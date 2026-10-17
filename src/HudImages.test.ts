import { describe, expect, it } from "vitest";
import { BitStream } from "./BitStream.js";
import { BitWriter } from "./BitWriter.js";
import { ClassRegistry } from "./ClassRegistry.js";
import { registerDataBlockParsers } from "./DataBlockParsers.js";
import type { HudImageEntry } from "./dataBlockDataTypes.js";

describe("ShapeBaseData HUD slots", () => {
  it.each([[], [1], [0, 1, 2], [0, 7]].map((slots) => ({ slots })))(
    "preserves sparse slot indices $slots and subsequent bits",
    ({ slots }) => {
      const writer = new BitWriter().writeFlag(false).writeString("flag.dts");
      for (let i = 0; i < 9; i++) writer.writeFlag(false); // default physics/camera fields
      writer.writeString("").writeFlag(false).writeFlag(false); // debris, sensor, heat
      writer.writeString("").writeString(""); // command icons
      for (let i = 0; i < 13; i++) writer.writeFlag(false); // flags and datablock refs
      writer.writeU32(0).writeFlag(false); // shield effect
      const expected: HudImageEntry[] = [];
      for (let index = 0; index < 8; index++) {
        writer.writeFlag(slots.includes(index));
        if (!slots.includes(index)) continue;
        const enemyName = index === 7 ? "enemy" : undefined;
        writer.writeString("hudFlag").writeFlag(enemyName !== undefined);
        if (enemyName) writer.writeString(enemyName);
        writer
          .writeFlag(true)
          .writeFlag(false)
          .writeFlag(true)
          .writeFlag(false)
          .writeFlag(true);
        expected.push({
          index,
          friendlyName: "hudFlag",
          enemyName,
          renderCenter: true,
          renderModulated: false,
          renderAlways: true,
          renderDistance: false,
          renderName: true,
        });
      }
      writer.writeU32(0x12345678);
      const stream = new BitStream(writer.finish());
      const registry = new ClassRegistry();
      registerDataBlockParsers(registry);
      const result = registry
        .getDataBlockCatalog()
        .get("ShapeBaseData")!
        .unpackData(stream);
      expect(result.hudImages).toEqual(expected.length ? expected : undefined);
      expect(stream.readU32()).toBe(0x12345678);
      expect(stream.isError()).toBe(false);
    },
  );
});
