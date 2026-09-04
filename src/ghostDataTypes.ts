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

export type MoveData = {
  pyaw: number;
  ppitch: number;
  proll: number;
  px: number;
  py: number;
  pz: number;
  freeLook: boolean;
  trigger: boolean[];
};

export type SoundSlot = {
  index: number;
  playing: boolean;
  profileId?: number;
};

export type ThreadState = {
  index: number;
  sequence: number;
  state: number;
  forward: boolean;
  atEnd: boolean;
};

export type ImageSlot = {
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
};

export type WheelState = {
  avel: number;
  dy: number;
  dx: number;
};

// ---------------------------------------------------------------------------
// GameBase hierarchy
// ---------------------------------------------------------------------------

export type GameBaseGhostData = {
  dataBlockId?: number;
  targetId?: number;
};

export type ShapeBaseGhostData = GameBaseGhostData & {
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
};

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export type PlayerGhostData = ShapeBaseGhostData & {
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
};

/** ShapeBase::readPacketData: energy level + recharge rate. */
export type ShapeBasePacketData = {
  energyLevel?: number;
  rechargeRate?: number;
};

/** Turret::readPacketData (FUN_00655d70). */
export type TurretPacketData = ShapeBasePacketData & {
  /** Ranged 0..4 (3 bits); stored at Turret+0x88c. Meaning unverified. */
  turretState: number;
  /** Three F32s copied into the turret's current rotation state
   *  (+0x890..+0x898 → +0x8dc/+0x8d4/+0x8d8). Meaning unverified. */
  rotationValues: [number, number, number];
};

export type PlayerPacketData = {
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
};

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export type VehicleGhostData = ShapeBaseGhostData & {
  jetting?: boolean;
  steeringYaw?: number;
  steeringPitch?: number;
  move?: MoveData;
  frozen?: boolean;
  position?: Vec3;
  angPosition?: Quat;
  linMomentum?: Vec3;
  angMomentum?: Vec3;
  energy?: number;
};

export type VehiclePacketData = {
  energyLevel?: number;
  rechargeRate?: number;
  steering?: { x: number; y: number };
  linPosition?: Vec3;
  angPosition?: Quat;
  linMomentum?: Vec3;
  angMomentum?: Vec3;
  disableMove?: boolean;
  frozen?: boolean;
};

export type WheeledVehicleGhostData = VehicleGhostData & {
  braking?: boolean;
  wheels?: WheelState[];
};

export type WheeledVehiclePacketData = VehiclePacketData & {
  braking?: boolean;
  wheels?: WheelState[];
};

export type FlyingVehicleGhostData = VehicleGhostData & {
  createHeightOn?: boolean;
  thrustDirection?: number;
};

export type HoverVehicleGhostData = VehicleGhostData & {
  thrustDirection?: number;
};

// ---------------------------------------------------------------------------
// Items & static shapes
// ---------------------------------------------------------------------------

export type ItemGhostData = ShapeBaseGhostData & {
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
};

export type StaticShapeGhostData = ShapeBaseGhostData & {
  transform?: AffineTransform | MatrixF;
  position?: Vec3;
  scale?: Vec3;
  powered?: boolean;
};

export type ScopeAlwaysShapeGhostData = StaticShapeGhostData;

export type BeaconObjectGhostData = StaticShapeGhostData & {
  beaconType?: number;
};

export type TurretGhostData = StaticShapeGhostData & {
  capacitorEnergy?: number;
  phi?: number;
  theta?: number;
  activationLevel?: number;
};

// ---------------------------------------------------------------------------
// Mission markers
// ---------------------------------------------------------------------------

export type MissionMarkerGhostData = ShapeBaseGhostData & {
  transform?: AffineTransform;
  position?: Vec3;
  scale?: Vec3;
};

export type WayPointGhostData = MissionMarkerGhostData & {
  name?: string;
  teamId?: number;
  hidden?: boolean;
};

export type SpawnSphereGhostData = MissionMarkerGhostData & {
  radius?: number;
  sphereWeight?: number;
  indoorWeight?: number;
  outdoorWeight?: number;
};

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export type CameraGhostData = ShapeBaseGhostData & {
  posX?: number;
  posY?: number;
  posZ?: number;
  fovOrDist?: number;
  orbitParam?: number;
};

export type CameraPacketData = {
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
};

// ---------------------------------------------------------------------------
// Standalone ghost types (not GameBase subclasses)
// ---------------------------------------------------------------------------

export type MarkerGhostData = {
  position?: Vec3;
};

export type SimpleNetObjectGhostData = {
  message?: string;
};

export type InteriorInstanceGhostData = {
  crc?: number;
  interiorFile?: string;
  showTerrainInside?: boolean;
  transform?: MatrixF;
  scale?: Vec3;
  alarmState?: boolean;
  skinBase?: string;
  audioProfileId?: number;
  audioEnvironmentId?: number;
};

export type TSStaticGhostData = {
  transform?: MatrixF;
  scale?: Vec3;
  shapeName?: string;
};

export type TerrainBlockGhostData = {
  crc?: number;
  terrFileName?: string;
  detailTextureName?: string;
  squareSize?: number;
  emptySquareRuns?: number[];
  emptySquareRunCount?: number;
};

export type TriggerGhostData = {
  tickPeriodMS?: number;
};

export type VehicleBlockerGhostData = {
  transform?: MatrixF;
  boundsMin?: Vec3;
  boundsMax?: Vec3;
};

export type MissionAreaGhostData = {
  area?: { x: number; y: number; w: number; h: number };
  flightCeiling?: number;
  flightCeilingRange?: number;
};

export type AudioEmitterGhostData = {
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
};

export type PhysicalZoneGhostData = {
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
};

// ---------------------------------------------------------------------------
// Debris
// ---------------------------------------------------------------------------

export type DebrisGhostData = GameBaseGhostData & {
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
};

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

export interface ProjectileGhostData extends GameBaseGhostData {}

export type LinearProjectileGhostData = GameBaseGhostData & {
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
};

export type BombProjectileGhostData = GameBaseGhostData & {
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
};

export type GrenadeProjectileGhostData = GameBaseGhostData & {
  position?: Vec3;
  velocity?: Vec3;
  currTick?: number;
  quickSplash?: boolean;
  explodePoint?: Vec3;
  explodeNormal?: Vec3;
  sourceObject?: number;
  sourceSlot?: number;
  vehicleObject?: number;
};

export type SeekerProjectileGhostData = GameBaseGhostData & {
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
};

export type SniperProjectileGhostData = GameBaseGhostData & {
  energyPercentage?: number;
  initialPosition?: Vec3;
  endPos?: Vec3;
  truncated?: boolean;
  hitWater?: boolean;
  sourceObject?: number;
  sourceSlot?: number;
  clientOwned?: boolean;
};

export type ShockLanceProjectileGhostData = GameBaseGhostData & {
  targetObject?: number;
  start?: Vec3;
  end?: Vec3;
  hitObject?: boolean;
  sourceObject?: number;
  sourceSlot?: number;
};

export type ELFProjectileGhostData = GameBaseGhostData & {
  sourceObject?: number;
  sourceSlot?: number;
  targetObject?: number;
};

export type RepairProjectileGhostData = GameBaseGhostData & {
  sourceObject?: number;
  sourceSlot?: number;
  repairingObject?: number;
};

export type TargetProjectileGhostData = GameBaseGhostData & {
  initialPosition?: Vec3;
  endPos?: Vec3;
  truncated?: boolean;
  sourceObject?: number;
  sourceSlot?: number;
  clientOwned?: boolean;
};

// ---------------------------------------------------------------------------
// Force fields
// ---------------------------------------------------------------------------

export type ForceFieldBareGhostData = GameBaseGhostData & {
  transform?: AffineTransform;
  scale?: Vec3;
  state?: number;
  position?: number;
};

// ---------------------------------------------------------------------------
// Environment & effects
// ---------------------------------------------------------------------------

export type SunGhostData = {
  textures?: string[];
  direction?: Vec3;
  color?: Color4;
  ambient?: Color4;
  extraLightProps?: number[];
};

export type SkyGhostData = {
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
};

export type LightningGhostData = GameBaseGhostData & {
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
};

export type WaterBlockGhostData = {
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
};

export type SplashGhostData = GameBaseGhostData & {
  position?: Vec3;
};

export type ShockwaveGhostData = GameBaseGhostData & {
  position?: Vec3;
  normal?: Vec3;
};

export type FireballAtmosphereGhostData = GameBaseGhostData & {
  dropRadius?: number;
  dropsPerMinute?: number;
  maxDropAngle?: number;
  minDropAngle?: number;
  startVelocity?: number;
  dropHeight?: number;
  dropDir?: Vec3;
};

export type PrecipitationGhostData = GameBaseGhostData & {
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
};

export type ParticleEmissionDummyGhostData = GameBaseGhostData & {
  transform?: MatrixF;
  scale?: Vec3;
  emitterDatablockId?: number;
};

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export type StationFXPersonalGhostData = GameBaseGhostData & {
  stationObject?: number;
};

export type AIObjectiveGhostData = ShapeBaseGhostData & {
  transform?: AffineTransform;
  scale?: Vec3;
  unknownFlag?: boolean;
};
