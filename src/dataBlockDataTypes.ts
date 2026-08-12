import type { Vec3, Color3, Color4, AffineTransform } from "./dataTypes.js";

// ---------------------------------------------------------------------------
// Sub-structures
// ---------------------------------------------------------------------------

export interface HudImageEntry {
  friendlyName: string;
  enemyName?: string;
  renderCenter: boolean;
  renderModulated: boolean;
  renderAlways: boolean;
  renderDistance: boolean;
  renderName: boolean;
}

export interface ImageState {
  name: string;
  transitionOnAmmo: number;
  transitionOnNoAmmo: number;
  transitionOnTarget: number;
  transitionOnNoTarget: number;
  transitionOnWet: number;
  transitionOnNotWet: number;
  transitionOnTriggerUp: number;
  transitionOnTriggerDown: number;
  transitionOnTimeout: number;
  transitionGeneric0In: number;
  transitionGeneric0Out: number;
  timeoutValue?: number;
  waitForTimeout: boolean;
  fire: boolean;
  ejectShell: boolean;
  scaleAnimation: boolean;
  direction: boolean;
  reload: boolean;
  energyDrain?: number;
  loaded: number;
  spin: number;
  recoil: number;
  sequence?: number;
  sequenceVis?: number;
  flashSequence: boolean;
  ignoreLoadedForReady: boolean;
  emitter: number | null;
  emitterTime?: number;
  emitterNode?: number;
  sound: number | null;
}

export interface ParticleKey {
  r: number;
  g: number;
  b: number;
  a: number;
  size: number;
  time: number;
}

// ---------------------------------------------------------------------------
// Base DataBlock types
// ---------------------------------------------------------------------------

export interface SimDataBlock {
  [key: string]: unknown;
}

export interface GameBaseDataBlock extends SimDataBlock {}

// ---------------------------------------------------------------------------
// ShapeBase hierarchy
// ---------------------------------------------------------------------------

export interface ShapeBaseDataBlock extends GameBaseDataBlock {
  crc?: number;
  shapeName?: string;
  mass?: number;
  drag?: number;
  density?: number;
  maxEnergy?: number;
  cameraMaxDist?: number;
  cameraMinDist?: number;
  cameraDefaultFov?: number;
  cameraMinFov?: number;
  cameraMaxFov?: number;
  debrisShapeName?: string;
  sensorRadius?: number;
  sensorColor?: Color4;
  heat?: number;
  cmdCategory?: string;
  cmdMiniIconName?: string;
  canControl?: boolean;
  canObserve?: boolean;
  observeThroughObject?: boolean;
  emap?: boolean;
  isInvincible?: boolean;
  renderWhenDestroyed?: boolean;
  cmdIcon?: number | null;
  explosion?: number | null;
  underwaterExplosion?: number | null;
  debris?: number | null;
  inheritEnergyFromMount?: boolean;
  firstPersonOnly?: boolean;
  useEyePoint?: boolean;
  shieldEffectLifetimeMS?: number;
  shieldEffectScale?: Vec3;
  hudImages?: HudImageEntry[];
}

export interface ShapeBaseImageDataBlock extends GameBaseDataBlock {
  crc?: number;
  shapeName?: string;
  mountPoint?: number;
  offset?: AffineTransform;
  firstPerson?: boolean;
  mass?: number;
  usesEnergy?: boolean;
  minEnergy?: number;
  hasFlash?: boolean;
  projectile?: number | null;
  muzzleFlash?: number | null;
  isSeeker?: boolean;
  seekerRadius?: number;
  maxSeekAngle?: number;
  seekerLockTime?: number;
  seekerFreeTime?: number;
  isTargetLockRequired?: boolean;
  maxLockRange?: number;
  cloakable?: boolean;
  lightType?: number;
  lightRadius?: number;
  lightTime?: number;
  lightColor?: Color4;
  shellExitDir?: Vec3;
  shellExitVariance?: number;
  shellVelocity?: number;
  casing?: number | null;
  accuFire?: boolean;
  states?: ImageState[];
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

/**
 * Field names for the movement/jet/splash sections are binary-verified
 * against Tribes2.exe (build 25034) initPersistFields offsets — the
 * retail struct layout differs from the SVN engine source.
 */
export interface PlayerDataBlock extends ShapeBaseDataBlock {
  renderFirstPerson?: boolean;
  minLookAngle?: number;
  maxLookAngle?: number;
  maxFreelookAngle?: number;
  maxTimeScale?: number;
  maxStepHeight?: number;
  jetForce?: number;
  underwaterJetForce?: number;
  underwaterVertJetFactor?: number;
  /** Energy drained per 32ms tick while jetting. */
  jetEnergyDrain?: number;
  underwaterJetEnergyDrain?: number;
  /** Jets refuse to fire below this energy level. */
  minJetEnergy?: number;
  maxJetForwardSpeed?: number;
  maxJetHorizontalPercentage?: number;
  jetEmitter?: number | null;
  jetEffect?: number;
  runForce?: number;
  runEnergyDrain?: number;
  minRunEnergy?: number;
  maxForwardSpeed?: number;
  maxBackwardSpeed?: number;
  maxSideSpeed?: number;
  maxUnderwaterForwardSpeed?: number;
  maxUnderwaterBackwardSpeed?: number;
  maxUnderwaterSideSpeed?: number;
  runSurfaceAngle?: number;
  recoverDelay?: number;
  recoverRunForceScale?: number;
  jumpForce?: number;
  jumpEnergyDrain?: number;
  minJumpEnergy?: number;
  minJumpSpeed?: number;
  maxJumpSpeed?: number;
  jumpSurfaceAngle?: number;
  jumpDelay?: number;
  horizMaxSpeed?: number;
  horizResistSpeed?: number;
  horizResistFactor?: number;
  upMaxSpeed?: number;
  upResistSpeed?: number;
  upResistFactor?: number;
  splashVelocity?: number;
  splashAngle?: number;
  splashFreqMod?: number;
  splashVelEpsilon?: number;
  bubbleEmitTime?: number;
  mediumSplashSoundVelocity?: number;
  hardSplashSoundVelocity?: number;
  exitSplashSoundVelocity?: number;
  footstepSplashHeight?: number;
  minImpactSpeed?: number;
  sounds?: (number | null)[];
  boxSize?: Vec3;
  footPuffEmitter?: number | null;
  footPuffNumParts?: number;
  footPuffRadius?: number;
  decalData?: number | null;
  decalOffset?: number;
  dustEmitter?: number | null;
  splash?: number | null;
  splashEmitters?: (number | null)[];
  groundImpactMinSpeed?: number;
  groundImpactShakeFreq?: Vec3;
  groundImpactShakeAmp?: Vec3;
  groundImpactShakeDuration?: number;
  groundImpactShakeFalloff?: number;
  /** Heat signature rates (Tribes 2; retail player.cs: 1/4 and 1/3). */
  heatDecayPerSec?: number;
  heatIncreasePerSec?: number;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export interface VehicleDataBlock extends ShapeBaseDataBlock {
  bodyRestitution?: number;
  bodyFriction?: number;
  impactSounds?: (number | null)[];
  minImpactSpeed?: number;
  softImpactSpeed?: number;
  hardImpactSpeed?: number;
  minRollSpeed?: number;
  maxSteeringAngle?: number;
  maxDrag?: number;
  minDrag?: number;
  cameraOffset?: number;
  cameraLag?: number;
  jetForce?: number;
  jetEnergyDrain?: number;
  minJetEnergy?: number;
  integration?: number;
  collisionTol?: number;
  massCenter?: number;
  exitSplashSoundVelocity?: number;
  softSplashSoundVelocity?: number;
  mediumSplashSoundVelocity?: number;
  hardSplashSoundVelocity?: number;
  waterSounds?: (number | null)[];
  dustEmitter?: number | null;
  damageEmitters?: (number | null)[];
  splashEmitters?: (number | null)[];
  damageEmitterOffset0?: Vec3;
  damageEmitterOffset1?: Vec3;
  damageLevelTolerance0?: number;
  damageLevelTolerance1?: number;
  splashFreqMod?: number;
  splashVelEpsilon?: number;
  collDamageThresholdVel?: number;
  collDamageMultiplier?: number;
}

export interface FlyingVehicleDataBlock extends VehicleDataBlock {
  jetActivateSound?: number | null;
  jetDeactivateSound?: number | null;
  jetEmitters?: (number | null)[];
  maneuveringForce?: number;
  horizontalSurfaceForce?: number;
  verticalSurfaceForce?: number;
  autoInputDamping?: number;
  steeringForce?: number;
  steeringRollForce?: number;
  rollForce?: number;
  autoAngularForce?: number;
  rotationalDrag?: number;
  maxAutoSpeed?: number;
  autoLinearForce?: number;
  hoverHeight?: number;
  createHoverHeight?: number;
  minTrailSpeed?: number;
  vertThrustMultiple?: number;
  maxForwardSpeed?: number;
}

export interface HoverVehicleDataBlock extends VehicleDataBlock {
  dragForce?: number;
  mainThrustForce?: number;
  reverseThrustForce?: number;
  strafeThrustForce?: number;
  turboFactor?: number;
  stabLenMin?: number;
  stabLenMax?: number;
  stabSpringConstant?: number;
  stabDampingConstant?: number;
  gyroDrag?: number;
  normalForce?: number;
  restorativeForce?: number;
  steeringForce?: number;
  rollForce?: number;
  pitchForce?: number;
  floatingThrustFactor?: number;
  brakingForce?: number;
  dustTrailOffset?: Vec3;
  dustTrailFreqMod?: number;
  triggerTrailHeight?: number;
  floatSound?: number | null;
  thrustSound?: number | null;
  turboSound?: number | null;
  jetEmitters?: (number | null)[];
  dustTrailEmitter?: number | null;
  mainThrustEmitterFactor?: number;
  strafeThrustEmitterFactor?: number;
  reverseThrustEmitterFactor?: number;
}

export interface WheeledVehicleDataBlock extends VehicleDataBlock {
  tireRadius?: number;
  tireStaticFriction?: number;
  tireKineticFriction?: number;
  tireRestitution?: number;
  tireLateralForce?: number;
  tireLateralDamping?: number;
  tireLateralRelaxation?: number;
  tireLongitudinalForce?: number;
  tireLongitudinalDamping?: number;
  tireEmitter?: number | null;
  jetSound?: number | null;
  engineSound?: number | null;
  squealSound?: number | null;
  wadeSound?: number | null;
  spring?: number;
  springDamping?: number;
  springLength?: number;
  brakeTorque?: number;
  engineTorque?: number;
  engineBrake?: number;
  maxWheelSpeed?: number;
  steeringAngle?: number;
  steeringReturn?: number;
  steeringDamping?: number;
  powerSteeringFactor?: number;
}

// ---------------------------------------------------------------------------
// Static shapes and turrets
// ---------------------------------------------------------------------------

export interface StaticShapeDataBlock extends ShapeBaseDataBlock {
  noIndividualDamage?: boolean;
  dynamicTypeField?: number;
}

export interface TurretDataBlock extends StaticShapeDataBlock {
  thetaMin?: number;
  thetaMax?: number;
  thetaNull?: number;
  neverUpdateControl?: boolean;
  primaryAxis?: number;
  maxCapacitorEnergy?: number;
  capacitorRechargeRate?: number;
}

export interface TurretImageDataBlock extends ShapeBaseImageDataBlock {
  activationMS?: number;
  deactivateDelayMS?: number;
  degPerSecTheta?: number;
  degPerSecPhi?: number;
  dontFireInsideDamageRadius?: boolean;
  damageRadius?: number;
  useCapacitor?: boolean;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface ItemDataBlock extends ShapeBaseDataBlock {
  friction?: number;
  elasticity?: number;
  sticky?: boolean;
  gravityMod?: number;
  maxVelocity?: number;
  lightType?: number;
  lightColor?: Color4;
  lightTime?: number;
  lightRadius?: number;
  lightOnlyStatic?: boolean;
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

export interface ProjectileDataBlock extends GameBaseDataBlock {
  projectileShapeName?: string;
  faceViewerLinkTime?: number;
  lifetime?: number;
  faceViewer?: boolean;
  scale?: Vec3;
  baseEmitter?: number | null;
  delayEmitter?: number | null;
  bubbleEmitter?: number | null;
  explosion?: number | null;
  underwaterExplosion?: number | null;
  splash?: number | null;
  sound?: number | null;
  wetFireSound?: number | null;
  fireSound?: number | null;
  decals?: (number | null)[];
  lightRadius?: number;
  lightColor?: Color3 | Color4;
  underwaterLightColor?: Color3;
  explodeOnWaterImpact?: boolean;
  depthTolerance?: number;
}

/**
 * Field names binary-verified against Tribes2.exe (build 25034):
 * initPersistFields FUN_0062b3c0 / unpackData FUN_0062bea0.
 */
export interface LinearProjectileDataBlock extends ProjectileDataBlock {
  dryVelocity?: number;
  wetVelocity?: number;
  /** Milliseconds, tick-rounded (32ms) by the engine's onAdd. */
  fizzleTimeMS?: number;
  /** Milliseconds, tick-rounded (32ms) by the engine's onAdd. */
  lifetimeMS?: number;
  explodeOnDeath?: boolean;
  /** Degrees, 0–90. */
  reflectOnWaterImpactAngle?: number;
  /** Degrees, 0–90. */
  deflectionOnWaterImpact?: number;
  fizzleUnderwaterMS?: number;
  activateDelayMS?: number;
  doDynamicClientHits?: boolean;
}

export interface GrenadeProjectileDataBlock extends ProjectileDataBlock {
  armingDelayMS?: number;
  muzzleVelocity?: number;
  grenadeElasticity?: number;
  grenadeFriction?: number;
  drag?: number;
  density?: number;
  gravityMod?: number;
  lifetimeMS?: number;
}

export interface SeekerProjectileDataBlock extends ProjectileDataBlock {
  lifetimeMS?: number;
  muzzleVelocity?: number;
  turningSpeed?: number;
  proximityRadius?: number;
  terrainAvoidanceSpeed?: number;
  terrainScanAhead?: number;
  terrainHeightFail?: number;
  terrainAvoidanceRadius?: number;
  flareDistance?: number;
  flareAngle?: number;
  useFlechette?: boolean;
  maxVelocity?: number;
  acceleration?: number;
  flechetteDelayMs?: number;
  exhaustTimeMs?: number;
  exhaustNodeName?: string;
  casingShapeName?: string;
  casingDebris?: number | null;
  puffEmitter?: number | null;
  exhaustEmitter?: number | null;
}

export interface SniperProjectileDataBlock extends ProjectileDataBlock {
  maxRifleRange?: number;
  rifleHeadMultiplier?: number;
  beamColor?: Color4;
  fadeTime?: number;
  startBeamWidth?: number;
  endBeamWidth?: number;
  pulseBeamWidth?: number;
  beamFlareAngle?: number;
  minFlareSize?: number;
  maxFlareSize?: number;
  pulseSpeed?: number;
  pulseLength?: number;
  textures?: string[];
}

export interface ShockLanceProjectileDataBlock extends ProjectileDataBlock {
  zapDuration?: number;
  boltLength?: number;
  numParts?: number;
  lightningFreq?: number;
  lightningDensity?: number;
  lightningAmp?: number;
  lightningWidth?: number;
  shockwave?: number | null;
  startWidth?: number[];
  endWidth?: number[];
  boltSpeed?: number[];
  texWrap?: number[];
  textures?: string[];
  emitter?: number | null;
}

export interface ELFProjectileDataBlock extends ProjectileDataBlock {
  beamRange?: number;
  beamDrainRate?: number;
  muzzleVelocity?: number;
  proximityRadius?: number;
  startWidth?: number;
  endWidth?: number;
  mainBeamTexture?: string;
  innerBeamTexture?: string;
  flareTexture?: string;
  hitEmitter?: number | null;
}

export interface RepairProjectileDataBlock extends ProjectileDataBlock {
  beamRange?: number;
  beamRepairRate?: number;
  muzzleVelocity?: number;
  proximityRadius?: number;
  startWidth?: number;
  endWidth?: number;
  startBeamWidth?: number;
  endBeamWidth?: number;
  mainBeamTexture?: string;
  innerBeamTexture?: string;
}

export interface TargetProjectileDataBlock extends ProjectileDataBlock {
  maxRifleRange?: number;
  beamColor?: Color4;
  startBeamWidth?: number;
  pulseBeamWidth?: number;
  beamFlareAngle?: number;
  minFlareSize?: number;
  maxFlareSize?: number;
  pulseSpeed?: number;
  pulseLength?: number;
  textures?: string[];
}

/**
 * Field names binary-verified against Tribes2.exe (build 25034):
 * initPersistFields FUN_0063fcb0 / unpackData FUN_00640160.
 */
export interface TracerProjectileDataBlock extends LinearProjectileDataBlock {
  tracerLength?: number;
  tracerWidth?: number;
  tracerMinPixels?: number;
  /** Registered as a bool in the engine despite the name. */
  tracerAlpha?: boolean;
  tracerColor?: Color4;
  /** Cross fades in when the view angle cosine exceeds this. */
  crossViewAng?: number;
  crossSize?: number;
  renderCross?: boolean;
  tracerTex0?: string;
  tracerTex1?: string;
}

export interface EnergyProjectileDataBlock extends GrenadeProjectileDataBlock {
  energyDrainPerSecond?: number;
  energyMinDrain?: number;
  beamWidth?: number;
  beamRange?: number;
  numSegments?: number;
  texRepeat?: number;
  beamFlareAngle?: number;
  beamTexture?: string;
  flareTexture?: string;
}

export interface LinearFlareProjectileDataBlock
  extends LinearProjectileDataBlock {
  numFlares?: number;
  flareColor?: Color4;
  flareTexture?: string;
  smokeTexture?: string;
  size?: number;
  flareModTexture?: number;
  smokeSize?: number;
}

export interface BombProjectileDataBlock extends GrenadeProjectileDataBlock {
  smokeDist?: number;
  noSmoke?: number;
  boomTime?: number;
  casingDist?: number;
  smokeCushion?: number;
  noSmokeCounter?: number;
  smokeTexture?: string;
  bombTexture?: string;
}

export interface FlareProjectileDataBlock extends GrenadeProjectileDataBlock {
  size?: number;
  useLensFlare?: boolean;
  flareTexture?: string;
  lensFlareTexture?: string;
}

// ---------------------------------------------------------------------------
// Effects: explosions, debris, splash, shockwave
// ---------------------------------------------------------------------------

export interface ExplosionDataBlock extends GameBaseDataBlock {
  dtsFileName?: string;
  soundProfile?: number | null;
  particleEmitter?: number | null;
  particleDensity?: number;
  particleRadius?: number;
  faceViewer?: boolean;
  explosionScale?: Vec3;
  playSpeed?: number;
  debrisThetaMin?: number;
  debrisThetaMax?: number;
  debrisPhiMin?: number;
  debrisPhiMax?: number;
  debrisMinVelocity?: number;
  debrisMaxVelocity?: number;
  debrisNum?: number;
  debrisVariance?: number;
  delayMS?: number;
  delayVariance?: number;
  lifetimeMS?: number;
  lifetimeVariance?: number;
  offset?: number;
  shakeCamera?: boolean;
  hasLight?: boolean;
  camShakeFreq?: Vec3;
  camShakeAmp?: Vec3;
  camShakeDuration?: number;
  camShakeRadius?: number;
  camShakeFalloff?: number;
  shockwave?: number | null;
  debris?: number | null;
  emitters?: (number | null)[];
  subExplosions?: (number | null)[];
  times?: number[];
  sizes?: Vec3[];
}

export interface DebrisDataBlock extends GameBaseDataBlock {
  elasticity?: number;
  friction?: number;
  numBounces?: number;
  bounceVariance?: number;
  minSpinSpeed?: number;
  maxSpinSpeed?: number;
  render2D?: boolean;
  explodeOnMaxBounce?: boolean;
  staticOnMaxBounce?: boolean;
  snapOnMaxBounce?: boolean;
  lifetime?: number;
  lifetimeVariance?: number;
  minSpinSpeed_dup?: number;
  maxSpinSpeed_dup?: number;
  velocity?: number;
  velocityVariance?: number;
  useRadiusMass?: boolean;
  fade?: boolean;
  baseRadius?: number;
  gravModifier?: number;
  terminalVelocity?: number;
  ignoreWater?: boolean;
  texture?: string;
  shapeName?: string;
  emitter0?: number | null;
  emitter1?: number | null;
  explosion?: number | null;
}

export interface SplashDataBlock extends GameBaseDataBlock {
  scale?: Vec3;
  delayMS?: number;
  delayVariance?: number;
  lifetimeMS?: number;
  lifetimeVariance?: number;
  width?: number;
  numSegments?: number;
  velocity?: number;
  height?: number;
  acceleration?: number;
  texWrap?: number;
  texFactor?: number;
  ejectionFreq?: number;
  ejectionAngle?: number;
  ringLifetime?: number;
  startRadius?: number;
  explosion?: number | null;
  emitters?: (number | null)[];
  colors?: Color4[];
  times?: number[];
  textureName?: string;
  foamTexture?: string;
}

export interface ShockwaveDataBlock extends GameBaseDataBlock {
  scale?: Vec3;
  delayMS?: number;
  delayVariance?: number;
  lifetimeMS?: number;
  lifetimeVariance?: number;
  width?: number;
  numSegments?: number;
  numVertSegments?: number;
  velocity?: number;
  height?: number;
  verticalCurve?: number;
  acceleration?: number;
  texWrap?: number;
  is2D?: boolean;
  orientToNormal?: boolean;
  mapToTerrain?: boolean;
  renderBottom?: boolean;
  renderSquare?: boolean;
  emitters?: (number | null)[];
  colors?: Color4[];
  times?: number[];
  textureName?: string;
  mapToTexture?: string;
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

export interface ParticleEmitterDataBlock extends GameBaseDataBlock {
  ejectionPeriodMS?: number;
  periodVarianceMS?: number;
  ejectionVelocity?: number;
  velocityVariance?: number;
  ejectionOffset?: number;
  thetaMin?: number;
  thetaMax?: number;
  phiReferenceVel?: number;
  phiVariance?: number;
  overrideAdvances?: boolean;
  orientParticles?: boolean;
  orientOnVelocity?: boolean;
  lifetimeMS?: number;
  lifetimeVarianceMS?: number;
  useEmitterSizes?: boolean;
  useEmitterColors?: boolean;
  particles?: (number | null)[];
}

export interface ParticleDataBlock extends GameBaseDataBlock {
  dragCoefficient?: number;
  windCoefficient?: number;
  gravityCoefficient?: number;
  inheritedVelFactor?: number;
  constantAcceleration?: number;
  lifetimeMS?: number;
  lifetimeVarianceMS?: number;
  spinSpeed?: number;
  spinRandomMin?: number;
  spinRandomMax?: number;
  useInvAlpha?: boolean;
  keys?: ParticleKey[];
  textures?: string[];
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export interface AudioDescriptionDataBlock extends SimDataBlock {
  volume?: number;
  isLooping?: boolean;
  loopCount?: number;
  minLoopGap?: number;
  maxLoopGap?: number;
  is3D?: boolean;
  referenceDistance?: number;
  maxDistance?: number;
  coneInsideAngle?: number;
  coneOutsideAngle?: number;
  coneOutsideVolume?: number;
  coneVector?: Vec3;
  environmentLevel?: number;
  type?: number;
}

export interface AudioProfileDataBlock extends SimDataBlock {
  description?: number | null;
  environment?: number | null;
  sampleEnvironment?: number | null;
  filename?: string;
}

export interface AudioEnvironmentDataBlock extends SimDataBlock {
  useRoom?: boolean;
  room?: number;
  roomHF?: number;
  reflections?: number;
  reverb?: number;
  roomRolloffFactor?: number;
  decayTime?: number;
  decayHFRatio?: number;
  reflectionsDelay?: number;
  reverbDelay?: number;
  roomVolume?: number;
  damping?: number;
  environmentSize?: number;
  environmentDiffusion?: number;
  airAbsorption?: number;
  effectVolume?: number;
  flags?: number;
}

export interface AudioSampleEnvironmentDataBlock extends SimDataBlock {
  direct?: number;
  directHF?: number;
  room?: number;
  roomHF?: number;
  obstruction?: number;
  obstructionLFRatio?: number;
  occlusion?: number;
  occlusionLFRatio?: number;
  occlusionRoomRatio?: number;
  roomRolloff?: number;
  airAbsorption?: number;
  outsideVolumeHF?: number;
  flags?: number;
}

// ---------------------------------------------------------------------------
// Misc / utility datablocks
// ---------------------------------------------------------------------------

export interface DecalDataBlock extends SimDataBlock {
  sizeX?: number;
  sizeY?: number;
  textureName?: string;
}

export interface CameraDataBlock extends ShapeBaseDataBlock {}

export interface SensorDataBlock extends SimDataBlock {}

export interface TriggerDataBlock extends SimDataBlock {
  tickPeriodMS?: number;
}

export interface ForceFieldBareDataBlock extends SimDataBlock {
  fadeMS?: number;
  baseTranslucency?: number;
  powerOffTranslucency?: number;
  fadeInOnly?: boolean;
  triggerEnable?: boolean;
  color1?: Color4;
  color2?: Color4;
  framesPerSec?: number;
  numFrames?: number;
  scrollSpeed?: number;
  umapping?: number;
  vmapping?: number;
  texture0?: string;
  texture1?: string;
  texture2?: string;
  texture3?: string;
  texture4?: string;
}

export interface ParticleEmissionDummyDataBlock extends SimDataBlock {
  timeMultiple?: number;
}

export interface CommanderIconDataBlock extends SimDataBlock {
  baseImage?: string;
  activeImage?: string;
  inactiveImage?: string;
  selectImage?: string;
  hilightImage?: string;
}

export interface PrecipitationDataBlock extends SimDataBlock {
  soundProfile?: number | null;
  numDrops?: number;
  maxSize?: number;
  materialList?: string;
  sizeX?: number;
  sizeY?: number;
  movingBoxPer?: number;
  divHeightVal?: number;
  sizeBigBox?: number;
  topBoxSpeed?: number;
  frontBoxSpeed?: number;
  topBoxDrawPer?: number;
  bottomDrawHeight?: number;
  skipIfPer?: number;
  bottomSpeedPer?: number;
  frontSpeedPer?: number;
  frontRadiusPer?: number;
}

export interface FireballAtmosphereDataBlock extends SimDataBlock {
  emitter?: number | null;
}

export interface LightningDataBlock extends SimDataBlock {
  strikeSounds?: (number | null)[];
  strikeTextures?: string[];
  thunderSound?: number | null;
}

// ---------------------------------------------------------------------------
// Station effects
// ---------------------------------------------------------------------------

export interface StationFXVehicleDataBlock extends SimDataBlock {
  glowTopHeight?: number;
  glowBottomHeight?: number;
  glowTopRadius?: number;
  glowBottomRadius?: number;
  numGlowSegments?: number;
  glowFadeTime?: number;
  armLightDelay?: number;
  armLightLifetime?: number;
  armLightFadeTime?: number;
  lifetime?: number;
  numArcSegments?: number;
  sphereColor?: Color4;
  spherePhiSegments?: number;
  sphereThetaSegments?: number;
  sphereRadius?: number;
  scale?: Vec3;
  glowNodeName?: string;
  leftNodeName0?: string;
  rightNodeName0?: string;
  leftNodeName1?: string;
  rightNodeName1?: string;
  leftNodeName2?: string;
  rightNodeName2?: string;
  leftNodeName3?: string;
  rightNodeName3?: string;
  texture0?: string;
  texture1?: string;
}

export interface StationFXPersonalDataBlock extends SimDataBlock {
  glowTopRadius?: number;
  glowBottomRadius?: number;
  glowTopHeight?: number;
  glowBottomHeight?: number;
  numGlowSegments?: number;
  numGlowPanels?: number;
  topAlpha?: number;
  bottomAlpha?: number;
  glowSpeed?: number;
  scrollSpeed?: number;
  leftNodeName?: string;
  rightNodeName?: string;
  texture0?: string;
  texture1?: string;
}

// ---------------------------------------------------------------------------
// Miscellaneous game datablocks
// ---------------------------------------------------------------------------

export interface CannedChatItemDataBlock extends SimDataBlock {
  chatText?: string;
}

export interface MissionMarkerDataBlock extends ShapeBaseDataBlock {}

export interface TSShapeConstructorDataBlock extends SimDataBlock {
  shape?: string;
  sequences?: string[];
}

export interface EffectProfileDataBlock extends SimDataBlock {
  minDistance?: number;
  maxDistance?: number;
  audioScale?: number;
  directional?: boolean;
  effectName?: string;
}

// ---------------------------------------------------------------------------
// Jet / running light effects
// ---------------------------------------------------------------------------

export interface JetEffectDataBlock extends GameBaseDataBlock {
  coolColor?: Color4;
  hotColor?: Color4;
  activateTime?: number;
  deactivateTime?: number;
  length?: number;
  width?: number;
  speed?: number;
  stretch?: number;
  yOffset?: number;
  texture?: string;
}

export interface RunningLightDataBlock extends GameBaseDataBlock {
  radius?: number;
  color?: Color4;
  type?: number;
  length?: number;
  nodeName?: string;
  direction?: Vec3;
  offset?: Vec3;
  texture?: string;
}
