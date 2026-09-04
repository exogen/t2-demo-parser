import { huffProcessor } from "./HuffmanProcessor.js";

/**
 * LSB-first bit packer producing buffers that BitStream reads back
 * bit-for-bit. Mirrors the write side of the engine's BitStream for the
 * primitives the parser consumes; intended for building test vectors and
 * synthetic packets.
 */
export class BitWriter {
  private bytes: number[] = [];
  private bitNum = 0;

  getCurPos(): number {
    return this.bitNum;
  }

  writeFlag(value: boolean): this {
    return this.writeInt(value ? 1 : 0, 1);
  }

  /** Write the low `bitCount` bits of `value` (up to 32), LSB first. */
  writeInt(value: number, bitCount: number): this {
    if (!(bitCount >= 0 && bitCount <= 32)) {
      throw new RangeError(`writeInt bitCount out of range: ${bitCount}`);
    }
    for (let i = 0; i < bitCount; i++) {
      const byteIndex = this.bitNum >> 3;
      this.bytes[byteIndex] ??= 0;
      // Use arithmetic on the float64 value so bit 31 works for values
      // above 2^31 - 1.
      const bit = Math.floor(value / 2 ** i) % 2 !== 0 ? 1 : 0;
      this.bytes[byteIndex] |= bit << (this.bitNum & 7);
      this.bitNum++;
    }
    return this;
  }

  writeSignedInt(value: number, bitCount: number): this {
    this.writeFlag(value < 0);
    return this.writeInt(Math.abs(value), bitCount - 1);
  }

  writeU8(value: number): this {
    return this.writeInt(value & 0xff, 8);
  }

  writeU32(value: number): this {
    return this.writeInt(value >>> 0, 32);
  }

  writeS32(value: number): this {
    return this.writeInt(value >>> 0, 32);
  }

  writeF32(value: number): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    return this.writeInt(view.getUint32(0, true), 32);
  }

  /** Write a float in [0, 1] quantized to `bitCount` bits. */
  writeFloat(value: number, bitCount: number): this {
    return this.writeInt(Math.round(value * (2 ** bitCount - 1)), bitCount);
  }

  writeBytes(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i++) this.writeU8(bytes[i]);
    return this;
  }

  /** Write a Huffman string exactly as the engine's writeString does
   *  (no string-buffer prefix optimization). */
  writeString(value: string): this {
    huffProcessor.writeHuffBuffer(this, value);
    return this;
  }

  /** Pad to a byte boundary (plus optional extra zero bytes) and return
   *  the packed buffer. */
  finish(padBytes = 0): Uint8Array {
    const total = ((this.bitNum + 7) >> 3) + padBytes;
    const out = new Uint8Array(total);
    for (let i = 0; i < this.bytes.length; i++) out[i] = this.bytes[i];
    return out;
  }
}
