import { describe, expect, it } from "vitest";
import { BitStream } from "./BitStream.js";
import { BitWriter } from "./BitWriter.js";
import { createDefaultRegistry } from "./defaultRegistry.js";
import { GhostTracker } from "./GhostManager.js";

function unpackSky(writer: BitWriter, initial: boolean) {
  const registry = createDefaultRegistry();
  const parser = registry.getGhostParser(registry.getGhostClassId("Sky")!)!;
  const stream = new BitStream(writer.writeU32(0x12345678).finish());
  const data = parser.unpackUpdate(stream, initial, {
    compressionPoint: { x: 0, y: 0, z: 0 },
    ghostTracker: new GhostTracker(),
  });
  expect(stream.readU32()).toBe(0x12345678);
  return data;
}

describe("Sky weather masks", () => {
  it("reads integer fog state and elapsed time in a late initial update", () => {
    const writer = new BitWriter()
      .writeFlag(true)
      .writeString("sky.dml")
      .writeF32(0.25)
      .writeF32(0.5)
      .writeF32(0.75) // Fog color.
      .writeU32(0) // Fog volume count.
      .writeU8(1)
      .writeU8(0) // Sky textures and bottom texture.
      .writeF32(0)
      .writeF32(0)
      .writeF32(0) // Solid sky color.
      .writeU8(1); // Wind affects precipitation.
    for (let i = 0; i < 3; i++) {
      writer.writeString("").writeF32(0.25).writeF32(0.125);
    }
    writer
      .writeF32(1)
      .writeF32(2)
      .writeF32(3)
      .writeS32(-1)
      .writeFlag(true)
      .writeF32(0.25)
      .writeF32(8)
      .writeU32(2)
      .writeU32(1234)
      .writeF32(0);
    for (let i = 0; i < 7; i++) writer.writeFlag(false);
    expect(unpackSky(writer, true)).toMatchObject({
      windVelocity: { x: 1, y: 2, z: 3 },
      stormCurrent: -1,
      stormInit: {
        startPct: 0.25,
        duration: 8,
        indexOrMode: 2,
        startTime: 1234,
        targetPct: 0,
      },
    });
  });

  it("keeps every sparse weather mask aligned through the trailing wind", () => {
    const writer = new BitWriter()
      .writeFlag(false) // Initial.
      .writeFlag(true)
      .writeU8(0) // Storm cloud show.
      .writeFlag(true)
      .writeU8(1) // Storm fog show.
      .writeFlag(true)
      .writeF32(600)
      .writeF32(400)
      .writeFlag(true)
      .writeU32(1)
      .writeF32(8) // Cloud storm.
      .writeFlag(true)
      .writeF32(0.5)
      .writeF32(4)
      .writeS32(-1) // Fog storm.
      .writeFlag(true)
      .writeS32(-1)
      .writeF32(0.75)
      .writeF32(0.25)
      .writeF32(0.125)
      .writeFlag(true)
      .writeF32(-2)
      .writeF32(8)
      .writeF32(1);
    expect(unpackSky(writer, false)).toEqual({
      stormCloudsOn: false,
      stormFogOn: true,
      visibleDistance: 600,
      fogDistance: 400,
      stormType: 1,
      stormMagnitude: 8,
      stormTimeline: { startPct: 0.5, duration: 4, indexOrMode: -1 },
      stormCloudProfile: {
        enabled: -1,
        value0: 0.75,
        value1: 0.25,
        value2: 0.125,
      },
      windVelocity: { x: -2, y: 8, z: 1 },
    });
  });
});
