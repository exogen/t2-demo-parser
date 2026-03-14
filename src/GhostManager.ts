import type { BitStream } from "./BitStream.js";
import type {
  ClassRegistry,
  ConnectionContext,
  GhostEntry,
  GhostTrackerInterface,
} from "./ClassRegistry.js";
import { MaxTriggerKeys } from "./types.js";

// ============================================================
// Ghost Tracker — tracks ghost lifecycle (create/update/delete)
// ============================================================

export class GhostTracker implements GhostTrackerInterface {
  private ghosts = new Map<number, GhostEntry>();

  getGhost(index: number): GhostEntry | undefined {
    return this.ghosts.get(index);
  }

  hasGhost(index: number): boolean {
    return this.ghosts.has(index);
  }

  createGhost(index: number, classId: number, className: string): GhostEntry {
    const entry: GhostEntry = { classId, className, state: {} };
    this.ghosts.set(index, entry);
    return entry;
  }

  deleteGhost(index: number): void {
    this.ghosts.delete(index);
  }

  getAllGhosts(): Map<number, GhostEntry> {
    return this.ghosts;
  }

  size(): number {
    return this.ghosts.size;
  }

  clear(): void {
    this.ghosts.clear();
  }
}

// ============================================================
// Shared parsing helpers
// ============================================================

function readMove(bs: BitStream): Record<string, unknown> {
  const pyaw = bs.readFlag() ? bs.readInt(16) : 0;
  const ppitch = bs.readFlag() ? bs.readInt(16) : 0;
  const proll = bs.readFlag() ? bs.readInt(16) : 0;
  const px = bs.readInt(6);
  const py = bs.readInt(6);
  const pz = bs.readInt(6);
  const freeLook = bs.readFlag();
  const trigger: boolean[] = [];
  for (let i = 0; i < MaxTriggerKeys; i++) {
    trigger.push(bs.readFlag());
  }
  return { pyaw, ppitch, proll, px, py, pz, freeLook, trigger };
}

/**
 * Read a packed ColorF: 4 × U8 (32 bits total), each converted to [0..1] float.
 * From decompiled binary: FUN_0043f040 reads 4 bytes, each × (1/255).
 */
function readPackedColorF(
  bs: BitStream
): { r: number; g: number; b: number; a: number } {
  return {
    r: bs.readInt(8) / 255,
    g: bs.readInt(8) / 255,
    b: bs.readInt(8) / 255,
    a: bs.readInt(8) / 255,
  };
}

/**
 * Tribes 2 object/datablock references are serialized via FUN_00436ce0/FUN_00436d10
 * as raw 11-bit object ids (nextPow2(0x800) -> bitCount 11).
 */
function readObjectRef11(bs: BitStream): number {
  return bs.readInt(11);
}

// ============================================================
// GameBase::unpackUpdate (base layer for all game objects)
// ============================================================

function readGameBaseUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // GameBase::unpackUpdate (FUN_005e3360)
  // DataBlockMask
  if (bs.readFlag()) {
    result.dataBlockId = readObjectRef11(bs);
  }

  // TargetMask
  if (bs.readFlag()) {
    // Optional explicit target id; otherwise remains -1.
    const hasTargetId = bs.readFlag();
    result.targetId = hasTargetId ? bs.readInt(9) : -1;
  }

  return result;
}

// ============================================================
// ShapeBase::unpackUpdate (layer 2 — damage, threads, images, etc.)
// ============================================================

function readShapeBaseUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readGameBaseUpdate(bs, isInitial, conn);

  // ShapeBase::unpackUpdate (FUN_005ef0e0)
  // Combined gate for all remaining ShapeBase masks.
  if (!bs.readFlag()) {
    return result;
  }

  // DamageMask
  if (bs.readFlag()) {
    result.damageLevel = bs.readFloat(6); // DamageLevelBits=6
    result.damageState = bs.readInt(2); // NumDamageStateBits=2
    result.blowApart = bs.readFlag();
    result.damageDir = bs.readNormalVector(8);
  }

  // SoundMask (4 sound slots)
  if (bs.readFlag()) {
    const sounds: Record<string, unknown>[] = [];
    for (let i = 0; i < 4; i++) {
      if (bs.readFlag()) {
        const playing = bs.readFlag();
        const sound: Record<string, unknown> = {
          index: i,
          playing,
        };
        if (playing) {
          sound.profileId = readObjectRef11(bs);
        }
        sounds.push(sound);
      }
    }
    if (sounds.length > 0) {
      result.sounds = sounds;
    }
  }

  // ThreadMask (script animation threads, 4 slots)
  if (bs.readFlag()) {
    const threads: Record<string, unknown>[] = [];
    for (let i = 0; i < 4; i++) {
      if (bs.readFlag()) {
        threads.push({
          index: i,
          sequence: bs.readInt(5),
          state: bs.readInt(2),
          forward: bs.readFlag(),
          atEnd: bs.readFlag(),
        });
      }
    }
    if (threads.length > 0) {
      result.threads = threads;
    }
  }

  // ImageMask (8 mounted image slots)
  let imageSkinDirty = false;
  if (bs.readFlag()) {
    const images: Record<string, unknown>[] = [];
    for (let i = 0; i < 8; i++) {
      if (bs.readFlag()) {
        const img: Record<string, unknown> = { index: i };

        // Optional image datablock reference.
        if (bs.readFlag()) {
          img.dataBlockId = readObjectRef11(bs);
        } else {
          img.dataBlockId = 0;
        }

        // FUN_00588870 payload: hasSkin -> (tagIndex|string).
        if (bs.readFlag()) {
          if (bs.readFlag()) {
            img.skinTagIndex = bs.readInt(10);
            imageSkinDirty = true;
          } else {
            img.skinName = bs.readString();
            imageSkinDirty = true;
          }
        }

        // Per-slot state flags + 3-bit fire count.
        // The retail Tribes 2 binary (FUN_005ef0e0) packs these in a different
        // order than the V12 SDK source code. Verified via Ghidra decompilation:
        // the binary stores to offsets 0x3ac (triggerDown), 0x398 (loaded),
        // 0x3ad (ammo), 0x3af (wet), 0x3ae (target), confirmed by matching the
        // setImage(slot, db, skin, loaded, ammo, triggerDown) call signature.
        img.triggerDown = bs.readFlag();
        img.loaded = bs.readFlag();
        img.ammo = bs.readFlag();
        img.wet = bs.readFlag();
        img.target = bs.readFlag();
        img.fireCount = bs.readInt(3);

        // Mounted-image firing bit (FUN_005ef0e0):
        // Read when (this+0x18 & 8)==0, i.e., when the object is NOT
        // "properly added" to the scene. Initial block creates and packet
        // stream ghost creates are NOT properly added (isInitial=true),
        // but packet stream ghost updates ARE properly added (isInitial=false).
        if (isInitial) {
          img.imageExtraFlag = bs.readFlag();
        }

        images.push(img);
      }
    }
    if (images.length > 0) {
      result.images = images;
    }
  }

  // ShapeBase post-image state cluster (FUN_005ef0e0 @ 0x005ef0e0).
  // This section must preserve exact flag nesting for bit-accurate decode.
  if (bs.readFlag()) {
    const hasStateA = bs.readFlag();
    if (hasStateA) {
      const stateAEnabled = bs.readFlag();
      result.stateAEnabled = stateAEnabled;
      result.stateB = bs.readFlag();
      const hasInvulnerability = bs.readFlag();
      result.hasInvulnerability = hasInvulnerability;

      if (hasInvulnerability) {
        result.invulnerabilityVisual = bs.readFlag();
        result.invulnerabilityTicks = bs.readU32();
      } else {
        result.binaryCloak = bs.readFlag();
      }
    }

    const hasStateB = bs.readFlag();
    if (hasStateB) {
      const useStateBFlag = bs.readFlag();
      if (useStateBFlag) {
        const stateBMode = bs.readFlag();
        result.stateBMode = stateBMode;
        if (stateBMode) {
          result.energyPackOn = true;
        } else {
          result.energyPackOn = false;
        }
      } else {
        result.shieldNormal = bs.readNormalVector(8);
        result.energyPercent = bs.readFloat(5);
      }
    }

    if (bs.readFlag()) {
      result.stateValue1 = bs.readU32();
      result.stateValue2 = bs.readU32();
    }
  }

  if (imageSkinDirty) {
    result.imageSkinDirty = true;
  }

  // MountedMask
  if (bs.readFlag()) {
    if (bs.readFlag()) {
      // Mounting
      result.mountObject = bs.readInt(10);
      result.mountNode = bs.readInt(5); // NumMountPointBits=5
    } else {
      result.mountObject = -1; // Unmounting
    }
  }

  return result;
}

// ============================================================
// Player ghost parser
// ============================================================

function playerUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readShapeBaseUpdate(bs, isInitial, conn);

  // ImpactMask (only on non-initial updates)
  if (bs.readFlag()) {
    result.impactSound = bs.readInt(3); // ImpactBits=3
  }

  // ActionMask — action animation
  if (bs.readFlag()) {
    result.action = bs.readInt(8); // ActionAnimBits=8
    result.actionHoldAtEnd = bs.readFlag();
    result.actionAtEnd = bs.readFlag();
    result.actionFirstPerson = bs.readFlag();
    if (!result.actionAtEnd) {
      if (bs.readFlag()) {
        result.actionAnimPos = bs.readSignedFloat(6);
      }
    }
  }

  // ActionMask — arm animation
  if (bs.readFlag()) {
    result.armAction = bs.readInt(8); // ActionAnimBits=8
  }

  // Control object shortcut — if controlled by this client, skip rest
  if (bs.readFlag()) {
    return result;
  }

  // MoveMask
  if (bs.readFlag()) {
    result.actionState = bs.readInt(3); // NumStateBits=3
    if (bs.readFlag()) {
      // RecoverState
      result.recoverTicks = bs.readInt(7); // RecoverDelayBits=7
    }

    // FUN_005db2d0: two state flags immediately before compressed position.
    result.moveFlag0 = bs.readFlag();
    result.moveFlag1 = bs.readFlag();

    result.position = bs.readCompressedPoint(conn.compressionPoint);

    // Velocity
    if (bs.readFlag()) {
      // Binary (0x5db850): readInt(13) FIRST, then readNormalVector(10)
      const velMag = bs.readInt(13) / 32.0;
      const velDir = bs.readNormalVector(10);
      result.velocity = {
        x: velDir.x * velMag,
        y: velDir.y * velMag,
        z: velDir.z * velMag,
      };
    } else {
      result.velocity = { x: 0, y: 0, z: 0 };
    }

    result.headX = bs.readSignedFloat(6); // * maxLookAngle
    result.headZ = bs.readSignedFloat(6); // * maxLookAngle
    result.rotationZ = bs.readFloat(7) * 2 * Math.PI;

    result.move = readMove(bs);
    result.allowWarp = bs.readFlag();
  }

  // Energy (always present after MoveMask section)
  result.energy = bs.readFloat(5); // EnergyLevelBits=5

  return result;
}

function playerReadPacketData(
  bs: BitStream,
  conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // ShapeBase::readPacketData
  result.energyLevel = bs.readF32();
  result.rechargeRate = bs.readF32();

  // Player::readPacketData
  result.actionState = bs.readInt(3); // NumStateBits=3
  if (bs.readFlag()) {
    // RecoverState
    result.recoverTicks = bs.readInt(7);
  }
  if (bs.readFlag()) {
    result.jumpDelay = bs.readInt(7); // JumpDelayBits=7
  }

  if (bs.readFlag()) {
    // Not mounted — read full position/velocity
    const pos = {
      x: bs.readF32(),
      y: bs.readF32(),
      z: bs.readF32(),
    };
    result.position = pos;
    // Update compression point (this IS the compression point)
    conn.compressionPoint = pos;
    result.velocity = {
      x: bs.readF32(),
      y: bs.readF32(),
      z: bs.readF32(),
    };
    result.jumpSurfaceLastContact = bs.readInt(4);
  }

  result.headX = bs.readF32();
  result.headZ = bs.readF32();
  result.rotationZ = bs.readF32();

  if (bs.readFlag()) {
    // Has control object (e.g., vehicle being piloted)
    // Binary FUN_005dab20: readInt(10) + resolveGhost + obj->readPacketData(conn, stream)
    const controlGhostIndex = bs.readInt(10);
    result.controlObjectGhost = controlGhostIndex;

    // Recursively call the control object's readPacketData.
    // Look up the ghost class and find its readPacketData parser.
    const controlGhost = conn.ghostTracker.getGhost(controlGhostIndex);
    const controlParser = controlGhost
      ? conn.getGhostParser?.(controlGhost.classId)
      : undefined;
    if (controlParser?.readPacketData) {
      const prevGhostIndex = conn.currentGhostIndex;
      conn.currentGhostIndex = controlGhostIndex;
      result.controlObjectData = controlParser.readPacketData(bs, conn);
      conn.currentGhostIndex = prevGhostIndex;
    }
  }

  result.disableMove = bs.readFlag();
  result.pilot = bs.readFlag();

  return result;
}

// ============================================================
// Vehicle ghost parser
// ============================================================

function vehicleUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readShapeBaseUpdate(bs, isInitial, conn);

  result.jetting = bs.readFlag();

  // Control object shortcut — server writes true and returns early,
  // meaning no further Vehicle data follows in the stream.
  if (bs.readFlag()) {
    result._controlledEarlyReturn = true;
    return result;
  }

  // Steering
  result.steeringYaw = bs.readFloat(9);
  result.steeringPitch = bs.readFloat(9);
  result.move = readMove(bs);
  result.frozen = bs.readFlag();

  // PositionMask
  if (bs.readFlag()) {
    result.position = bs.readCompressedPoint(conn.compressionPoint);
    // Angular position as quaternion (4x F32)
    result.angPosition = {
      x: bs.readF32(),
      y: bs.readF32(),
      z: bs.readF32(),
      w: bs.readF32(),
    };
    // Linear momentum (3x F32)
    result.linMomentum = bs.readPoint3F();
    // Angular momentum (3x F32)
    result.angMomentum = bs.readPoint3F();
  }

  // EnergyMask
  if (bs.readFlag()) {
    result.energy = bs.readFloat(8);
  }

  return result;
}

function vehicleReadPacketData(
  bs: BitStream,
  conn: ConnectionContext
): Record<string, unknown> {
  // Vehicle::readPacketData (binary FUN_0060d740)
  // ShapeBase::readPacketData → GameBase::readPacketData (empty) + energy + recharge
  const result: Record<string, unknown> = {};
  result.energyLevel = bs.readF32();
  result.rechargeRate = bs.readF32();

  // Vehicle-specific rigid body state
  result.steering = { x: bs.readF32(), y: bs.readF32() };
  const linPos = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
  result.linPosition = linPos;
  result.angPosition = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
    w: bs.readF32(),
  };
  result.linMomentum = bs.readPoint3F();
  result.angMomentum = bs.readPoint3F();
  result.disableMove = bs.readFlag();
  result.frozen = bs.readFlag();
  conn.compressionPoint = linPos;
  return result;
}

function wheeledVehicleReadPacketData(
  bs: BitStream,
  conn: ConnectionContext
): Record<string, unknown> {
  // WheeledVehicle::readPacketData (binary FUN_00615840)
  // Calls Parent::readPacketData (Vehicle) + braking flag + per-wheel data
  const result = vehicleReadPacketData(bs, conn);
  result.braking = bs.readFlag();
  // wheelCount × 3 F32 (avel, Dy, Dx per wheel)
  // Use ghost wheel count cache (populated during ghost creates)
  let wheelCount = 4;
  const ghostIdx = conn.currentGhostIndex;
  if (ghostIdx !== undefined) {
    const cached = ghostWheelCountCache.get(ghostIdx);
    if (cached !== undefined) {
      wheelCount = cached;
    }
  }
  const wheels: Array<{ avel: number; Dy: number; Dx: number }> = [];
  for (let i = 0; i < wheelCount; i++) {
    wheels.push({
      avel: bs.readF32(),
      Dy: bs.readF32(),
      Dx: bs.readF32(),
    });
  }
  result.wheels = wheels;
  return result;
}

// ============================================================
// FlyingVehicle ghost parser
// ============================================================

function flyingVehicleUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = vehicleUnpackUpdate(bs, isInitial, conn);

  // FlyingVehicle has its own control gate flag (separate from Vehicle's).
  // Retail binary removed the V12 ThrustMask wrapper but kept the per-subclass
  // control check: if true, no FlyingVehicle-specific data follows.
  if (bs.readFlag()) {
    return result;
  }
  result.createHeightOn = bs.readFlag();
  result.thrustDirection = bs.readInt(3); // NumThrustBits=3

  return result;
}

// ============================================================
// HoverVehicle ghost parser
// ============================================================

function hoverVehicleUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = vehicleUnpackUpdate(bs, isInitial, conn);
  result.thrustDirection = bs.readInt(3); // NumThrustBits=3
  return result;
}

// ============================================================
// Item ghost parser
// ============================================================

function itemUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readShapeBaseUpdate(bs, isInitial, conn);

  // InitialUpdateMask
  if (bs.readFlag()) {
    result.rotate = bs.readFlag();
    result.isStatic = bs.readFlag();
    result.collideable = bs.readFlag();
    if (bs.readFlag()) {
      result.scale = bs.readPoint3F();
    }
  }

  // ThrowSrcMask
  if (bs.readFlag()) {
    result.collisionObject = bs.readInt(10);
  }

  // RotationMask (only if !rotate)
  if (bs.readFlag()) {
    const zSign = bs.readFlag() ? -1 : 1;
    const angle = bs.readF32();
    result.rotation = { zSign, angle };
  }

  // PositionMask
  if (bs.readFlag()) {
    result.position = bs.readPoint3F();
    const atRest = bs.readFlag();
    result.atRest = atRest;
    if (!atRest) {
      result.velocity = bs.readPoint3F();
    }
    result.warp = bs.readFlag();
  }

  return result;
}

// ============================================================
// StaticShape ghost parser
// ============================================================

function staticShapeUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readShapeBaseUpdate(bs, isInitial, conn);

  // PositionMask
  if (bs.readFlag()) {
    // FUN_00602da0 -> FUN_0043c4c0 reads compressed affine transform
    // (position + quaternion xyz + sign bit), not a full MatrixF.
    result.transform = bs.readAffineTransform();
    result.position = (result.transform as { position?: unknown }).position;
    result.scale = bs.readPoint3F();
  }

  // Power state (always present)
  result.powered = bs.readFlag();

  return result;
}

function scopeAlwaysShapeUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // ScopeAlwaysShape vtable +0x4c -> FUN_00602da0 (same as StaticShape).
  return staticShapeUnpackUpdate(bs, isInitial, conn);
}

function markerUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  // Marker::unpackUpdate (simPath.cc): Parent::unpackUpdate (SceneObject,
  // no data) then reads just a Point3F position.
  const position = bs.readPoint3F();
  return { position };
}

function simpleNetObjectUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  // SimpleNetObject vtable +0x4c -> FUN_005c5220 (single string).
  return { message: bs.readString() };
}

function beaconObjectUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // BeaconObject vtable +0x4c -> FUN_006a3ae0:
  // StaticShape payload + optional 2-bit beacon type.
  const result = staticShapeUnpackUpdate(bs, isInitial, conn);
  if (bs.readFlag()) {
    result.beaconType = bs.readInt(2);
  }
  return result;
}

function missionMarkerUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // MissionMarker extends ShapeBase (confirmed by V12 source and empirical
  // testing). The Ghidra decompilation misidentified the parent call — the
  // real parent is ShapeBase::unpackUpdate, not an empty stub.
  const result = readShapeBaseUpdate(bs, isInitial, conn);

  // MissionMarker's own field: PositionMask
  if (bs.readFlag()) {
    result.transform = bs.readAffineTransform();
    result.position = (result.transform as { position?: unknown }).position;
    result.scale = bs.readPoint3F();
  }

  return result;
}

function debrisUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Debris vtable +0x4c -> FUN_006844d0.
  // Confirmed in decompiled binary: calls parent GameBase::unpackUpdate first.
  const result = readGameBaseUpdate(bs, isInitial, conn);

  // 6 × F32
  result.value0 = bs.readF32();
  result.value1 = bs.readF32();
  result.value2 = bs.readF32();
  result.value3 = bs.readF32();
  result.value4 = bs.readF32();
  result.value5 = bs.readF32();

  // 4 × bool (readBool = 8-bit)
  result.bool0 = bs.readBool();
  result.bool1 = bs.readBool();
  result.bool2 = bs.readBool();
  result.bool3 = bs.readBool();

  // 6 × F32
  result.value6 = bs.readF32();
  result.value7 = bs.readF32();
  result.value8 = bs.readF32();
  result.value9 = bs.readF32();
  result.value10 = bs.readF32();
  result.value11 = bs.readF32();

  // 2 × bool
  result.bool4 = bs.readBool();
  result.bool5 = bs.readBool();

  // 3 × F32
  result.value12 = bs.readF32();
  result.value13 = bs.readF32();
  result.value14 = bs.readF32();

  // 1 × bool
  result.bool6 = bs.readBool();

  // 2 × string
  result.string0 = bs.readString();
  result.string1 = bs.readString();

  // 3 conditional object references
  const refs: number[] = [];
  for (let i = 0; i < 2; i++) {
    refs.push(bs.readFlag() ? readObjectRef11(bs) : -1);
  }
  result.objectRefs = refs;
  result.objectRef2 = bs.readFlag() ? readObjectRef11(bs) : -1;

  return result;
}

function projectileUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Projectile vtable +0x4c -> FUN_005e3360 (GameBase only).
  return readGameBaseUpdate(bs, isInitial, conn);
}

// ============================================================
// Projectile ghost parsers
// ============================================================

function bombProjectileUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  // BombProjectile vtable +0x4c -> FUN_00636050.
  const result: Record<string, unknown> = {};

  // Parent GameBase::unpackUpdate
  if (bs.readFlag()) {
    result.dataBlockId = readObjectRef11(bs);
  }
  if (bs.readFlag()) {
    const hasTargetId = bs.readFlag();
    result.targetId = hasTargetId ? bs.readInt(9) : -1;
  }

  if (!bs.readFlag()) {
    if (bs.readFlag()) {
      result.position = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
      result.velocity = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
    }
    if (!bs.readFlag()) {
      return result;
    }
    result.endPoint = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
    result.endNormal = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
    return result;
  }

  result.position = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
  result.velocity = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
  result.currTick = bs.readInt(12); // nextPow2(0x1000) -> 12 bits

  if (bs.readFlag()) {
    result.resetFlag = true; // FUN_00636ae0 side-effect-only
  }

  if (bs.readFlag()) {
    result.explodePoint = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
    result.explodeNormal = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
  }

  if (bs.readFlag()) {
    result.sourceObject = bs.readInt(11); // nextPow2(0x401) -> 11 bits
    result.sourceSlot = bs.readInt(3); // nextPow2(8) -> 3 bits
  } else {
    result.sourceObject = -1;
    result.sourceSlot = -1;
  }

  if (bs.readFlag()) {
    result.vehicleObject = bs.readInt(11); // nextPow2(0x401) -> 11 bits
  } else {
    result.vehicleObject = 0;
  }

  return result;
}

function grenadeUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Parent: Projectile → GameBase (Projectile has no override)
  const result = readGameBaseUpdate(bs, isInitial, conn);

  if (bs.readFlag()) {
    // InitialUpdateMask
    result.position = bs.readPoint3F();
    result.velocity = bs.readPoint3F();
    result.currTick = bs.readRangedU32(0, 4095);
    result.quickSplash = bs.readFlag();
    if (bs.readFlag()) {
      result.explodePoint = bs.readPoint3F();
      result.explodeNormal = bs.readPoint3F();
    }
    if (bs.readFlag()) {
      result.sourceObject = bs.readRangedU32(0, 1024);
      result.sourceSlot = bs.readRangedU32(0, 7);
    }
    if (bs.readFlag()) {
      result.vehicleObject = bs.readRangedU32(0, 1024);
    }
  } else {
    // Non-initial
    if (bs.readFlag()) {
      // BounceMask
      result.position = bs.readPoint3F();
      result.velocity = bs.readPoint3F();
    }
    if (bs.readFlag()) {
      // ExplosionMask
      result.explodePoint = bs.readPoint3F();
      result.explodeNormal = bs.readPoint3F();
    }
  }

  return result;
}

function seekerUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // SeekerProjectile::unpackUpdate in build 25034 is FUN_0063c010
  // (vtable PTR_FUN_007ae54c + 0x4c), with parent GameBase::unpackUpdate.
  const result = readGameBaseUpdate(bs, isInitial, conn);

  const fullStateMask = bs.readFlag();
  if (!fullStateMask) {
    // 0x0063c010 non-full path
    const isExplosion = bs.readFlag();
    if (isExplosion) {
      // FUN_00639370: explode(position, normal) — SeekerProjectile detonation.
      result.explodePosition = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
      result.explodeNormal = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
      return result;
    }

    result.position = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
    result.velocity = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };

    const hasTargetInfo = bs.readFlag();
    if (hasTargetInfo) {
      const hasTargetGhost = bs.readFlag();
      if (!hasTargetGhost) {
        result.targetDirection = {
          x: bs.readF32(),
          y: bs.readF32(),
          z: bs.readF32(),
        };
        result.targetMode = 1;
      } else {
        // getBitCount(getNextPow2(0x401)) -> 11 bits
        result.targetGhost = bs.readInt(11);
        result.targetMode = 0;
      }
    } else {
      result.targetMode = 2;
    }

    return result;
  }

  // 0x0063c010 full-state path
  result.position = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
  result.velocity = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
  result.orientation = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };

  // Optional source object + slot
  if (bs.readFlag()) {
    result.sourceObject = bs.readInt(11); // getBitCount(getNextPow2(0x401))
    result.sourceSlot = bs.readInt(3); // getBitCount(getNextPow2(8))
  } else {
    result.sourceObject = -1;
    result.sourceSlot = -1;
  }

  // Optional target descriptor
  if (bs.readFlag()) {
    const hasTargetGhost = bs.readFlag();
    if (!hasTargetGhost) {
      result.targetDirection = {
        x: bs.readF32(),
        y: bs.readF32(),
        z: bs.readF32(),
      };
      result.targetMode = 1;
    } else {
      result.targetGhost = bs.readInt(11); // getBitCount(getNextPow2(0x401))
      result.targetMode = 0;
    }
  } else {
    result.targetMode = 2;
  }

  // Final timeout/alive flag branch in FUN_0063c010.
  result.timeoutReset = bs.readFlag();

  return result;
}

// ============================================================
// Turret ghost parser
// ============================================================

function turretUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Turret extends StaticShape (confirmed in decompiled binary FUN_00655f60
  // calls FUN_00602da0 = StaticShape::unpackUpdate as parent)
  const result = staticShapeUnpackUpdate(bs, isInitial, conn);

  // Capacitor energy (Tribes 2 specific — not in V12/TorqueSDK)
  if (bs.readFlag()) {
    result.capacitorEnergy = bs.readFloat(8);
  }

  // Control client shortcut
  if (bs.readFlag()) {
    return result;
  }

  // Barrel rotation state
  if (bs.readFlag()) {
    result.phi = bs.readFloat(10);
    result.theta = bs.readFloat(10);
    result.activationLevel = bs.readFloat(8);
  }

  return result;
}

// ============================================================
// InteriorInstance ghost parser (partial — can't parse light groups without resource)
// ============================================================

function interiorUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (bs.readFlag()) {
    // InitMask — full initial state
    result.crc = bs.readU32();
    result.interiorFile = bs.readString();
    result.showTerrainInside = bs.readFlag();
    result.transform = bs.readMatrixF();
    result.scale = bs.readPoint3F();
    result.alarmState = bs.readFlag();
    result.skinBase = bs.readString();
    if (bs.readFlag()) {
      result.audioProfileId = readObjectRef11(bs);
    }
    if (bs.readFlag()) {
      result.audioEnvironmentId = readObjectRef11(bs);
    }
  } else {
    // Normal update
    if (bs.readFlag()) {
      // TransformMask
      result.transform = bs.readMatrixF();
      result.scale = bs.readPoint3F();
    }
    result.alarmState = bs.readFlag();

    // LightUpdateGrouper — iterates over bits 3-10 (8 slots), each slot
    // containing a dirty flag + N active flags (one per light in that group).
    // The loop exits at the first bit position with 0 keys. We don't know
    // the interior resource so we can't determine key counts. For interiors
    // with 0 animated lights (the common case), no bits are written here.
    // We assume 0 and continue to the remaining masks.

    // SkinBaseMask
    if (bs.readFlag()) {
      result.skinBase = bs.readString();
    }
    // AudioMask
    if (bs.readFlag()) {
    if (bs.readFlag()) {
      result.audioProfileId = readObjectRef11(bs);
    }
    if (bs.readFlag()) {
      result.audioEnvironmentId = readObjectRef11(bs);
    }
    }
  }

  return result;
}

// ============================================================
// Camera ghost parser (simple)
// ============================================================

function cameraUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Camera::unpackUpdate (FUN_005cc8c0):
  // 1) ShapeBase::unpackUpdate (FUN_005ef0e0)
  // 2) if (control object shortcut flag) return
  // 3) if (camera update flag) read 5 x F32
  const result = readShapeBaseUpdate(bs, isInitial, conn);

  // Controlled by local connection: no additional payload in this update.
  if (bs.readFlag()) {
    return result;
  }

  // Camera-specific payload (5 floats in retail Tribes2.exe).
  if (bs.readFlag()) {
    result.posX = bs.readF32();
    result.posY = bs.readF32();
    result.posZ = bs.readF32();
    result.fovOrDist = bs.readF32();
    result.orbitParam = bs.readF32();
  }

  return result;
}

function cameraReadPacketData(
  bs: BitStream,
  conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Camera::readPacketData (FUN_005cc530 / FUN_005cc650):
  // Parent::readPacketData + absolute camera transform basis + mode-specific orbit payload.
  result.energyLevel = bs.readF32();
  result.rechargeRate = bs.readF32();

  const pos = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };
  result.position = pos;
  result.rotX = bs.readF32();
  result.rotZ = bs.readF32();

  // writeRangedU32(mode, 0, 4) -> 3 bits.
  const cameraMode = bs.readInt(3);
  result.cameraMode = cameraMode;

  // Modes 3/4 include orbit-distance payload.
  if (cameraMode === 3 || cameraMode === 4) {
    result.minOrbitDist = bs.readF32();
    result.maxOrbitDist = bs.readF32();
    result.curOrbitDist = bs.readF32();

    // OrbitObjectMode: observing flag + always-read 10-bit target ghost index.
    if (cameraMode === 3) {
      result.observingClientObject = bs.readFlag();
      result.orbitObjectGhostIndex = bs.readInt(10);
    }

    // OrbitPointMode: NetConnection::readCompressed using current compression point.
    if (cameraMode === 4) {
      result.orbitPoint = bs.readCompressedPoint(conn.compressionPoint, 0.01);
    }
  }

  // The camera packet updates the connection compression point to absolute camera pos.
  conn.compressionPoint = pos;

  return result;
}

// ============================================================
// LinearProjectile ghost parser
// ============================================================

function linearProjectileUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Parent: LinearProjectile → Projectile → GameBase
  const result = readGameBaseUpdate(bs, isInitial, conn);

  if (bs.readFlag()) {
    // InitialUpdateMask
    if (bs.readFlag()) {
      // Hidden/already exploded (mHidden=true): initial create of finished projectile
      // Binary: sets mHidden=1, reads pos+direction, computes endpoint, reads decal flag
      result.hidden = true;
      result.explodePosition = bs.readCompressedPoint(conn.compressionPoint);
      result.explodeNormal = bs.readNormalVector(14); // binary: 0xe
      result.endedWithDecal = bs.readFlag();
    } else {
      // Live projectile initial update
      result.position = bs.readCompressedPoint(conn.compressionPoint);
      result.direction = bs.readNormalVector(14); // binary: 0xe
      result.currTick = bs.readRangedU32(0, 511); // nextPow2(0x200)=9 bits
      if (bs.readFlag()) {
        result.sourceObject = bs.readInt(10); // nextPow2(0x400)=10 bits
        result.sourceSlot = bs.readRangedU32(0, 7); // nextPow2(8)=3 bits
        if (bs.readFlag()) {
          result.excessVel = bs.readRangedU32(0, 255); // nextPow2(0x100)=8 bits
          result.excessDir = bs.readNormalVector(7);
        }
      }
      if (bs.readFlag()) {
        result.vehicleObject = bs.readInt(10); // nextPow2(0x400)=10 bits
      }
    }
  } else {
    // Non-initial: explosion notification
    result.explodePosition = bs.readCompressedPoint(conn.compressionPoint);
    result.explodeNormal = bs.readNormalVector(14); // binary: 0xe
    result.endedWithDecal = bs.readFlag();
  }

  return result;
}

// ============================================================
// ELFProjectile ghost parser
// ============================================================

function elfProjectileUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Parent: ELFProjectile → GameBase
  const result = readGameBaseUpdate(bs, isInitial, conn);

  if (bs.readFlag()) {
    if (bs.readFlag()) {
      result.sourceObject = bs.readRangedU32(0, 1024);
      result.sourceSlot = bs.readRangedU32(0, 7);
      result.targetObject = bs.readRangedU32(0, 1024);
    }
  }

  return result;
}

// ============================================================
// RepairProjectile ghost parser
// ============================================================

function repairProjectileUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Parent: RepairProjectile → GameBase
  const result = readGameBaseUpdate(bs, isInitial, conn);

  if (bs.readFlag()) {
    // InitialUpdateMask
    if (bs.readFlag()) {
      result.sourceObject = bs.readRangedU32(0, 1024);
      result.sourceSlot = bs.readRangedU32(0, 7);
      result.repairingObject = bs.readRangedU32(0, 1024);
    }
  }
  // Non-initial update: no data

  return result;
}

// ============================================================
// TargetProjectile ghost parser
// ============================================================

function targetProjectileUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Parent: TargetProjectile → Projectile → GameBase
  const result = readGameBaseUpdate(bs, isInitial, conn);

  if (bs.readFlag()) {
    // InitialUpdateMask
    result.initialPosition = bs.readPoint3F();
    result.endPos = bs.readPoint3F();
    result.truncated = bs.readFlag();
    if (bs.readFlag()) {
      result.sourceObject = bs.readRangedU32(0, 1024);
      result.sourceSlot = bs.readRangedU32(0, 7);
      result.clientOwned = bs.readFlag();
    }
  } else {
    // Swing update
    if (bs.readFlag()) {
      result.sourceObject = bs.readRangedU32(0, 1024);
      result.sourceSlot = bs.readRangedU32(0, 7);
      result.clientOwned = bs.readFlag();
    } else {
      result.initialPosition = bs.readPoint3F();
    }
    result.endPos = bs.readPoint3F();
    result.truncated = bs.readFlag();
  }

  return result;
}

// ============================================================
// WayPoint ghost parser
// ============================================================

function wayPointUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // WayPoint extends MissionMarker (V12 source: missionMarker.h)
  const result = missionMarkerUnpackUpdate(bs, isInitial, conn);

  // WayPoint additions
  if (bs.readFlag()) {
    result.name = bs.readString();
  }
  if (bs.readFlag()) {
    result.teamId = bs.readS32();
  }
  if (bs.readFlag()) {
    result.hidden = bs.readFlag();
  }

  return result;
}

// ============================================================
// SpawnSphere ghost parser
// ============================================================

function spawnSphereUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // SpawnSphere extends MissionMarker (V12 source: missionMarker.h)
  const result = missionMarkerUnpackUpdate(bs, isInitial, conn);

  // SpawnSphere additions
  if (bs.readFlag()) {
    result.radius = bs.readF32();
    result.sphereWeight = bs.readF32();
    result.indoorWeight = bs.readF32();
    result.outdoorWeight = bs.readF32();
  }

  return result;
}

// ============================================================
// ForceFieldBare ghost parser
// ============================================================

function forceFieldBareUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  // ForceFieldBare::unpackUpdate (FUN_00676d30):
  // GameBase parent, then two-level transform flags, then StateChangeMask.
  const result = readGameBaseUpdate(bs, _isInitial, _conn);

  // InitialUpdateMask flag — if true, reads transform+scale (initial path)
  if (bs.readFlag()) {
    result.transform = bs.readAffineTransform();
    result.scale = bs.readPoint3F();
  } else {
    // Non-initial: TransformMask flag
    if (bs.readFlag()) {
      result.transform = bs.readAffineTransform();
      result.scale = bs.readPoint3F();
    }
  }

  // StateChangeMask
  if (bs.readFlag()) {
    const state = bs.readInt(2); // 0=Open, 1=Opening, 2=Closing, 3=Closed
    result.state = state;
    if (state === 3) {
      // Closed: position = 0 (not read from stream)
      result.position = 0;
    } else if (state === 0) {
      // Open: position = datablock fadeMS (not read from stream)
    } else {
      // Opening (1) or Closing (2): read position from stream
      result.position = bs.readU32();
    }
  }

  return result;
}

// ============================================================
// TSStatic ghost parser
// ============================================================

function tsStaticUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // TSStatic::unpackUpdate (FUN_00690580) has no update-mask flags:
  // it always serializes MatrixF transform, Point3F scale, and shapeName.
  result.transform = bs.readMatrixF();
  result.scale = bs.readPoint3F();
  result.shapeName = bs.readString();

  return result;
}

// ============================================================
// TerrainBlock ghost parser
// ============================================================

function terrainBlockUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  // TerrainBlock extends SceneObject (NOT GameBase).
  // V12 source: terrain/terrData.cc lines 910-941
  // Format:
  //   flag(InitMask) → U32 CRC + readString(terrFileName)
  //     + readString(detailTextureName) + U32 squareSize
  //     + U32 count + U32[count] emptySquareRuns
  //   else → flag(EmptyMask) → U32 count + U32[count] emptySquareRuns
  const result: Record<string, unknown> = {};

  if (bs.readFlag()) {
    // InitMask
    result.crc = bs.readU32();
    result.terrFileName = bs.readString();
    result.detailTextureName = bs.readString();
    result.squareSize = bs.readU32();

    const size = bs.readU32();
    const emptySquareRuns: number[] = [];
    for (let i = 0; i < size; i++) {
      emptySquareRuns.push(bs.readU32());
    }
    result.emptySquareRuns = emptySquareRuns;
    result.emptySquareRunCount = size;
  } else {
    // Normal update
    if (bs.readFlag()) {
      // EmptyMask
      const size = bs.readU32();
      const emptySquareRuns: number[] = [];
      for (let i = 0; i < size; i++) {
        emptySquareRuns.push(bs.readU32());
      }
      result.emptySquareRuns = emptySquareRuns;
      result.emptySquareRunCount = size;
    }
  }

  return result;
}

// ============================================================
// Sun ghost parser
// ============================================================

function sunUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  // Binary FUN_005b1620: TWO separate readFlag blocks.
  // Block 1: 5 texture/environment map name strings
  // Block 2: 19 F32 values (direction + color + ambient + extra light properties)
  const result: Record<string, unknown> = {};

  // Block 1: texture names (5 × readSTString)
  if (bs.readFlag()) {
    const textures: string[] = [];
    for (let i = 0; i < 5; i++) {
      textures.push(bs.readString());
    }
    result.textures = textures;
  }

  // Block 2: light properties (19 × F32)
  if (bs.readFlag()) {
    const values: number[] = [];
    for (let i = 0; i < 19; i++) {
      values.push(bs.readF32());
    }
    result.direction = { x: values[0], y: values[1], z: values[2] };
    result.color = { r: values[3], g: values[4], b: values[5], a: values[6] };
    result.ambient = { r: values[7], g: values[8], b: values[9], a: values[10] };
    // Remaining 8 values are additional light properties in build 25034
    result.extraLightProps = values.slice(11);
  }

  return result;
}

// ============================================================
// Sky ghost parser
// ============================================================

function skyUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Decompiled from FUN_005ab580 (Sky::unpackUpdate) / FUN_005abfd0 (packUpdate).
  // This layout is significantly larger than Torque-era Sky examples and must
  // stay aligned with the retail Tribes 2 binary.

  // InitialUpdateMask
  if (bs.readFlag()) {
    result.materialList = bs.readString();
    result.fogColor = { r: bs.readF32(), g: bs.readF32(), b: bs.readF32() };

    const fogVolumeCount = bs.readU32();
    if (fogVolumeCount > 64) {
      throw new Error(`Invalid Sky fogVolumeCount: ${fogVolumeCount}`);
    }
    result.fogVolumeCount = fogVolumeCount;

    // bool fields are read via Stream::read(1) in the binary (byte-sized bool)
    result.useSkyTextures = bs.readBool();
    result.renderBottomTexture = bs.readBool();
    result.skySolidColor = { r: bs.readF32(), g: bs.readF32(), b: bs.readF32() };
    result.windEffectPrecipitation = bs.readBool();

    const fogVolumes: Record<string, unknown>[] = [];
    for (let i = 0; i < fogVolumeCount; i++) {
      // V12 sky.cc writes: visibleDistance, minHeight, maxHeight, color
      fogVolumes.push({
        visibleDistance: bs.readF32(),
        minHeight: bs.readF32(),
        maxHeight: bs.readF32(),
        color: { r: bs.readF32(), g: bs.readF32(), b: bs.readF32() },
      });
    }
    result.fogVolumes = fogVolumes;

    const cloudLayers: Record<string, unknown>[] = [];
    for (let i = 0; i < 3; i++) {
      cloudLayers.push({
        texture: bs.readString(),
        heightPercent: bs.readF32(),
        speed: bs.readF32(),
      });
    }
    result.cloudLayers = cloudLayers;

    // Initial wind velocity vector
    result.windVelocity = bs.readPoint3F();
    result.stormCurrent = bs.readF32();

    if (bs.readFlag()) {
      result.stormInit = {
        startPct: bs.readF32(),
        duration: bs.readF32(),
        indexOrMode: bs.readF32(),
        startTime: bs.readF32(),
        targetPct: bs.readF32(),
      };
    }
  }

  // StormCloudsShow mask
  if (bs.readFlag()) {
    result.stormCloudsOn = bs.readBool();
  }

  // StormFogShow mask
  if (bs.readFlag()) {
    result.stormFogOn = bs.readBool();
  }

  // Distance mask (visible/fog distances)
  if (bs.readFlag()) {
    result.visibleDistance = bs.readF32();
    result.fogDistance = bs.readF32();
  }

  // Storm/falloff mask
  if (bs.readFlag()) {
    result.stormType = bs.readF32();
    result.stormMagnitude = bs.readF32();
  }

  // Storm timeline mask
  if (bs.readFlag()) {
    result.stormTimeline = {
      startPct: bs.readF32(),
      duration: bs.readF32(),
      indexOrMode: bs.readF32(),
    };
  }

  // Storm cloud profile mask
  if (bs.readFlag()) {
    result.stormCloudProfile = {
      enabled: bs.readF32(),
      value0: bs.readF32(),
      value1: bs.readF32(),
      value2: bs.readF32(),
    };
  }

  // Wind velocity update mask
  if (bs.readFlag()) {
    result.windVelocity = bs.readPoint3F();
  }

  return result;
}

// ============================================================
// Lightning ghost parser (GameBase subclass)
// ============================================================

function lightningUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readGameBaseUpdate(bs, isInitial, conn);
  if (bs.readFlag()) {
    // InitialUpdateMask — only sent on create
    result.position = bs.readPoint3F();
    result.scale = bs.readPoint3F();
    result.strikeWidth = bs.readF32();
    result.chanceToHitTarget = bs.readF32();
    result.strikeRadius = bs.readF32();
    result.boltStartRadius = bs.readF32();
    result.color = { r: bs.readF32(), g: bs.readF32(), b: bs.readF32() };
    result.fadeColor = { r: bs.readF32(), g: bs.readF32(), b: bs.readF32() };
    result.useFog = bs.readInt(8) !== 0; // bool read as U8
    result.strikesPerMinute = bs.readF32();
  }
  return result;
}

// ============================================================
// WaterBlock ghost parser (SceneObject subclass, NO GameBase)
// ============================================================

const WC_NUM_SUBMERGE_TEX = 2;

function waterBlockUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // No flag checks — always sends everything
  result.transform = bs.readAffineTransform();
  result.scale = bs.readPoint3F();
  result.surfaceName = bs.readString();
  result.envMapName = bs.readString();
  const submergeNames: string[] = [];
  for (let i = 0; i < WC_NUM_SUBMERGE_TEX; i++) {
    submergeNames.push(bs.readString());
  }
  result.submergeNames = submergeNames;
  result.liquidType = bs.readS32();
  result.density = bs.readF32();
  result.viscosity = bs.readF32();
  result.waveMagnitude = bs.readF32();
  result.surfaceOpacity = bs.readF32();
  result.envMapIntensity = bs.readF32();
  result.removeWetEdges = bs.readInt(8) !== 0; // bool as U8
  if (bs.readFlag()) {
    result.audioEnvironmentId = readObjectRef11(bs);
  }
  return result;
}

// ============================================================
// MissionArea ghost parser (NetObject subclass)
// ============================================================

function missionAreaUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (bs.readFlag()) {
    // RectI: point.x, point.y, extent.x, extent.y
    result.area = {
      x: bs.readS32(),
      y: bs.readS32(),
      w: bs.readS32(),
      h: bs.readS32(),
    };
    result.flightCeiling = bs.readF32();
    result.flightCeilingRange = bs.readF32();
  }
  return result;
}

// ============================================================
// Splash ghost parser (GameBase subclass)
// ============================================================

function splashUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readGameBaseUpdate(bs, isInitial, conn);
  if (bs.readFlag()) {
    result.position = bs.readPoint3F();
  }
  return result;
}

// ============================================================
// Shockwave ghost parser (GameBase subclass)
// ============================================================

function shockwaveUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readGameBaseUpdate(bs, isInitial, conn);
  if (bs.readFlag()) {
    result.position = bs.readPoint3F();
    result.normal = bs.readPoint3F();
  }
  return result;
}

// ============================================================
// FireballAtmosphere ghost parser (GameBase subclass)
// ============================================================

function fireballAtmosphereUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readGameBaseUpdate(bs, isInitial, conn);
  if (bs.readFlag()) {
    result.dropRadius = bs.readF32();
    result.dropsPerMinute = bs.readF32();
    result.maxDropAngle = bs.readF32();
    result.minDropAngle = bs.readF32();
    result.startVelocity = bs.readF32();
    result.dropHeight = bs.readF32();
    result.dropDir = bs.readPoint3F();
  }
  return result;
}

// ============================================================
// VehicleBlocker ghost parser (SceneObject subclass, NO GameBase)
// ============================================================

function vehicleBlockerUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  // VehicleBlocker instance vtable is 0x00796ca4. Slot +0x4c resolves to
  // FUN_005b9d40, which always reads:
  //   16 x U32 (MatrixF)
  //   6 x U32  (two Point3F corners)
  // No flags are present in this payload.
  const result: Record<string, unknown> = {};

  result.transform = bs.readMatrixF();
  result.boundsMin = bs.readPoint3F();
  result.boundsMax = bs.readPoint3F();

  return result;
}

// ============================================================
// ParticleEmissionDummy ghost parser (GameBase subclass)
// ============================================================

function particleEmissionDummyUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readGameBaseUpdate(bs, isInitial, conn);
  // Always writes transform + scale + optional datablock
  result.transform = bs.readMatrixF();
  result.scale = bs.readPoint3F();
  if (bs.readFlag()) {
    result.emitterDatablockId = readObjectRef11(bs);
  }
  return result;
}

// ============================================================
// Precipitation ghost parser (GameBase subclass)
// ============================================================

function precipitationUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readGameBaseUpdate(bs, isInitial, conn);

  // Mask order from decompiled binary FUN_00681260:
  // InitMask, StormShowMask, StormMask, PercentageMask
  // (Note: V12 source has different order; binary is authoritative)

  // InitMask
  if (bs.readFlag()) {
    result.percentage = bs.readF32();
    const colorCount = bs.readS32();
    result.colorCount = colorCount;
    if (colorCount < 0 || colorCount > 3) {
      throw new Error(`Invalid precipitation colorCount: ${colorCount}`);
    }
    // Colors use packed ColorF (FUN_0043f040): 4×U8 = 32 bits each, NOT 4×F32
    const colors: { r: number; g: number; b: number; a: number }[] = [];
    for (let i = 0; i < colorCount; i++) {
      colors.push(readPackedColorF(bs));
    }
    result.colors = colors;
    result.offsetSpeed = bs.readF32();
    result.minVelocity = bs.readF32();
    result.maxVelocity = bs.readF32();
    result.maxDrops = bs.readS32();
    result.maxRadius = bs.readF32();
    // Inner flag: storm initialization data (3 F32s)
    if (bs.readFlag()) {
      result.stormLastTime = bs.readF32();
      result.stormTime = bs.readF32();
      result.stormEndPercentage = bs.readF32();
    }
  }

  // StormShowMask
  if (bs.readFlag()) {
    result.stormPrecipitationOn = bs.readBool();
  }

  // StormMask
  if (bs.readFlag()) {
    result.stormTime = bs.readF32();
    result.stormEndPercentage = bs.readF32();
  }

  // PercentageMask
  if (bs.readFlag()) {
    result.percentageUpdate = bs.readF32();
  }

  return result;
}

// ============================================================
// SniperProjectile ghost parser
// ============================================================

function sniperProjectileUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Parent: SniperProjectile → LinearProjectile → Projectile → GameBase
  const result = readGameBaseUpdate(bs, isInitial, conn);

  if (bs.readFlag()) {
    // InitialUpdateMask
    result.energyPercentage = bs.readFloat(7);
    result.initialPosition = bs.readPoint3F();
    result.endPos = bs.readPoint3F();
    result.truncated = bs.readFlag();
    result.hitWater = bs.readFlag();
    if (bs.readFlag()) {
      result.sourceObject = bs.readRangedU32(0, 1024);
      result.sourceSlot = bs.readRangedU32(0, 7);
      result.clientOwned = bs.readFlag();
    }
  } else {
    // Swing update
    if (bs.readFlag()) {
      result.sourceObject = bs.readRangedU32(0, 1024);
      result.sourceSlot = bs.readRangedU32(0, 7);
      result.clientOwned = bs.readFlag();
    } else {
      result.initialPosition = bs.readPoint3F();
    }
    result.endPos = bs.readPoint3F();
    result.truncated = bs.readFlag();
  }

  return result;
}

// ============================================================
// ShockLanceProjectile ghost parser
// ============================================================

function shockLanceProjectileUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // Parent: ShockLanceProjectile → Projectile → GameBase
  const result = readGameBaseUpdate(bs, isInitial, conn);

  // Target (always written)
  if (bs.readFlag()) {
    result.targetObject = bs.readRangedU32(0, 1024);
  }

  // Initial update
  if (bs.readFlag()) {
    result.start = bs.readPoint3F();
    result.end = bs.readPoint3F();
    result.hitObject = bs.readFlag();
    if (bs.readFlag()) {
      result.sourceObject = bs.readRangedU32(0, 1024);
      result.sourceSlot = bs.readRangedU32(0, 7);
    }
  }

  return result;
}

// ============================================================
// WheeledVehicle ghost parser
// ============================================================

/**
 * Determine wheel count from a WheeledVehicleData shape name.
 * In standard Tribes 2, the only WheeledVehicle is the MPB/Jericho (6 wheels).
 * Wildcat and Beowulf are HoverVehicleData, NOT WheeledVehicleData.
 * wheelCount is computed at runtime from shape ground#/spring# node pairs.
 * Falls back to 6 (the only standard WheeledVehicle) if shape unknown.
 */
function getWheelCountFromShape(shapeName: string | undefined): number {
  if (!shapeName) return 6;
  const lower = shapeName.toLowerCase();
  // MPB (vehicle_land_mpbase.dts) has 6 wheels: Ground0-5 + Spring0-5
  if (lower.includes("mpb") || lower.includes("mpbase")) return 6;
  // Default to 6 for unknown shapes (standard T2 only has the MPB)
  return 6;
}

/** Cache of dataBlockId → wheelCount for WheeledVehicle ghosts. */
const wheelCountCache = new Map<number, number>();
/** Cache of ghostIndex → wheelCount for WheeledVehicle updates (where dbId is absent). */
const ghostWheelCountCache = new Map<number, number>();

function wheeledVehicleUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = vehicleUnpackUpdate(bs, isInitial, conn);

  // Always read braking/wheels. Binary (FUN_00615a70) checks
  // param_1[0x2097]==in_ECX (GameConnection.mControlObject == this vehicle)
  // but in demo recordings mControlObject is always the Player, never
  // a vehicle, so this condition is always false.
  {
    result.braking = bs.readFlag();

    if (bs.readFlag()) {
      // Determine wheel count from the DataBlock's shape name.
      // On creates, dataBlockId is available (DataBlockMask set).
      // On updates, use ghost-index cache populated during create.
      let wheelCount = 4;
      const dbId = result.dataBlockId as number | undefined;
      const ghostIdx = conn.currentGhostIndex;

      if (dbId !== undefined) {
        const cached = wheelCountCache.get(dbId);
        if (cached !== undefined) {
          wheelCount = cached;
        } else if (conn.getDataBlockData) {
          const dbData = conn.getDataBlockData(dbId);
          if (dbData) {
            wheelCount = getWheelCountFromShape(dbData.shapeName as string);
            wheelCountCache.set(dbId, wheelCount);
          }
        }
        // Cache by ghost index for future updates
        if (ghostIdx !== undefined) {
          ghostWheelCountCache.set(ghostIdx, wheelCount);
        }
      } else if (ghostIdx !== undefined) {
        // UPDATE: look up by ghost index
        const cached = ghostWheelCountCache.get(ghostIdx);
        if (cached !== undefined) {
          wheelCount = cached;
        }
      }

      const wheels: { avel: number; dy: number; dx: number }[] = [];
      for (let i = 0; i < wheelCount; i++) {
        wheels.push({
          avel: bs.readF32(),
          dy: bs.readF32(),
          dx: bs.readF32(),
        });
      }
      result.wheels = wheels;
    }
  }

  return result;
}

// ============================================================
// Trigger ghost parser
// ============================================================

function triggerUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  // Trigger::unpackUpdate (0x0061bab0):
  // Parent chain reads 0 bits (confirmed via r2ghidra — the parent call at
  // 0x005e2840 chains to 0x00436e00 which is empty).
  // Then reads 4 raw bytes (U32 tickPeriodMS, stored at this+0x44).
  // The V12 source has a full polyhedron (transform, points, planes, edges)
  // but the Tribes 2 build 25034 binary strips all of that.
  return { tickPeriodMS: bs.readU32() };
}

// ============================================================
// PhysicalZone ghost parser (SceneObject subclass)
// ============================================================

function physicalZoneUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (bs.readFlag()) {
    // Initial update — raw MatrixF (16×F32) + Point3F scale
    result.transform = bs.readMatrixF();
    result.scale = bs.readPoint3F();
    // Polyhedron points
    const numPoints = bs.readU32();
    if (numPoints > Math.floor(bs.getRemainingBits() / 96)) {
      throw new Error(`Invalid physicalZone point count: ${numPoints}`);
    }
    const points: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
      points.push(bs.readPoint3F());
    }
    result.points = points;

    // Polyhedron planes
    const numPlanes = bs.readU32();
    if (numPlanes > Math.floor(bs.getRemainingBits() / 128)) {
      throw new Error(`Invalid physicalZone plane count: ${numPlanes}`);
    }
    const planes: { x: number; y: number; z: number; d: number }[] = [];
    for (let i = 0; i < numPlanes; i++) {
      planes.push({
        x: bs.readF32(),
        y: bs.readF32(),
        z: bs.readF32(),
        d: bs.readF32(),
      });
    }
    result.planes = planes;

    // Polyhedron edges
    const numEdges = bs.readU32();
    if (numEdges > Math.floor(bs.getRemainingBits() / 128)) {
      throw new Error(`Invalid physicalZone edge count: ${numEdges}`);
    }
    const edges: { face0: number; face1: number; vertex0: number; vertex1: number }[] = [];
    for (let i = 0; i < numEdges; i++) {
      edges.push({
        face0: bs.readU32(),
        face1: bs.readU32(),
        vertex0: bs.readU32(),
        vertex1: bs.readU32(),
      });
    }
    result.edges = edges;

    result.velocityMod = bs.readF32();
    result.gravityMod = bs.readF32();
    result.appliedForce = bs.readPoint3F();
    result.active = bs.readFlag();
  } else {
    // Non-initial update: just active flag
    result.active = bs.readFlag();
  }

  return result;
}

// ============================================================
// AudioEmitter ghost parser (SceneObject subclass)
// ============================================================

function audioEmitterUnpackUpdate(
  bs: BitStream,
  _isInitial: boolean,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Initial update flag
  result.initialUpdate = bs.readFlag();

  // Transform
  if (bs.readFlag()) {
    result.transform = bs.readAffineTransform();
  }

  // Profile
  if (bs.readFlag()) {
    if (bs.readFlag()) {
      result.audioProfileId = readObjectRef11(bs);
    }
  }

  // Description
  if (bs.readFlag()) {
    if (bs.readFlag()) {
      result.audioDescriptionId = readObjectRef11(bs);
    }
  }

  // Filename
  if (bs.readFlag()) {
    result.filename = bs.readString();
  }

  // UseProfileDescription
  if (bs.readFlag()) {
    result.useProfileDescription = bs.readFlag();
  }

  // Volume
  if (bs.readFlag()) {
    result.volume = bs.readF32();
  }

  // IsLooping
  if (bs.readFlag()) {
    result.isLooping = bs.readFlag();
  }

  // Is3D
  if (bs.readFlag()) {
    result.is3D = bs.readFlag();
  }

  // MinDistance
  if (bs.readFlag()) {
    result.minDistance = bs.readF32();
  }

  // MaxDistance
  if (bs.readFlag()) {
    result.maxDistance = bs.readF32();
  }

  // ConeInsideAngle (S32 in engine — field type 1)
  if (bs.readFlag()) {
    result.coneInsideAngle = bs.readS32();
  }

  // ConeOutsideAngle (S32 in engine — field type 1)
  if (bs.readFlag()) {
    result.coneOutsideAngle = bs.readS32();
  }

  // ConeOutsideVolume
  if (bs.readFlag()) {
    result.coneOutsideVolume = bs.readF32();
  }

  // ConeVector
  if (bs.readFlag()) {
    result.coneVector = bs.readPoint3F();
  }

  // LoopCount (S32 in engine — field type 1)
  if (bs.readFlag()) {
    result.loopCount = bs.readS32();
  }

  // MinLoopGap (S32 in engine — field type 1, milliseconds)
  if (bs.readFlag()) {
    result.minLoopGap = bs.readS32();
  }

  // MaxLoopGap (S32 in engine — field type 1, milliseconds)
  if (bs.readFlag()) {
    result.maxLoopGap = bs.readS32();
  }

  // AudioType (S32/enum in engine — field type 9, written as 4 raw bytes)
  if (bs.readFlag()) {
    result.audioType = bs.readS32();
  }

  // OutsideAmbient
  if (bs.readFlag()) {
    result.outsideAmbient = bs.readFlag();
  }

  return result;
}

// ============================================================
// StationFXPersonal ghost parser (GameBase subclass)
// ============================================================

function stationFXPersonalUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  const result = readGameBaseUpdate(bs, isInitial, conn);

  if (bs.readFlag()) {
    // InitialUpdateMask
    if (bs.readFlag()) {
      result.stationObject = bs.readRangedU32(0, 1024);
    }
  }

  return result;
}

// ============================================================
// AIObjective ghost parser (AIObjective::unpackUpdate @ FUN_0047dae0)
// ============================================================

function aiObjectiveUnpackUpdate(
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
): Record<string, unknown> {
  // AIObjective::unpackUpdate calls FUN_0066a8b0 (ShapeBase-derived),
  // then reads one additional flag.
  const result = readShapeBaseUpdate(bs, isInitial, conn);

  if (bs.readFlag()) {
    result.transform = bs.readAffineTransform();
    result.scale = bs.readPoint3F();
  }

  result.unknownFlag = bs.readFlag();
  return result;
}

// ============================================================
// Register all ghost parsers into the registry
// ============================================================

export function registerGhostParsers(registry: ClassRegistry): void {
  registry.catalogGhost({
    name: "AIObjective",
    unpackUpdate: aiObjectiveUnpackUpdate,
  });

  registry.catalogGhost({
    name: "BeaconObject",
    unpackUpdate: beaconObjectUnpackUpdate,
  });

  registry.catalogGhost({
    name: "BombProjectile",
    unpackUpdate: bombProjectileUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Player",
    unpackUpdate: playerUnpackUpdate,
    readPacketData: playerReadPacketData,
  });

  registry.catalogGhost({
    name: "Debris",
    unpackUpdate: debrisUnpackUpdate,
  });

  registry.catalogGhost({
    name: "GameBase",
    unpackUpdate: readGameBaseUpdate,
  });

  registry.catalogGhost({
    name: "ShapeBase",
    unpackUpdate: readShapeBaseUpdate,
    readPacketData: vehicleReadPacketData,
  });

  registry.catalogGhost({
    name: "Vehicle",
    unpackUpdate: vehicleUnpackUpdate,
    readPacketData: vehicleReadPacketData,
  });

  registry.catalogGhost({
    name: "FlyingVehicle",
    unpackUpdate: flyingVehicleUnpackUpdate,
    readPacketData: vehicleReadPacketData,
  });

  registry.catalogGhost({
    name: "HoverVehicle",
    unpackUpdate: hoverVehicleUnpackUpdate,
    readPacketData: vehicleReadPacketData,
  });

  registry.catalogGhost({
    name: "Item",
    unpackUpdate: itemUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Marker",
    unpackUpdate: markerUnpackUpdate,
  });

  registry.catalogGhost({
    name: "MissionMarker",
    unpackUpdate: missionMarkerUnpackUpdate,
  });

  registry.catalogGhost({
    name: "StaticShape",
    unpackUpdate: staticShapeUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Projectile",
    unpackUpdate: projectileUnpackUpdate,
  });

  registry.catalogGhost({
    name: "ScopeAlwaysShape",
    unpackUpdate: scopeAlwaysShapeUnpackUpdate,
  });

  registry.catalogGhost({
    name: "GrenadeProjectile",
    unpackUpdate: grenadeUnpackUpdate,
  });

  registry.catalogGhost({
    name: "SimpleNetObject",
    unpackUpdate: simpleNetObjectUnpackUpdate,
  });

  registry.catalogGhost({
    name: "SeekerProjectile",
    unpackUpdate: seekerUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Turret",
    unpackUpdate: turretUnpackUpdate,
  });

  registry.catalogGhost({
    name: "InteriorInstance",
    unpackUpdate: interiorUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Camera",
    unpackUpdate: cameraUnpackUpdate,
    readPacketData: cameraReadPacketData,
  });

  registry.catalogGhost({
    name: "LinearProjectile",
    unpackUpdate: linearProjectileUnpackUpdate,
  });

  registry.catalogGhost({
    name: "ELFProjectile",
    unpackUpdate: elfProjectileUnpackUpdate,
  });

  registry.catalogGhost({
    name: "RepairProjectile",
    unpackUpdate: repairProjectileUnpackUpdate,
  });

  registry.catalogGhost({
    name: "TargetProjectile",
    unpackUpdate: targetProjectileUnpackUpdate,
  });

  // TracerProjectile resolves through LinearProjectile vtables in the retail binary.
  registry.catalogGhost({
    name: "TracerProjectile",
    unpackUpdate: linearProjectileUnpackUpdate,
  });

  registry.catalogGhost({
    name: "WayPoint",
    unpackUpdate: wayPointUnpackUpdate,
  });

  registry.catalogGhost({
    name: "SpawnSphere",
    unpackUpdate: spawnSphereUnpackUpdate,
  });

  registry.catalogGhost({
    name: "ForceFieldBare",
    unpackUpdate: forceFieldBareUnpackUpdate,
  });

  registry.catalogGhost({
    name: "TSStatic",
    unpackUpdate: tsStaticUnpackUpdate,
  });

  registry.catalogGhost({
    name: "TerrainBlock",
    unpackUpdate: terrainBlockUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Sun",
    unpackUpdate: sunUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Sky",
    unpackUpdate: skyUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Lightning",
    unpackUpdate: lightningUnpackUpdate,
  });

  registry.catalogGhost({
    name: "WaterBlock",
    unpackUpdate: waterBlockUnpackUpdate,
  });

  registry.catalogGhost({
    name: "MissionArea",
    unpackUpdate: missionAreaUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Splash",
    unpackUpdate: splashUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Shockwave",
    unpackUpdate: shockwaveUnpackUpdate,
  });

  registry.catalogGhost({
    name: "FireballAtmosphere",
    unpackUpdate: fireballAtmosphereUnpackUpdate,
  });

  registry.catalogGhost({
    name: "VehicleBlocker",
    unpackUpdate: vehicleBlockerUnpackUpdate,
  });

  registry.catalogGhost({
    name: "ParticleEmissionDummy",
    unpackUpdate: particleEmissionDummyUnpackUpdate,
  });

  registry.catalogGhost({
    name: "Precipitation",
    unpackUpdate: precipitationUnpackUpdate,
  });

  // Projectile aliases — same wire format as GrenadeProjectile
  registry.catalogGhost({
    name: "EnergyProjectile",
    unpackUpdate: grenadeUnpackUpdate,
  });

  registry.catalogGhost({
    name: "FlareProjectile",
    unpackUpdate: grenadeUnpackUpdate,
  });

  registry.catalogGhost({
    name: "LinearFlareProjectile",
    unpackUpdate: linearProjectileUnpackUpdate,
  });

  registry.catalogGhost({
    name: "SniperProjectile",
    unpackUpdate: sniperProjectileUnpackUpdate,
  });

  registry.catalogGhost({
    name: "ShockLanceProjectile",
    unpackUpdate: shockLanceProjectileUnpackUpdate,
  });

  registry.catalogGhost({
    name: "WheeledVehicle",
    unpackUpdate: wheeledVehicleUnpackUpdate,
    readPacketData: wheeledVehicleReadPacketData,
  });

  registry.catalogGhost({
    name: "Trigger",
    unpackUpdate: triggerUnpackUpdate,
  });

  registry.catalogGhost({
    name: "PhysicalZone",
    unpackUpdate: physicalZoneUnpackUpdate,
  });

  registry.catalogGhost({
    name: "AudioEmitter",
    unpackUpdate: audioEmitterUnpackUpdate,
  });

  registry.catalogGhost({
    name: "StationFXPersonal",
    unpackUpdate: stationFXPersonalUnpackUpdate,
  });

  // StationFXVehicle has identical wire format to StationFXPersonal
  registry.catalogGhost({
    name: "StationFXVehicle",
    unpackUpdate: stationFXPersonalUnpackUpdate,
  });
}
