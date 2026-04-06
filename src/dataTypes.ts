// ---------------------------------------------------------------------------
// Shared data types used across ghost, datablock, and event parsers
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Color3 {
  r: number;
  g: number;
  b: number;
}

export interface Color4 {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface AffineTransform {
  position: Vec3;
  rotation: Quat;
}

export interface MatrixF {
  elements: number[];
  position: Vec3;
}
