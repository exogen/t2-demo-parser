import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DemoParser } from "./DemoParser.js";
import {
  BlockTypePacket,
  BlockTypeMove,
  BlockTypeInfo,
} from "./types.js";
import type { PacketData } from "./types.js";

/**
 * Integration tests that parse real demo files and verify zero failures.
 * These are the primary regression tests — any parser change that causes
 * ghost failures, tracker divergences, or incorrect counts will be caught.
 */

const DEMO_DIR = path.resolve(import.meta.dirname, "..", "data");

/** Demo files with expected parse metrics. */
const DEMOS = [
  {
    file: "exogen_Harvester.rec",
    minPackets: 28000,
    minGhostCreates: 17000,
    minGhostUpdates: 520000,
  },
  {
    file: "uploads_7_2025-04-26_21-30_Tacocat_CTFGame_MisadventureV2.rec",
    minPackets: 58000,
    minGhostCreates: 23000,
    minGhostUpdates: 1100000,
  },
  {
    file: "uploads_4_6_15_24_Massive_DannoProCaptain.rec",
    minPackets: 30000,
    minGhostCreates: 18000,
    minGhostUpdates: 580000,
  },
  {
    file: "uploads_6_SterIO_2025_LT_Pub_SH.rec",
    minPackets: 58000,
    minGhostCreates: 16000,
    minGhostUpdates: 1200000,
  },
  {
    file: "uploads_6_SterIO_2025_TeamNev_vs_TeamBlake_WoodyMyrk.rec",
    minPackets: 21000,
    minGhostCreates: 11000,
    minGhostUpdates: 380000,
  },
  {
    file: "uploads_8_MapFour3-1.rec",
    minPackets: 34000,
    minGhostCreates: 16000,
    minGhostUpdates: 710000,
  },
  {
    file: "auto-capture_2025-12-03_01-52_DemoBot-Mia_CTFGame_El_FinLT.rec",
    minPackets: 51000,
    minGhostCreates: 5000,
    minGhostUpdates: 450000,
  },
];

function demoExists(file: string): boolean {
  return fs.existsSync(path.join(DEMO_DIR, file));
}

async function parseDemoFile(file: string) {
  const buf = fs.readFileSync(path.join(DEMO_DIR, file));
  const parser = new DemoParser(buf);
  const result = await parser.parseFullDemo();
  return { parser, result, pp: parser.getPacketParser() };
}

describe("DemoParser integration", () => {
  for (const demo of DEMOS) {
    const shortName = demo.file
      .replace(/^uploads_\d+_/, "")
      .replace(/\.rec$/, "");

    it(`${shortName}: 0 failures, 0 divergences`, { timeout: 60_000, skip: !demoExists(demo.file) }, async () => {
      const { result, pp } = await parseDemoFile(demo.file);

      // Zero tolerance for failures
      expect(pp.ghostsFailed).toBe(0);
      expect(pp.ghostsTrackerDiverged).toBe(0);

      // Sanity: verify we actually parsed a meaningful amount of data
      expect(pp.packetsParsed).toBeGreaterThanOrEqual(demo.minPackets);
      expect(pp.ghostCreatesParsed).toBeGreaterThanOrEqual(
        demo.minGhostCreates
      );
      expect(pp.ghostUpdatesParsed).toBeGreaterThanOrEqual(
        demo.minGhostUpdates
      );

      // Header sanity
      expect(result.header.identString).toBe("Tribes2 Recording");
      expect(result.header.protocolVersion).toBe(0x330004);

      // Blocks exist
      expect(result.blocks.length).toBeGreaterThan(0);
    });
  }
});

describe("DemoParser structure", () => {
  const demoFile = "exogen_Harvester.rec";
  const skip = !demoExists(demoFile);

  it("parses header correctly", { skip, timeout: 30_000 }, async () => {
    const { result } = await parseDemoFile(demoFile);

    expect(result.header.identString).toBe("Tribes2 Recording");
    expect(result.header.protocolVersion).toBe(0x330004);
    expect(result.header.demoLengthMs).toBeGreaterThan(0);
  });

  it("parses initial block with DataBlocks", { skip, timeout: 30_000 }, async () => {
    const { result } = await parseDemoFile(demoFile);

    expect(result.initialBlock).toBeDefined();
    expect(result.initialBlock!.dataBlocks.size).toBeGreaterThan(0);
  });

  it("parses initial ghosts", { skip, timeout: 30_000 }, async () => {
    const { result } = await parseDemoFile(demoFile);

    expect(result.initialBlock!.initialGhosts).toBeDefined();
    expect(result.initialBlock!.initialGhosts!.length).toBeGreaterThan(0);
  });

  it("exposes registry with correct binding counts", { skip, timeout: 30_000 }, async () => {
    const { parser } = await parseDemoFile(demoFile);

    const reg = parser.getRegistry();
    const ghostBindings = reg.getGhostBindings();
    const eventBindings = reg.getEventBindings();

    // 53 ghost classes, 26 event classes
    expect(ghostBindings.size).toBe(53);
    expect(eventBindings.size).toBe(26);
  });

  it("WheeledVehicle always reads braking/wheels (regression)", { timeout: 60_000, skip: !demoExists("uploads_7_2025-04-26_21-30_Tacocat_CTFGame_MisadventureV2.rec") }, async () => {
    // The Tacocat demo previously had 32 ghost failures from WV misparse
    const { pp } = await parseDemoFile(
      "uploads_7_2025-04-26_21-30_Tacocat_CTFGame_MisadventureV2.rec"
    );
    expect(pp.ghostsFailed).toBe(0);
    expect(pp.ghostsTrackerDiverged).toBe(0);
  });
});

describe("DemoParser stepping API", () => {
  const demoFile = "exogen_Harvester.rec";
  const skip = !demoExists(demoFile);

  function loadDemo() {
    const buf = fs.readFileSync(path.join(DEMO_DIR, demoFile));
    return new DemoParser(buf);
  }

  it("getters before load() throw, loaded returns false", { skip }, () => {
    const parser = loadDemo();
    expect(parser.loaded).toBe(false);
    expect(() => parser.header).toThrow("must call load() first");
    expect(() => parser.initialBlock).toThrow("must call load() first");
    expect(() => parser.blockCount).toThrow("must call load() first");
    expect(() => parser.blockCursor).toThrow("must call load() first");
  });

  it("nextBlock() throws before load()", { skip }, () => {
    const parser = loadDemo();
    expect(() => parser.nextBlock()).toThrow("must call load() first");
  });

  it("reset() throws before load()", { skip }, () => {
    const parser = loadDemo();
    expect(() => parser.reset()).toThrow("must call load() first");
  });

  it("load() returns header/initialBlock with valid data", { skip, timeout: 30_000 }, async () => {
    const parser = loadDemo();
    const result = await parser.load();

    expect(result.header.identString).toBe("Tribes2 Recording");
    expect(result.header.protocolVersion).toBe(0x330004);
    expect(result.header.demoLengthMs).toBeGreaterThan(0);
    expect(result.initialBlock.dataBlocks.size).toBeGreaterThan(0);
    expect(result.initialBlock.initialGhosts.length).toBeGreaterThan(0);
    expect(result.initialBlock.missionName.length).toBeGreaterThan(0);
  });

  it("load() is idempotent", { skip, timeout: 30_000 }, async () => {
    const parser = loadDemo();
    const result1 = await parser.load();
    const result2 = await parser.load();

    expect(result2.header).toBe(result1.header);
    expect(result2.initialBlock).toBe(result1.initialBlock);
  });

  it("load() populates getters", { skip, timeout: 30_000 }, async () => {
    const parser = loadDemo();
    await parser.load();

    expect(parser.loaded).toBe(true);
    expect(parser.header.identString).toBe("Tribes2 Recording");
    expect(parser.initialBlock.dataBlocks.size).toBeGreaterThan(0);
    expect(parser.blockCount).toBeGreaterThan(0);
    expect(parser.blockCursor).toBe(0);
  });

  it("nextBlock() returns blocks sequentially and advances cursor", { skip, timeout: 30_000 }, async () => {
    const parser = loadDemo();
    await parser.load();

    const block0 = parser.nextBlock();
    expect(block0).toBeDefined();
    expect(block0!.index).toBe(0);
    expect(parser.blockCursor).toBe(1);

    const block1 = parser.nextBlock();
    expect(block1).toBeDefined();
    expect(block1!.index).toBe(1);
    expect(parser.blockCursor).toBe(2);
  });

  it("nextBlock() parses blocks with correct types", { skip, timeout: 60_000 }, async () => {
    const parser = loadDemo();
    await parser.load();

    let packets = 0;
    let moves = 0;
    let infos = 0;
    let block: ReturnType<typeof parser.nextBlock>;
    while ((block = parser.nextBlock())) {
      if (block.type === BlockTypePacket && block.parsed) packets++;
      if (block.type === BlockTypeMove && block.parsed) moves++;
      if (block.type === BlockTypeInfo && block.parsed) infos++;
    }

    expect(packets).toBeGreaterThan(0);
    expect(moves).toBeGreaterThan(0);
    expect(infos).toBeGreaterThan(0);
  });

  it("nextBlock() returns undefined when exhausted", { skip, timeout: 60_000 }, async () => {
    const parser = loadDemo();
    await parser.load();

    while (parser.nextBlock()) {}

    expect(parser.nextBlock()).toBeUndefined();
    expect(parser.blockCursor).toBe(parser.blockCount);
  });

  it("reset() resets cursor and produces identical stats on replay", { skip, timeout: 120_000 }, async () => {
    const parser = loadDemo();
    await parser.load();

    // First pass
    while (parser.nextBlock()) {}
    const pp1 = parser.getPacketParser();
    const stats1 = {
      packetsParsed: pp1.packetsParsed,
      ghostCreatesParsed: pp1.ghostCreatesParsed,
      ghostUpdatesParsed: pp1.ghostUpdatesParsed,
      ghostDeletes: pp1.ghostDeletes,
      ghostsFailed: pp1.ghostsFailed,
      ghostsTrackerDiverged: pp1.ghostsTrackerDiverged,
      eventsParsed: pp1.eventsParsed,
      controlObjectParsed: pp1.controlObjectParsed,
    };

    // Reset and replay
    parser.reset();
    expect(parser.blockCursor).toBe(0);

    while (parser.nextBlock()) {}
    const pp2 = parser.getPacketParser();
    const stats2 = {
      packetsParsed: pp2.packetsParsed,
      ghostCreatesParsed: pp2.ghostCreatesParsed,
      ghostUpdatesParsed: pp2.ghostUpdatesParsed,
      ghostDeletes: pp2.ghostDeletes,
      ghostsFailed: pp2.ghostsFailed,
      ghostsTrackerDiverged: pp2.ghostsTrackerDiverged,
      eventsParsed: pp2.eventsParsed,
      controlObjectParsed: pp2.controlObjectParsed,
    };

    expect(stats2).toEqual(stats1);
  });

  it("stepping produces same stats as parseFullDemo()", { skip, timeout: 120_000 }, async () => {
    // Parse with parseFullDemo
    const buf = fs.readFileSync(path.join(DEMO_DIR, demoFile));
    const fullParser = new DemoParser(buf);
    await fullParser.parseFullDemo();
    const fullPP = fullParser.getPacketParser();
    const fullStats = {
      packetsParsed: fullPP.packetsParsed,
      ghostCreatesParsed: fullPP.ghostCreatesParsed,
      ghostUpdatesParsed: fullPP.ghostUpdatesParsed,
      ghostDeletes: fullPP.ghostDeletes,
      ghostsFailed: fullPP.ghostsFailed,
      ghostsTrackerDiverged: fullPP.ghostsTrackerDiverged,
      eventsParsed: fullPP.eventsParsed,
      controlObjectParsed: fullPP.controlObjectParsed,
    };

    // Parse with stepping API
    const stepParser = new DemoParser(buf);
    await stepParser.load();
    while (stepParser.nextBlock()) {}
    const stepPP = stepParser.getPacketParser();
    const stepStats = {
      packetsParsed: stepPP.packetsParsed,
      ghostCreatesParsed: stepPP.ghostCreatesParsed,
      ghostUpdatesParsed: stepPP.ghostUpdatesParsed,
      ghostDeletes: stepPP.ghostDeletes,
      ghostsFailed: stepPP.ghostsFailed,
      ghostsTrackerDiverged: stepPP.ghostsTrackerDiverged,
      eventsParsed: stepPP.eventsParsed,
      controlObjectParsed: stepPP.controlObjectParsed,
    };

    expect(stepStats).toEqual(fullStats);
  });

  it("parseFullDemo() backward compat: sets loaded state", { skip, timeout: 30_000 }, async () => {
    const parser = loadDemo();
    await parser.parseFullDemo();

    expect(parser.loaded).toBe(true);
    expect(parser.blockCursor).toBe(parser.blockCount);
    expect(parser.nextBlock()).toBeUndefined();
  });

  it("processBlocks() fast-forwards correct count", { skip, timeout: 60_000 }, async () => {
    const parser = loadDemo();
    await parser.load();

    const processed = parser.processBlocks(100);
    expect(processed).toBe(100);
    expect(parser.blockCursor).toBe(100);

    // Drain the rest
    while (parser.nextBlock()) {}

    // processBlocks returns 0 when exhausted
    expect(parser.processBlocks(10)).toBe(0);
  });

  it("processBlocks() produces same stats as nextBlock() drain", { skip, timeout: 120_000 }, async () => {
    const buf = fs.readFileSync(path.join(DEMO_DIR, demoFile));

    // Drain with nextBlock
    const parser1 = new DemoParser(buf);
    await parser1.load();
    while (parser1.nextBlock()) {}
    const pp1 = parser1.getPacketParser();
    const stats1 = {
      packetsParsed: pp1.packetsParsed,
      ghostCreatesParsed: pp1.ghostCreatesParsed,
      ghostUpdatesParsed: pp1.ghostUpdatesParsed,
      ghostsFailed: pp1.ghostsFailed,
    };

    // Drain with processBlocks
    const parser2 = new DemoParser(buf);
    await parser2.load();
    parser2.processBlocks(Infinity);
    const pp2 = parser2.getPacketParser();
    const stats2 = {
      packetsParsed: pp2.packetsParsed,
      ghostCreatesParsed: pp2.ghostCreatesParsed,
      ghostUpdatesParsed: pp2.ghostUpdatesParsed,
      ghostsFailed: pp2.ghostsFailed,
    };

    expect(stats2).toEqual(stats1);
  });
});

describe("DemoParser data exposure", () => {
  const demoFile = "exogen_Harvester.rec";
  const demoWithEvents = "uploads_6_SterIO_2025_LT_Pub_SH.rec";
  const skipDemo = !demoExists(demoFile);
  const skipEvents = !demoExists(demoWithEvents);

  it("initial block exposes sensorGroupColors", { skip: skipDemo, timeout: 30_000 }, async () => {
    const { result } = await parseDemoFile(demoFile);
    const colors = result.initialBlock.sensorGroupColors;

    expect(colors).toBeDefined();
    expect(Array.isArray(colors)).toBe(true);
    // demo022 has 5 sensor group color entries (2 teams + default)
    expect(colors.length).toBeGreaterThan(0);

    // Each entry has proper structure
    for (const c of colors) {
      expect(c).toHaveProperty("group");
      expect(c).toHaveProperty("targetGroup");
      expect(c.r).toBeGreaterThanOrEqual(0);
      expect(c.r).toBeLessThanOrEqual(255);
      expect(c.g).toBeGreaterThanOrEqual(0);
      expect(c.g).toBeLessThanOrEqual(255);
      expect(c.b).toBeGreaterThanOrEqual(0);
      expect(c.b).toBeLessThanOrEqual(255);
      expect(c.a).toBeGreaterThanOrEqual(0);
      expect(c.a).toBeLessThanOrEqual(255);
    }

    // Friendly self-color is green
    const greenEntries = colors.filter(
      (c) => c.r === 0 && c.g === 255 && c.b === 0
    );
    expect(greenEntries.length).toBeGreaterThan(0);
  });

  it("initial block exposes pathManager", { skip: skipDemo, timeout: 30_000 }, async () => {
    const { result } = await parseDemoFile(demoFile);
    const pm = result.initialBlock.pathManager;

    expect(pm).toBeDefined();
    expect(Array.isArray(pm)).toBe(true);
    // pathManager may be empty for some maps, but the field must exist
    for (const entry of pm) {
      expect(entry).toHaveProperty("entryId");
      expect(entry).toHaveProperty("records");
      expect(Array.isArray(entry.records)).toBe(true);
    }
  });

  it("packets expose targetVisibility when present", { skip: skipDemo, timeout: 60_000 }, async () => {
    const { result } = await parseDemoFile(demoFile);
    let found = 0;
    for (const block of result.blocks) {
      if (block.type !== BlockTypePacket || !block.parsed) continue;
      const pkt = block.parsed as PacketData;
      if (pkt.gameState.targetVisibility) {
        found++;
        for (const tv of pkt.gameState.targetVisibility) {
          expect(typeof tv.index).toBe("number");
          expect(tv.index).toBeGreaterThanOrEqual(0);
          expect(tv.index).toBeLessThan(16);
          expect(typeof tv.mask).toBe("number");
        }
      }
    }
    // targetVisibility is sent in most game packets
    expect(found).toBeGreaterThan(0);
  });

  it("SensorGroupColorEvent parsed in packet stream", { skip: skipEvents, timeout: 60_000 }, async () => {
    const { result } = await parseDemoFile(demoWithEvents);
    let sgColorCount = 0;
    let setSgCount = 0;
    for (const block of result.blocks) {
      if (block.type !== BlockTypePacket || !block.parsed) continue;
      const pkt = block.parsed as PacketData;
      for (const evt of pkt.events) {
        if (evt.parsedData?.type === "SensorGroupColorEvent") {
          sgColorCount++;
          expect(evt.parsedData.sensorGroup).toBeDefined();
          expect(evt.parsedData.colors).toBeDefined();
        }
        if (evt.parsedData?.type === "SetSensorGroupEvent") {
          setSgCount++;
          expect(typeof evt.parsedData.sensorGroup).toBe("number");
        }
      }
    }
    expect(sgColorCount).toBeGreaterThan(0);
    expect(setSgCount).toBeGreaterThan(0);
  });

  it("GravityEvent returns float value", { skip: skipEvents, timeout: 60_000 }, async () => {
    // Check that GravityEvent gravity field, if present, is a float not an integer bit pattern
    const { result } = await parseDemoFile(demoWithEvents);
    for (const block of result.blocks) {
      if (block.type !== BlockTypePacket || !block.parsed) continue;
      const pkt = block.parsed as PacketData;
      for (const evt of pkt.events) {
        if (evt.parsedData?.type === "GravityEvent") {
          const g = evt.parsedData.gravity as number;
          // Gravity is a physical constant, typically -20 to -33 in Tribes 2
          // A U32 misread would give ~3.2 billion
          expect(Math.abs(g)).toBeLessThan(1000);
        }
      }
    }
  });
});
