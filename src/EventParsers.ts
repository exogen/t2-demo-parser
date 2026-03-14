import type { BitStream } from "./BitStream.js";
import type { ClassRegistry, ConnectionContext } from "./ClassRegistry.js";
import {
  DataBlockClassFirst,
  SimDBEventObjectIdBits,
  SimDBEventClassIdBits,
  SimDBEventIndexBits,
  SimDBEventTotalBits,
} from "./types.js";

// ============================================================
// SimDataBlockEvent — DataBlock definition sent during gameplay
// ============================================================

function simDataBlockEventUnpack(
  bs: BitStream,
  conn: ConnectionContext
): Record<string, unknown> {
  // Decompiled source of truth:
  //   FUN_005ffc90 reads:
  //     mProcess flag + readClassId() + readInt(7) + readInt(11) + readInt(12)
  // This matches the on-wire format written by FUN_005ffbc0.
  const mProcess = bs.readFlag();
  if (!mProcess) {
    return {
      type: "SimDataBlockEvent",
      mProcess: false,
    };
  }

  const id = bs.readInt(SimDBEventObjectIdBits) + 0;
  const classId = bs.readInt(SimDBEventClassIdBits) + DataBlockClassFirst;
  const index = bs.readInt(SimDBEventIndexBits);
  const total = bs.readInt(SimDBEventTotalBits);

  const result: Record<string, unknown> = {
    type: "SimDataBlockEvent",
    mProcess: true,
  };

  result.objectId = id;
  result.classId = classId;
  result.index = index;
  result.total = total;

  // Save payload start for DataBlock discovery
  result._payloadBitPos = bs.getCurPos();

  // Try to parse the DataBlock payload if we have a parser.
  // String buffer is already enabled by parsePacket() for the entire packet —
  // do NOT toggle it here, as that would reset accumulated prefix context and
  // then disable string buffer for the rest of the packet's events and ghosts.
  const parser = conn.getDataBlockParser?.(classId);
  if (parser) {
    try {
      result.dataBlockData = parser.unpackData(bs);
      result.dataBlockClassName = parser.name;
    } catch {
      result._needsClassParser = true;
    }
  } else {
    result._needsClassParser = true;
  }

  return result;
}

// ============================================================
// NetStringEvent — string table update
// ============================================================

function netStringEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  // Tribes2.exe source of truth (FUN_00589b60):
  // - id: readInt(10)
  // - hasValue: readFlag()
  // - if hasValue: readString() via BitStream::readString(..., 0xff)
  const id = bs.readInt(10);
  const hasValue = bs.readFlag();
  const value = hasValue ? bs.readString() : undefined;
  return { type: "NetStringEvent", id, hasValue, value };
}

// ============================================================
// Sim2DAudioEvent — 2D audio playback
// ============================================================

function sim2DAudioEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  // Binary FUN_005fff40: FUN_00436d10(bs) = readInt(11) for DataBlock object ref.
  // No +3 offset — object IDs here use the same numbering as ghost dataBlockId
  // references and SimDataBlockEvent.objectId (all keyed by raw readInt(11)).
  const id = bs.readInt(11);
  return { type: "Sim2DAudioEvent", profileId: id };
}

// ============================================================
// Sim3DAudioEvent — 3D positional audio
// ============================================================

function sim3DAudioEventUnpack(
  bs: BitStream,
  conn: ConnectionContext
): Record<string, unknown> {
  // Binary FUN_006000f0: FUN_00436d10(bs) = readInt(11) for DataBlock object ref.
  // No +3 offset — same numbering as ghost dataBlockId and SimDataBlockEvent.
  const id = bs.readInt(11);
  let rotation: Record<string, unknown> | undefined;
  if (bs.readFlag()) {
    // Has cone params — read quaternion
    const qx = bs.readFloat(8);
    const qy = bs.readFloat(8);
    const qz = bs.readFloat(8);
    let qw = Math.sqrt(Math.max(0, 1.0 - (qx * qx + qy * qy + qz * qz)));
    if (bs.readFlag()) qw = -qw;
    rotation = { x: qx, y: qy, z: qz, w: qw };
  }
  // Read compressed position
  const position = bs.readCompressedPoint(conn.compressionPoint, 0.5);
  return { type: "Sim3DAudioEvent", profileId: id, rotation, position };
}

// ============================================================
// SetSensorGroupEvent
// ============================================================

function setSensorGroupEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return { type: "SetSensorGroupEvent", sensorGroup: bs.readInt(5) };
}

// ============================================================
// SetServerTargetEvent
// ============================================================

function setServerTargetEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "SetServerTargetEvent" };
  if (bs.readFlag()) {
    result.targetId = bs.readInt(9); // TargetIdBitSize=9
  }
  result.targetPos = {
    x: bs.readF32(),
    y: bs.readF32(),
    z: bs.readF32(),
  };
  return result;
}

// ============================================================
// TargetToEvent — waypoint/command targeting
// ============================================================

function targetToEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "TargetToEvent" };
  if (bs.readFlag()) {
    result.targetId = bs.readInt(9);
  }
  if (bs.readFlag()) {
    // Position only
    result.targetPos = {
      x: bs.readF32(),
      y: bs.readF32(),
      z: bs.readF32(),
    };
  }
  result.assign = bs.readFlag();
  return result;
}

// ============================================================
// SetObjectActiveImageEvent
// ============================================================

function setObjectActiveImageEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  const objectId = bs.readRangedU32(0, 1023); // MaxGhostCount-1
  const imageSlot = bs.readRangedU32(0, 8); // MaxMountedImages
  return { type: "SetObjectActiveImageEvent", objectId, imageSlot };
}

// ============================================================
// SetMissionCRCEvent
// ============================================================

function setMissionCRCEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return { type: "SetMissionCRCEvent", crc: bs.readU32() };
}

// ============================================================
// RemoteCommandEvent — script console command
// ============================================================

function remoteCommandEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  // Decompiled Tribes 2 binary source of truth:
  //   pack:   FUN_005bfd40 writes argc(5 bits), then argc×FUN_00588530
  //   unpack: FUN_005bfda0 reads argc(5 bits), then argc×FUN_00588690
  const argc = bs.readInt(5);
  const args: string[] = [];
  for (let i = 0; i < argc; i++) {
    args.push(bs.unpackNetString());
  }
  return {
    type: "RemoteCommandEvent",
    argc,
    argv: args,
    funcName: args[0] ?? "",
    args: args.slice(1),
  };
}

// ============================================================
// TargetInfoEvent — target metadata synchronization
// ============================================================

function targetInfoEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  // Decompiled Tribes2.exe source of truth (FUN_006735b0):
  // - targetId: readInt(9)
  // - tag fields: outer presence flag; inner non-empty flag; if non-empty readInt(10), else sentinel 0x400
  // - sensorGroup: optional readInt(5)
  // - dataBlock: outer presence flag; inner valid flag; if valid readInt(11), else sentinel -2
  // - renderFlags: optional readInt(9)
  // - voicePitch: optional readFloat(7) * 1.5 + 0.5
  const result: Record<string, unknown> = { type: "TargetInfoEvent" };
  result.targetId = bs.readInt(9); // TargetIdBitSize=9

  if (bs.readFlag()) {
    result.nameTag = bs.readFlag() ? bs.readInt(10) : 0x400;
  }
  if (bs.readFlag()) {
    result.skinTag = bs.readFlag() ? bs.readInt(10) : 0x400;
  }
  if (bs.readFlag()) {
    result.skinPrefTag = bs.readFlag() ? bs.readInt(10) : 0x400;
  }
  if (bs.readFlag()) {
    result.voiceTag = bs.readFlag() ? bs.readInt(10) : 0x400;
  }
  if (bs.readFlag()) {
    result.typeTag = bs.readFlag() ? bs.readInt(10) : 0x400;
  }
  if (bs.readFlag()) {
    result.sensorGroup = bs.readInt(5);
  }
  if (bs.readFlag()) {
    result.dataBlockId = bs.readFlag() ? bs.readInt(11) : -2;
  }
  if (bs.readFlag()) {
    result.renderFlags = bs.readInt(9); // NumRenderBits=9
  }
  if (bs.readFlag()) {
    const raw = bs.readFloat(7);
    result.voicePitch = raw * 1.5 + 0.5;
  }

  return result;
}

// ============================================================
// TargetFreeEvent — target cleanup notification
// ============================================================

function targetFreeEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return { type: "TargetFreeEvent", targetId: bs.readInt(9) };
}

// ============================================================
// SimTargetAudioEvent — target-specific audio
// ============================================================

function simTargetAudioEventUnpack(
  bs: BitStream,
  conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "SimTargetAudioEvent" };
  result.targetId = bs.readInt(9);
  result.fileTag = bs.readInt(12);
  result.descriptionId = bs.readRangedU32(3, 1026);
  if (bs.readFlag()) {
    result.position = bs.readCompressedPoint(conn.compressionPoint, 0.5);
  }
  result.updateSound = bs.readFlag();
  return result;
}

// ============================================================
// SensorGroupColorEvent — sensor group HUD colors
// ============================================================

function sensorGroupColorEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "SensorGroupColorEvent" };
  result.sensorGroup = bs.readInt(5);
  const updateMask = bs.readU32();
  result.updateMask = updateMask;
  const colors: Record<string, unknown>[] = [];
  for (let i = 0; i < 32; i++) {
    if ((1 << i) & updateMask) {
      if (bs.readFlag()) {
        colors.push({
          index: i,
          r: bs.readU8(),
          g: bs.readU8(),
          b: bs.readU8(),
          a: bs.readU8(),
        });
      } else {
        colors.push({ index: i, default: true });
      }
    }
  }
  result.colors = colors;
  return result;
}

// ============================================================
// ResetClientTargetsEvent — clear all client targets
// ============================================================

function resetClientTargetsEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return {
    type: "ResetClientTargetsEvent",
    clientTargetsOnly: bs.readFlag(),
  };
}

// ============================================================
// RemoveClientTargetTypeEvent — remove targets by type
// ============================================================

function removeClientTargetTypeEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return {
    type: "RemoveClientTargetTypeEvent",
    targetType: bs.readRangedU32(0, 3), // NumTypes=3
  };
}

// ============================================================
// SimVoiceStreamEvent — voice chat audio streaming
// ============================================================

function simVoiceStreamEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "SimVoiceStreamEvent" };
  result.streamId = bs.readInt(5);
  result.sequence = bs.readInt(6); // SEQUENCE_BITS=6
  result.codecId = bs.readInt(2);
  // Server connection (demo is always client-side):
  result.clientId = bs.readU8();
  if (result.sequence === 0) {
    result.objectId = bs.readInt(10); // GhostIdBitSize=10
  }
  // Size
  const VOICE_PACKET_DATA_SIZE = 16; // typical value
  if (bs.readFlag()) {
    result.size = bs.readInt(5); // SIZE_BITS=5
  } else {
    result.size = VOICE_PACKET_DATA_SIZE;
  }
  // Skip the audio data bytes (mSize bytes, but first byte is lock byte so we read mSize-1)
  const dataSize = (result.size as number);
  if (dataSize > 0) {
    result.audioData = bs.readBitsBuffer(dataSize * 8);
  }
  return result;
}

// ============================================================
// GhostingMessageEvent — ghost synchronization control
// ============================================================

function ghostingMessageEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return {
    type: "GhostingMessageEvent",
    sequence: bs.readU32(),
    message: bs.readInt(3),
    ghostCount: bs.readInt(11),
  };
}

// ============================================================
// GhostAlwaysObjectEvent — scope-always ghost objects
// ============================================================

function ghostAlwaysObjectEventUnpack(
  bs: BitStream,
  conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "GhostAlwaysObjectEvent" };
  result.ghostIndex = bs.readInt(10);
  const hasObjectData = bs.readFlag();
  result._hasObjectData = hasObjectData;

  if (hasObjectData) {
    const classId = bs.readInt(7); // NetObjectClassBitSize=7
    result.classId = classId;

    // Binary FUN_005854e0: classId + full object unpackUpdate payload.
    // We must consume the embedded payload here to keep packet bit alignment.
    const parser = conn.getGhostParser?.(classId);
    if (!parser) {
      throw new Error(`No ghost parser for GhostAlwaysObjectEvent classId=${classId}`);
    }
    result.objectData = parser.unpackUpdate(bs, true, conn);
  }
  return result;
}

// ============================================================
// PathManagerEvent — server path/patrol route updates
// ============================================================

function pathManagerEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "PathManagerEvent" };

  if (bs.readFlag()) {
    // NewPaths
    result.messageType = "NewPaths";
    const numPaths = bs.readU32();
    const paths: Record<string, unknown>[] = [];
    for (let i = 0; i < numPaths && i < 256; i++) {
      const totalTime = bs.readU32();
      const numPoints = bs.readU32();
      const points: Record<string, unknown>[] = [];
      for (let j = 0; j < numPoints && j < 1024; j++) {
        points.push({
          position: bs.readPoint3F(),
          msToNext: bs.readU32(),
        });
      }
      paths.push({ totalTime, points });
    }
    result.paths = paths;
  } else {
    // ModifyPath
    result.messageType = "ModifyPath";
    result.modifiedPath = bs.readU32();
    const totalTime = bs.readU32();
    const numPoints = bs.readU32();
    const points: Record<string, unknown>[] = [];
    for (let j = 0; j < numPoints && j < 1024; j++) {
      points.push({
        position: bs.readPoint3F(),
        msToNext: bs.readU32(),
      });
    }
    result.path = { totalTime, points };
  }

  return result;
}

// ============================================================
// LightningStrikeEvent — lightning visual effects
// ============================================================

function lightningStrikeEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  // Binary FUN_00626e40: flag → early return if false → readInt(11) + readFloat(10) + readFloat(10) + flag → readInt(11)
  const result: Record<string, unknown> = { type: "LightningStrikeEvent" };
  if (!bs.readFlag()) {
    return result;
  }
  result.sourceGhost = bs.readInt(11); // resolveGhost: getNextPow2(0x401)=2048 → 11 bits
  result.startX = bs.readFloat(10);
  result.startY = bs.readFloat(10);
  if (bs.readFlag()) {
    result.targetGhost = bs.readInt(11);
  }
  return result;
}

// ============================================================
// FileChunkEvent — file transfer data chunks
// ============================================================

function fileChunkEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  const chunkLen = bs.readRangedU32(0, 63);
  const chunkData = bs.readBitsBuffer(chunkLen * 8);
  return { type: "FileChunkEvent", chunkLen, chunkData };
}

// ============================================================
// DownloadMessageEvent — file download control
// ============================================================

function downloadMessageEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return {
    type: "DownloadMessageEvent",
    value: bs.readU32(),
    message: bs.readInt(3),
  };
}

// ============================================================
// FileDownloadRequestEvent — request file transfers
// ============================================================

function fileDownloadRequestEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  const nameCount = bs.readRangedU32(0, 31);
  const fileNames: string[] = [];
  for (let i = 0; i < nameCount; i++) {
    fileNames.push(bs.readString());
  }
  return { type: "FileDownloadRequestEvent", fileNames };
}

// ============================================================
// SimpleMessageEvent — test/debug messages
// ============================================================

function simpleMessageEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return { type: "SimpleMessageEvent", message: bs.readString() };
}

// ============================================================
// CRCChallengeEvent — CRC validation challenge from server
// Binary: FUN_006a2c30 reads 3×U32 + readFlag
// ============================================================

function crcChallengeEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return {
    type: "CRCChallengeEvent",
    crcValue: bs.readU32(),
    field1: bs.readU32(),
    field2: bs.readU32(),
    flag: bs.readFlag(),
  };
}

// ============================================================
// CRCChallengeResponseEvent — CRC validation response
// Binary: FUN_006a2e00 reads 3×U32
// ============================================================

function crcChallengeResponseEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return {
    type: "CRCChallengeResponseEvent",
    crcValue: bs.readU32(),
    field1: bs.readU32(),
    field2: bs.readU32(),
  };
}

// ============================================================
// GravityEvent — gravity value synchronization
// Binary: FUN_005ff5b0 reads 4 bytes (F32 gravity value)
// ============================================================

function gravityEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return {
    type: "GravityEvent",
    gravity: bs.readF32(),
  };
}

// ============================================================
// FogChallengeEvent — fog validation (stub: not found in binary)
// ============================================================

function fogChallengeEventUnpack(
  _bs: BitStream,
  _conn: ConnectionContext
): Record<string, unknown> {
  return { type: "FogChallengeEvent" };
}

// ============================================================
// Register all event parsers
// ============================================================

export function registerEventParsers(registry: ClassRegistry): void {
  registry.catalogEvent({
    name: "SimDataBlockEvent",
    unpack: simDataBlockEventUnpack,
  });
  registry.catalogEvent({
    name: "NetStringEvent",
    unpack: netStringEventUnpack,
  });
  registry.catalogEvent({
    name: "Sim2DAudioEvent",
    unpack: sim2DAudioEventUnpack,
  });
  registry.catalogEvent({
    name: "Sim3DAudioEvent",
    unpack: sim3DAudioEventUnpack,
  });
  registry.catalogEvent({
    name: "SetSensorGroupEvent",
    unpack: setSensorGroupEventUnpack,
  });
  registry.catalogEvent({
    name: "SetServerTargetEvent",
    unpack: setServerTargetEventUnpack,
  });
  registry.catalogEvent({
    name: "TargetToEvent",
    unpack: targetToEventUnpack,
  });
  registry.catalogEvent({
    name: "SetObjectActiveImageEvent",
    unpack: setObjectActiveImageEventUnpack,
  });
  registry.catalogEvent({
    name: "SetMissionCRCEvent",
    unpack: setMissionCRCEventUnpack,
  });
  registry.catalogEvent({
    name: "RemoteCommandEvent",
    unpack: remoteCommandEventUnpack,
  });
  registry.catalogEvent({
    name: "TargetInfoEvent",
    unpack: targetInfoEventUnpack,
  });
  registry.catalogEvent({
    name: "TargetFreeEvent",
    unpack: targetFreeEventUnpack,
  });
  registry.catalogEvent({
    name: "SimTargetAudioEvent",
    unpack: simTargetAudioEventUnpack,
  });
  registry.catalogEvent({
    name: "SensorGroupColorEvent",
    unpack: sensorGroupColorEventUnpack,
  });
  registry.catalogEvent({
    name: "ResetClientTargetsEvent",
    unpack: resetClientTargetsEventUnpack,
  });
  registry.catalogEvent({
    name: "RemoveClientTargetTypeEvent",
    unpack: removeClientTargetTypeEventUnpack,
  });
  registry.catalogEvent({
    name: "SimVoiceStreamEvent",
    unpack: simVoiceStreamEventUnpack,
  });
  registry.catalogEvent({
    name: "GhostingMessageEvent",
    unpack: ghostingMessageEventUnpack,
  });
  registry.catalogEvent({
    name: "GhostAlwaysObjectEvent",
    unpack: ghostAlwaysObjectEventUnpack,
  });
  registry.catalogEvent({
    name: "PathManagerEvent",
    unpack: pathManagerEventUnpack,
  });
  registry.catalogEvent({
    name: "LightningStrikeEvent",
    unpack: lightningStrikeEventUnpack,
  });
  registry.catalogEvent({
    name: "FileChunkEvent",
    unpack: fileChunkEventUnpack,
  });
  registry.catalogEvent({
    name: "DownloadMessageEvent",
    unpack: downloadMessageEventUnpack,
  });
  registry.catalogEvent({
    name: "FileDownloadRequestEvent",
    unpack: fileDownloadRequestEventUnpack,
  });
  registry.catalogEvent({
    name: "SimpleMessageEvent",
    unpack: simpleMessageEventUnpack,
  });
  registry.catalogEvent({
    name: "CRCChallengeEvent",
    unpack: crcChallengeEventUnpack,
  });
  registry.catalogEvent({
    name: "CRCChallengeResponseEvent",
    unpack: crcChallengeResponseEventUnpack,
  });
  registry.catalogEvent({
    name: "GravityEvent",
    unpack: gravityEventUnpack,
  });
  registry.catalogEvent({
    name: "FogChallengeEvent",
    unpack: fogChallengeEventUnpack,
  });
}
