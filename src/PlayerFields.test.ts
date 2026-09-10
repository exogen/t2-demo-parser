import { describe, expect, it } from "vitest";
import { BitStream } from "./BitStream.js";
import { BitWriter } from "./BitWriter.js";
import { ClassRegistry } from "./ClassRegistry.js";
import { registerDataBlockParsers } from "./DataBlockParsers.js";
import { readMove } from "./GhostManager.js";

describe("binary-verified player prediction fields", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "decodes teamPermiable=%s and otherPermiable=%s without consuming following fields",
    (team, other) => {
      // ForceFieldBareData::packData / unpackData: offsets 0x44..0x4c,
      // two bits at 0x8c/0x8d, then colors, animation fields and five strings.
      const writer = new BitWriter()
        .writeS32(750)
        .writeF32(0.5)
        .writeF32(0.125)
        .writeFlag(team)
        .writeFlag(other);
      for (const byte of [255, 128, 64, 255, 10, 20, 30, 40])
        writer.writeU8(byte);
      writer.writeS32(12).writeS32(5).writeF32(0.25).writeF32(2).writeF32(3);
      for (let i = 0; i < 5; i++) writer.writeString("field" + i);
      writer.writeU32(0x12345678);
      const stream = new BitStream(writer.finish());
      const registry = new ClassRegistry();
      registerDataBlockParsers(registry);
      const value = registry
        .getDataBlockCatalog()
        .get("ForceFieldBareData")!
        .unpackData(stream);
      expect(value.teamPermiable).toBe(team);
      expect(value.otherPermiable).toBe(other);
      expect(value).not.toHaveProperty("fadeInOnly");
      expect(value).not.toHaveProperty("triggerEnable");
      expect(value.framesPerSec).toBe(12);
      expect(value.texture4).toBe("field4");
      expect(stream.readU32()).toBe(0x12345678);
    },
  );
  it("reads the demo move queue with the same packed fields as ghost moves", () => {
    const writer = new BitWriter()
      .writeFlag(true)
      .writeInt(65535, 16)
      .writeFlag(true)
      .writeInt(1234, 16)
      .writeFlag(false)
      .writeInt(0, 6)
      .writeInt(32, 6)
      .writeInt(16, 6)
      .writeFlag(true);
    const trigger = [true, false, true, false, false, true];
    for (const bit of trigger) writer.writeFlag(bit);
    writer.writeU32(0x87654321);
    const stream = new BitStream(writer.finish());
    expect(readMove(stream)).toEqual({
      pyaw: 65535,
      ppitch: 1234,
      proll: 0,
      px: 0,
      py: 32,
      pz: 16,
      freeLook: true,
      trigger,
    });
    expect(stream.readU32()).toBe(0x87654321);
  });
});
