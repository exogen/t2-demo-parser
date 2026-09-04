import type { BitStream } from "./BitStream.js";
import type { ClassRegistry, ConnectionContext } from "./ClassRegistry.js";
import type {
  SimDataBlockEventData,
  NetStringEventData,
  Sim2DAudioEventData,
  Sim3DAudioEventData,
  SetSensorGroupEventData,
  SetServerTargetEventData,
  TargetToEventData,
  SetObjectActiveImageEventData,
  SetMissionCRCEventData,
  RemoteCommandEventData,
  TargetInfoEventData,
  TargetFreeEventData,
  SimTargetAudioEventData,
  SensorGroupColorEventData,
  SensorGroupColorEntry,
  ResetClientTargetsEventData,
  RemoveClientTargetTypeEventData,
  SimVoiceStreamEventData,
  GhostingMessageEventData,
  GhostAlwaysObjectEventData,
  PathManagerEventData,
  PathData,
  PathPoint,
  LightningStrikeEventData,
  FileChunkEventData,
  DownloadMessageEventData,
  FileDownloadRequestEventData,
  SimpleMessageEventData,
  CRCChallengeEventData,
  CRCChallengeResponseEventData,
  GravityEventData,
  FogChallengeEventData,
} from "./eventDataTypes.js";
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
): SimDataBlockEventData {
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

  const id = bs.readInt(SimDBEventObjectIdBits);
  const classId = bs.readInt(SimDBEventClassIdBits) + DataBlockClassFirst;
  const index = bs.readInt(SimDBEventIndexBits);
  const total = bs.readInt(SimDBEventTotalBits);

  // The payload must be consumed to keep the packet aligned; with no
  // parser (only possible for a corrupt classId — all 54 DataBlock
  // classes are bound) the engine would fail the packet too, so throw
  // and let readEvents mark the event failed. Parser errors propagate
  // for the same reason.
  // String buffer is already enabled by parsePacket() for the entire packet —
  // do NOT toggle it here, as that would reset accumulated prefix context and
  // then disable string buffer for the rest of the packet's events and ghosts.
  const parser = conn.getDataBlockParser?.(classId);
  if (!parser) {
    throw new Error(
      `No DataBlock parser for SimDataBlockEvent classId=${classId}`,
    );
  }
  return {
    type: "SimDataBlockEvent",
    mProcess: true,
    objectId: id,
    classId,
    index,
    total,
    dataBlockData: parser.unpackData(bs),
    dataBlockClassName: parser.name,
  };
}

// ============================================================
// NetStringEvent — string table update
// ============================================================

function netStringEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): NetStringEventData {
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
): Sim2DAudioEventData {
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
): Sim3DAudioEventData {
  // Binary FUN_006000f0: FUN_00436d10(bs) = readInt(11) for DataBlock object ref.
  // No +3 offset — same numbering as ghost dataBlockId and SimDataBlockEvent.
  const id = bs.readInt(11);
  let rotation: Sim3DAudioEventData["rotation"];
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
): SetSensorGroupEventData {
  return { type: "SetSensorGroupEvent", sensorGroup: bs.readInt(5) };
}

// ============================================================
// SetServerTargetEvent
// ============================================================

function setServerTargetEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): SetServerTargetEventData {
  const targetId = bs.readFlag() ? bs.readInt(9) : undefined; // TargetIdBitSize=9
  const targetPos = { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() };
  const result: SetServerTargetEventData = {
    type: "SetServerTargetEvent",
    targetPos,
  };
  if (targetId !== undefined) result.targetId = targetId;
  return result;
}

// ============================================================
// TargetToEvent — waypoint/command targeting
// ============================================================

function targetToEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): TargetToEventData {
  const targetId = bs.readFlag() ? bs.readInt(9) : undefined;
  const targetPos = bs.readFlag()
    ? { x: bs.readF32(), y: bs.readF32(), z: bs.readF32() }
    : undefined;
  const result: TargetToEventData = {
    type: "TargetToEvent",
    assign: false, // placeholder, overwritten below
  };
  if (targetId !== undefined) result.targetId = targetId;
  if (targetPos) result.targetPos = targetPos;
  result.assign = bs.readFlag();
  return result;
}

// ============================================================
// SetObjectActiveImageEvent
// ============================================================

function setObjectActiveImageEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): SetObjectActiveImageEventData {
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
): SetMissionCRCEventData {
  return { type: "SetMissionCRCEvent", crc: bs.readU32() };
}

// ============================================================
// RemoteCommandEvent — script console command
// ============================================================

function remoteCommandEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): RemoteCommandEventData {
  // Decompiled Tribes 2 binary source of truth:
  //   pack:   FUN_005bfd40 writes argc(5 bits), then argc×FUN_00588530
  //   unpack: FUN_005bfda0 reads argc(5 bits), then argc×FUN_00588690
  const argc = bs.readInt(5);
  const argv: string[] = [];
  for (let i = 0; i < argc; i++) {
    argv.push(bs.unpackNetString());
  }
  return {
    type: "RemoteCommandEvent",
    argc,
    argv,
    funcName: argv[0] ?? "",
    args: argv.slice(1),
  };
}

// ============================================================
// TargetInfoEvent — target metadata synchronization
// ============================================================

function targetInfoEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): TargetInfoEventData {
  // Decompiled Tribes2.exe source of truth (FUN_006735b0):
  // - targetId: readInt(9)
  // - tag fields: outer presence flag; inner non-empty flag; if non-empty readInt(10), else sentinel 0x400
  // - sensorGroup: optional readInt(5)
  // - dataBlock: outer presence flag; inner valid flag; if valid readInt(11), else sentinel -2
  // - renderFlags: optional readInt(9)
  // - voicePitch: optional readFloat(7) * 1.5 + 0.5
  const result: TargetInfoEventData = {
    type: "TargetInfoEvent",
    targetId: bs.readInt(9), // TargetIdBitSize=9
  };

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
): TargetFreeEventData {
  return { type: "TargetFreeEvent", targetId: bs.readInt(9) };
}

// ============================================================
// SimTargetAudioEvent — target-specific audio
// ============================================================

function simTargetAudioEventUnpack(
  bs: BitStream,
  conn: ConnectionContext
): SimTargetAudioEventData {
  const result: SimTargetAudioEventData = {
    type: "SimTargetAudioEvent",
    targetId: bs.readInt(9),
    fileTag: bs.readInt(12),
    descriptionId: bs.readRangedU32(3, 1026),
    updateSound: false,
  };
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
): SensorGroupColorEventData {
  const sensorGroup = bs.readInt(5);
  const updateMask = bs.readU32();
  const colors: SensorGroupColorEntry[] = [];
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
  return { type: "SensorGroupColorEvent", sensorGroup, updateMask, colors };
}

// ============================================================
// ResetClientTargetsEvent — clear all client targets
// ============================================================

function resetClientTargetsEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): ResetClientTargetsEventData {
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
): RemoveClientTargetTypeEventData {
  return {
    type: "RemoveClientTargetTypeEvent",
    targetType: bs.readRangedU32(0, 3), // NumTypes=3
  };
}

// ============================================================
// SimVoiceStreamEvent — voice chat audio streaming
// ============================================================

/**
 * Voice codec table from the binary (0x0074d6e4, 36-byte entries indexed
 * by the 2-bit codec id). Only the fields the unpacker reads are kept:
 * bytes per frame (+0), frames in a full packet (+4), and whether frames
 * are nibble-packed with a per-frame 4-bit length (+0xc).
 */
const VoiceCodecs: readonly {
  frameBytes: number;
  fullPacketFrames: number;
  nibblePacked: boolean;
}[] = [
  { frameBytes: 6, fullPacketFrames: 6, nibblePacked: true },
  { frameBytes: 7, fullPacketFrames: 5, nibblePacked: false },
  { frameBytes: 9, fullPacketFrames: 4, nibblePacked: false },
  { frameBytes: 33, fullPacketFrames: 1, nibblePacked: false },
];

function simVoiceStreamEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): SimVoiceStreamEventData {
  // Build 25034 (FUN_0040d720, protocol >= 0x23 path — every demo and
  // server this parser supports). This differs from the V12 source:
  //   readInt(7) sequence, readInt(2) codecId, readInt(2) streamId,
  //   U32 clientId (client side), then codec-dependent payload.
  const sequence = bs.readInt(7);
  const codecId = bs.readInt(2);
  const streamId = bs.readInt(2);
  const clientId = bs.readU32();
  const codec = VoiceCodecs[codecId];
  const result: SimVoiceStreamEventData = {
    type: "SimVoiceStreamEvent",
    streamId,
    sequence,
    codecId,
    clientId,
    partial: false,
    frameCount: 0,
  };
  if (codec.nibblePacked) {
    // Flag (stored, unused by the reader), 5-bit frame count, then per
    // frame a 4-bit nibble count and that many nibbles.
    result.partial = bs.readFlag();
    result.frameCount = bs.readInt(5);
    const frames: Uint8Array[] = [];
    for (let i = 0; i < result.frameCount; i++) {
      const nibbles = bs.readInt(4);
      frames.push(bs.readBitsBuffer(nibbles * 4));
    }
    result.frames = frames;
  } else {
    // Flag selects an explicit 5-bit frame count (end-of-stream packets)
    // over the codec's full-packet count; then frameCount × frameBytes.
    result.partial = bs.readFlag();
    result.frameCount = result.partial
      ? bs.readInt(5)
      : codec.fullPacketFrames;
    result.audioData = bs.readBitsBuffer(
      result.frameCount * codec.frameBytes * 8,
    );
  }
  return result;
}

// ============================================================
// GhostingMessageEvent — ghost synchronization control
// ============================================================

function ghostingMessageEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): GhostingMessageEventData {
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
): GhostAlwaysObjectEventData {
  const ghostIndex = bs.readInt(10);
  const hasObjectData = bs.readFlag();
  const result: GhostAlwaysObjectEventData = {
    type: "GhostAlwaysObjectEvent",
    ghostIndex,
    hasObjectData,
  };

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

/**
 * Read a U32 count and reject it unless `minBitsPerEntry × count` bits
 * remain: exhausted reads return 0 without throwing, so a corrupt count
 * would otherwise spin allocating until memory ran out.
 */
function readCheckedCount(
  bs: BitStream,
  minBitsPerEntry: number,
  what: string,
): number {
  const count = bs.readU32();
  if (count > bs.getRemainingBits() / minBitsPerEntry) {
    throw new Error(`Invalid ${what}: ${count}`);
  }
  return count;
}

function readPathPoints(bs: BitStream): PathPoint[] {
  const numPoints = readCheckedCount(bs, 128, "PathManagerEvent numPoints");
  const points: PathPoint[] = [];
  for (let j = 0; j < numPoints; j++) {
    points.push({
      position: bs.readPoint3F(),
      msToNext: bs.readU32(),
    });
  }
  return points;
}

function pathManagerEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): PathManagerEventData {
  // pathManager.cc: counts are raw U32s with no cap; a path entry is at
  // least 64 bits (totalTime + numPoints) and a point exactly 128, so a
  // count that cannot fit in the remaining stream is corrupt.
  if (bs.readFlag()) {
    // NewPaths
    const numPaths = readCheckedCount(bs, 64, "PathManagerEvent numPaths");
    const paths: PathData[] = [];
    for (let i = 0; i < numPaths; i++) {
      const totalTime = bs.readU32();
      paths.push({ totalTime, points: readPathPoints(bs) });
    }
    return { type: "PathManagerEvent", messageType: "NewPaths", paths };
  } else {
    // ModifyPath
    const modifiedPath = bs.readU32();
    const totalTime = bs.readU32();
    const points = readPathPoints(bs);
    return {
      type: "PathManagerEvent",
      messageType: "ModifyPath",
      modifiedPath,
      path: { totalTime, points },
    };
  }
}

// ============================================================
// LightningStrikeEvent — lightning visual effects
// ============================================================

function lightningStrikeEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): LightningStrikeEventData {
  // Binary FUN_00626e40: flag → early return if false → readInt(11) + readFloat(10) + readFloat(10) + flag → readInt(11)
  const result: LightningStrikeEventData = { type: "LightningStrikeEvent" };
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
): FileChunkEventData {
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
): DownloadMessageEventData {
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
): FileDownloadRequestEventData {
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
): SimpleMessageEventData {
  return { type: "SimpleMessageEvent", message: bs.readString() };
}

// ============================================================
// CRCChallengeEvent — CRC validation challenge from server
// Binary: FUN_006a2c30 reads 3×U32 + readFlag
// ============================================================

function crcChallengeEventUnpack(
  bs: BitStream,
  _conn: ConnectionContext
): CRCChallengeEventData {
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
): CRCChallengeResponseEventData {
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
): GravityEventData {
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
): FogChallengeEventData {
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
