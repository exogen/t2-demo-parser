import { huffProcessor } from "./HuffmanProcessor.js";

/**
 * Bit-level stream reader, ported from the V12 engine's BitStream class.
 *
 * Bits are read LSB-first within each byte:
 *   byte[bitNum >> 3] & (1 << (bitNum & 7))
 */
export class BitStream {
  private data: Uint8Array;
  private bitNum: number;
  private maxReadBitNum: number;
  private error: boolean;
  private stringBuffer: string | null = null;

  constructor(data: Uint8Array, bitOffset = 0) {
    this.data = data;
    this.bitNum = bitOffset;
    this.maxReadBitNum = data.length << 3;
    this.error = false;
  }

  getCurPos(): number {
    return this.bitNum;
  }

  setCurPos(pos: number): void {
    this.bitNum = pos;
  }

  /** Byte position (rounded up), matching C++ getPosition() */
  getBytePosition(): number {
    return (this.bitNum + 7) >> 3;
  }

  isError(): boolean {
    return this.error;
  }

  /** Returns true if we've read past the buffer */
  isFull(): boolean {
    return this.bitNum > this.maxReadBitNum;
  }

  getRemainingBits(): number {
    return this.maxReadBitNum - this.bitNum;
  }

  getMaxPos(): number {
    return this.maxReadBitNum;
  }

  /** Read a single bit as a boolean. */
  readFlag(): boolean {
    if (this.bitNum >= this.maxReadBitNum) {
      this.error = true;
      return false;
    }
    const mask = 1 << (this.bitNum & 0x7);
    const ret = (this.data[this.bitNum >> 3] & mask) !== 0;
    this.bitNum++;
    return ret;
  }

  /**
   * Read N bits as an unsigned integer (up to 32 bits).
   * Bits are read LSB-first, matching the C++ implementation.
   */
  readInt(bitCount: number): number {
    if (bitCount === 0) return 0;
    if (this.bitNum + bitCount > this.maxReadBitNum) {
      this.error = true;
      return 0;
    }

    const startByte = this.bitNum >> 3;
    const downShift = this.bitNum & 0x7;
    this.bitNum += bitCount;

    // When bitCount + downShift <= 32, everything fits in 32-bit operations
    if (bitCount + downShift <= 32) {
      let ret = 0;
      const bytesNeeded = (bitCount + downShift + 7) >> 3;
      for (
        let i = 0;
        i < bytesNeeded && startByte + i < this.data.length;
        i++
      ) {
        ret |= this.data[startByte + i] << (i * 8);
      }
      ret = ret >>> downShift;
      if (bitCount === 32) return ret >>> 0;
      return ret & ((1 << bitCount) - 1);
    }

    // Slow path: bitCount + downShift > 32 (e.g., reading 32 bits at a
    // non-byte-aligned position). Use float64 arithmetic to avoid the
    // 32-bit limit of JavaScript bitwise operators.
    let ret = 0;
    const bytesNeeded = (bitCount + downShift + 7) >> 3;
    for (let i = 0; i < bytesNeeded && startByte + i < this.data.length; i++) {
      ret += this.data[startByte + i] * 2 ** (i * 8);
    }
    ret = Math.floor(ret / 2 ** downShift);
    // Mask to bitCount bits using float64-safe operations
    if (bitCount === 32) return ret >>> 0;
    return ret & ((1 << bitCount) - 1);
  }

  /** Read a signed integer: 1-bit sign flag + (bitCount-1) magnitude bits. */
  readSignedInt(bitCount: number): number {
    if (this.readFlag()) {
      return -this.readInt(bitCount - 1);
    }
    return this.readInt(bitCount - 1);
  }

  /** Read a float normalized to [0, 1]. */
  readFloat(bitCount: number): number {
    return this.readInt(bitCount) / ((1 << bitCount) - 1);
  }

  /** Read a float normalized to [-1, 1]. */
  readSignedFloat(bitCount: number): number {
    return (this.readInt(bitCount) * 2) / ((1 << bitCount) - 1) - 1.0;
  }

  /** Read a ranged unsigned 32-bit integer. */
  readRangedU32(rangeStart: number, rangeEnd: number): number {
    const rangeSize = rangeEnd - rangeStart + 1;
    const rangeBits = Math.ceil(Math.log2(rangeSize)) || 1;
    return this.readInt(rangeBits) + rangeStart;
  }

  /** Read raw bits into a new Uint8Array. */
  readBitsBuffer(bitCount: number): Uint8Array {
    if (bitCount === 0) return new Uint8Array(0);
    const byteCount = (bitCount + 7) >> 3;
    const result = new Uint8Array(byteCount);

    const startByte = this.bitNum >> 3;
    const downShift = this.bitNum & 0x7;
    const upShift = 8 - downShift;

    if (downShift === 0) {
      // Byte-aligned, fast path
      result.set(this.data.subarray(startByte, startByte + byteCount));
    } else {
      let curB = this.data[startByte];
      for (let i = 0; i < byteCount; i++) {
        const nextB =
          startByte + i + 1 < this.data.length
            ? this.data[startByte + i + 1]
            : 0;
        result[i] = ((curB >> downShift) | (nextB << upShift)) & 0xff;
        curB = nextB;
      }
    }

    // Mask off extra bits in the last byte
    const extraBits = bitCount & 0x7;
    if (extraBits !== 0) {
      result[byteCount - 1] &= (1 << extraBits) - 1;
    }

    this.bitNum += bitCount;
    return result;
  }

  /** Read N raw bytes. Returns an array of byte values. */
  readBytes(count: number): number[] {
    const buf = this.readBitsBuffer(count * 8);
    return Array.from(buf);
  }

  /** Read a U8 (8 bits). */
  readU8(): number {
    return this.readInt(8);
  }

  /** Read a U16 (16 bits, little-endian). */
  readU16(): number {
    return this.readInt(16);
  }

  /** Read a U32 (32 bits, little-endian). */
  readU32(): number {
    return this.readInt(32);
  }

  /** Read a signed 32-bit integer (via stream.read in C++). */
  readS32(): number {
    const val = this.readU32();
    return val | 0; // convert to signed
  }

  /** Shared buffer for allocation-free F32 reads. */
  private static readonly f32Buf = new ArrayBuffer(4);
  private static readonly f32View = new DataView(BitStream.f32Buf);
  private static readonly f32U8 = new Uint8Array(BitStream.f32Buf);

  /** Read a 32-bit float (IEEE 754), allocation-free. */
  readF32(): number {
    if (this.bitNum + 32 > this.maxReadBitNum) {
      this.error = true;
      return 0;
    }

    const startByte = this.bitNum >> 3;
    const downShift = this.bitNum & 0x7;
    const u8 = BitStream.f32U8;

    if (downShift === 0) {
      u8[0] = this.data[startByte];
      u8[1] = this.data[startByte + 1];
      u8[2] = this.data[startByte + 2];
      u8[3] = this.data[startByte + 3];
    } else {
      const upShift = 8 - downShift;
      for (let i = 0; i < 4; i++) {
        const curB = this.data[startByte + i];
        const nextB =
          startByte + i + 1 < this.data.length
            ? this.data[startByte + i + 1]
            : 0;
        u8[i] = ((curB >> downShift) | (nextB << upShift)) & 0xff;
      }
    }

    this.bitNum += 32;
    return BitStream.f32View.getFloat32(0, true);
  }

  /** Read a boolean value stored as a U8 (matches C++ Stream::read(bool*)). */
  readBool(): boolean {
    return this.readU8() !== 0;
  }

  /**
   * Read a compressed 3D normal vector.
   * Uses phi (azimuth) and theta (elevation) angles.
   */
  readNormalVector(bitCount: number): { x: number; y: number; z: number } {
    const phi = this.readSignedFloat(bitCount + 1) * Math.PI;
    const theta = this.readSignedFloat(bitCount) * (Math.PI / 2.0);

    return {
      x: Math.sin(phi) * Math.cos(theta),
      y: Math.cos(phi) * Math.cos(theta),
      z: Math.sin(theta),
    };
  }

  /**
   * Read an affine transform (position + quaternion rotation).
   * Position: 3x F32
   * Quaternion: 3x F32 (x,y,z) + 1-bit sign for w
   */
  readAffineTransform(): {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  } {
    const position = {
      x: this.readF32(),
      y: this.readF32(),
      z: this.readF32(),
    };

    const qx = this.readF32();
    const qy = this.readF32();
    const qz = this.readF32();
    let qw = Math.sqrt(
      Math.max(0, 1.0 - (qx * qx + qy * qy + qz * qz))
    );
    if (this.readFlag()) {
      qw = -qw;
    }

    return {
      position,
      rotation: { x: qx, y: qy, z: qz, w: qw },
    };
  }

  /**
   * Read a Huffman-encoded string.
   * Handles the stringBuffer optimization (shared prefix with previous string).
   */
  readString(): string {
    if (this.stringBuffer !== null) {
      if (this.readFlag()) {
        // Shared prefix optimization: offset into previous string
        const offset = this.readInt(8);
        const suffix = huffProcessor.readHuffBuffer(this);
        const result = this.stringBuffer.substring(0, offset) + suffix;
        this.stringBuffer = result;
        return result;
      }
    }
    const result = huffProcessor.readHuffBuffer(this);
    if (this.stringBuffer !== null) {
      this.stringBuffer = result;
    }
    return result;
  }

  /** Enable/disable the string buffer for shared-prefix optimization. */
  setStringBuffer(enable: boolean): void {
    this.stringBuffer = enable ? "" : null;
  }

  /** Skip N bits. */
  skipBits(count: number): void {
    this.bitNum += count;
  }

  /** Read 3x F32 as a Point3F. */
  readPoint3F(): { x: number; y: number; z: number } {
    return { x: this.readF32(), y: this.readF32(), z: this.readF32() };
  }

  /**
   * Read a compressed 3D point relative to a compression point.
   * Format: 2-bit type, then either absolute (3x F32) or relative delta.
   * Used by Player MoveMask and Vehicle PositionMask.
   */
  readCompressedPoint(
    compressionPoint: { x: number; y: number; z: number },
    scale: number = 0.01
  ): { x: number; y: number; z: number } {
    const type = this.readInt(2);
    if (type === 3) {
      // Absolute position
      return { x: this.readF32(), y: this.readF32(), z: this.readF32() };
    }
    // Relative to compression point
    const bitCounts = [16, 18, 20];
    const bits = bitCounts[type];
    const dx = this.readSignedInt(bits);
    const dy = this.readSignedInt(bits);
    const dz = this.readSignedInt(bits);
    return {
      x: compressionPoint.x + dx * scale,
      y: compressionPoint.y + dy * scale,
      z: compressionPoint.z + dz * scale,
    };
  }

  /**
   * Read a MatrixF written via mathWrite(MatrixF).
   * Format: 16x F32 (row-major in Torque's MatrixF storage) = 512 bits.
   */
  readMatrixF(): {
    elements: number[];
    position: { x: number; y: number; z: number };
  } {
    const elements = new Array<number>(16);
    for (let i = 0; i < 16; i++) {
      elements[i] = this.readF32();
    }

    // MatrixF is written row-major: each row is [r0, r1, r2, translation].
    // Position (column 3) is at indices 3, 7, 11 (last element of each row).
    return {
      elements,
      position: { x: elements[3], y: elements[7], z: elements[11] },
    };
  }

  /**
   * Read a Torque "packed string" with 2-bit type code.
   * Used by RemoteCommandEvent for script arguments.
   * Tribes 2 binary (FUN_00588690) format:
   *   0 = null/empty
   *   1 = normal packed string
   *   2 = tagged string id (10-bit), decoded to "\x01<decimalId>"
   *   3 = integer string (sign + 7/15/31-bit magnitude)
   */
  unpackNetString(): string {
    const code = this.readInt(2);
    switch (code) {
      case 0:
        return ""; // null string
      case 1:
        return this.readString(); // Huffman-encoded string
      case 2: {
        // Decompiled binary uses 10 bits here, not 12.
        const tag = this.readInt(10);
        // Keep Tribes 2 tagged-string wire representation.
        return `\x01${tag}`;
      }
      case 3: {
        // Integer encoding: sign + variable-size magnitude
        const neg = this.readFlag();
        let num: number;
        if (this.readFlag()) {
          num = this.readInt(7); // small
        } else if (this.readFlag()) {
          num = this.readInt(15); // medium
        } else {
          num = this.readInt(31); // large
        }
        if (neg) num = -num;
        return String(num);
      }
      default:
        return "";
    }
  }

  /** Create a snapshot of the current position that can be restored. */
  savePos(): number {
    return this.bitNum;
  }

  /** Restore a previously saved position. */
  restorePos(pos: number): void {
    this.bitNum = pos;
    this.error = false;
  }

  /** Get the underlying data buffer. */
  getBuffer(): Uint8Array {
    return this.data;
  }
}
