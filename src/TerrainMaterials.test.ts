import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BitStream } from "./BitStream.js";
import { BitWriter } from "./BitWriter.js";
import { createDefaultRegistry } from "./defaultRegistry.js";
import { GhostTracker } from "./GhostManager.js";
import { PacketParser } from "./PacketParser.js";
import { passiveObserverProtocolState } from "./LiveParser.js";

const registry = createDefaultRegistry();
const terrain = registry.getGhostParser(45)!;
const context = {
  compressionPoint: { x: 0, y: 0, z: 0 },
  ghostTracker: new GhostTracker(),
};
const names = [
  "LushWorld.GrassLight",
  "LushWorld.GrassMixed",
  "LushWorld.RockLight",
  "LushWorld.DirtMossy",
  "LushWorld.RockMossy",
  "",
  "",
  "",
];

// String buffering is enabled in packets: a false prefix flag precedes
// every independently encoded Huffman string in these synthetic vectors.
function initialTerrain() {
  return new BitWriter()
    .writeFlag(true)
    .writeU32(123)
    .writeFlag(false)
    .writeString("example.ter")
    .writeFlag(false)
    .writeString("details/lushdet2")
    .writeU32(8)
    .writeU32(0);
}
function stream(w: BitWriter) {
  const bs = new BitStream(w.finish());
  bs.setStringBuffer(true);
  return bs;
}

describe("TribesNEXT terrain materials", () => {
  it.each([null, 52])(
    "keeps the Magnum transition packet aligned (protocol %s)",
    (protocolVersion) => {
      // Map geometry only, extracted from mistcane - Rollercoaster - 00004.rec
      // block 415673 (1837.440s). The old parser stops after the terrain,
      // mistakes material bytes for a command, then loses eight ordered events.
      const packet = readFileSync(
        new URL("./fixtures/tribesnext-magnum-terrain.bin", import.meta.url),
      );
      const parser = new PacketParser(registry, new GhostTracker(), {
        protocolVersion,
        connectionProtocolState: {
          ...passiveObserverProtocolState(packet[0]),
          lastSeqRecvd: 330,
          highestAckedSeq: 114,
        },
        nextRecvEventSeq: 29455,
      });
      const checkpoint = parser.saveState();
      const result = parser.parsePacket(packet);
      const restored = new PacketParser(registry, new GhostTracker(), {
        protocolVersion: 51,
      });
      restored.restoreState(checkpoint);
      expect(restored.getProtocolVersion()).toBe(protocolVersion);
      expect(restored.parsePacket(packet)).toEqual(result);
      expect(result.parseFault).toBeUndefined();
      expect(result.events.map((e) => e.absoluteSequenceNumber)).toEqual(
        Array.from({ length: 11 }, (_, i) => 29455 + i),
      );
      expect(result.events.map((e) => e.parsedData?.ghostIndex)).toEqual(
        Array.from({ length: 11 }, (_, i) => 1001 - i),
      );
      expect(result.events[2].parsedData?.objectData).toMatchObject({
        terrFileName: "TL_Magnum.ter",
        materialNames: names,
      });
      expect(parser.getPendingGuaranteedEvents()).toEqual([]);
    },
  );

  it("reads eight material slots and preserves the new string prefix", () => {
    const w = initialTerrain()
      .writeFlag(true)
      .writeFlag(false)
      .writeString(names.join("\n"));
    w.writeFlag(true).writeU8(9).writeString("RockDark");
    const bs = stream(w);
    expect(terrain.unpackUpdate(bs, true, context).materialNames).toEqual(
      names,
    );
    expect(bs.readString()).toBe("LushWorldRockDark");
    expect(bs.isError()).toBe(false);
  });

  it.each([false, true])(
    "does not consume a legacy suffix starting with %s",
    (flag) => {
      const w = initialTerrain();
      const end = w.getCurPos();
      w.writeFlag(flag).writeU32(0x12345678);
      const bs = stream(w);
      expect(terrain.unpackUpdate(bs, true, context)).not.toHaveProperty(
        "materialNames",
      );
      expect(bs.getCurPos()).toBe(end);
      expect(bs.isError()).toBe(false);
      expect(bs.readFlag()).toBe(flag);
      expect(bs.readU32()).toBe(0x12345678);
    },
  );

  it("restores the string prefix after unsuccessful lookahead", () => {
    const w = initialTerrain()
      .writeFlag(true)
      .writeFlag(false)
      .writeString("not a material list");
    w.writeFlag(true).writeU8(8).writeString("new");
    const bs = stream(w);
    terrain.unpackUpdate(bs, true, context);
    expect(bs.readFlag()).toBe(true);
    expect(bs.readString()).toBe("not a material list");
    expect(bs.readString()).toBe("not a manew");
  });

  it.each([null, 51, 52])(
    "never probes saved demo ghosts (protocol %s)",
    (protocolVersion) => {
      const w = initialTerrain();
      const end = w.getCurPos();
      w.writeFlag(true).writeFlag(false).writeString(names.join("\n"));
      const bs = stream(w);
      expect(
        terrain.unpackUpdate(bs, true, {
          ...context,
          isDemoStartBlock: true,
          protocolVersion,
        }),
      ).not.toHaveProperty("materialNames");
      expect(bs.getCurPos()).toBe(end);
    },
  );
});

describe("negotiated terrain layout", () => {
  it("does not consume an exact material-list lookalike on protocol 51", () => {
    const w = initialTerrain();
    const end = w.getCurPos();
    w.writeFlag(true).writeFlag(false).writeString(names.join("\n"));
    const bs = stream(w);
    expect(
      terrain.unpackUpdate(bs, true, { ...context, protocolVersion: 51 }),
    ).not.toHaveProperty("materialNames");
    expect(bs.getCurPos()).toBe(end);
    expect(bs.readFlag()).toBe(true);
    expect(bs.readString()).toBe(names.join("\n"));
  });

  it.each([true, false])(
    "consumes a false QoL extension flag (initial %s)",
    (initial) => {
      const w = initial
        ? initialTerrain()
        : new BitWriter().writeFlag(false).writeFlag(false);
      w.writeFlag(false);
      const end = w.getCurPos();
      w.writeU32(0x12345678);
      const bs = stream(w);
      expect(
        terrain.unpackUpdate(bs, initial, { ...context, protocolVersion: 52 }),
      ).not.toHaveProperty("materialNames");
      expect(bs.getCurPos()).toBe(end);
      expect(bs.readU32()).toBe(0x12345678);
      expect(bs.isError()).toBe(false);
    },
  );

  it.each(["", "one\ntwo", names.join("\n")])(
    "consumes the negotiated string even if it does not match the demo heuristic (%j)",
    (materials) => {
      const w = initialTerrain()
        .writeFlag(true)
        .writeFlag(false)
        .writeString(materials);
      const end = w.getCurPos();
      w.writeU32(0x12345678);
      const bs = stream(w);
      expect(
        terrain.unpackUpdate(bs, true, { ...context, protocolVersion: 52 })
          .materialNames,
      ).toEqual(materials.split("\n"));
      expect(bs.getCurPos()).toBe(end);
      expect(bs.readU32()).toBe(0x12345678);
      expect(bs.isError()).toBe(false);
    },
  );

  it("reports a truncated negotiated extension instead of falling back to retail", () => {
    const w = initialTerrain()
      .writeFlag(true)
      .writeFlag(false)
      .writeString(names.join("\n"));
    const bs = new BitStream(w.finish().subarray(0, -5));
    bs.setStringBuffer(true);
    terrain.unpackUpdate(bs, true, { ...context, protocolVersion: 52 });
    expect(bs.isError()).toBe(true);
  });

  it("does not carry a detected demo layout into another terrain payload", () => {
    const patched = stream(
      initialTerrain()
        .writeFlag(true)
        .writeFlag(false)
        .writeString(names.join("\n")),
    );
    expect(terrain.unpackUpdate(patched, true, context).materialNames).toEqual(
      names,
    );
    const legacy = initialTerrain();
    const end = legacy.getCurPos();
    legacy.writeFlag(true).writeU32(0x12345678);
    const bs = stream(legacy);
    expect(terrain.unpackUpdate(bs, true, context)).not.toHaveProperty(
      "materialNames",
    );
    expect(bs.getCurPos()).toBe(end);
  });
});
