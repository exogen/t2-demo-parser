import type { Vec3, Quat } from "./dataTypes.js";

export type EventData = {
  type: string;
};

export type SimDataBlockEventData = EventData & {
  type: "SimDataBlockEvent";
  mProcess?: boolean;
  objectId?: number;
  classId?: number;
  index?: number;
  total?: number;
  dataBlockData?: Record<string, unknown>;
  dataBlockClassName?: string;
};

export type NetStringEventData = EventData & {
  type: "NetStringEvent";
  id: number;
  hasValue: boolean;
  value?: string;
};

export type Sim2DAudioEventData = EventData & {
  type: "Sim2DAudioEvent";
  profileId: number;
};

export type Sim3DAudioEventData = EventData & {
  type: "Sim3DAudioEvent";
  profileId: number;
  rotation?: Quat;
  position: Vec3;
};

export type SetSensorGroupEventData = EventData & {
  type: "SetSensorGroupEvent";
  sensorGroup: number;
};

export type SetServerTargetEventData = EventData & {
  type: "SetServerTargetEvent";
  targetId?: number;
  targetPos: Vec3;
};

export type TargetToEventData = EventData & {
  type: "TargetToEvent";
  targetId?: number;
  targetPos?: Vec3;
  assign: boolean;
};

export type SetObjectActiveImageEventData = EventData & {
  type: "SetObjectActiveImageEvent";
  objectId: number;
  imageSlot: number;
};

export type SetMissionCRCEventData = EventData & {
  type: "SetMissionCRCEvent";
  crc: number;
};

export type RemoteCommandEventData = EventData & {
  type: "RemoteCommandEvent";
  argc: number;
  argv: string[];
  funcName: string;
  args: string[];
};

export type TargetInfoEventData = EventData & {
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
};

export type TargetFreeEventData = EventData & {
  type: "TargetFreeEvent";
  targetId: number;
};

export type SimTargetAudioEventData = EventData & {
  type: "SimTargetAudioEvent";
  targetId: number;
  fileTag: number;
  descriptionId: number;
  position?: Vec3;
  updateSound: boolean;
};

export type SensorGroupColorEntry = {
  index: number;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  default?: boolean;
};

export type SensorGroupColorEventData = EventData & {
  type: "SensorGroupColorEvent";
  sensorGroup: number;
  updateMask: number;
  colors: SensorGroupColorEntry[];
};

export type ResetClientTargetsEventData = EventData & {
  type: "ResetClientTargetsEvent";
  clientTargetsOnly: boolean;
};

export type RemoveClientTargetTypeEventData = EventData & {
  type: "RemoveClientTargetTypeEvent";
  targetType: number;
};

export type SimVoiceStreamEventData = EventData & {
  type: "SimVoiceStreamEvent";
  streamId: number;
  sequence: number;
  /** Index into the binary's voice codec table (0–3). */
  codecId: number;
  clientId: number;
  /** True when the packet carries an explicit frame count (end of stream). */
  partial: boolean;
  frameCount: number;
  /** Fixed-size codec frames, concatenated (codecs 1–3). */
  audioData?: Uint8Array;
  /** Nibble-packed frames, one buffer per frame (codec 0). */
  frames?: Uint8Array[];
};

export type GhostingMessageEventData = EventData & {
  type: "GhostingMessageEvent";
  sequence: number;
  message: number;
  ghostCount: number;
};

export type GhostAlwaysObjectEventData = EventData & {
  type: "GhostAlwaysObjectEvent";
  ghostIndex: number;
  hasObjectData: boolean;
  classId?: number;
  objectData?: Record<string, unknown>;
};

export type PathPoint = {
  position: Vec3;
  rotation?: Quat;
  speed?: number;
  msToNext: number;
  smoothingType?: number;
};

export type PathData = {
  totalTime: number;
  points: PathPoint[];
};

export type PathManagerEventData = EventData & {
  type: "PathManagerEvent";
  messageType: string;
  paths?: PathData[];
  modifiedPath?: number;
  path?: PathData;
};

export type LightningStrikeEventData = EventData & {
  type: "LightningStrikeEvent";
  sourceGhost?: number;
  startX?: number;
  startY?: number;
  targetGhost?: number;
};

export type FileChunkEventData = EventData & {
  type: "FileChunkEvent";
  chunkLen: number;
  chunkData: Uint8Array;
};

export type DownloadMessageEventData = EventData & {
  type: "DownloadMessageEvent";
  value: number;
  message: number;
};

export type FileDownloadRequestEventData = EventData & {
  type: "FileDownloadRequestEvent";
  fileNames: string[];
};

export type SimpleMessageEventData = EventData & {
  type: "SimpleMessageEvent";
  message: string;
};

export type CRCChallengeEventData = EventData & {
  type: "CRCChallengeEvent";
  crcValue: number;
  field1: number;
  field2: number;
  flag: boolean;
};

export type CRCChallengeResponseEventData = EventData & {
  type: "CRCChallengeResponseEvent";
  crcValue: number;
  field1: number;
  field2: number;
};

export type GravityEventData = EventData & {
  type: "GravityEvent";
  gravity: number;
};

export type FogChallengeEventData = EventData & {
  type: "FogChallengeEvent";
};

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
