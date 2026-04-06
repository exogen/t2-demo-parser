import type { BitStream } from "./BitStream.js";
import type { ClassRegistry } from "./ClassRegistry.js";
import type {
  SimDataBlock,
  GameBaseDataBlock,
  ShapeBaseDataBlock,
  ShapeBaseImageDataBlock,
  PlayerDataBlock,
  VehicleDataBlock,
  FlyingVehicleDataBlock,
  HoverVehicleDataBlock,
  WheeledVehicleDataBlock,
  StaticShapeDataBlock,
  TurretDataBlock,
  TurretImageDataBlock,
  ItemDataBlock,
  ProjectileDataBlock,
  LinearProjectileDataBlock,
  GrenadeProjectileDataBlock,
  SeekerProjectileDataBlock,
  SniperProjectileDataBlock,
  ShockLanceProjectileDataBlock,
  ELFProjectileDataBlock,
  RepairProjectileDataBlock,
  TargetProjectileDataBlock,
  TracerProjectileDataBlock,
  EnergyProjectileDataBlock,
  LinearFlareProjectileDataBlock,
  BombProjectileDataBlock,
  FlareProjectileDataBlock,
  ExplosionDataBlock,
  DebrisDataBlock,
  SplashDataBlock,
  ShockwaveDataBlock,
  ParticleEmitterDataBlock,
  ParticleDataBlock,
  AudioDescriptionDataBlock,
  AudioProfileDataBlock,
  AudioEnvironmentDataBlock,
  AudioSampleEnvironmentDataBlock,
  DecalDataBlock,
  CameraDataBlock,
  SensorDataBlock,
  TriggerDataBlock,
  ForceFieldBareDataBlock,
  ParticleEmissionDummyDataBlock,
  CommanderIconDataBlock,
  PrecipitationDataBlock,
  FireballAtmosphereDataBlock,
  LightningDataBlock,
  StationFXVehicleDataBlock,
  StationFXPersonalDataBlock,
  CannedChatItemDataBlock,
  MissionMarkerDataBlock,
  TSShapeConstructorDataBlock,
  EffectProfileDataBlock,
  JetEffectDataBlock,
  RunningLightDataBlock,
  HudImageEntry,
  ImageState,
  ParticleKey,
} from "./dataBlockDataTypes.js";

// ============================================================
// Helper functions
// ============================================================

/**
 * Read a DataBlock reference: flag(1b) + readClassId (11 bits).
 * From decompiled binary: uses FUN_00436d10 (readClassId) which reads
 * getBitCount(getNextPow2(0x800)) = 11 bits.
 * If flag is false, sets objectId to -1 (0xFFFFFFFF).
 */
function readDataBlockRef(bs: BitStream): number | null {
  return bs.readFlag() ? bs.readInt(11) : null;
}

/**
 * Read a ranged signed 32-bit integer.
 * Encodes value as unsigned offset from min.
 */
function readRangedS32(bs: BitStream, min: number, max: number): number {
  return bs.readRangedU32(0, max - min) + min;
}

/**
 * Read a packed ColorF: 4 bytes (32 bits total), each converted to [0..1] float.
 * From decompiled binary: FUN_0043f040 calls FUN_0043efe0 which reads 4 × stream->read(1, &byte).
 * Each byte is multiplied by 1/255.0 to produce the float value.
 * NOTE: This is NOT 4×F32 (128 bits) — it's 4×U8 (32 bits).
 */
function readColorF(
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
 * Read a DataBlock boolean field: 8 bits (1 byte), as written by stream->write(sizeof(bool), &val).
 * NOTE: This is different from readFlag() which reads 1 bit via BitStream::readFlag().
 * Many DataBlock fields use write(sizeof(bool)) instead of writeFlag().
 */
function readBool(bs: BitStream): boolean {
  return bs.readInt(8) !== 0;
}

/**
 * Read a ranged float: min + readInt(bits) / ((1 << bits) - 1) * (max - min).
 */
function readRangedF32(
  bs: BitStream,
  min: number,
  max: number,
  bits: number
): number {
  return min + (bs.readInt(bits) / ((1 << bits) - 1)) * (max - min);
}

// ============================================================
// Base class parsers (inheritance chain)
// ============================================================

// SimDataBlock → GameBaseData: 0 bits on wire (no-op)

/**
 * ShapeBaseData::unpackData — critical base class for most game objects.
 *
 * Verified against decompiled binary FUN_005e63e0 (Tribes2.exe).
 * NOTE: The field order differs from V12 engine reference source.
 * The Tribes 2 binary groups booleans and DataBlock refs differently,
 * and the sensor color uses 4×U8 (not 4×F32), among other differences.
 */
function shapeBaseDataUnpack(bs: BitStream): ShapeBaseDataBlock {
  const result: ShapeBaseDataBlock = {};

  // computeCRC — flag; if true: U32 mCRC
  // Binary: readFlag → this+0xc0; if true: read(4) → this+0xbc
  if (bs.readFlag()) {
    result.crc = bs.readU32();
  }

  // shapeName — readString → this+0x44
  result.shapeName = bs.readString();

  // 9 conditional F32 fields (flag + F32 if non-default)
  // Binary: each is readFlag, if true: read(4) → field offset
  if (bs.readFlag()) result.mass = bs.readF32();           // → 0x74
  if (bs.readFlag()) result.drag = bs.readF32();           // → 0x78
  if (bs.readFlag()) result.density = bs.readF32();        // → 0x7c
  if (bs.readFlag()) result.maxEnergy = bs.readF32();      // → 0x80
  if (bs.readFlag()) result.cameraMaxDist = bs.readF32();  // → 0xa4
  if (bs.readFlag()) result.cameraMinDist = bs.readF32();  // → 0xa8
  if (bs.readFlag()) result.cameraDefaultFov = bs.readF32(); // → 0xac
  if (bs.readFlag()) result.cameraMinFov = bs.readF32();   // → 0xb0
  if (bs.readFlag()) result.cameraMaxFov = bs.readF32();   // → 0xb4

  // debrisShapeName — readString → this+0x48
  result.debrisShapeName = bs.readString();

  // sensorRadius — flag; if true: readInt(10) + 4×U8 (RGBA bytes)
  // Binary: readInt(10) → this+0x15c (cast to float), then 4 × read(1) → 0x160-0x163
  if (bs.readFlag()) {
    result.sensorRadius = bs.readInt(10);
    result.sensorColor = {
      r: bs.readInt(8),
      g: bs.readInt(8),
      b: bs.readInt(8),
      a: bs.readInt(8),
    };
  }

  // heat — flag; if true: F32 → this+0x50
  if (bs.readFlag()) result.heat = bs.readF32();

  // cmdCategory — readString → this+0x164
  result.cmdCategory = bs.readString();

  // cmdMiniIconName — readString → this+0x168
  // NOTE: V12 has cmdIcon (DataBlockRef) here, but binary has readString.
  result.cmdMiniIconName = bs.readString();

  // 3 boolean flags: canControl, canObserve, observeThroughObject
  // Binary: 3 readFlags → this+0x16c, 0x16d, 0x16e
  result.canControl = bs.readFlag();
  result.canObserve = bs.readFlag();
  result.observeThroughObject = bs.readFlag();

  // 3 more boolean flags (grouped together in binary, different from V12)
  // Binary: this+0x325, 0x329, 0x32a
  result.emap = bs.readFlag();              // 0x325
  result.isInvincible = bs.readFlag();      // 0x329
  result.renderWhenDestroyed = bs.readFlag(); // 0x32a

  // 4 DataBlock refs using readClassId (FUN_00436d10 = readInt(11))
  // Binary: each is readFlag + readClassId → this+0x70, 0x60, 0x68, 0x58
  result.cmdIcon = readDataBlockRef(bs);          // 0x6c/0x70
  result.explosion = readDataBlockRef(bs);        // 0x5c/0x60
  result.underwaterExplosion = readDataBlockRef(bs); // 0x64/0x68
  result.debris = readDataBlockRef(bs);           // 0x54/0x58

  // 3 more boolean flags
  // Binary: this+0x32b, 0x326, 0x327
  result.inheritEnergyFromMount = bs.readFlag();  // 0x32b
  result.firstPersonOnly = bs.readFlag();         // 0x326
  result.useEyePoint = bs.readFlag();             // 0x327

  // shieldEffectLifetimeMS — U32 → this+0x94
  result.shieldEffectLifetimeMS = bs.readU32();

  // shieldEffectScale — flag; if true: 3×F32
  // Binary: readFlag, if true: read(4) × 3 → this+0x98, 0x9c, 0xa0
  // NOTE: This field is NOT in the V12 reference source — Tribes 2 addition.
  if (bs.readFlag()) {
    result.shieldEffectScale = {
      x: bs.readF32(),
      y: bs.readF32(),
      z: bs.readF32(),
    };
  }

  // HUD images loop (8 iterations, NumHudRenderImages=8)
  // Binary: do-while uVar4 < 8 at offset this + uVar4*4 + 0x174
  const hudImages: HudImageEntry[] = [];
  for (let i = 0; i < 8; i++) {
    const hasFriendly = bs.readFlag();
    if (!hasFriendly) continue;
    const friendlyName = bs.readString();       // → this + i*4 + 0x174
    const hasEnemy = bs.readFlag();
    const enemyName = hasEnemy ? bs.readString() : undefined; // → this + i*4 + 0x194
    const img: HudImageEntry = {
      friendlyName,
      enemyName,
      renderCenter: bs.readFlag(),          // → this + i + 0x1f4
      renderModulated: bs.readFlag(),       // → this + i + 0x1fc
      renderAlways: bs.readFlag(),          // → this + i + 0x204
      renderDistance: bs.readFlag(),         // → this + i + 0x20c
      renderName: bs.readFlag(),            // → this + i + 0x214
    };
    hudImages.push(img);
  }
  if (hudImages.length > 0) result.hudImages = hudImages;

  return result;
}

// ============================================================
// ShapeBaseImageData (weapon mount data — 31 states)
// ============================================================

function shapeBaseImageDataUnpack(bs: BitStream): ShapeBaseImageDataBlock {
  // Extends GameBaseData directly (0 parent bits)
  const result: ShapeBaseImageDataBlock = {};

  // computeCRC — flag; if true: U32
  if (bs.readFlag()) {
    result.crc = bs.readU32();
  }

  // shapeName
  result.shapeName = bs.readString();

  // mountPoint — U32
  result.mountPoint = bs.readU32();

  // offsetTransform — flag(isIdentity); if NOT identity: readAffineTransform
  if (!bs.readFlag()) {
    result.offset = bs.readAffineTransform();
  }

  // firstPerson — flag
  result.firstPerson = bs.readFlag();

  // mass — F32
  result.mass = bs.readF32();

  // usesEnergy — flag
  result.usesEnergy = bs.readFlag();

  // minEnergy — F32
  result.minEnergy = bs.readF32();

  // hasFlash — flag
  result.hasFlash = bs.readFlag();

  // projectile — readDataBlockRef
  result.projectile = readDataBlockRef(bs);

  // muzzleFlash — readDataBlockRef (confirmed at offset 0xce4 in binary)
  result.muzzleFlash = readDataBlockRef(bs);

  // isSeeker — flag; if true: 4×F32 + flag + F32
  result.isSeeker = bs.readFlag();
  if (result.isSeeker) {
    result.seekerRadius = bs.readF32();
    result.maxSeekAngle = bs.readF32();
    result.seekerLockTime = bs.readF32();
    result.seekerFreeTime = bs.readF32();
    result.isTargetLockRequired = bs.readFlag();
    result.maxLockRange = bs.readF32();
  }

  // cloakable — flag
  result.cloakable = bs.readFlag();

  // lightType — readRangedU32(0, 3); if != 0: F32 + S32 + 4×writeFloat(7)
  result.lightType = bs.readRangedU32(0, 3);
  if (result.lightType !== 0) {
    result.lightRadius = bs.readF32();
    result.lightTime = bs.readS32();
    result.lightColor = {
      r: bs.readFloat(7),
      g: bs.readFloat(7),
      b: bs.readFloat(7),
      a: bs.readFloat(7),
    };
  }

  // shellExitDir — 3×F32 (mathWrite Point3F)
  result.shellExitDir = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };

  // shellExitVariance — F32
  result.shellExitVariance = bs.readF32();

  // shellVelocity — F32
  result.shellVelocity = bs.readF32();

  // casing — readDataBlockRef
  result.casing = readDataBlockRef(bs);

  // accuFire flag (confirmed at offset 0xc88 in binary, before state loop)
  result.accuFire = bs.readFlag();

  // State loop (31 iterations, MaxStates=31)
  const states: ImageState[] = [];
  for (let i = 0; i < 31; i++) {
    const hasName = bs.readFlag();
    if (!hasName) continue;

    const name = bs.readString();

    // 11 transition values: each readInt(5)
    const transitionOnAmmo = bs.readInt(5);
    const transitionOnNoAmmo = bs.readInt(5);
    const transitionOnTarget = bs.readInt(5);
    const transitionOnNoTarget = bs.readInt(5);
    const transitionOnWet = bs.readInt(5);
    const transitionOnNotWet = bs.readInt(5);
    const transitionOnTriggerUp = bs.readInt(5);
    const transitionOnTriggerDown = bs.readInt(5);
    const transitionOnTimeout = bs.readInt(5);
    const transitionGeneric0In = bs.readInt(5);
    const transitionGeneric0Out = bs.readInt(5);

    // timeoutValue — flag(!=default) then F32
    const timeoutValue = bs.readFlag() ? bs.readF32() : undefined;
    // waitForTimeout — flag
    const waitForTimeout = bs.readFlag();
    // fire — flag
    const fire = bs.readFlag();
    // ejectShell — flag
    const ejectShell = bs.readFlag();
    // scaleAnimation — flag
    const scaleAnimation = bs.readFlag();
    // direction — flag
    const direction = bs.readFlag();
    // reload — flag (confirmed at offset 0xe2a in binary, between direction and energyDrain)
    const reload = bs.readFlag();
    // energyDrain — flag(!=default) then F32
    const energyDrain = bs.readFlag() ? bs.readF32() : undefined;
    // loaded — readInt(3)
    const loaded = bs.readInt(3);
    // spin — readInt(3)
    const spin = bs.readInt(3);
    // recoil — readInt(3)
    const recoil = bs.readInt(3);
    // sequence — flag(!=default) then readSignedInt(16)
    const sequence = bs.readFlag() ? bs.readSignedInt(16) : undefined;
    // sequenceVis — flag(!=default) then readSignedInt(16)
    const sequenceVis = bs.readFlag() ? bs.readSignedInt(16) : undefined;
    // flashSequence — flag
    const flashSequence = bs.readFlag();
    // ignoreLoadedForReady — flag
    const ignoreLoadedForReady = bs.readFlag();
    // emitter — readDataBlockRef; if present: F32 + S32
    const emitter = readDataBlockRef(bs);
    const emitterTime = emitter !== null ? bs.readF32() : undefined;
    const emitterNode = emitter !== null ? bs.readS32() : undefined;
    // sound — readDataBlockRef
    const sound = readDataBlockRef(bs);

    const state: ImageState = {
      name,
      transitionOnAmmo,
      transitionOnNoAmmo,
      transitionOnTarget,
      transitionOnNoTarget,
      transitionOnWet,
      transitionOnNotWet,
      transitionOnTriggerUp,
      transitionOnTriggerDown,
      transitionOnTimeout,
      transitionGeneric0In,
      transitionGeneric0Out,
      timeoutValue,
      waitForTimeout,
      fire,
      ejectShell,
      scaleAnimation,
      direction,
      reload,
      energyDrain,
      loaded,
      spin,
      recoil,
      sequence,
      sequenceVis,
      flashSequence,
      ignoreLoadedForReady,
      emitter,
      emitterTime,
      emitterNode,
      sound,
    };
    states.push(state);
  }
  result.states = states;

  return result;
}

// ============================================================
// PlayerData (extends ShapeBaseData)
// ============================================================

function playerDataUnpack(bs: BitStream): PlayerDataBlock {
  const result: PlayerDataBlock = shapeBaseDataUnpack(bs);

  // Verified against decompiled binary FUN_005cfa40 (Tribes2.exe).
  // Binary layout: flag + 13 F32s + 2 optional DB refs + 9 F32s + 1 F32 +
  //   8 F32s + readInt(7) + 6 F32s + 9 F32s + 1 F32 + 32 sounds +
  //   boxSize(3) + DB refs + F32s + 11 ground impact F32s

  // 1. readFlag → 0x340 (renderFirstPerson — NOT F32!)
  result.renderFirstPerson = bs.readFlag();

  // 2. 13× F32 (offsets 0x334-0x360)
  result.minLookAngle = bs.readF32();       // 0x334
  result.maxLookAngle = bs.readF32();       // 0x338
  result.maxFreelookAngle = bs.readF32();   // 0x33c
  result.maxTimeScale = bs.readF32();       // 0x330
  result.maxStepHeight = bs.readF32();      // 0x398
  result.runForce = bs.readF32();           // 0x344
  result.runEnergyDrain = bs.readF32();     // 0x348
  result.minRunEnergy = bs.readF32();       // 0x34c
  result.maxForwardSpeed = bs.readF32();    // 0x350
  result.maxBackwardSpeed = bs.readF32();   // 0x354
  result.maxSideSpeed = bs.readF32();       // 0x358
  result.maxUnderwaterForwardSpeed = bs.readF32(); // 0x35c
  result.maxUnderwaterBackwardSpeed = bs.readF32(); // 0x360
  // [0x364 hardcoded to 0, not from stream]

  // 3. 2 optional DataBlock refs (readClassId pattern)
  result.maxUnderwaterSideSpeedRef = readDataBlockRef(bs); // 0x368
  if (bs.readFlag()) {
    result.runSurfaceAngleRef = bs.readInt(11); // 0x370 (no else/-1)
  }

  // 4. 9× F32 (offsets 0x374-0x394)
  result.runSurfaceAngle = bs.readF32();    // 0x374
  result.recoverDelay = bs.readF32();       // 0x378 (S32 on wire = 4 bytes)
  result.recoverRunForceScale = bs.readF32(); // 0x37c
  result.jumpForce = bs.readF32();          // 0x380
  result.jumpEnergyDrain = bs.readF32();    // 0x384
  result.minJumpEnergy = bs.readF32();      // 0x388
  result.minJumpSpeed = bs.readF32();       // 0x38c
  result.maxJumpSpeed = bs.readF32();       // 0x390
  result.jumpSurfaceAngle = bs.readF32();   // 0x394

  // 5. 1× F32 (offset 0x39c)
  result.minJetEnergy = bs.readF32();       // 0x39c

  // 6. 8× F32 (offsets 0x3b8-0x3d4)
  result.splashVelocity = bs.readF32();     // 0x3b8
  result.splashAngle = bs.readF32();        // 0x3bc
  result.splashFreqMod = bs.readF32();      // 0x3c0
  result.splashVelEpsilon = bs.readF32();   // 0x3c4
  result.bubbleEmitTime = bs.readF32();     // 0x3c8
  result.medSplashSoundVel = bs.readF32();  // 0x3cc
  result.hardSplashSoundVel = bs.readF32(); // 0x3d0
  result.exitSplashSoundVel = bs.readF32(); // 0x3d4

  // 7. readInt(7) → jumpDelay (offset 0x3d8)
  result.jumpDelay = bs.readInt(7);

  // 8. 6× F32 (offsets 0x3a0-0x3b4)
  result.horizMaxSpeed = bs.readF32();      // 0x3a0
  result.horizResistSpeed = bs.readF32();   // 0x3a4
  result.horizResistFactor = bs.readF32();  // 0x3a8
  result.upMaxSpeed = bs.readF32();         // 0x3ac
  result.upResistSpeed = bs.readF32();      // 0x3b0
  result.upResistFactor = bs.readF32();     // 0x3b4

  // 9. 9× F32 (offsets 0xd14-0xd34, far offsets = Tribes 2-specific fields)
  result.jetEnergyDrain = bs.readF32();     // 0xd14
  result.canJet = bs.readF32();             // 0xd18
  result.maxJetHorizontalPercentage = bs.readF32(); // 0xd1c
  result.maxJetForwardSpeed = bs.readF32(); // 0xd20
  result.jetForce = bs.readF32();           // 0xd24
  result.minJetSpeed = bs.readF32();        // 0xd28
  result.maxDamage = bs.readF32();          // 0xd2c
  result.minImpactDamageSpeed = bs.readF32(); // 0xd30
  result.impactDamageScale = bs.readF32();  // 0xd34

  // 10. 1× F32 (offset 0x3f4)
  result.footSplashHeight = bs.readF32();   // 0x3f4

  // 11. Sound loop: 32 iterations (MaxSounds=0x20 in binary)
  // Binary: zeros 0x428+i*4, then flag + readClassId → 0x4a8+i*4
  const sounds: (number | null)[] = [];
  for (let i = 0; i < 32; i++) {
    if (bs.readFlag()) {
      sounds.push(bs.readInt(11));
    } else {
      sounds.push(null);
    }
  }
  result.sounds = sounds;

  // 12. boxSize 3×F32 (offsets 0x528, 0x52c, 0x530)
  result.boxSize = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };

  // 13. footPuffEmitter + 2 F32s (offset 0xcf0, 0xcf4, 0xcf8)
  result.footPuffEmitter = readDataBlockRef(bs);
  result.footPuffNumParts = bs.readF32();
  result.footPuffRadius = bs.readF32();

  // 14. decalData + 1 F32 (offset 0xd00, 0x3f8)
  result.decalData = readDataBlockRef(bs);
  result.decalOffset = bs.readF32();

  // 15. dustEmitter + splash (offsets 0xd08, 0xd10)
  result.dustEmitter = readDataBlockRef(bs);
  result.splash = readDataBlockRef(bs);

  // 16. 3 splashEmitters (offsets 0xd44 + i*4)
  const splashEmitters: (number | null)[] = [];
  for (let i = 0; i < 3; i++) {
    splashEmitters.push(readDataBlockRef(bs));
  }
  result.splashEmitters = splashEmitters;

  // 17. 11× F32 for ground impact shake (offsets 0x3fc-0x424)
  // V12 has 9 fields; binary has 11 (2 extra Tribes 2-specific)
  result.groundImpactMinSpeed = bs.readF32();   // 0x3fc
  result.groundImpactShakeFreq = {
    x: bs.readF32(),  // 0x400
    y: bs.readF32(),  // 0x404
    z: bs.readF32(),  // 0x408
  };
  result.groundImpactShakeAmp = {
    x: bs.readF32(),  // 0x40c
    y: bs.readF32(),  // 0x410
    z: bs.readF32(),  // 0x414
  };
  result.groundImpactShakeDuration = bs.readF32(); // 0x418
  result.groundImpactShakeFalloff = bs.readF32();  // 0x41c
  result.boundingRadius = bs.readF32();            // 0x420 (Tribes 2 extra)
  result.moveBubbleSize = bs.readF32();            // 0x424 (Tribes 2 extra)

  return result;
}

// ============================================================
// VehicleData (extends ShapeBaseData)
// ============================================================

function vehicleDataUnpack(bs: BitStream): VehicleDataBlock {
  const result: VehicleDataBlock = shapeBaseDataUnpack(bs);

  // Verified against decompiled binary FUN_00609450 (Tribes2.exe).

  // 1. 2×F32 (body restitution/friction) → offsets 0x33c, 0x340
  result.bodyRestitution = bs.readF32();
  result.bodyFriction = bs.readF32();

  // 2. Loop of 2: impact sound DataBlock refs → offsets 0x334+i*4
  const impactSounds: (number | null)[] = [];
  for (let i = 0; i < 2; i++) {
    impactSounds.push(readDataBlockRef(bs));
  }
  result.impactSounds = impactSounds;

  // 3. ~20 F32s for vehicle physics
  result.minImpactSpeed = bs.readF32();          // 0x37c
  result.softImpactSpeed = bs.readF32();          // 0x380
  result.hardImpactSpeed = bs.readF32();          // 0x384 (900 dec)
  result.minRollSpeed = bs.readF32();             // 0x388
  result.maxSteeringAngle = bs.readF32();         // 0x38c
  result.maxDrag = bs.readF32();                  // 0x3a4
  result.minDrag = bs.readF32();                  // 0x3a0
  result.jetForce = bs.readF32();                 // 0x3a8
  result.jetEnergyDrain = bs.readF32();           // 0x3ac
  result.minJetEnergy = bs.readF32();             // 0x3b0
  result.cameraOffset = bs.readF32();             // 0x39c
  result.cameraLag = bs.readF32();                // 0x398
  result.triggerDustHeight = bs.readF32();         // 0x3c8
  result.dustHeight = bs.readF32();               // 0x3cc
  result.numDmgEmitterAreas = bs.readF32();       // 0x408
  result.exitSplashSoundVelocity = bs.readF32();  // 0x36c
  result.softSplashSoundVelocity = bs.readF32();  // 0x370
  result.mediumSplashSoundVelocity = bs.readF32(); // 0x374
  result.hardSplashSoundVelocity = bs.readF32();  // 0x378

  // 4. Loop of 5: water impact sound DataBlock refs → offsets 0x358+i*4
  const waterSounds: (number | null)[] = [];
  for (let i = 0; i < 5; i++) {
    waterSounds.push(readDataBlockRef(bs));
  }
  result.waterSounds = waterSounds;

  // 5. dustEmitter DataBlock ref → offset 0x3c4
  result.dustEmitter = readDataBlockRef(bs);

  // 6. Loop of 3: damage emitter DataBlock refs → offsets 0x3dc+i*4
  const damageEmitters: (number | null)[] = [];
  for (let i = 0; i < 3; i++) {
    damageEmitters.push(readDataBlockRef(bs));
  }
  result.damageEmitters = damageEmitters;

  // 7. Loop of 2: splash emitter DataBlock refs → offsets 0x414+i*4
  const splashEmitters: (number | null)[] = [];
  for (let i = 0; i < 2; i++) {
    splashEmitters.push(readDataBlockRef(bs));
  }
  result.splashEmitters = splashEmitters;

  // 8. 2×3 F32 damage emitter offsets (2 sets of x,y,z) → offsets 0x3e8-0x3f4
  result.damageEmitterOffset0 = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };
  result.damageEmitterOffset1 = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };

  // 9. 2 F32 damage level tolerance → offsets 0x400, 0x404
  result.damageLevelTolerance0 = bs.readF32();
  result.damageLevelTolerance1 = bs.readF32();

  // 10. 2 F32 splash params → offsets 0x41c, 0x420
  result.splashFreqMod = bs.readF32();
  result.splashVelEpsilon = bs.readF32();

  // 11. 2 F32 collision damage → offsets 0x390, 0x394
  result.collDamageThresholdVel = bs.readF32();
  result.collDamageMultiplier = bs.readF32();

  return result;
}

// ============================================================
// FlyingVehicleData (extends VehicleData)
// ============================================================

function flyingVehicleDataUnpack(bs: BitStream): FlyingVehicleDataBlock {
  const result: FlyingVehicleDataBlock = vehicleDataUnpack(bs);

  // 2 sound refs
  result.jetActivateSound = readDataBlockRef(bs);
  result.jetDeactivateSound = readDataBlockRef(bs);

  // 4 jet emitter refs
  const jetEmitters: (number | null)[] = [];
  for (let i = 0; i < 4; i++) {
    jetEmitters.push(readDataBlockRef(bs));
  }
  result.jetEmitters = jetEmitters;

  // Verified against decompiled binary FUN_0060fc40 — 16 F32s
  result.maneuveringForce = bs.readF32();
  result.horizontalSurfaceForce = bs.readF32();
  result.verticalSurfaceForce = bs.readF32();
  result.autoInputDamping = bs.readF32();
  result.steeringForce = bs.readF32();
  result.steeringRollForce = bs.readF32();
  result.rollForce = bs.readF32();
  result.autoAngularForce = bs.readF32();
  result.rotationalDrag = bs.readF32();
  result.maxAutoSpeed = bs.readF32();
  result.autoLinearForce = bs.readF32();
  result.hoverHeight = bs.readF32();
  result.createHoverHeight = bs.readF32();
  result.minTrailSpeed = bs.readF32();
  result.vertThrustMultiple = bs.readF32();
  result.maxForwardSpeed = bs.readF32();

  return result;
}

// ============================================================
// HoverVehicleData (extends VehicleData)
// ============================================================

function hoverVehicleDataUnpack(bs: BitStream): HoverVehicleDataBlock {
  const result: HoverVehicleDataBlock = vehicleDataUnpack(bs);

  // 17 F32s
  result.dragForce = bs.readF32();
  result.mainThrustForce = bs.readF32();
  result.reverseThrustForce = bs.readF32();
  result.strafeThrustForce = bs.readF32();
  result.turboFactor = bs.readF32();
  result.stabLenMin = bs.readF32();
  result.stabLenMax = bs.readF32();
  result.stabSpringConstant = bs.readF32();
  result.stabDampingConstant = bs.readF32();
  result.gyroDrag = bs.readF32();
  result.normalForce = bs.readF32();
  result.restorativeForce = bs.readF32();
  result.steeringForce = bs.readF32();
  result.rollForce = bs.readF32();
  result.pitchForce = bs.readF32();
  result.floatingThrustFactor = bs.readF32();
  result.brakingForce = bs.readF32();

  // 3×F32 (dustTrailOffset)
  result.dustTrailOffset = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };

  // 2 F32s
  result.dustTrailFreqMod = bs.readF32();
  result.triggerTrailHeight = bs.readF32();

  // 3 sound refs
  result.floatSound = readDataBlockRef(bs);
  result.thrustSound = readDataBlockRef(bs);
  result.turboSound = readDataBlockRef(bs);

  // 3 jet emitter refs
  const jetEmitters: (number | null)[] = [];
  for (let i = 0; i < 3; i++) {
    jetEmitters.push(readDataBlockRef(bs));
  }
  result.jetEmitters = jetEmitters;

  // dustTrailEmitter ref
  result.dustTrailEmitter = readDataBlockRef(bs);

  // 3 F32s
  result.mainThrustEmitterFactor = bs.readF32();
  result.strafeThrustEmitterFactor = bs.readF32();
  result.reverseThrustEmitterFactor = bs.readF32();

  return result;
}

// ============================================================
// WheeledVehicleData (extends VehicleData)
// ============================================================

function wheeledVehicleDataUnpack(bs: BitStream): WheeledVehicleDataBlock {
  const result: WheeledVehicleDataBlock = vehicleDataUnpack(bs);

  // 9 tire F32s
  result.tireRadius = bs.readF32();
  result.tireStaticFriction = bs.readF32();
  result.tireKineticFriction = bs.readF32();
  result.tireRestitution = bs.readF32();
  result.tireLateralForce = bs.readF32();
  result.tireLateralDamping = bs.readF32();
  result.tireLateralRelaxation = bs.readF32();
  result.tireLongitudinalForce = bs.readF32();
  result.tireLongitudinalDamping = bs.readF32();

  // tire emitter ref
  result.tireEmitter = readDataBlockRef(bs);

  // 4 sound refs
  result.jetSound = readDataBlockRef(bs);
  result.engineSound = readDataBlockRef(bs);
  result.squealSound = readDataBlockRef(bs);
  result.wadeSound = readDataBlockRef(bs);

  // 11 F32s
  result.spring = bs.readF32();
  result.springDamping = bs.readF32();
  result.springLength = bs.readF32();
  result.brakeTorque = bs.readF32();
  result.engineTorque = bs.readF32();
  result.engineBrake = bs.readF32();
  result.maxWheelSpeed = bs.readF32();
  result.steeringAngle = bs.readF32();
  result.steeringReturn = bs.readF32();
  result.steeringDamping = bs.readF32();
  result.powerSteeringFactor = bs.readF32();

  return result;
}

// ============================================================
// StaticShapeData (extends ShapeBaseData)
// ============================================================

function staticShapeDataUnpack(bs: BitStream): StaticShapeDataBlock {
  const result: StaticShapeDataBlock = shapeBaseDataUnpack(bs);
  result.noIndividualDamage = bs.readFlag();
  result.dynamicTypeField = bs.readS32();
  return result;
}

// ============================================================
// TurretData (extends StaticShapeData)
// ============================================================

function turretDataUnpack(bs: BitStream): TurretDataBlock {
  const result: TurretDataBlock = staticShapeDataUnpack(bs);
  // Verified against decompiled binary FUN_00654190
  result.thetaMin = bs.readF32(); // 0x33c
  result.thetaMax = bs.readF32(); // 0x340
  result.thetaNull = bs.readF32(); // 0x344
  result.neverUpdateControl = bs.readFlag(); // 0x34c
  result.primaryAxis = bs.readRangedU32(0, 3); // 0x348 (FUN_0043f120(4) = 2 bits)
  result.maxCapacitorEnergy = bs.readF32(); // 0x35c
  result.capacitorRechargeRate = bs.readF32(); // 0x360
  return result;
}

// ============================================================
// TurretImageData (extends ShapeBaseImageData)
// ============================================================

function turretImageDataUnpack(bs: BitStream): TurretImageDataBlock {
  const result: TurretImageDataBlock = shapeBaseImageDataUnpack(bs);
  // Verified against decompiled binary FUN_00654850
  result.activationMS = bs.readInt(8); // << 5 on store (0x1c04)
  result.deactivateDelayMS = bs.readInt(8); // << 5 on store (0x1c08)
  result.degPerSecTheta = bs.readRangedU32(0, 1080); // 0x1c10 (FUN_0043f120(0x439))
  result.degPerSecPhi = bs.readRangedU32(0, 1080); // 0x1c14
  result.dontFireInsideDamageRadius = bs.readFlag(); // 0x1c1c
  result.damageRadius = bs.readF32(); // 0x1c20
  result.useCapacitor = bs.readFlag(); // 0x1c24 (NOT a DataBlockRef)
  return result;
}

// ============================================================
// ItemData (extends ShapeBaseData)
// ============================================================

function itemDataUnpack(bs: BitStream): ItemDataBlock {
  const result: ItemDataBlock = shapeBaseDataUnpack(bs);

  // 2×readFloat(10)
  result.friction = bs.readFloat(10);
  result.elasticity = bs.readFloat(10);

  // flag(sticky)
  result.sticky = bs.readFlag();

  // flag(gravityMod!=1) then readFloat(10)
  if (bs.readFlag()) result.gravityMod = bs.readFloat(10);

  // flag(maxVelocity!=-1) then F32
  if (bs.readFlag()) result.maxVelocity = bs.readF32();

  // flag(hasLight); if true: readInt(2) + 4×readFloat(7) + S32 + F32 + flag
  if (bs.readFlag()) {
    result.lightType = bs.readInt(2);
    result.lightColor = {
      r: bs.readFloat(7),
      g: bs.readFloat(7),
      b: bs.readFloat(7),
      a: bs.readFloat(7),
    };
    result.lightTime = bs.readS32();
    result.lightRadius = bs.readF32();
    result.lightOnlyStatic = bs.readFlag();
  }

  return result;
}

// ============================================================
// ProjectileData (extends GameBaseData — 0 parent bits)
// ============================================================

function projectileDataUnpack(bs: BitStream): ProjectileDataBlock {
  const result: ProjectileDataBlock = {};

  // readString (projectileName)
  result.projectileShapeName = bs.readString();

  // 2×S32
  result.faceViewerLinkTime = bs.readS32();
  result.lifetime = bs.readS32();

  // flag(faceViewer)
  result.faceViewer = bs.readFlag();

  // flag(nonDefaultScale); if true: 3×F32
  if (bs.readFlag()) {
    result.scale = {
      x: bs.readF32(),
      y: bs.readF32(),
      z: bs.readF32(),
    };
  }

  // 9 readDataBlockRef fields in pack order (verified against decompiled
  // Tribes2.exe FUN_00631010 / FUN_006303f0 struct offsets).
  result.baseEmitter = readDataBlockRef(bs);         // 0xe8 ParticleEmitterData
  result.delayEmitter = readDataBlockRef(bs);        // 0xec ParticleEmitterData
  result.bubbleEmitter = readDataBlockRef(bs);       // 0xf0 ParticleEmitterData
  result.explosion = readDataBlockRef(bs);           // 0xf4 ExplosionData
  result.underwaterExplosion = readDataBlockRef(bs); // 0xf8 ExplosionData
  result.splash = readDataBlockRef(bs);              // 0xfc SplashData
  result.sound = readDataBlockRef(bs);               // 0x100 AudioProfile (in-flight)
  result.wetFireSound = readDataBlockRef(bs);        // 0x104 AudioProfile
  result.fireSound = readDataBlockRef(bs);           // 0x108 AudioProfile

  // 6 decal refs (loop)
  const decals: (number | null)[] = [];
  for (let i = 0; i < 6; i++) {
    decals.push(readDataBlockRef(bs));
  }
  result.decals = decals;

  // flag(hasLight); if true: readFloat(8) + 3×readFloat(7)
  if (bs.readFlag()) {
    result.lightRadius = bs.readFloat(8);
    result.lightColor = {
      r: bs.readFloat(7),
      g: bs.readFloat(7),
      b: bs.readFloat(7),
    };
  }

  // flag(hasUnderwaterColor); if true: 3×readFloat(7)
  if (bs.readFlag()) {
    result.underwaterLightColor = {
      r: bs.readFloat(7),
      g: bs.readFloat(7),
      b: bs.readFloat(7),
    };
  }

  // explodeOnWaterImpact: 8-bit bool via stream->write(sizeof(bool))
  // (confirmed in decompiled binary FUN_00631360: read(1,&var) at offset 0xcc)
  result.explodeOnWaterImpact = readBool(bs);
  // depthTolerance: F32
  result.depthTolerance = bs.readF32();

  return result;
}

// ============================================================
// LinearProjectileData (extends ProjectileData)
// ============================================================

function linearProjectileDataUnpack(bs: BitStream): LinearProjectileDataBlock {
  const result: LinearProjectileDataBlock = projectileDataUnpack(bs);

  // 2×F32
  result.dryVelocity = bs.readF32();
  result.wetVelocity = bs.readF32();

  // 2×U32
  result.fizzleTime = bs.readU32();
  result.fizzleType = bs.readU32();

  // flag
  result.hardRetarget = bs.readFlag();

  // 2×readRangedU32(0,90)
  result.inheritedVelocityScale = bs.readRangedU32(0, 90);
  result.lifetimeMS = bs.readRangedU32(0, 90);

  // 2×U32
  result.collideWithOwnerTimeMS = bs.readU32();
  result.proximityRadius = bs.readU32();

  // flag
  result.tracerProjectile = bs.readFlag();

  return result;
}

// ============================================================
// GrenadeProjectileData (extends ProjectileData)
// ============================================================

function grenadeProjectileDataUnpack(bs: BitStream): GrenadeProjectileDataBlock {
  const result: GrenadeProjectileDataBlock = projectileDataUnpack(bs);

  result.armingDelayMS = bs.readS32();
  result.muzzleVelocity = bs.readF32();
  result.grenadeElasticity = bs.readF32();
  result.grenadeFriction = bs.readF32();
  result.drag = bs.readF32();
  result.density = bs.readF32();
  result.gravityMod = bs.readF32();
  result.lifetimeMS = bs.readS32();

  return result;
}

// ============================================================
// SeekerProjectileData (extends ProjectileData)
// ============================================================

function seekerProjectileDataUnpack(bs: BitStream): SeekerProjectileDataBlock {
  const result: SeekerProjectileDataBlock = projectileDataUnpack(bs);

  // Verified against decompiled binary (lines 430494-430580)
  // 10 F32/S32 (offsets 0x138-0x164)
  result.lifetimeMS = bs.readS32(); // 0x138
  result.muzzleVelocity = bs.readF32(); // 0x13c
  result.turningSpeed = bs.readF32(); // 0x140
  result.proximityRadius = bs.readF32(); // 0x14c
  result.terrainAvoidanceSpeed = bs.readF32(); // 0x150
  result.terrainScanAhead = bs.readF32(); // 0x154
  result.terrainHeightFail = bs.readF32(); // 0x158
  result.terrainAvoidanceRadius = bs.readF32(); // 0x15c
  result.flareDistance = bs.readF32(); // 0x160
  result.flareAngle = bs.readF32(); // 0x164

  // useFlechette — 8-bit bool via stream->read(1, &var) at offset 0x168
  // (confirmed: read(1, &cStack_21) = 1 BYTE = 8 bits, NOT readF32)
  result.useFlechette = readBool(bs);

  // 2 F32 (offsets 0x144, 0x148)
  result.maxVelocity = bs.readF32();
  result.acceleration = bs.readF32();

  // 2 S32 (offsets 0x16c, 0x180)
  result.flechetteDelayMs = bs.readS32();
  result.exhaustTimeMs = bs.readS32();

  // 2 readString (offsets 0x184, 0x190)
  result.exhaustNodeName = bs.readString();
  result.casingShapeName = bs.readString();

  // 3 conditional DataBlock refs (offsets 0x18c, 0x174, 0x17c)
  result.casingDebris = readDataBlockRef(bs);
  result.puffEmitter = readDataBlockRef(bs);
  result.exhaustEmitter = readDataBlockRef(bs);

  return result;
}

// ============================================================
// SniperProjectileData (extends ProjectileData)
// ============================================================

function sniperProjectileDataUnpack(bs: BitStream): SniperProjectileDataBlock {
  const result: SniperProjectileDataBlock = projectileDataUnpack(bs);

  // Verified against decompiled binary FUN_00641d40
  // 2×F32 (offsets 0x138, 0x13c)
  result.maxRifleRange = bs.readF32();
  result.rifleHeadMultiplier = bs.readF32();

  // ColorF via FUN_0043f040 (packed 4×U8 = 32 bits at offset 0x140)
  result.beamColor = readColorF(bs);

  // 9×F32 (offsets 0x150, 0x154, 0x158, 0x168, 0x15c, 0x160, 0x164, 0x16c, 0x170)
  result.fadeTime = bs.readF32();
  result.startBeamWidth = bs.readF32();
  result.endBeamWidth = bs.readF32();
  result.pulseBeamWidth = bs.readF32();
  result.beamFlareAngle = bs.readF32();
  result.minFlareSize = bs.readF32();
  result.maxFlareSize = bs.readF32();
  result.pulseSpeed = bs.readF32();
  result.pulseLength = bs.readF32();

  // ColorF via FUN_0043f040 (packed 4×U8 = 32 bits at offset 0x178)
  result.lightColor = readColorF(bs);

  // F32 (offset 0x174)
  result.lightRadius = bs.readF32();

  // 12 readString (ST_NUM_TEX=0xc)
  const textures: string[] = [];
  for (let i = 0; i < 12; i++) {
    textures.push(bs.readString());
  }
  result.textures = textures;

  return result;
}

// ============================================================
// ShockLanceProjectileData (extends ProjectileData)
// ============================================================

function shockLanceProjectileDataUnpack(
  bs: BitStream
): ShockLanceProjectileDataBlock {
  // Verified against decompiled binary FUN_0064e840
  const result: ShockLanceProjectileDataBlock = projectileDataUnpack(bs);

  // 7 F32 (offsets 0x138, 0x13c, 0x160, 0x164, 0x168, 0x16c, 0x170)
  result.zapDuration = bs.readF32();
  result.boltLength = bs.readF32();
  result.numParts = bs.readF32();
  result.lightningFreq = bs.readF32();
  result.lightningDensity = bs.readF32();
  result.lightningAmp = bs.readF32();
  result.lightningWidth = bs.readF32();

  // DataBlockRef (shockwave at offset 0x190)
  result.shockwave = readDataBlockRef(bs);

  // 2×4 loop: startWidth[2], endWidth[2], boltSpeed[2], texWrap[2]
  // (offsets 0x140+i*4, 0x148+i*4, 0x150+i*4, 0x158+i*4)
  const startWidth: number[] = [];
  const endWidth: number[] = [];
  const boltSpeed: number[] = [];
  const texWrap: number[] = [];
  for (let i = 0; i < 2; i++) {
    startWidth.push(bs.readF32());
    endWidth.push(bs.readF32());
    boltSpeed.push(bs.readF32());
    texWrap.push(bs.readF32());
  }
  result.startWidth = startWidth;
  result.endWidth = endWidth;
  result.boltSpeed = boltSpeed;
  result.texWrap = texWrap;

  // 4 readString (texture[4] at offset 0x174)
  const slTextures: string[] = [];
  for (let i = 0; i < 4; i++) {
    slTextures.push(bs.readString());
  }
  result.textures = slTextures;

  // DataBlockRef (emitter at offset 0x188)
  result.emitter = readDataBlockRef(bs);

  return result;
}

// ============================================================
// ELFProjectileData (extends ProjectileData)
// ============================================================

function elfProjectileDataUnpack(bs: BitStream): ELFProjectileDataBlock {
  const result: ELFProjectileDataBlock = projectileDataUnpack(bs);

  // 6×F32
  result.beamRange = bs.readF32();
  result.beamDrainRate = bs.readF32();
  result.muzzleVelocity = bs.readF32();
  result.proximityRadius = bs.readF32();
  result.startWidth = bs.readF32();
  result.endWidth = bs.readF32();

  // 3 readString
  result.mainBeamTexture = bs.readString();
  result.innerBeamTexture = bs.readString();
  result.flareTexture = bs.readString();

  // 1 readDataBlockRef
  result.hitEmitter = readDataBlockRef(bs);

  return result;
}

// ============================================================
// RepairProjectileData (extends ProjectileData)
// ============================================================

function repairProjectileDataUnpack(bs: BitStream): RepairProjectileDataBlock {
  const result: RepairProjectileDataBlock = projectileDataUnpack(bs);

  // 8×F32
  result.beamRange = bs.readF32();
  result.beamRepairRate = bs.readF32();
  result.muzzleVelocity = bs.readF32();
  result.proximityRadius = bs.readF32();
  result.startWidth = bs.readF32();
  result.endWidth = bs.readF32();
  result.startBeamWidth = bs.readF32();
  result.endBeamWidth = bs.readF32();

  // 2 readString
  result.mainBeamTexture = bs.readString();
  result.innerBeamTexture = bs.readString();

  return result;
}

// ============================================================
// TargetProjectileData (extends ProjectileData)
// ============================================================

function targetProjectileDataUnpack(bs: BitStream): TargetProjectileDataBlock {
  const result: TargetProjectileDataBlock = projectileDataUnpack(bs);

  // Verified against decompiled binary FUN_006477f0
  // F32 (offset 0x138)
  result.maxRifleRange = bs.readF32();

  // ColorF via FUN_0043f040 (packed 4×U8 = 32 bits at offset 0x13c)
  result.beamColor = readColorF(bs);

  // 7×F32 (offsets 0x14c, 0x15c, 0x150, 0x154, 0x158, 0x160, 0x164)
  result.startBeamWidth = bs.readF32();
  result.pulseBeamWidth = bs.readF32();
  result.beamFlareAngle = bs.readF32();
  result.minFlareSize = bs.readF32();
  result.maxFlareSize = bs.readF32();
  result.pulseSpeed = bs.readF32();
  result.pulseLength = bs.readF32();

  // 4 readString (textureName[4] at offset 0x16c)
  const targetTextures: string[] = [];
  for (let i = 0; i < 4; i++) {
    targetTextures.push(bs.readString());
  }
  result.textures = targetTextures;

  return result;
}

// ============================================================
// TracerProjectileData (extends LinearProjectileData)
// ============================================================

function tracerProjectileDataUnpack(bs: BitStream): TracerProjectileDataBlock {
  // Verified against decompiled binary FUN_00640160
  const result: TracerProjectileDataBlock = linearProjectileDataUnpack(bs);

  // 3 F32 (offsets 0x168, 0x184, 0x170)
  result.tracerLength = bs.readF32();
  result.tracerAlpha = bs.readF32();
  result.tracerMinPixels = bs.readF32();

  // readBool 8-bit (offset 0x16c)
  result.crossViewFraction = readBool(bs);

  // ColorF via FUN_0043f040 (packed 4×U8 at offset 0x174)
  result.tracerColor = readColorF(bs);

  // 2 F32 (offsets 0x188, 0x18c)
  result.tracerWidth = bs.readF32();
  result.muzzleVelocity = bs.readF32();

  // readBool 8-bit (offset 0x190)
  result.proximityRadius = readBool(bs);

  // 2 readString (loop count=2 at offset 0x194)
  result.textureName0 = bs.readString();
  result.textureName1 = bs.readString();

  return result;
}

// ============================================================
// EnergyProjectileData (extends GrenadeProjectileData)
// ============================================================

function energyProjectileDataUnpack(bs: BitStream): EnergyProjectileDataBlock {
  // Verified against decompiled binary FUN_00694d80 — parent is FUN_00633cf0 (GrenadeProjectileData)
  const result: EnergyProjectileDataBlock = grenadeProjectileDataUnpack(bs);

  // 7×F32
  result.energyDrainPerSecond = bs.readF32();
  result.energyMinDrain = bs.readF32();
  result.beamWidth = bs.readF32();
  result.beamRange = bs.readF32();
  result.numSegments = bs.readF32();
  result.texRepeat = bs.readF32();
  result.beamFlareAngle = bs.readF32();

  // 2 readString
  result.beamTexture = bs.readString();
  result.flareTexture = bs.readString();

  return result;
}

// ============================================================
// LinearFlareProjectileData (extends LinearProjectileData)
// ============================================================

function linearFlareProjectileDataUnpack(
  bs: BitStream
): LinearFlareProjectileDataBlock {
  // Verified against decompiled binary FUN_0063dc80
  const result: LinearFlareProjectileDataBlock = linearProjectileDataUnpack(bs);

  // F32 (offset 0x168)
  result.numFlares = bs.readF32();

  // ColorF via FUN_0043f040 (packed 4×U8 at offset 0x178)
  result.flareColor = readColorF(bs);

  // 2 readString (offsets 0x188, 0x18c)
  result.flareTexture = bs.readString();
  result.smokeTexture = bs.readString();

  // 3×F32 loop (offset 0x16c, count=3)
  result.size = bs.readF32();
  result.flareModTexture = bs.readF32();
  result.smokeSize = bs.readF32();

  return result;
}

// ============================================================
// BombProjectileData (extends GrenadeProjectileData)
// ============================================================

function bombProjectileDataUnpack(bs: BitStream): BombProjectileDataBlock {
  const result: BombProjectileDataBlock = grenadeProjectileDataUnpack(bs);

  // 6×F32
  result.smokeDist = bs.readF32();
  result.noSmoke = bs.readF32();
  result.boomTime = bs.readF32();
  result.casingDist = bs.readF32();
  result.smokeCushion = bs.readF32();
  result.noSmokeCounter = bs.readF32();

  // 2 readString
  result.smokeTexture = bs.readString();
  result.bombTexture = bs.readString();

  return result;
}

// ============================================================
// FlareProjectileData (extends GrenadeProjectileData)
// ============================================================

function flareProjectileDataUnpack(bs: BitStream): FlareProjectileDataBlock {
  // Verified against decompiled binary FUN_006872f0
  const result: FlareProjectileDataBlock = grenadeProjectileDataUnpack(bs);

  // F32 (offset 0x158)
  result.size = bs.readF32();

  // readBool 8-bit (offset 0x160, read(1,...))
  result.useLensFlare = readBool(bs);

  // 2 readString loop (offset 0x164, count=2)
  result.flareTexture = bs.readString();
  result.lensFlareTexture = bs.readString();

  return result;
}

// ============================================================
// ExplosionData (extends GameBaseData)
// ============================================================

function explosionDataUnpack(bs: BitStream): ExplosionDataBlock {
  const result: ExplosionDataBlock = {};

  // readString
  result.dtsFileName = bs.readString();

  // 2 readDataBlockRef
  result.soundProfile = readDataBlockRef(bs);
  result.particleEmitter = readDataBlockRef(bs);

  // readInt(14) + F32 + flag
  result.particleDensity = bs.readInt(14);
  result.particleRadius = bs.readF32();
  result.faceViewer = bs.readFlag();

  // flag(scale); if true: 3×readInt(16)
  if (bs.readFlag()) {
    result.explosionScale = {
      x: bs.readInt(16),
      y: bs.readInt(16),
      z: bs.readInt(16),
    };
  }

  // readInt(14) + 4×readRangedU32 + 2×readRangedU32(0,1000) + readInt(14) + readRangedU32(0,10000)
  result.playSpeed = bs.readInt(14);
  result.debrisThetaMin = bs.readRangedU32(0, 180);
  result.debrisThetaMax = bs.readRangedU32(0, 180);
  result.debrisPhiMin = bs.readRangedU32(0, 360);
  result.debrisPhiMax = bs.readRangedU32(0, 360);
  result.debrisMinVelocity = bs.readRangedU32(0, 1000);
  result.debrisMaxVelocity = bs.readRangedU32(0, 1000);
  result.debrisNum = bs.readInt(14);
  result.debrisVariance = bs.readRangedU32(0, 10000);

  // 4×readInt(16) + F32 + 2 flags
  result.delayMS = bs.readInt(16);
  result.delayVariance = bs.readInt(16);
  result.lifetimeMS = bs.readInt(16);
  result.lifetimeVariance = bs.readInt(16);
  result.offset = bs.readF32();
  result.shakeCamera = bs.readFlag();
  result.hasLight = bs.readFlag();

  // 9×F32
  result.camShakeFreq = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };
  result.camShakeAmp = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };
  result.camShakeDuration = bs.readF32();
  result.camShakeRadius = bs.readF32();
  result.camShakeFalloff = bs.readF32();

  // readDataBlockRef(shockwave) + 1 debris ref + 4 emitter refs + 5 sub-explosion refs
  result.shockwave = readDataBlockRef(bs);
  result.debris = readDataBlockRef(bs);
  const emitters: (number | null)[] = [];
  for (let i = 0; i < 4; i++) {
    emitters.push(readDataBlockRef(bs));
  }
  result.emitters = emitters;
  const subExplosions: (number | null)[] = [];
  for (let i = 0; i < 5; i++) {
    subExplosions.push(readDataBlockRef(bs));
  }
  result.subExplosions = subExplosions;

  // readRangedU32(0,4) count; loop: readFloat(8) times + 3×readRangedU32(0,16000) sizes
  const timeCount = bs.readRangedU32(0, 4);
  const times: number[] = [];
  for (let i = 0; i < timeCount; i++) {
    times.push(bs.readFloat(8));
  }
  result.times = times;
  const sizes: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < timeCount; i++) {
    sizes.push({
      x: bs.readRangedU32(0, 16000),
      y: bs.readRangedU32(0, 16000),
      z: bs.readRangedU32(0, 16000),
    });
  }
  result.sizes = sizes;

  return result;
}

// ============================================================
// DebrisData (extends GameBaseData)
// ============================================================

function debrisDataUnpack(bs: BitStream): DebrisDataBlock {
  // Field order confirmed from decompiled binary FUN_006844d0
  const result: DebrisDataBlock = {};

  result.elasticity = bs.readF32(); // 0x50
  result.friction = bs.readF32(); // 0x4c
  result.numBounces = bs.readS32(); // 0x5c
  result.bounceVariance = bs.readS32(); // 0x60
  result.minSpinSpeed = bs.readF32(); // 0x64
  result.maxSpinSpeed = bs.readF32(); // 0x68

  // 4 bools via stream->write(sizeof(bool)) = 8 bits each (0x6c-0x6f)
  result.render2D = readBool(bs);
  result.explodeOnMaxBounce = readBool(bs);
  result.staticOnMaxBounce = readBool(bs);
  result.snapOnMaxBounce = readBool(bs);

  result.lifetime = bs.readF32(); // 0x54
  result.lifetimeVariance = bs.readF32(); // 0x58

  // "Written twice" bug: same offsets 0x64/0x68 written again
  result.minSpinSpeed_dup = bs.readF32();
  result.maxSpinSpeed_dup = bs.readF32();

  result.velocity = bs.readF32(); // 0x44
  result.velocityVariance = bs.readF32(); // 0x48

  // 2 bools via stream->write(sizeof(bool)) = 8 bits each (0x70, 0x71)
  result.useRadiusMass = readBool(bs);
  result.fade = readBool(bs);

  result.baseRadius = bs.readF32(); // 0x74
  result.gravModifier = bs.readF32(); // 0x78
  result.terminalVelocity = bs.readF32(); // 0x7c

  result.ignoreWater = readBool(bs); // 0x80 (8-bit bool)

  // 2 readString
  result.shapeFileName = bs.readString(); // 0x8c
  result.skinName = bs.readString(); // 0x84

  // 2 emitter refs (loop at 0xa4, 0xa8) + 1 explosion ref (0x94)
  result.emitter0 = readDataBlockRef(bs);
  result.emitter1 = readDataBlockRef(bs);
  result.explosion = readDataBlockRef(bs);

  return result;
}

// ============================================================
// SplashData (extends GameBaseData)
// ============================================================

function splashDataUnpack(bs: BitStream): SplashDataBlock {
  const result: SplashDataBlock = {};

  // 3×F32 (scale)
  result.scale = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };

  // ~15 F32/S32 values
  result.delayMS = bs.readS32();
  result.delayVariance = bs.readS32();
  result.lifetimeMS = bs.readS32();
  result.lifetimeVariance = bs.readS32();
  result.width = bs.readF32();
  result.numSegments = bs.readS32();
  result.velocity = bs.readF32();
  result.height = bs.readF32();
  result.acceleration = bs.readF32();
  result.texWrap = bs.readF32();
  result.texFactor = bs.readF32();
  result.ejectionFreq = bs.readF32();
  result.ejectionAngle = bs.readF32();
  result.ringLifetime = bs.readF32();
  result.startRadius = bs.readF32();

  // explosion ref + 3 emitter refs
  result.explosion = readDataBlockRef(bs);
  const emitters: (number | null)[] = [];
  for (let i = 0; i < 3; i++) {
    emitters.push(readDataBlockRef(bs));
  }
  result.emitters = emitters;

  // 4× ColorF (4×U8 = 32 bits each, via FUN_0043f040)
  const colors: { r: number; g: number; b: number; a: number }[] = [];
  for (let i = 0; i < 4; i++) {
    colors.push(readColorF(bs));
  }
  result.colors = colors;

  // 4×F32 times
  const times: number[] = [];
  for (let i = 0; i < 4; i++) {
    times.push(bs.readF32());
  }
  result.times = times;

  // 2 readString
  result.textureName = bs.readString();
  result.foamTexture = bs.readString();

  return result;
}

// ============================================================
// ShockwaveData (extends GameBaseData)
// ============================================================

function shockwaveDataUnpack(bs: BitStream): ShockwaveDataBlock {
  const result: ShockwaveDataBlock = {};

  // 3×F32 (scale)
  result.scale = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };

  // ~17 F32/S32/bool values
  result.delayMS = bs.readS32();
  result.delayVariance = bs.readS32();
  result.lifetimeMS = bs.readS32();
  result.lifetimeVariance = bs.readS32();
  result.width = bs.readF32();
  result.numSegments = bs.readS32();
  result.numVertSegments = bs.readS32();
  result.velocity = bs.readF32();
  result.height = bs.readF32();
  result.verticalCurve = bs.readF32();
  result.acceleration = bs.readF32();
  result.texWrap = bs.readF32();
  // 5 bools via stream->write(sizeof(bool)) = 8 bits each
  // (confirmed at offsets 0x98-0x9c in binary, using read(1,&var) pattern)
  result.is2D = readBool(bs);
  result.orientToNormal = readBool(bs);
  result.mapToTerrain = readBool(bs);
  result.renderBottom = readBool(bs);
  result.renderSquare = readBool(bs);

  // 3 emitter refs
  const emitters: (number | null)[] = [];
  for (let i = 0; i < 3; i++) {
    emitters.push(readDataBlockRef(bs));
  }
  result.emitters = emitters;

  // 4× ColorF (4×U8 = 32 bits each, via FUN_0043f040)
  const colors: { r: number; g: number; b: number; a: number }[] = [];
  for (let i = 0; i < 4; i++) {
    colors.push(readColorF(bs));
  }
  result.colors = colors;

  // 4×F32 times
  const times: number[] = [];
  for (let i = 0; i < 4; i++) {
    times.push(bs.readF32());
  }
  result.times = times;

  // 2 readString
  result.textureName = bs.readString();
  result.mapToTexture = bs.readString();

  return result;
}

// ============================================================
// ParticleEmitterData (extends GameBaseData)
// ============================================================

function particleEmitterDataUnpack(bs: BitStream): ParticleEmitterDataBlock {
  const result: ParticleEmitterDataBlock = {};

  // 4 readInt(various)
  result.ejectionPeriodMS = bs.readInt(10);
  result.periodVarianceMS = bs.readInt(10);
  result.ejectionVelocity = bs.readInt(16);
  result.velocityVariance = bs.readInt(14);

  // flag then readInt(16)
  if (bs.readFlag()) {
    result.ejectionOffset = bs.readInt(16);
  }

  // 2×readRangedU32(0,180)
  result.thetaMin = bs.readRangedU32(0, 180);
  result.thetaMax = bs.readRangedU32(0, 180);

  // 2 conditional readRangedU32(0,360)
  if (bs.readFlag()) result.phiReferenceVel = bs.readRangedU32(0, 360);
  if (bs.readFlag()) result.phiVariance = bs.readRangedU32(0, 360);

  // 3 flags
  result.overrideAdvances = bs.readFlag();
  result.orientParticles = bs.readFlag();
  result.orientOnVelocity = bs.readFlag();

  // 2×readInt(10)
  result.lifetimeMS = bs.readInt(10);
  result.lifetimeVarianceMS = bs.readInt(10);

  // 2 flags
  result.useEmitterSizes = bs.readFlag();
  result.useEmitterColors = bs.readFlag();

  // U32 count (4 bytes) + per-particle: flag(1b) + conditional readClassId(11b)
  // Verified against decompiled binary FUN_006222a0:
  //   read(4, &count) → U32 count
  //   for each: readFlag → if true: FUN_00436d10 (readClassId, 11 bits); else: 0xFFFFFFFF
  const particleCount = bs.readU32();
  const particles: (number | null)[] = [];
  for (let i = 0; i < particleCount && i < 16; i++) {
    particles.push(readDataBlockRef(bs));
  }
  result.particles = particles;

  return result;
}

// ============================================================
// ParticleData (extends GameBaseData)
// ============================================================

function particleDataUnpack(bs: BitStream): ParticleDataBlock {
  const result: ParticleDataBlock = {};

  // readFloat(10) + flag then F32
  result.dragCoefficient = bs.readFloat(10);
  if (bs.readFlag()) result.windCoefficient = bs.readF32();

  // readSignedFloat(12)
  result.gravityCoefficient = bs.readSignedFloat(12);

  // readFloat(9) + flag then F32
  result.inheritedVelFactor = bs.readFloat(9);
  if (bs.readFlag()) result.constantAcceleration = bs.readF32();

  // 2×readInt(10)
  result.lifetimeMS = bs.readInt(10);
  result.lifetimeVarianceMS = bs.readInt(10);

  // flag then F32 (spinSpeed at offset 0x58, conditional)
  if (bs.readFlag()) result.spinSpeed = bs.readF32();

  // flag then 2×readInt(11) (spinRandomMin/Max at 0x5c/0x60)
  // Verified against decompiled binary FUN_006232d0:
  // spinRandom conditional checks BOTH defaults, reads 11-bit values (subtract 1000)
  if (bs.readFlag()) {
    result.spinRandomMin = bs.readInt(11);
    result.spinRandomMax = bs.readInt(11);
  }

  // useInvAlpha — always read (1-bit flag at offset 0x64)
  // NOT inside the spinRandom conditional (confirmed in binary: separate readFlag at line 416229)
  result.useInvAlpha = bs.readFlag();

  // readInt(2) count(+1); per key: 4×readFloat(7) + readFloat(14) + readFloat(8)
  const numKeys = bs.readInt(2) + 1;
  const keys: ParticleKey[] = [];
  for (let i = 0; i < numKeys; i++) {
    keys.push({
      r: bs.readFloat(7),
      g: bs.readFloat(7),
      b: bs.readFloat(7),
      a: bs.readFloat(7),
      size: bs.readFloat(14),
      time: bs.readFloat(8),
    });
  }
  result.keys = keys;

  // readInt(6) texCount; per tex: readString
  const texCount = bs.readInt(6);
  const textures: string[] = [];
  for (let i = 0; i < texCount && i < 50; i++) {
    textures.push(bs.readString());
  }
  result.textures = textures;

  return result;
}

// ============================================================
// AudioDescription (extends SimDataBlock — 0 parent bits)
// ============================================================

function audioDescriptionUnpack(bs: BitStream): AudioDescriptionDataBlock {
  const result: AudioDescriptionDataBlock = {};

  // readFloat(6)
  result.volume = bs.readFloat(6);

  // flag(looping); if true: 3×S32
  result.isLooping = bs.readFlag();
  if (result.isLooping) {
    result.loopCount = bs.readS32();
    result.minLoopGap = bs.readS32();
    result.maxLoopGap = bs.readS32();
  }

  // flag(is3D); if true: 2×F32 + 2×readInt(9) + readFloat(6) + readNormalVector(8) + F32
  // Verified: decompiled FUN_0040c1a0 has NO isStreaming flag between isLooping and is3D.
  // Offsets: isLooping=0x40, is3D=0x41 — consecutive with no gap.
  result.is3D = bs.readFlag();
  if (result.is3D) {
    result.referenceDistance = bs.readF32();
    result.maxDistance = bs.readF32();
    result.coneInsideAngle = bs.readInt(9);
    result.coneOutsideAngle = bs.readInt(9);
    result.coneOutsideVolume = bs.readFloat(6);
    result.coneVector = bs.readNormalVector(8);
    result.environmentLevel = bs.readF32();
  }

  // readInt(3) — type
  result.type = bs.readInt(3);

  return result;
}

// ============================================================
// AudioProfile (extends SimDataBlock — 0 parent bits)
// ============================================================

function audioProfileUnpack(bs: BitStream): AudioProfileDataBlock {
  const result: AudioProfileDataBlock = {};

  // Verified: decompiled FUN_0040c7f0 reads 3 DataBlock refs + 1 string.
  // Offsets: 0x48 (description), 0x4c (effect/environment), 0x50 (sampleEnvironment)
  result.description = readDataBlockRef(bs);
  result.environment = readDataBlockRef(bs);
  result.sampleEnvironment = readDataBlockRef(bs);

  // readString (filename, .wav appended on read)
  result.filename = bs.readString();

  return result;
}

// ============================================================
// AudioEnvironment (extends SimDataBlock — 0 parent bits)
// ============================================================

function audioEnvironmentUnpack(bs: BitStream): AudioEnvironmentDataBlock {
  // Verified against decompiled binary FUN_0040b530
  const result: AudioEnvironmentDataBlock = {};

  // flag(useRoom) → offset 0x3c
  result.useRoom = bs.readFlag();
  if (result.useRoom) {
    // readRangedU32(0, 26) → offset 0x40 (FUN_0043f120(0x1b=27), rangeSize=27, max=26)
    result.room = bs.readRangedU32(0, 26);
  } else {
    // 13 fields inside !useRoom branch (binary offsets 0x44-0x7c)
    result.roomHF = readRangedS32(bs, -10000, 0); // 0x44
    result.reflections = readRangedS32(bs, -10000, 10000); // 0x48
    result.reverb = readRangedS32(bs, -10000, 2000); // 0x4c
    result.roomRolloffFactor = readRangedF32(bs, 0.1, 10, 8); // 0x50
    result.decayTime = readRangedF32(bs, 0.1, 20, 8); // 0x54
    result.decayHFRatio = readRangedF32(bs, 0.1, 20, 8); // 0x58
    result.reflectionsDelay = readRangedF32(bs, 0, 0.3, 9); // 0x5c
    result.reverbDelay = readRangedF32(bs, 0, 0.1, 7); // 0x60
    result.roomVolume = readRangedS32(bs, -10000, 0); // 0x64
    result.effectVolume = readRangedF32(bs, 0, 1, 9); // 0x6c (9 bits, confirmed in binary)
    result.damping = readRangedF32(bs, 0, 2, 10); // 0x70 (10 bits, confirmed in binary)
    result.environmentSize = readRangedF32(bs, 1, 100, 8); // 0x74 (8 bits, confirmed in binary)
    result.environmentDiffusion = readRangedF32(bs, 0, 1, 10); // 0x78 (10 bits, confirmed in binary)
    // NOTE: No airAbsorption field in binary (V12 has it, Tribes 2 binary does not)
    result.flags = bs.readInt(6); // 0x7c
  }

  // Trailing field: always present after both branches (binary line 23471, offset 0x68)
  result.effectVolumeHF = readRangedF32(bs, 0, 1, 8);

  return result;
}

// ============================================================
// AudioSampleEnvironment (extends SimDataBlock — 0 parent bits)
// ============================================================

function audioSampleEnvironmentUnpack(bs: BitStream): AudioSampleEnvironmentDataBlock {
  const result: AudioSampleEnvironmentDataBlock = {};

  // Series of rangedS32 and rangedF32 values + readInt(3)
  result.direct = readRangedS32(bs, -10000, 1000);
  result.directHF = readRangedS32(bs, -10000, 0);
  result.room = readRangedS32(bs, -10000, 1000);
  result.roomHF = readRangedS32(bs, -10000, 0);
  result.obstruction = readRangedF32(bs, 0, 1, 9);
  result.obstructionLFRatio = readRangedF32(bs, 0, 1, 8);
  result.occlusion = readRangedF32(bs, 0, 1, 9);
  result.occlusionLFRatio = readRangedF32(bs, 0, 1, 8);
  result.occlusionRoomRatio = readRangedF32(bs, 0, 10, 9);
  result.roomRolloff = readRangedF32(bs, 0, 10, 9);
  result.airAbsorption = readRangedF32(bs, 0, 10, 9);
  result.outsideVolumeHF = readRangedS32(bs, -10000, 0);
  result.flags = bs.readInt(3);

  return result;
}

// ============================================================
// DecalData (extends SimDataBlock — 0 parent bits)
// ============================================================

function decalDataUnpack(bs: BitStream): DecalDataBlock {
  return {
    sizeX: bs.readF32(),
    sizeY: bs.readF32(),
    textureName: bs.readString(),
  };
}

// ============================================================
// CameraData (extends ShapeBaseData) — no additional fields
// ============================================================

function cameraDataUnpack(bs: BitStream): CameraDataBlock {
  return shapeBaseDataUnpack(bs);
}

// ============================================================
// SensorData — empty body
// ============================================================

function sensorDataUnpack(_bs: BitStream): SensorDataBlock {
  return {};
}

// ============================================================
// TriggerData — S32(tickPeriodMS)
// ============================================================

function triggerDataUnpack(bs: BitStream): TriggerDataBlock {
  return { tickPeriodMS: bs.readS32() };
}

// ============================================================
// ForceFieldBareData
// ============================================================

function forceFieldBareDataUnpack(bs: BitStream): ForceFieldBareDataBlock {
  // Verified against decompiled binary FUN_00675580
  const result: ForceFieldBareDataBlock = {};

  // 3 S32/F32 (offsets 0x44, 0x48, 0x4c)
  result.fadeMS = bs.readS32();
  result.baseTranslucency = bs.readF32();
  result.powerOffTranslucency = bs.readF32();

  // 2 readFlag (offsets 0x8c, 0x8d — 1-bit flags, inline bit extraction)
  result.fadeInOnly = bs.readFlag();
  result.triggerEnable = bs.readFlag();

  // 2 ColorF via FUN_0043f040 (packed 4×U8 = 32 bits each, offsets 0x90, 0xa0)
  result.color1 = readColorF(bs);
  result.color2 = readColorF(bs);

  // Offsets 0x84, 0x88, 0x80, 0x78, 0x7c — named to match TorqueScript fields.
  // framesPerSec and numFrames are S32 (integers); the rest are F32.
  result.framesPerSec = bs.readS32(); // 0x84
  result.numFrames = bs.readS32();    // 0x88
  result.scrollSpeed = bs.readF32();  // 0x80
  result.umapping = bs.readF32();     // 0x78
  result.vmapping = bs.readF32();     // 0x7c

  // 5 readString (loop at 0x50+i*4)
  result.texture0 = bs.readString();
  result.texture1 = bs.readString();
  result.texture2 = bs.readString();
  result.texture3 = bs.readString();
  result.texture4 = bs.readString();

  return result;
}

// ============================================================
// ParticleEmissionDummyData — F32(timeMultiple)
// ============================================================

function particleEmissionDummyDataUnpack(
  bs: BitStream
): ParticleEmissionDummyDataBlock {
  return { timeMultiple: bs.readF32() };
}

// ============================================================
// CommanderIconData — 5 readString (NumImages=5)
// ============================================================

function commanderIconDataUnpack(bs: BitStream): CommanderIconDataBlock {
  return {
    baseImage: bs.readString(),
    activeImage: bs.readString(),
    inactiveImage: bs.readString(),
    selectImage: bs.readString(),
    hilightImage: bs.readString(),
  };
}

// ============================================================
// PrecipitationData
// ============================================================

function precipitationDataUnpack(bs: BitStream): PrecipitationDataBlock {
  // Verified against decompiled binary FUN_006805d0
  const result: PrecipitationDataBlock = {};

  // DataBlockRef (soundProfile at offset 0x48)
  result.soundProfile = readDataBlockRef(bs);

  // S32 (offset 0x4c)
  result.numDrops = bs.readS32();

  // F32 (maxSize at offset 0x50 — before string)
  result.maxSize = bs.readF32();

  // readString (materialList at offset 0x5c)
  result.materialList = bs.readString();

  // 13×F32 (offsets 0x54, 0x58, 0x60, 0x64, 0x68, 0x6c, 0x70, 0x74, 0x78, 0x7c, 0x80, 0x84, 0x88)
  result.sizeX = bs.readF32();
  result.sizeY = bs.readF32();
  result.movingBoxPer = bs.readF32();
  result.divHeightVal = bs.readF32();
  result.sizeBigBox = bs.readF32();
  result.topBoxSpeed = bs.readF32();
  result.frontBoxSpeed = bs.readF32();
  result.topBoxDrawPer = bs.readF32();
  result.bottomDrawHeight = bs.readF32();
  result.skipIfPer = bs.readF32();
  result.bottomSpeedPer = bs.readF32();
  result.frontSpeedPer = bs.readF32();
  result.frontRadiusPer = bs.readF32();

  return result;
}

// ============================================================
// FireballAtmosphereData
// ============================================================

function fireballAtmosphereDataUnpack(bs: BitStream): FireballAtmosphereDataBlock {
  return { emitter: readDataBlockRef(bs) };
}

// ============================================================
// LightningData
// ============================================================

function lightningDataUnpack(bs: BitStream): LightningDataBlock {
  const result: LightningDataBlock = {};

  // 8 readDataBlockRef (strikeSound profiles)
  const strikeSounds: (number | null)[] = [];
  for (let i = 0; i < 8; i++) {
    strikeSounds.push(readDataBlockRef(bs));
  }
  result.strikeSounds = strikeSounds;

  // 8 readString (strikeTextures)
  const strikeTextures: string[] = [];
  for (let i = 0; i < 8; i++) {
    strikeTextures.push(bs.readString());
  }
  result.strikeTextures = strikeTextures;

  // readDataBlockRef (thunder sound)
  result.thunderSound = readDataBlockRef(bs);

  return result;
}

// ============================================================
// StationFXVehicleData
// ============================================================

function stationFXVehicleDataUnpack(bs: BitStream): StationFXVehicleDataBlock {
  // Field order confirmed from decompiled binary FUN_0069d570
  const result: StationFXVehicleDataBlock = {};

  // 11 F32 fields (offsets 0x44-0x6c)
  result.glowTopHeight = bs.readF32(); // 0x44
  result.glowBottomHeight = bs.readF32(); // 0x48
  result.glowTopRadius = bs.readF32(); // 0x4c
  result.glowBottomRadius = bs.readF32(); // 0x50
  result.numGlowSegments = bs.readF32(); // 0x54
  result.glowFadeTime = bs.readF32(); // 0x58
  result.armLightDelay = bs.readF32(); // 0x5c
  result.armLightLifetime = bs.readF32(); // 0x60
  result.armLightFadeTime = bs.readF32(); // 0x64
  result.lifetime = bs.readF32(); // 0x68
  result.numArcSegments = bs.readF32(); // 0x6c

  // ColorF via FUN_0043f040 (4×U8 = 32 bits at offset 0x70)
  result.sphereColor = readColorF(bs);

  // 6 F32 fields (offsets 0x80-0x94)
  result.spherePhiSegments = bs.readF32(); // 0x80
  result.sphereThetaSegments = bs.readF32(); // 0x84
  result.sphereRadius = bs.readF32(); // 0x88
  result.scale = {
    x: bs.readF32(), // 0x8c
    y: bs.readF32(), // 0x90
    z: bs.readF32(), // 0x94
  };

  // 11 strings
  result.glowTexture = bs.readString(); // 0x98

  // 4×(2 readString) — pad textures
  result.padTexture00 = bs.readString();
  result.padTexture01 = bs.readString();
  result.padTexture10 = bs.readString();
  result.padTexture11 = bs.readString();
  result.padTexture20 = bs.readString();
  result.padTexture21 = bs.readString();
  result.padTexture30 = bs.readString();
  result.padTexture31 = bs.readString();

  // 2 readString
  result.lightStartColor = bs.readString();
  result.lightEndColor = bs.readString();

  return result;
}

// ============================================================
// StationFXPersonalData
// ============================================================

function stationFXPersonalDataUnpack(bs: BitStream): StationFXPersonalDataBlock {
  const result: StationFXPersonalDataBlock = {};

  // ~10 F32
  result.glowTopRadius = bs.readF32();
  result.glowBottomRadius = bs.readF32();
  result.glowTopHeight = bs.readF32();
  result.glowBottomHeight = bs.readF32();
  result.numGlowSegments = bs.readF32();
  result.numGlowPanels = bs.readF32();
  result.topAlpha = bs.readF32();
  result.bottomAlpha = bs.readF32();
  result.glowSpeed = bs.readF32();
  result.scrollSpeed = bs.readF32();

  // 2 readString
  result.glowTexture = bs.readString();
  result.padTexture = bs.readString();

  // 2 readString
  result.lightStartColor = bs.readString();
  result.lightEndColor = bs.readString();

  return result;
}

// ============================================================
// CannedChatItem (game-specific, Tribes 2 only)
// From Tribes 2 script reference: single readString (chatText)
// ============================================================

function cannedChatItemUnpack(bs: BitStream): CannedChatItemDataBlock {
  return { chatText: bs.readString() };
}

// ============================================================
// MissionMarkerData (extends ShapeBaseData — no additional fields)
// ============================================================

function missionMarkerDataUnpack(bs: BitStream): MissionMarkerDataBlock {
  return shapeBaseDataUnpack(bs);
}

// ============================================================
// GameBaseData (extends SimDataBlock — 0 bits on wire)
// ============================================================

function gameBaseDataUnpack(_bs: BitStream): GameBaseDataBlock {
  return {};
}

// ============================================================
// SimDataBlock — 0 bits on wire (base class)
// ============================================================

function simDataBlockUnpack(_bs: BitStream): SimDataBlock {
  return {};
}

// ============================================================
// TSShapeConstructor (extends SimDataBlock)
// readString(shape) + readInt(7) count + count × readString
// NumSequenceBits = 7
// ============================================================

function tsShapeConstructorUnpack(bs: BitStream): TSShapeConstructorDataBlock {
  const result: TSShapeConstructorDataBlock = {};
  result.shape = bs.readString();
  const count = bs.readInt(7);
  const sequences: string[] = [];
  for (let i = 0; i < count && i < 128; i++) {
    sequences.push(bs.readString());
  }
  result.sequences = sequences;
  return result;
}

// ============================================================
// EffectProfile (classId 139)
// From decompiled binary FUN_0050dde0.
// Parent: SimDataBlock (no-op)
// ============================================================

function effectProfileUnpack(bs: BitStream): EffectProfileDataBlock {
  const result: EffectProfileDataBlock = {};
  result.minDistance = bs.readF32();     // 0x40
  result.maxDistance = bs.readF32();     // 0x44
  result.audioScale = bs.readF32();     // 0x48
  result.directional = readBool(bs);    // 0x4c, _read(1) = 8-bit bool
  result.effectName = bs.readString();  // 0x3c
  return result;
}

// ============================================================
// JetEffectData (classId 150)
// From decompiled binary FUN_0069fe60.
// Parent: GameBaseData → SimDataBlock (no-op chain)
// ============================================================

function jetEffectDataUnpack(bs: BitStream): JetEffectDataBlock {
  const result: JetEffectDataBlock = {};
  result.coolColor = readColorF(bs);      // 0x44, FUN_0043f040 = packed 4×U8
  result.hotColor = readColorF(bs);       // 0x54, FUN_0043f040 = packed 4×U8
  result.activateTime = bs.readF32();     // 0x64
  result.deactivateTime = bs.readF32();   // 0x68
  result.length = bs.readF32();           // 0x6c
  result.width = bs.readF32();            // 0x70
  result.speed = bs.readF32();            // 0x74
  result.stretch = bs.readF32();          // 0x78
  result.yOffset = bs.readF32();          // 0x7c
  // texture[0]: loop of 1 iteration, flag + conditional string
  if (bs.readFlag()) {
    result.texture = bs.readString();     // 0x80
  }
  return result;
}

// ============================================================
// RunningLightData (classId 162)
// From decompiled binary FUN_006a0af0.
// Parent: GameBaseData → SimDataBlock (no-op chain)
// ============================================================

function runningLightDataUnpack(bs: BitStream): RunningLightDataBlock {
  const result: RunningLightDataBlock = {};
  result.radius = bs.readF32();           // 0x48
  result.color = readColorF(bs);          // 0x4c, FUN_0043f040 = packed 4×U8
  result.type = bs.readF32();             // 0x44, stored as F32 (bool/int on wire)
  result.length = bs.readF32();           // 0x78
  result.nodeName = bs.readString();      // 0x5c
  result.direction = {                    // 0x60-0x68
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };
  result.offset = {                       // 0x6c-0x74
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };
  // texture[0]: loop of 1 iteration, flag + conditional string
  if (bs.readFlag()) {
    result.texture = bs.readString();     // 0x7c
  }
  return result;
}

// ============================================================
// Registration
// ============================================================

export function registerDataBlockParsers(registry: ClassRegistry): void {
  // Base types
  registry.catalogDataBlock({
    name: "ShapeBaseData",
    unpackData: shapeBaseDataUnpack,
  });
  registry.catalogDataBlock({
    name: "ShapeBaseImageData",
    unpackData: shapeBaseImageDataUnpack,
  });

  // Player/Vehicle types
  registry.catalogDataBlock({ name: "PlayerData", unpackData: playerDataUnpack });
  registry.catalogDataBlock({
    name: "VehicleData",
    unpackData: vehicleDataUnpack,
  });
  registry.catalogDataBlock({
    name: "FlyingVehicleData",
    unpackData: flyingVehicleDataUnpack,
  });
  registry.catalogDataBlock({
    name: "HoverVehicleData",
    unpackData: hoverVehicleDataUnpack,
  });
  registry.catalogDataBlock({
    name: "WheeledVehicleData",
    unpackData: wheeledVehicleDataUnpack,
  });

  // Static/Turret types
  registry.catalogDataBlock({
    name: "StaticShapeData",
    unpackData: staticShapeDataUnpack,
  });
  registry.catalogDataBlock({ name: "TurretData", unpackData: turretDataUnpack });
  registry.catalogDataBlock({
    name: "TurretImageData",
    unpackData: turretImageDataUnpack,
  });

  // Item
  registry.catalogDataBlock({ name: "ItemData", unpackData: itemDataUnpack });

  // Projectile types
  registry.catalogDataBlock({
    name: "ProjectileData",
    unpackData: projectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "LinearProjectileData",
    unpackData: linearProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "GrenadeProjectileData",
    unpackData: grenadeProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "SeekerProjectileData",
    unpackData: seekerProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "SniperProjectileData",
    unpackData: sniperProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "ShockLanceProjectileData",
    unpackData: shockLanceProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "ELFProjectileData",
    unpackData: elfProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "RepairProjectileData",
    unpackData: repairProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "TargetProjectileData",
    unpackData: targetProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "TracerProjectileData",
    unpackData: tracerProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "EnergyProjectileData",
    unpackData: energyProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "LinearFlareProjectileData",
    unpackData: linearFlareProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "BombProjectileData",
    unpackData: bombProjectileDataUnpack,
  });
  registry.catalogDataBlock({
    name: "FlareProjectileData",
    unpackData: flareProjectileDataUnpack,
  });

  // Effects
  registry.catalogDataBlock({
    name: "ExplosionData",
    unpackData: explosionDataUnpack,
  });
  registry.catalogDataBlock({ name: "DebrisData", unpackData: debrisDataUnpack });
  registry.catalogDataBlock({ name: "SplashData", unpackData: splashDataUnpack });
  registry.catalogDataBlock({
    name: "ShockwaveData",
    unpackData: shockwaveDataUnpack,
  });
  registry.catalogDataBlock({
    name: "ParticleEmitterData",
    unpackData: particleEmitterDataUnpack,
  });
  registry.catalogDataBlock({
    name: "ParticleData",
    unpackData: particleDataUnpack,
  });

  // Audio
  registry.catalogDataBlock({
    name: "AudioDescription",
    unpackData: audioDescriptionUnpack,
  });
  registry.catalogDataBlock({
    name: "AudioProfile",
    unpackData: audioProfileUnpack,
  });
  registry.catalogDataBlock({
    name: "AudioEnvironment",
    unpackData: audioEnvironmentUnpack,
  });
  registry.catalogDataBlock({
    name: "AudioSampleEnvironment",
    unpackData: audioSampleEnvironmentUnpack,
  });

  // Misc
  registry.catalogDataBlock({ name: "DecalData", unpackData: decalDataUnpack });
  registry.catalogDataBlock({
    name: "CameraData",
    unpackData: cameraDataUnpack,
  });
  registry.catalogDataBlock({ name: "SensorData", unpackData: sensorDataUnpack });
  registry.catalogDataBlock({
    name: "TriggerData",
    unpackData: triggerDataUnpack,
  });
  registry.catalogDataBlock({
    name: "ForceFieldBareData",
    unpackData: forceFieldBareDataUnpack,
  });
  registry.catalogDataBlock({
    name: "ParticleEmissionDummyData",
    unpackData: particleEmissionDummyDataUnpack,
  });
  registry.catalogDataBlock({
    name: "CommanderIconData",
    unpackData: commanderIconDataUnpack,
  });
  registry.catalogDataBlock({
    name: "PrecipitationData",
    unpackData: precipitationDataUnpack,
  });
  registry.catalogDataBlock({
    name: "FireballAtmosphereData",
    unpackData: fireballAtmosphereDataUnpack,
  });
  registry.catalogDataBlock({
    name: "LightningData",
    unpackData: lightningDataUnpack,
  });
  registry.catalogDataBlock({
    name: "StationFXVehicleData",
    unpackData: stationFXVehicleDataUnpack,
  });
  registry.catalogDataBlock({
    name: "StationFXPersonalData",
    unpackData: stationFXPersonalDataUnpack,
  });

  // Classes added from game-specific analysis
  registry.catalogDataBlock({
    name: "CannedChatItem",
    unpackData: cannedChatItemUnpack,
  });
  registry.catalogDataBlock({
    name: "MissionMarkerData",
    unpackData: missionMarkerDataUnpack,
  });
  registry.catalogDataBlock({
    name: "GameBaseData",
    unpackData: gameBaseDataUnpack,
  });
  registry.catalogDataBlock({
    name: "SimDataBlock",
    unpackData: simDataBlockUnpack,
  });
  registry.catalogDataBlock({
    name: "TSShapeConstructor",
    unpackData: tsShapeConstructorUnpack,
  });

  // Previously missing parsers (verified against decompiled binary)
  registry.catalogDataBlock({
    name: "EffectProfile",
    unpackData: effectProfileUnpack,
  });
  registry.catalogDataBlock({
    name: "JetEffectData",
    unpackData: jetEffectDataUnpack,
  });
  registry.catalogDataBlock({
    name: "RunningLightData",
    unpackData: runningLightDataUnpack,
  });
}
