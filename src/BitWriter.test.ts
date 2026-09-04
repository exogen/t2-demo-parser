import { describe, it, expect } from "vitest";
import { BitStream } from "./BitStream.js";
import { BitWriter } from "./BitWriter.js";
import { huffProcessor, MaxHuffStringLength } from "./HuffmanProcessor.js";

describe("BitWriter / BitStream round trip", () => {
  it("round-trips flags, ints, signed ints, floats and bytes", () => {
    const w = new BitWriter();
    w.writeFlag(true)
      .writeInt(0x2a5, 10)
      .writeFlag(false)
      .writeU32(0xdeadbeef)
      .writeSignedInt(-1234, 16)
      .writeF32(-3.5)
      .writeFloat(0.25, 7)
      .writeBytes([1, 2, 255]);
    const bs = new BitStream(w.finish());
    expect(bs.readFlag()).toBe(true);
    expect(bs.readInt(10)).toBe(0x2a5);
    expect(bs.readFlag()).toBe(false);
    expect(bs.readU32()).toBe(0xdeadbeef);
    expect(bs.readSignedInt(16)).toBe(-1234);
    expect(bs.readF32()).toBe(-3.5);
    expect(bs.readFloat(7)).toBeCloseTo(0.25, 2);
    expect(bs.readBytes(3)).toEqual([1, 2, 255]);
    expect(bs.isError()).toBe(false);
  });

  it("writes bit 31 of values above 2^31", () => {
    const w = new BitWriter().writeInt(0x80000001, 32);
    expect(new BitStream(w.finish()).readU32()).toBe(0x80000001);
  });
});

describe("HuffmanProcessor", () => {
  const samples = [
    "",
    "a",
    "Rollercoaster",
    "Tribes2 Recording",
    "\x01123",
    "player name with spaces & symbols!?",
    "éÿ\x00\x7f",
    "x".repeat(MaxHuffStringLength),
  ];

  for (const sample of samples) {
    it(`round-trips ${JSON.stringify(sample.slice(0, 24))}`, () => {
      const w = new BitWriter().writeString(sample).writeInt(0x5a, 8);
      const bs = new BitStream(w.finish());
      expect(bs.readString()).toBe(sample);
      // The trailing marker proves the decoder consumed exactly the
      // encoded bits.
      expect(bs.readInt(8)).toBe(0x5a);
      expect(bs.isError()).toBe(false);
    });
  }

  it("uses the raw-byte form when Huffman codes would be longer", () => {
    // Bytes with (near-)zero frequency get long codes, so the encoder
    // must fall back to flag=0 + length + raw bytes.
    const sample = "\x80\x81\x82\x83";
    const bs = new BitStream(new BitWriter().writeString(sample).finish());
    expect(bs.readFlag()).toBe(false);
    expect(bs.readInt(8)).toBe(4);
    expect(bs.readBytes(4)).toEqual([0x80, 0x81, 0x82, 0x83]);
  });

  it("compresses common text", () => {
    const sample = "the quick brown fox";
    const w = new BitWriter().writeString(sample);
    expect(w.getCurPos()).toBeLessThan(1 + 8 + sample.length * 8);
    const bs = new BitStream(w.finish());
    expect(bs.readFlag()).toBe(true);
    bs.setCurPos(0);
    expect(bs.readString()).toBe(sample);
  });

  it("rejects strings the 8-bit length prefix cannot describe", () => {
    expect(() =>
      new BitWriter().writeString("x".repeat(MaxHuffStringLength + 1)),
    ).toThrow(RangeError);
    expect(() => new BitWriter().writeString("Ā")).toThrow(RangeError);
  });

  it("terminates on a truncated compressed string", () => {
    const w = new BitWriter().writeString("hello world");
    const full = w.finish();
    const cut = full.subarray(0, 3);
    const bs = new BitStream(cut);
    const s = huffProcessor.readHuffBuffer(bs);
    expect(typeof s).toBe("string");
    expect(bs.isError()).toBe(true);
  });

  it("applies the shared-prefix optimisation when the string buffer is on", () => {
    // With the buffer on every string starts with a prefix flag:
    // flag=0 → whole string; flag=1, offset=5 → keep "hello", then a
    // Huffman suffix.
    const w = new BitWriter()
      .writeFlag(false)
      .writeString("hello world")
      .writeFlag(true)
      .writeInt(5, 8)
      .writeString(" there");
    const bs = new BitStream(w.finish());
    bs.setStringBuffer(true);
    expect(bs.readString()).toBe("hello world");
    expect(bs.readString()).toBe("hello there");
  });
});
