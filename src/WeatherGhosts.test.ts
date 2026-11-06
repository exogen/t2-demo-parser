import { describe, expect, it } from "vitest";
import { BitStream } from "./BitStream.js";
import { BitWriter } from "./BitWriter.js";
import { createDefaultRegistry } from "./defaultRegistry.js";
import { GhostTracker } from "./GhostManager.js";

function unpackWeather(name: string, stream: BitStream) {
  const registry = createDefaultRegistry();
  const parser = registry.getGhostParser(registry.getGhostClassId(name)!)!;
  return parser.unpackUpdate(stream, true, {
    compressionPoint: { x: 0, y: 0, z: 0 },
    ghostTracker: new GhostTracker(),
  });
}

describe("weather ghost updates", () => {
  it("reads the snow radius from a captured Katabatic ghost update", () => {
    // The 379-bit initial Precipitation update, aligned to its first bit.
    const stream = new BitStream(
      Buffer.from(
        "21580000c09f00000080ffffff7f0000401f0000401f0000e01fe80300803e00000003020000fe02000000040000fc01",
        "hex",
      ),
    );
    expect(unpackWeather("Precipitation", stream)).toMatchObject({
      maxDrops: 2000,
      maxRadius: 125,
    });
    expect(stream.getCurPos()).toBe(379);
  });

  it("preserves the signed unset precipitation radius", () => {
    const writer = new BitWriter()
      .writeFlag(false) // No GameBase datablock update.
      .writeFlag(false) // No GameBase target update.
      .writeFlag(true) // Precipitation initial update.
      .writeF32(1) // Percentage.
      .writeS32(0) // Color count.
      .writeF32(0.25) // Offset speed.
      .writeF32(0.25) // Minimum velocity.
      .writeF32(1.5) // Maximum velocity.
      .writeS32(2000)
      .writeS32(-1)
      .writeFlag(false) // Initial storm.
      .writeFlag(false) // Storm show.
      .writeFlag(false) // Storm transition.
      .writeFlag(false); // Percentage update.
    expect(unpackWeather("Precipitation", new BitStream(writer.finish()))).toMatchObject({
      maxRadius: -1,
    });
  });

  it("preserves both storm masks in a mid-storm precipitation update", () => {
    const writer = new BitWriter()
      .writeFlag(false) // GameBase datablock.
      .writeFlag(false) // GameBase target.
      .writeFlag(true) // InitMask.
      .writeF32(0.5)
      .writeS32(0) // No colors.
      .writeF32(0.25)
      .writeF32(0.25)
      .writeF32(1.5)
      .writeS32(2000)
      .writeS32(125)
      .writeFlag(true) // Initial storm.
      .writeF32(32)
      .writeF32(1)
      .writeF32(2)
      .writeFlag(true) // StormShowMask.
      .writeU8(1)
      .writeFlag(true) // StormMask repeats the target and duration.
      .writeF32(1)
      .writeF32(2)
      .writeFlag(true) // PercentageMask.
      .writeF32(0.5)
      .writeU32(0x12345678);
    const stream = new BitStream(writer.finish());
    expect(unpackWeather("Precipitation", stream)).toMatchObject({
      stormInitial: { elapsedTicks: 32, endPercentage: 1, durationSeconds: 2 },
      stormPrecipitationOn: true,
      stormUpdate: { endPercentage: 1, durationSeconds: 2 },
      percentageUpdate: 0.5,
    });
    expect(stream.readU32()).toBe(0x12345678);
  });

  it.each([15, 0x80000001])("reads unsigned lightning strike rate %i", (rate) => {
    const writer = new BitWriter()
      .writeFlag(false) // No GameBase datablock update.
      .writeFlag(false) // No GameBase target update.
      .writeFlag(true); // Lightning initial update.
    const floats = [
      0, 0, 300, // Position.
      512, 512, 300, // Scale.
      2.5, 0.5, 20, 20, // Width, chance, and radii.
      1, 1, 1, // Color.
      0.1, 0.1, 1, // Fade color.
    ];
    for (const value of floats) writer.writeF32(value);
    writer.writeU8(1).writeU32(rate).writeU32(0x12345678);
    const stream = new BitStream(writer.finish());
    expect(unpackWeather("Lightning", stream).strikesPerMinute).toBe(rate);
    expect(stream.readU32()).toBe(0x12345678);
  });
});
