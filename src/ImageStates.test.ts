import { describe, expect, it } from "vitest";
import { BitStream } from "./BitStream.js";
import { BitWriter } from "./BitWriter.js";
import { ClassRegistry } from "./ClassRegistry.js";
import { registerDataBlockParsers } from "./DataBlockParsers.js";
import type { ShapeBaseImageDataBlock } from "./dataBlockDataTypes.js";

/** ShapeBaseImageData's retail wire layout: 31 flagged state slots. */
function imageStates(slots: readonly number[]): BitStream {
  const writer = new BitWriter()
    .writeFlag(false) // CRC
    .writeString("weapon_test.dts")
    .writeU32(0) // mount point
    .writeFlag(true) // identity offset
    .writeFlag(true) // first person
    .writeF32(1) // mass
    .writeFlag(false) // uses energy
    .writeF32(0) // minimum energy
    .writeFlag(false) // has flash
    .writeFlag(false) // projectile
    .writeFlag(false) // muzzle flash
    .writeFlag(false) // seeker
    .writeFlag(false) // cloakable
    .writeInt(0, 2); // no light
  for (let i = 0; i < 5; i++) writer.writeF32(0); // shell direction, variance, velocity
  writer.writeFlag(false).writeFlag(false); // casing, accurate fire
  for (let index = 0; index < 31; index++) {
    writer.writeFlag(slots.includes(index));
    if (!slots.includes(index)) continue;
    writer.writeString(`State${index}`);
    // Transitions reference original state slots, not positions in the
    // compact list: Loaded -> slot 30, TriggerDown -> 10, Timeout -> 2.
    const targets = [0, 31, 0, 0, 0, 0, 0, 0, 0, 11, index === 30 ? 1 : 3];
    for (const target of targets) writer.writeInt(target, 5);
    writer
      .writeFlag(true)
      .writeF32(0.5 + index / 8) // timeout
      .writeFlag(true) // wait for timeout
      .writeFlag(index === 10) // fire
      .writeFlag(index === 10 || index === 30) // eject shell
      .writeFlag(index === 2) // shockwave
      .writeFlag(index === 0 || index === 10) // scale animation
      .writeFlag(index !== 2) // direction
      .writeFlag(false) // default energy drain
      .writeInt(0, 3) // loaded
      .writeInt(0, 3) // spin
      .writeInt(0, 3) // recoil
      .writeFlag(true)
      .writeSignedInt(index, 16) // sequence
      .writeFlag(false) // default flash sequence index
      .writeFlag(false) // flash
      .writeFlag(false) // ignore loaded
      .writeFlag(false) // emitter
      .writeFlag(false); // sound
  }
  writer.writeU32(0x12345678);
  return new BitStream(writer.finish());
}

function parseImage(stream: BitStream): ShapeBaseImageDataBlock {
  const registry = new ClassRegistry();
  registerDataBlockParsers(registry);
  return registry
    .getDataBlockCatalog()
    .get("ShapeBaseImageData")!
    .unpackData(stream) as ShapeBaseImageDataBlock;
}

describe("ShapeBaseImageData state slots", () => {
  it("preserves sparse wire indices without changing transition targets or compact list order", () => {
    const stream = imageStates([0, 2, 10, 30]);
    const states = parseImage(stream).states!;
    expect(states.map(({ index, name }) => ({ index, name }))).toEqual([
      { index: 0, name: "State0" },
      { index: 2, name: "State2" },
      { index: 10, name: "State10" },
      { index: 30, name: "State30" },
    ]);
    expect(states[0]).toMatchObject({
      transitionOnLoaded: 31,
      transitionOnTriggerDown: 11,
      transitionOnTimeout: 3,
      transitionOnNotLoaded: 0,
      sequence: 0,
      timeoutValue: 0.5,
      fire: false,
      ejectShell: false,
      shockwave: false,
      scaleAnimation: true,
      direction: true,
    });
    expect(states[1]).toMatchObject({
      fire: false,
      ejectShell: false,
      shockwave: true,
      scaleAnimation: false,
      direction: false,
    });
    expect(states[2]).toMatchObject({
      fire: true,
      ejectShell: true,
      shockwave: false,
      scaleAnimation: true,
      direction: true,
    });
    expect(states[3]).toMatchObject({
      transitionOnTimeout: 1,
      sequence: 30,
      timeoutValue: 4.25,
      fire: false,
      ejectShell: true,
      shockwave: false,
      scaleAnimation: false,
      direction: true,
    });
    expect(stream.readU32()).toBe(0x12345678);
    expect(stream.isError()).toBe(false);
  });

  it.each([[], [0], [0, 1, 2], [10, 30]].map((slots) => ({ slots })))(
    "preserves slots $slots and the following bit stream",
    ({ slots }) => {
      const stream = imageStates(slots);
      expect(parseImage(stream).states?.map(({ index }) => index)).toEqual(
        slots,
      );
      expect(stream.readU32()).toBe(0x12345678);
      expect(stream.isError()).toBe(false);
    },
  );
});
