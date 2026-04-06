import type { Vec3, Quat } from "./dataTypes.js";

export interface EventData {
  type: string;
  [key: string]: unknown;
}

export interface SimDataBlockEventData extends EventData {
  type: "SimDataBlockEvent";
  mProcess?: boolean;
  objectId?: number;
  classId?: number;
  index?: number;
  total?: number;
  _payloadBitPos?: number;
  dataBlockData?: Record<string, unknown>;
  dataBlockClassName?: string;
  _needsClassParser?: boolean;
}

export interface NetStringEventData extends EventData {
  type: "NetStringEvent";
  id: number;
  hasValue: boolean;
  value?: string;
}

export interface Sim2DAudioEventData extends EventData {
  type: "Sim2DAudioEvent";
  profileId: number;
}

export interface Sim3DAudioEventData extends EventData {
  type: "Sim3DAudioEvent";
  profileId: number;
  rotation?: Quat;
  position: Vec3;
}

export interface SetSensorGroupEventData extends EventData {
  type: "SetSensorGroupEvent";
  sensorGroup: number;
}

export interface SetServerTargetEventData extends EventData {
  type: "SetServerTargetEvent";
  targetId?: number;
  targetPos: Vec3;
}

export interface TargetToEventData extends EventData {
  type: "TargetToEvent";
  targetId?: number;
  targetPos?: Vec3;
  assign: boolean;
}

export interface SetObjectActiveImageEventData extends EventData {
  type: "SetObjectActiveImageEvent";
  objectId: number;
  imageSlot: number;
}

export interface SetMissionCRCEventData extends EventData {
  type: "SetMissionCRCEvent";
  crc: number;
}

export interface RemoteCommandEventData extends EventData {
  type: "RemoteCommandEvent";
  argc: number;
  argv: string[];
  funcName: string;
  args: string[];
}

export interface TargetInfoEventData extends EventData {
  type: "TargetInfoEvent";
  targetId: number;
  nameTag?: number;
  skinTag?: number;
  skinPrefTag?: number;
  voiceTag?: number;
  typeTag?: number;
  sensorGroup?: number;
  dataBlockId?: number;
  renderFlags?: number;
  voicePitch?: number;
}

export interface TargetFreeEventData extends EventData {
  type: "TargetFreeEvent";
  targetId: number;
}

export interface SimTargetAudioEventData extends EventData {
  type: "SimTargetAudioEvent";
  targetId: number;
  fileTag: number;
  descriptionId: number;
  position?: Vec3;
  updateSound: boolean;
}

export interface SensorGroupColorEntry {
  index: number;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  default?: boolean;
}

export interface SensorGroupColorEventData extends EventData {
  type: "SensorGroupColorEvent";
  sensorGroup: number;
  updateMask: number;
  colors: SensorGroupColorEntry[];
}

export interface ResetClientTargetsEventData extends EventData {
  type: "ResetClientTargetsEvent";
  clientTargetsOnly: boolean;
}

export interface RemoveClientTargetTypeEventData extends EventData {
  type: "RemoveClientTargetTypeEvent";
  targetType: number;
}

export interface SimVoiceStreamEventData extends EventData {
  type: "SimVoiceStreamEvent";
  streamId: number;
  sequence: number;
  codecId: number;
  clientId: number;
  objectId?: number;
  size: number;
  audioData?: Uint8Array;
}

export interface GhostingMessageEventData extends EventData {
  type: "GhostingMessageEvent";
  sequence: number;
  message: number;
  ghostCount: number;
}

export interface GhostAlwaysObjectEventData extends EventData {
  type: "GhostAlwaysObjectEvent";
  ghostIndex: number;
  _hasObjectData: boolean;
  classId?: number;
  objectData?: Record<string, unknown>;
}

export interface PathPoint {
  position: Vec3;
  rotation?: Quat;
  speed?: number;
  msToNext: number;
  smoothingType?: number;
}

export interface PathData {
  totalTime: number;
  points: PathPoint[];
}

export interface PathManagerEventData extends EventData {
  type: "PathManagerEvent";
  messageType: string;
  paths?: PathData[];
  modifiedPath?: number;
  path?: PathData;
}

export interface LightningStrikeEventData extends EventData {
  type: "LightningStrikeEvent";
  sourceGhost?: number;
  startX?: number;
  startY?: number;
  targetGhost?: number;
}

export interface FileChunkEventData extends EventData {
  type: "FileChunkEvent";
  chunkLen: number;
  chunkData: Uint8Array;
}

export interface DownloadMessageEventData extends EventData {
  type: "DownloadMessageEvent";
  value: number;
  message: number;
}

export interface FileDownloadRequestEventData extends EventData {
  type: "FileDownloadRequestEvent";
  fileNames: string[];
}

export interface SimpleMessageEventData extends EventData {
  type: "SimpleMessageEvent";
  message: string;
}

export interface CRCChallengeEventData extends EventData {
  type: "CRCChallengeEvent";
  crcValue: number;
  field1: number;
  field2: number;
  flag: boolean;
}

export interface CRCChallengeResponseEventData extends EventData {
  type: "CRCChallengeResponseEvent";
  crcValue: number;
  field1: number;
  field2: number;
}

export interface GravityEventData extends EventData {
  type: "GravityEvent";
  gravity: number;
}

export interface FogChallengeEventData extends EventData {
  type: "FogChallengeEvent";
}

export type AnyEventData =
  | SimDataBlockEventData
  | NetStringEventData
  | Sim2DAudioEventData
  | Sim3DAudioEventData
  | SetSensorGroupEventData
  | SetServerTargetEventData
  | TargetToEventData
  | SetObjectActiveImageEventData
  | SetMissionCRCEventData
  | RemoteCommandEventData
  | TargetInfoEventData
  | TargetFreeEventData
  | SimTargetAudioEventData
  | SensorGroupColorEventData
  | ResetClientTargetsEventData
  | RemoveClientTargetTypeEventData
  | SimVoiceStreamEventData
  | GhostingMessageEventData
  | GhostAlwaysObjectEventData
  | PathManagerEventData
  | LightningStrikeEventData
  | FileChunkEventData
  | DownloadMessageEventData
  | FileDownloadRequestEventData
  | SimpleMessageEventData
  | CRCChallengeEventData
  | CRCChallengeResponseEventData
  | GravityEventData
  | FogChallengeEventData;
