import type { ParsedData } from "./ClassRegistry.js";

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
  "AudioDescription",         // 0 / 128
  "AudioEnvironment",         // 1 / 129
  "AudioProfile",             // 2 / 130
  "AudioSampleEnvironment",   // 3 / 131
  "BombProjectileData",       // 4 / 132
  "CameraData",               // 5 / 133
  "CannedChatItem",           // 6 / 134
  "CommanderIconData",        // 7 / 135
  "DebrisData",               // 8 / 136
  "DecalData",                // 9 / 137
  "ELFProjectileData",        // 10 / 138
  "EffectProfile",            // 11 / 139
  "EnergyProjectileData",     // 12 / 140
  "ExplosionData",            // 13 / 141
  "FireballAtmosphereData",   // 14 / 142
  "FlareProjectileData",      // 15 / 143
  "FlyingVehicleData",        // 16 / 144
  "ForceFieldBareData",       // 17 / 145
  "GameBaseData",             // 18 / 146
  "GrenadeProjectileData",    // 19 / 147
  "HoverVehicleData",         // 20 / 148
  "ItemData",                 // 21 / 149
  "JetEffectData",            // 22 / 150
  "LightningData",            // 23 / 151
  "LinearFlareProjectileData",// 24 / 152
  "LinearProjectileData",     // 25 / 153
  "MissionMarkerData",        // 26 / 154
  "ParticleData",             // 27 / 155
  "ParticleEmissionDummyData",// 28 / 156
  "ParticleEmitterData",      // 29 / 157
  "PlayerData",               // 30 / 158
  "PrecipitationData",        // 31 / 159
  "ProjectileData",           // 32 / 160
  "RepairProjectileData",     // 33 / 161
  "RunningLightData",         // 34 / 162
  "SeekerProjectileData",     // 35 / 163
  "SensorData",               // 36 / 164
  "ShapeBaseData",            // 37 / 165
  "ShapeBaseImageData",       // 38 / 166
  "ShockLanceProjectileData", // 39 / 167
  "ShockwaveData",            // 40 / 168
  "SimDataBlock",             // 41 / 169
  "SniperProjectileData",     // 42 / 170
  "SplashData",               // 43 / 171
  "StaticShapeData",          // 44 / 172
  "StationFXPersonalData",    // 45 / 173
  "StationFXVehicleData",     // 46 / 174
  "TSShapeConstructor",       // 47 / 175
  "TargetProjectileData",     // 48 / 176
  "TracerProjectileData",     // 49 / 177
  "TriggerData",              // 50 / 178
  "TurretData",               // 51 / 179
  "TurretImageData",          // 52 / 180
  "WheeledVehicleData",       // 53 / 181
] as const;

// Deterministic NetObject (ghost) class name mapping, derived from machine code
// analysis of the Tribes 2 binary (build 25034). All 53 NetObject classes
// with mClassIdBase=0 are sorted by C strcmp (ASCII byte order), which
// is how AbstractClassRep::initialize assigns sequential classIds.
// Index N in this array corresponds to classId N (NetObjectClassFirst + N).
// Verified against decompiled FUN_00423cb0 class table initialization.
// Vehicle is NOT a ghost class (classGroup=0xFFFFFFFF in binary).
export const NetObjectClassNames: readonly string[] = [
  "AIObjective",            // 0
  "AudioEmitter",           // 1
  "BeaconObject",           // 2
  "BombProjectile",         // 3
  "Camera",                 // 4
  "Debris",                 // 5
  "ELFProjectile",          // 6
  "EnergyProjectile",       // 7
  "FireballAtmosphere",     // 8
  "FlareProjectile",        // 9
  "FlyingVehicle",          // 10
  "ForceFieldBare",         // 11
  "GameBase",               // 12
  "GrenadeProjectile",      // 13
  "HoverVehicle",           // 14
  "InteriorInstance",       // 15
  "Item",                   // 16
  "Lightning",              // 17
  "LinearFlareProjectile",  // 18
  "LinearProjectile",       // 19
  "Marker",                 // 20
  "MissionArea",            // 21
  "MissionMarker",          // 22
  "ParticleEmissionDummy",  // 23
  "PhysicalZone",           // 24
  "Player",                 // 25
  "Precipitation",          // 26
  "Projectile",             // 27
  "RepairProjectile",       // 28
  "ScopeAlwaysShape",       // 29
  "SeekerProjectile",       // 30
  "ShapeBase",              // 31
  "ShockLanceProjectile",   // 32
  "Shockwave",              // 33
  "SimpleNetObject",        // 34
  "Sky",                    // 35
  "SniperProjectile",       // 36
  "SpawnSphere",            // 37
  "Splash",                 // 38
  "StaticShape",            // 39
  "StationFXPersonal",      // 40
  "StationFXVehicle",       // 41
  "Sun",                    // 42
  "TSStatic",               // 43
  "TargetProjectile",       // 44
  "TerrainBlock",           // 45
  "TracerProjectile",       // 46
  "Trigger",                // 47
  "Turret",                 // 48
  "VehicleBlocker",         // 49
  "WaterBlock",             // 50
  "WayPoint",               // 51
  "WheeledVehicle",         // 52
] as const;

// Deterministic NetEvent class name mapping, derived from machine code
// analysis of the Tribes 2 binary (build 25034). All 26 NetEvent classes
// with mClassIdBase=0xFF are sorted by C strcmp (ASCII byte order), which
// is how AbstractClassRep::initialize assigns sequential classIds.
// Index N in this array corresponds to classId NetEventClassFirst + N (255 + N).
export const NetEventClassNames: readonly string[] = [
  "CRCChallengeEvent",            // 0 / 255
  "CRCChallengeResponseEvent",    // 1 / 256
  "FogChallengeEvent",            // 2 / 257
  "GhostAlwaysObjectEvent",       // 3 / 258
  "GhostingMessageEvent",         // 4 / 259
  "GravityEvent",                 // 5 / 260
  "LightningStrikeEvent",         // 6 / 261
  "NetStringEvent",               // 7 / 262
  "PathManagerEvent",             // 8 / 263
  "RemoteCommandEvent",           // 9 / 264
  "RemoveClientTargetTypeEvent",  // 10 / 265
  "ResetClientTargetsEvent",      // 11 / 266
  "SensorGroupColorEvent",        // 12 / 267
  "SetMissionCRCEvent",           // 13 / 268
  "SetObjectActiveImageEvent",    // 14 / 269
  "SetSensorGroupEvent",          // 15 / 270
  "SetServerTargetEvent",         // 16 / 271
  "Sim2DAudioEvent",              // 17 / 272
  "Sim3DAudioEvent",              // 18 / 273
  "SimDataBlockEvent",            // 19 / 274
  "SimTargetAudioEvent",          // 20 / 275
  "SimVoiceStreamEvent",          // 21 / 276
  "SimpleMessageEvent",           // 22 / 277
  "TargetFreeEvent",              // 23 / 278
  "TargetInfoEvent",              // 24 / 279
  "TargetToEvent",                // 25 / 280
] as const;

// Block types in the U16 packed format (type = typeSize >> 12)
// These are from TorqueSDK-style recordBlock/handleRecordedBlock
export const BlockTypePacket = 0;     // Received network packet (dnet data)
export const BlockTypeSendPacket = 1; // SendPacket trigger (size=0, no data)
export const BlockTypeMove = 2;       // Raw Move struct (64 bytes)
export const BlockTypeInfo = 3;       // Info block (8 bytes: U32 + F32)

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

export interface InfoBlock {
  value1: number; // U32
  value2: number; // F32
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
}

export interface NetEventInfo {
  classId: number;
  guaranteed: boolean;
  sequenceNumber?: number;
  absoluteSequenceNumber?: number;
  dataBitsStart: number;
  dataBitsEnd: number;
  parsedData?: ParsedData;
}

export interface PacketData {
  dnetHeader: DnetHeader;
  rateInfo: RateInfo;
  gameState: GameState;
  events: NetEventInfo[];
  ghosts: GhostUpdate[];
  /** Bit position where ghost section starts (readGhosts call). */
  ghostSectionStart?: number;
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

export interface ScoreEntry {
  clientId: number;
  teamId: number;
  score: number;
  field0: number;
  field1: number;
  field2: number;
  isBot: boolean;
  triggerFlags: boolean[];
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
  records: { field0: number; field1: number; field2: number; auxField: number }[];
}

export interface InitialBlockData {
  taggedStrings: Map<number, string>;
  dataBlockHeaders: DataBlockHeader[];
  dataBlockCount: number;
  dataBlocks: Map<number, ParsedDataBlock>;
  /** Initial $firstPerson state from GameConnection::writeDemoStartBlock. */
  firstPerson: boolean;
  connectionFields: number[];
  stateArray: number[];
  scoreEntries: ScoreEntry[];
  demoValues: string[];
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
  missionName: string;
  missionCRC: number;
  phase2TrailingBits?: number;
  phase2Valid?: boolean;
  phase2Error?: string;
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
