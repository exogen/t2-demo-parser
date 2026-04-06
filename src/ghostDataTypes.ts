import type {
  Vec3,
  Quat,
  Color3,
  Color4,
  AffineTransform,
  MatrixF,
} from "./dataTypes.js";

// ---------------------------------------------------------------------------
// Sub-structures
// ---------------------------------------------------------------------------

export interface MoveData {
  pyaw: number;
  ppitch: number;
  proll: number;
  px: number;
  py: number;
  pz: number;
  freeLook: boolean;
  trigger: boolean[];
}

export interface SoundSlot {
  index: number;
  playing: boolean;
  profileId?: number;
}

export interface ThreadState {
  index: number;
  sequence: number;
  state: number;
  forward: boolean;
  atEnd: boolean;
}

export interface ImageSlot {
  index: number;
  dataBlockId?: number;
  skinTagIndex?: number;
  skinName?: string;
  triggerDown?: boolean;
  loaded?: boolean;
  ammo?: boolean;
  wet?: boolean;
  target?: boolean;
  fireCount?: number;
  imageExtraFlag?: boolean;
}

export interface WheelState {
  avel: number;
  dy: number;
  dx: number;
}

// ---------------------------------------------------------------------------
// GameBase hierarchy
// ---------------------------------------------------------------------------

export interface GameBaseGhostData {
  dataBlockId?: number;
  targetId?: number;
  [key: string]: unknown;
}

export interface ShapeBaseGhostData extends GameBaseGhostData {
  damageLevel?: number;
  damageState?: number;
  blowApart?: boolean;
  damageDir?: Vec3;
  sounds?: SoundSlot[];
  threads?: ThreadState[];
  images?: ImageSlot[];
  imageSkinDirty?: boolean;
  cloaked?: boolean;
  isControlled?: boolean;
  fading?: boolean;
  fadeOut?: boolean;
  fadeTime?: number;
  fadeVal?: boolean;
  stateBMode?: boolean;
  energyPackOn?: boolean;
  shieldNormal?: Vec3;
  energyPercent?: number;
  stateValue1?: number;
  stateValue2?: number;
  mountObject?: number;
  mountNode?: number;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface PlayerGhostData extends ShapeBaseGhostData {
  impactSound?: number;
  action?: number;
  actionHoldAtEnd?: boolean;
  actionAtEnd?: boolean;
  actionFirstPerson?: boolean;
  actionAnimPos?: number;
  armAction?: number;
  actionState?: number;
  recoverTicks?: number;
  moveFlag0?: boolean;
  moveFlag1?: boolean;
  position?: Vec3;
  velocity?: Vec3;
  headX?: number;
  headZ?: number;
  rotationZ?: number;
  move?: MoveData;
  allowWarp?: boolean;
  energy?: number;
}

export interface PlayerPacketData {
  energyLevel?: number;
  rechargeRate?: number;
  actionState?: number;
  recoverTicks?: number;
  jumpDelay?: number;
  position?: Vec3;
  velocity?: Vec3;
  jumpSurfaceLastContact?: number;
  headX?: number;
  headZ?: number;
  rotationZ?: number;
  controlObjectGhost?: number;
  controlObjectData?: Record<string, unknown>;
  disableMove?: boolean;
  pilot?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export interface VehicleGhostData extends ShapeBaseGhostData {
  jetting?: boolean;
  _controlledEarlyReturn?: boolean;
  steeringYaw?: number;
  steeringPitch?: number;
  move?: MoveData;
  frozen?: boolean;
  position?: Vec3;
  angPosition?: Quat;
  linMomentum?: Vec3;
  angMomentum?: Vec3;
  energy?: number;
}

export interface VehiclePacketData {
  energyLevel?: number;
  rechargeRate?: number;
  steering?: { x: number; y: number };
  linPosition?: Vec3;
  angPosition?: Quat;
  linMomentum?: Vec3;
  angMomentum?: Vec3;
  disableMove?: boolean;
  frozen?: boolean;
  [key: string]: unknown;
}

export interface WheeledVehicleGhostData extends VehicleGhostData {
  braking?: boolean;
  wheels?: WheelState[];
}

export interface WheeledVehiclePacketData extends VehiclePacketData {
  braking?: boolean;
  wheels?: WheelState[];
}

export interface FlyingVehicleGhostData extends VehicleGhostData {
  createHeightOn?: boolean;
  thrustDirection?: number;
}

export interface HoverVehicleGhostData extends VehicleGhostData {
  thrustDirection?: number;
}

// ---------------------------------------------------------------------------
// Items & static shapes
// ---------------------------------------------------------------------------

export interface ItemGhostData extends ShapeBaseGhostData {
  rotate?: boolean;
  isStatic?: boolean;
  collideable?: boolean;
  scale?: Vec3;
  collisionObject?: number;
  rotation?: { zSign: number; angle: number };
  position?: Vec3;
  atRest?: boolean;
  velocity?: Vec3;
  warp?: boolean;
}

export interface StaticShapeGhostData extends ShapeBaseGhostData {
  transform?: AffineTransform | MatrixF;
  position?: Vec3;
  scale?: Vec3;
  powered?: boolean;
}

export type ScopeAlwaysShapeGhostData = StaticShapeGhostData;

export interface BeaconObjectGhostData extends StaticShapeGhostData {
  beaconType?: number;
}

export interface TurretGhostData extends StaticShapeGhostData {
  capacitorEnergy?: number;
  phi?: number;
  theta?: number;
  activationLevel?: number;
}

// ---------------------------------------------------------------------------
// Mission markers
// ---------------------------------------------------------------------------

export interface MissionMarkerGhostData extends ShapeBaseGhostData {
  transform?: AffineTransform;
  position?: Vec3;
  scale?: Vec3;
}

export interface WayPointGhostData extends MissionMarkerGhostData {
  name?: string;
  teamId?: number;
  hidden?: boolean;
}

export interface SpawnSphereGhostData extends MissionMarkerGhostData {
  radius?: number;
  sphereWeight?: number;
  indoorWeight?: number;
  outdoorWeight?: number;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export interface CameraGhostData extends ShapeBaseGhostData {
  posX?: number;
  posY?: number;
  posZ?: number;
  fovOrDist?: number;
  orbitParam?: number;
}

export interface CameraPacketData {
  energyLevel?: number;
  rechargeRate?: number;
  position?: Vec3;
  rotX?: number;
  rotZ?: number;
  cameraMode?: number;
  minOrbitDist?: number;
  maxOrbitDist?: number;
  curOrbitDist?: number;
  observingClientObject?: boolean;
  orbitObjectGhostIndex?: number;
  orbitPoint?: Vec3;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Standalone ghost types (not GameBase subclasses)
// ---------------------------------------------------------------------------

export interface MarkerGhostData {
  position?: Vec3;
  [key: string]: unknown;
}

export interface SimpleNetObjectGhostData {
  message?: string;
  [key: string]: unknown;
}

export interface InteriorInstanceGhostData {
  crc?: number;
  interiorFile?: string;
  showTerrainInside?: boolean;
  transform?: MatrixF;
  scale?: Vec3;
  alarmState?: boolean;
  skinBase?: string;
  audioProfileId?: number;
  audioEnvironmentId?: number;
  [key: string]: unknown;
}

export interface TSStaticGhostData {
  transform?: MatrixF;
  scale?: Vec3;
  shapeName?: string;
  [key: string]: unknown;
}

export interface TerrainBlockGhostData {
  crc?: number;
  terrFileName?: string;
  detailTextureName?: string;
  squareSize?: number;
  emptySquareRuns?: number[];
  emptySquareRunCount?: number;
  [key: string]: unknown;
}

export interface TriggerGhostData {
  tickPeriodMS?: number;
  [key: string]: unknown;
}

export interface VehicleBlockerGhostData {
  transform?: MatrixF;
  boundsMin?: Vec3;
  boundsMax?: Vec3;
  [key: string]: unknown;
}

export interface MissionAreaGhostData {
  area?: { x: number; y: number; w: number; h: number };
  flightCeiling?: number;
  flightCeilingRange?: number;
  [key: string]: unknown;
}

export interface AudioEmitterGhostData {
  initialUpdate?: boolean;
  transform?: AffineTransform;
  audioProfileId?: number;
  audioDescriptionId?: number;
  filename?: string;
  useProfileDescription?: boolean;
  volume?: number;
  isLooping?: boolean;
  is3D?: boolean;
  minDistance?: number;
  maxDistance?: number;
  coneInsideAngle?: number;
  coneOutsideAngle?: number;
  coneOutsideVolume?: number;
  coneVector?: Vec3;
  loopCount?: number;
  minLoopGap?: number;
  maxLoopGap?: number;
  audioType?: number;
  outsideAmbient?: boolean;
  [key: string]: unknown;
}

export interface PhysicalZoneGhostData {
  transform?: MatrixF;
  scale?: Vec3;
  points?: Vec3[];
  planes?: Array<{ x: number; y: number; z: number; d: number }>;
  edges?: Array<{
    face0: number;
    face1: number;
    vertex0: number;
    vertex1: number;
  }>;
  velocityMod?: number;
  gravityMod?: number;
  appliedForce?: Vec3;
  active?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Debris
// ---------------------------------------------------------------------------

export interface DebrisGhostData extends GameBaseGhostData {
  value0?: number;
  value1?: number;
  value2?: number;
  value3?: number;
  value4?: number;
  value5?: number;
  value6?: number;
  value7?: number;
  value8?: number;
  value9?: number;
  value10?: number;
  value11?: number;
  value12?: number;
  value13?: number;
  value14?: number;
  bool0?: boolean;
  bool1?: boolean;
  bool2?: boolean;
  bool3?: boolean;
  bool4?: boolean;
  bool5?: boolean;
  bool6?: boolean;
  string0?: string;
  string1?: string;
  objectRefs?: number[];
  objectRef2?: number;
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

export interface ProjectileGhostData extends GameBaseGhostData {}

export interface LinearProjectileGhostData extends GameBaseGhostData {
  hidden?: boolean;
  explodePosition?: Vec3;
  explodeNormal?: Vec3;
  endedWithDecal?: boolean;
  position?: Vec3;
  direction?: Vec3;
  currTick?: number;
  sourceObject?: number;
  sourceSlot?: number;
  excessVel?: number;
  excessDir?: Vec3;
  vehicleObject?: number;
}

export interface BombProjectileGhostData extends GameBaseGhostData {
  position?: Vec3;
  velocity?: Vec3;
  endPoint?: Vec3;
  endNormal?: Vec3;
  currTick?: number;
  resetFlag?: boolean;
  explodePoint?: Vec3;
  explodeNormal?: Vec3;
  sourceObject?: number;
  sourceSlot?: number;
  vehicleObject?: number;
}

export interface GrenadeProjectileGhostData extends GameBaseGhostData {
  position?: Vec3;
  velocity?: Vec3;
  currTick?: number;
  quickSplash?: boolean;
  explodePoint?: Vec3;
  explodeNormal?: Vec3;
  sourceObject?: number;
  sourceSlot?: number;
  vehicleObject?: number;
}

export interface SeekerProjectileGhostData extends GameBaseGhostData {
  explodePosition?: Vec3;
  explodeNormal?: Vec3;
  position?: Vec3;
  velocity?: Vec3;
  targetDirection?: Vec3;
  targetMode?: number;
  targetGhost?: number;
  orientation?: Vec3;
  sourceObject?: number;
  sourceSlot?: number;
  timeoutReset?: boolean;
}

export interface SniperProjectileGhostData extends GameBaseGhostData {
  energyPercentage?: number;
  initialPosition?: Vec3;
  endPos?: Vec3;
  truncated?: boolean;
  hitWater?: boolean;
  sourceObject?: number;
  sourceSlot?: number;
  clientOwned?: boolean;
}

export interface ShockLanceProjectileGhostData extends GameBaseGhostData {
  targetObject?: number;
  start?: Vec3;
  end?: Vec3;
  hitObject?: boolean;
  sourceObject?: number;
  sourceSlot?: number;
}

export interface ELFProjectileGhostData extends GameBaseGhostData {
  sourceObject?: number;
  sourceSlot?: number;
  targetObject?: number;
}

export interface RepairProjectileGhostData extends GameBaseGhostData {
  sourceObject?: number;
  sourceSlot?: number;
  repairingObject?: number;
}

export interface TargetProjectileGhostData extends GameBaseGhostData {
  initialPosition?: Vec3;
  endPos?: Vec3;
  truncated?: boolean;
  sourceObject?: number;
  sourceSlot?: number;
  clientOwned?: boolean;
}

// ---------------------------------------------------------------------------
// Force fields
// ---------------------------------------------------------------------------

export interface ForceFieldBareGhostData extends GameBaseGhostData {
  transform?: AffineTransform;
  scale?: Vec3;
  state?: number;
  position?: number;
}

// ---------------------------------------------------------------------------
// Environment & effects
// ---------------------------------------------------------------------------

export interface SunGhostData {
  textures?: string[];
  direction?: Vec3;
  color?: Color4;
  ambient?: Color4;
  extraLightProps?: number[];
  [key: string]: unknown;
}

export interface SkyGhostData {
  materialList?: string;
  fogColor?: Color3;
  fogVolumeCount?: number;
  useSkyTextures?: boolean;
  renderBottomTexture?: boolean;
  skySolidColor?: Color3;
  windEffectPrecipitation?: boolean;
  fogVolumes?: Array<{
    visibleDistance: number;
    minHeight: number;
    maxHeight: number;
    color: Color3;
  }>;
  cloudLayers?: Array<{
    texture: string;
    heightPercent: number;
    speed: number;
  }>;
  windVelocity?: Vec3;
  stormCurrent?: number;
  stormInit?: {
    startPct: number;
    duration: number;
    indexOrMode: number;
    startTime: number;
    targetPct: number;
  };
  stormCloudsOn?: boolean;
  stormFogOn?: boolean;
  visibleDistance?: number;
  fogDistance?: number;
  stormType?: number;
  stormMagnitude?: number;
  stormTimeline?: {
    startPct: number;
    duration: number;
    indexOrMode: number;
  };
  stormCloudProfile?: {
    enabled: number;
    value0: number;
    value1: number;
    value2: number;
  };
  [key: string]: unknown;
}

export interface LightningGhostData extends GameBaseGhostData {
  position?: Vec3;
  scale?: Vec3;
  strikeWidth?: number;
  chanceToHitTarget?: number;
  strikeRadius?: number;
  boltStartRadius?: number;
  color?: Color3;
  fadeColor?: Color3;
  useFog?: boolean;
  strikesPerMinute?: number;
}

export interface WaterBlockGhostData {
  transform?: AffineTransform;
  scale?: Vec3;
  surfaceName?: string;
  envMapName?: string;
  submergeNames?: string[];
  liquidType?: number;
  density?: number;
  viscosity?: number;
  waveMagnitude?: number;
  surfaceOpacity?: number;
  envMapIntensity?: number;
  removeWetEdges?: boolean;
  audioEnvironmentId?: number;
  [key: string]: unknown;
}

export interface SplashGhostData extends GameBaseGhostData {
  position?: Vec3;
}

export interface ShockwaveGhostData extends GameBaseGhostData {
  position?: Vec3;
  normal?: Vec3;
}

export interface FireballAtmosphereGhostData extends GameBaseGhostData {
  dropRadius?: number;
  dropsPerMinute?: number;
  maxDropAngle?: number;
  minDropAngle?: number;
  startVelocity?: number;
  dropHeight?: number;
  dropDir?: Vec3;
}

export interface PrecipitationGhostData extends GameBaseGhostData {
  percentage?: number;
  colorCount?: number;
  colors?: Color4[];
  offsetSpeed?: number;
  minVelocity?: number;
  maxVelocity?: number;
  maxDrops?: number;
  maxRadius?: number;
  stormLastTime?: number;
  stormTime?: number;
  stormEndPercentage?: number;
  stormPrecipitationOn?: boolean;
  percentageUpdate?: number;
}

export interface ParticleEmissionDummyGhostData extends GameBaseGhostData {
  transform?: MatrixF;
  scale?: Vec3;
  emitterDatablockId?: number;
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface StationFXPersonalGhostData extends GameBaseGhostData {
  stationObject?: number;
}

export interface AIObjectiveGhostData extends ShapeBaseGhostData {
  transform?: AffineTransform;
  scale?: Vec3;
  unknownFlag?: boolean;
}
