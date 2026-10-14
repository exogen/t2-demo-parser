import type { MoveData } from "./ghostDataTypes.js";
import type { ParsedData } from "./ClassRegistry.js";
import type { Color4 } from "./dataTypes.js";

/** Ident string at the start of every .rec file (checked on playback). */
export const DemoIdentString = "Tribes2 Recording";
/** Protocol version written by build 25034; playback rejects any other. */
export const DemoProtocolVersion = 0x330004;
/** One Move block per simulation tick, 32ms each (DemoParser.bufferedMoveTicks). */
export const MoveTickMs = 32;

// Key constants from the V12 engine source
export const MaxGhostCount = 1024;
export const GhostIdBitSize = 10;
export const NetStringTableMaxStrings = 4096;
export const StringIdBitSize = 12;
export const NetEventClassBitSize = 6;
export const NetEventClassFirst = 255;
export const NetObjectClassBitSize = 7;
export const NetObjectClassFirst = 0;
export const MaxPacketDataSize = 1500;
export const MaxTriggerKeys = 6;
export const MoveCountBits = 5;
export const MaxMoveCount = 30;

// GhostingMessageEvent message types (NetConnection::GhostMSG enum).
export const GhostMsgGhostAlwaysDone = 0;
export const GhostMsgGhostAlwaysAck = 1;
export const GhostMsgEndGhosting = 2;
export const GhostMsgGhostingActive = 3;

// DataBlock constants.
// For SimDataBlockEvent header (initial block + events), the binary uses:
//   readInt(11) objectId, readInt(7) classId, readInt(11) index, readInt(12) total.
// For DataBlock references in payloads (readDataBlockRef), V12 source uses:
//   readRangedU32(DataBlockObjectIdFirst, DataBlockObjectIdLast).
export const DataBlockObjectIdFirst = 3;
export const DataBlockObjectIdBitSize = 10;
export const DataBlockObjectIdLast =
  DataBlockObjectIdFirst + (1 << DataBlockObjectIdBitSize) - 1; // 1026
export const DataBlockClassFirst = 128;
export const DataBlockClassBitSize = 7;

// SimDataBlockEvent header bit sizes (from decompiled binary).
// These are the HEADER field sizes, which differ from the payload reference sizes.
// readClassInfo uses getNextPow2(0x800=2048) → getBitCount(2048)=11 for objectId.
// The classId, index, and total are read with literal values 7, 11, 12 (from 0x80, 0xb, 0xc).
export const SimDBEventObjectIdBits = 11;
export const SimDBEventClassIdBits = 7; // same as DataBlockClassBitSize
export const SimDBEventIndexBits = 11;
export const SimDBEventTotalBits = 12;

// Deterministic DataBlock class name mapping, derived from machine code
// analysis of the Tribes 2 binary (build 25034). All 54 DataBlock classes
// with mClassIdBase=0x80 are sorted by C strcmp (ASCII byte order), which
// is how AbstractClassRep::initialize assigns sequential classIds.
// Index N in this array corresponds to classId N (group-local) or
// classId N+128 (V12 global format).
export const DataBlockClassNames: readonly string[] = [
  "AudioDescription", // 0 / 128
  "AudioEnvironment", // 1 / 129
  "AudioProfile", // 2 / 130
  "AudioSampleEnvironment", // 3 / 131
  "BombProjectileData", // 4 / 132
  "CameraData", // 5 / 133
  "CannedChatItem", // 6 / 134
  "CommanderIconData", // 7 / 135
  "DebrisData", // 8 / 136
  "DecalData", // 9 / 137
  "ELFProjectileData", // 10 / 138
  "EffectProfile", // 11 / 139
  "EnergyProjectileData", // 12 / 140
  "ExplosionData", // 13 / 141
  "FireballAtmosphereData", // 14 / 142
  "FlareProjectileData", // 15 / 143
  "FlyingVehicleData", // 16 / 144
  "ForceFieldBareData", // 17 / 145
  "GameBaseData", // 18 / 146
  "GrenadeProjectileData", // 19 / 147
  "HoverVehicleData", // 20 / 148
  "ItemData", // 21 / 149
  "JetEffectData", // 22 / 150
  "LightningData", // 23 / 151
  "LinearFlareProjectileData", // 24 / 152
  "LinearProjectileData", // 25 / 153
  "MissionMarkerData", // 26 / 154
  "ParticleData", // 27 / 155
  "ParticleEmissionDummyData", // 28 / 156
  "ParticleEmitterData", // 29 / 157
  "PlayerData", // 30 / 158
  "PrecipitationData", // 31 / 159
  "ProjectileData", // 32 / 160
  "RepairProjectileData", // 33 / 161
  "RunningLightData", // 34 / 162
  "SeekerProjectileData", // 35 / 163
  "SensorData", // 36 / 164
  "ShapeBaseData", // 37 / 165
  "ShapeBaseImageData", // 38 / 166
  "ShockLanceProjectileData", // 39 / 167
  "ShockwaveData", // 40 / 168
  "SimDataBlock", // 41 / 169
  "SniperProjectileData", // 42 / 170
  "SplashData", // 43 / 171
  "StaticShapeData", // 44 / 172
  "StationFXPersonalData", // 45 / 173
  "StationFXVehicleData", // 46 / 174
  "TSShapeConstructor", // 47 / 175
  "TargetProjectileData", // 48 / 176
  "TracerProjectileData", // 49 / 177
  "TriggerData", // 50 / 178
  "TurretData", // 51 / 179
  "TurretImageData", // 52 / 180
  "WheeledVehicleData", // 53 / 181
] as const;

// Deterministic NetObject (ghost) class name mapping, derived from machine code
// analysis of the Tribes 2 binary (build 25034). All 53 NetObject classes
// with mClassIdBase=0 are sorted by C strcmp (ASCII byte order), which
// is how AbstractClassRep::initialize assigns sequential classIds.
// Index N in this array corresponds to classId N (NetObjectClassFirst + N).
// Verified against decompiled FUN_00423cb0 class table initialization.
// Vehicle is NOT a ghost class (classGroup=0xFFFFFFFF in binary).
export const NetObjectClassNames: readonly string[] = [
  "AIObjective", // 0
  "AudioEmitter", // 1
  "BeaconObject", // 2
  "BombProjectile", // 3
  "Camera", // 4
  "Debris", // 5
  "ELFProjectile", // 6
  "EnergyProjectile", // 7
  "FireballAtmosphere", // 8
  "FlareProjectile", // 9
  "FlyingVehicle", // 10
  "ForceFieldBare", // 11
  "GameBase", // 12
  "GrenadeProjectile", // 13
  "HoverVehicle", // 14
  "InteriorInstance", // 15
  "Item", // 16
  "Lightning", // 17
  "LinearFlareProjectile", // 18
  "LinearProjectile", // 19
  "Marker", // 20
  "MissionArea", // 21
  "MissionMarker", // 22
  "ParticleEmissionDummy", // 23
  "PhysicalZone", // 24
  "Player", // 25
  "Precipitation", // 26
  "Projectile", // 27
  "RepairProjectile", // 28
  "ScopeAlwaysShape", // 29
  "SeekerProjectile", // 30
  "ShapeBase", // 31
  "ShockLanceProjectile", // 32
  "Shockwave", // 33
  "SimpleNetObject", // 34
  "Sky", // 35
  "SniperProjectile", // 36
  "SpawnSphere", // 37
  "Splash", // 38
  "StaticShape", // 39
  "StationFXPersonal", // 40
  "StationFXVehicle", // 41
  "Sun", // 42
  "TSStatic", // 43
  "TargetProjectile", // 44
  "TerrainBlock", // 45
  "TracerProjectile", // 46
  "Trigger", // 47
  "Turret", // 48
  "VehicleBlocker", // 49
  "WaterBlock", // 50
  "WayPoint", // 51
  "WheeledVehicle", // 52
] as const;

// Deterministic NetEvent class name mapping, derived from machine code
// analysis of the Tribes 2 binary (build 25034). All 26 NetEvent classes
// with mClassIdBase=0xFF are sorted by C strcmp (ASCII byte order), which
// is how AbstractClassRep::initialize assigns sequential classIds.
// Index N in this array corresponds to classId NetEventClassFirst + N (255 + N).
export const NetEventClassNames: readonly string[] = [
  "CRCChallengeEvent", // 0 / 255
  "CRCChallengeResponseEvent", // 1 / 256
  "FogChallengeEvent", // 2 / 257
  "GhostAlwaysObjectEvent", // 3 / 258
  "GhostingMessageEvent", // 4 / 259
  "GravityEvent", // 5 / 260
  "LightningStrikeEvent", // 6 / 261
  "NetStringEvent", // 7 / 262
  "PathManagerEvent", // 8 / 263
  "RemoteCommandEvent", // 9 / 264
  "RemoveClientTargetTypeEvent", // 10 / 265
  "ResetClientTargetsEvent", // 11 / 266
  "SensorGroupColorEvent", // 12 / 267
  "SetMissionCRCEvent", // 13 / 268
  "SetObjectActiveImageEvent", // 14 / 269
  "SetSensorGroupEvent", // 15 / 270
  "SetServerTargetEvent", // 16 / 271
  "Sim2DAudioEvent", // 17 / 272
  "Sim3DAudioEvent", // 18 / 273
  "SimDataBlockEvent", // 19 / 274
  "SimTargetAudioEvent", // 20 / 275
  "SimVoiceStreamEvent", // 21 / 276
  "SimpleMessageEvent", // 22 / 277
  "TargetFreeEvent", // 23 / 278
  "TargetInfoEvent", // 24 / 279
  "TargetToEvent", // 25 / 280
] as const;

// Block types in the U16 packed format (type = typeSize >> 12)
// These are from TorqueSDK-style recordBlock/handleRecordedBlock
export const BlockTypePacket = 0; // Received network packet (dnet data)
export const BlockTypeSendPacket = 1; // SendPacket trigger (size=0, no data)
export const BlockTypeMove = 2; // Raw Move struct (64 bytes)
export const BlockTypeInfo = 3; // Info block (8 bytes: U32 + F32)

// Packet types from dnet
export const DataPacket = 0;
export const PingPacket = 1;
export const AckPacket = 2;

export interface Move {
  px: number;
  py: number;
  pz: number;
  pyaw: number;
  ppitch: number;
  proll: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  id: number;
  sendCount: number;
  freeLook: boolean;
  trigger: boolean[];
}

/**
 * Type 3 block: the `$firstPerson` flag and the control camera FOV,
 * replayed through setControlCameraFov on playback. The client's
 * GameConnection::readPacket (FUN_005fb9f0 → FUN_005fb9b0) writes one
 * before applying each dispatched packet — an accepted DataPacket with a
 * new sequence number — so it follows that packet's Packet block. Pings,
 * acks, duplicates and rejected packets get a Packet block but no Info.
 */
export interface InfoBlock {
  /** Byte 0 of the block. The engine writes a bool through a 4-byte slot;
   *  the other three bytes are uninitialized stack in real recordings. */
  firstPerson: boolean;
  /** Control camera field of view in degrees (F32). */
  cameraFov: number;
}

export interface DataBlockHeader {
  objectId: number;
  classId: number;
  index: number;
  total: number;
  dataBitsStart: number;
}

export interface DnetHeader {
  gameFlag: boolean;
  connectSeqBit: number;
  seqNumber: number;
  highestAck: number;
  packetType: number;
  ackByteCount: number;
  ackMask: number;
}

export interface RateInfo {
  updateDelay?: number;
  packetSize?: number;
  maxUpdateDelay?: number;
  maxPacketSize?: number;
}

export interface GhostUpdate {
  index: number;
  type: "create" | "update" | "delete";
  classId?: number;
  updateBitsStart: number;
  updateBitsEnd: number;
  parsedData?: ParsedData;
  /** Set when the ghost's data could not be parsed (unknown class,
   *  parser threw, or tracker divergence). The ghost section stops
   *  here and the tracker no longer mirrors the server. */
  failed?: boolean;
  /** Why parsing failed (parser name and error text). */
  error?: string;
}

/**
 * A packet the parser could not fully consume. The engine drops the
 * connection on any of these ("Invalid packet"), and by default the
 * PacketParser halts too (see `haltOnFault`): later packets come back
 * empty with the same fault attached. Continuing would mean parsing
 * against ghost/event state that no longer mirrors the server.
 */
export interface ParseFault {
  stage: "gameState" | "event" | "ghost";
  message: string;
}

export interface NetEventInfo {
  classId: number;
  guaranteed: boolean;
  sequenceNumber?: number;
  absoluteSequenceNumber?: number;
  dataBitsStart: number;
  dataBitsEnd: number;
  parsedData?: ParsedData;
  /** Set when the event could not be parsed (unknown class or parser
   *  threw), leaving the stream position unreliable. */
  failed?: boolean;
  /** Why parsing failed (parser name and error text). */
  error?: string;
}

export interface PacketData {
  dnetHeader: DnetHeader;
  rateInfo: RateInfo;
  gameState: GameState;
  events: NetEventInfo[];
  ghosts: GhostUpdate[];
  /** Bit position where ghost section starts (readGhosts call). */
  ghostSectionStart?: number;
  /** Present when any section of the packet failed to parse. */
  parseFault?: ParseFault;
}

export interface GameState {
  lastMoveAck: number;
  damageFlash?: number;
  whiteOut?: number;
  selfLocked?: boolean;
  selfHomed?: boolean;
  seekerTracking?: boolean;
  seekerTrackingPos?: { x: number; y: number; z: number };
  seekerMode?: number;
  seekerObjectGhostIndex?: number;
  targetPos?: { x: number; y: number; z: number };
  pinged: boolean;
  jammed: boolean;
  controlObjectGhostIndex?: number;
  controlObjectDataStart?: number;
  controlObjectDataEnd?: number;
  controlObjectData?: ParsedData;
  /** Why the control object's readPacketData could not be applied. */
  controlObjectError?: string;
  compressionPoint?: { x: number; y: number; z: number };
  targetVisibility?: { index: number; mask: number }[];
  cameraFov?: number;
}

export interface DemoBlock {
  index: number;
  type: number;
  size: number;
  data: Uint8Array;
  parsed?: PacketData | Move | InfoBlock;
  /** Set if decoding the block threw (a parser bug — packets report
   *  wire problems through `PacketData.parseFault` instead). */
  parseError?: string;
}

export interface ConnectionProtocolState {
  lastSeqRecvdAtSend: number[];
  lastSeqRecvd: number;
  highestAckedSeq: number;
  lastSendSeq: number;
  ackMask: number;
  connectSequence: number;
  lastRecvAckAck: number;
  connectionEstablished: boolean;
}

export interface StringTableEntry {
  id: number;
  value: string;
}

export interface ParsedDataBlock {
  classId: number;
  className: string;
  objectId: number;
  data: ParsedData;
}

/**
 * IFF (Identification Friend or Foe) color for one sensor group pairing.
 * sensorGroupColors[myGroup][theirGroup] determines how `theirGroup` appears
 * to `myGroup` (e.g., red for enemy, green for friendly).
 */
export interface SensorGroupColor {
  group: number;
  targetGroup: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface TargetEntry {
  targetId: number;
  sensorData?: number;
  voiceMapData?: number;
  name?: string;
  skin?: string;
  skinPref?: string;
  voice?: string;
  typeDescription?: string;
  sensorGroup: number;
  targetData: number;
  dataBlockRef?: number;
  damageLevel: number;
}

export interface PathManagerEntry {
  entryId: number;
  records: {
    field0: number;
    field1: number;
    field2: number;
    auxField: number;
  }[];
}

/**
 * A ProcessList's tick state, as the demo start block saves it
 * (FUN_00602100 writes it, FUN_006021b0 reads it). Times are Sim
 * milliseconds on the recording client's clock.
 */
export interface ProcessListState {
  /**
   * mDirty: the list must be re-sorted into process order before its next
   * tick.
   */
  dirty: boolean;
  /**
   * mCurrentTag: the stamp of the latest process-order sort.
   */
  currentTag: number;
  /**
   * mLastTick: the tick time the list has advanced to, always a multiple
   * of 32: lastTime rounded up on the client list, down on the server
   * list. A backlogged client list advances it without simulating.
   */
  lastTick: number;
  /**
   * mLastTime: time the list was last advanced to.
   */
  lastTime: number;
  /**
   * mLastDelta: on the client list, lastTick - lastTime (the interpolation
   * remainder) as of the last advance that simulated; it goes stale while
   * the connection is backlogged (every queued move simulated and 30 or
   * more queued). The server list never sets it.
   */
  lastDelta: number;
}

export interface InitialBlockData {
  taggedStrings: Map<number, string>;
  dataBlockHeaders: DataBlockHeader[];
  dataBlockCount: number;
  dataBlocks: Map<number, ParsedDataBlock>;
  /** Initial $firstPerson state from GameConnection::writeDemoStartBlock. */
  firstPerson: boolean;
  /**
   * mCameraPos: the control camera's first-to-third-person blend, from 0
   * (first person) to 1 (third person).
   */
  cameraPos: number;
  /**
   * mCameraSpeed: how fast cameraPos changes, per second (10 on every
   * connection).
   */
  cameraSpeed: number;
  /**
   * mLastMoveAck: the index of the first move the server has not yet
   * acknowledged (every lower one has been). readPacket pops the queued
   * moves below it, so between packets it equals firstMoveIndex.
   */
  lastMoveAck: number;
  /**
   * mLastClientMove: the index of the next queued move the client's own
   * simulation will process.
   */
  lastClientMove: number;
  /**
   * mFirstMoveIndex: the move index of `moves[0]`.
   */
  firstMoveIndex: number;
  /**
   * mSensorGroup: the connection's sensor group, which selects the IFF
   * colors it sees. Later changes arrive as SetSensorGroupEvents.
   */
  sensorGroup: number;
  /**
   * The six fields from cameraPos to sensorGroup as raw U32s, in stream
   * order (cameraPos and cameraSpeed as F32 bit patterns).
   *
   * @deprecated Use the named fields.
   */
  connectionFields: number[];
  /**
   * mTargetVisibleMask: the server's record of the 512 target visibility
   * bits it last sent for the connection's sensor group, which its
   * visibility updates are diffed against. Clients never use it, so
   * recordings made by Tribes2.exe store zeros.
   */
  targetVisibleMask: number[];
  /**
   * @deprecated Use targetVisibleMask.
   */
  stateArray: number[];
  /**
   * Queued client moves (GameConnection::mMoveList), starting at
   * firstMoveIndex.
   */
  moves: MoveData[];
  demoValues: string[];
  /**
   * The TargetManager's default IFF color (255, 0, 0, 255 unless a demo
   * changed it). SensorGroupColorEvent entries equal to the sender's
   * default are sent as "default" and decoded with the receiver's, which
   * Tribes2.exe overwrites with this value when it loads a demo.
   */
  defaultIffColor: Color4;
  sensorGroupColors: SensorGroupColor[];
  targetEntries: TargetEntry[];
  connectionState: ConnectionProtocolState;
  roundTripTime: number;
  packetLoss: number;
  pathManager: PathManagerEntry[];
  notifyCount: number;
  nextRecvEventSeq: number;
  ghostingSequence: number;
  initialGhosts: GhostUpdate[];
  initialEvents: NetEventInfo[];
  controlObjectGhostIndex: number;
  controlObjectData?: ParsedData;
  /** Compression point established by the control object's readPacketData
   *  (its position), used to decode compressed points in packets that
   *  precede the first in-stream compression-point update. */
  initialCompressionPoint?: { x: number; y: number; z: number };
  missionName: string;
  /**
   * mMissionCRC: the server's CRC of the mission file, delivered by
   * SetMissionCRCEvent (0xffffffff on a fresh connection). Tribes2.exe
   * names and validates its lighting/*.ml caches with it.
   */
  missionCRC: number;
  /**
   * The client ProcessList's tick state. Absent when phase 2 stopped
   * before reaching it; only meaningful when phase2Valid is true.
   */
  clientProcessList?: ProcessListState;
  /**
   * The server ProcessList's tick state. Absent when phase 2 stopped
   * before reaching it; only meaningful when phase2Valid is true.
   */
  serverProcessList?: ProcessListState;
  phase2TrailingBits?: number;
  phase2Valid?: boolean;
  phase2Error?: string;
  /**
   * Seeded state the engine would choke on during playback even though
   * the block decodes. Empty for every recording made by Tribes2.exe;
   * populated for hand-built (from-connect) initial blocks that break an
   * engine invariant — e.g. a notify count that does not equal
   * `lastSendSeq - highestAckedSeq` (NetConnection::handleNotify
   * dereferences an empty notify queue).
   */
  warnings: string[];
}

export interface DemoHeader {
  identString: string;
  protocolVersion: number;
  demoLengthMs: number;
  initialBlockSize: number;
}

export interface DemoFile {
  header: DemoHeader;
  initialBlock: InitialBlockData;
  blocks: DemoBlock[];
}

export interface LoadResult {
  header: DemoHeader;
  initialBlock: InitialBlockData;
}
