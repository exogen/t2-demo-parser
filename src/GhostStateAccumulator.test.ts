import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DemoParser } from "./DemoParser.js";
import { createLiveParser } from "./LiveParser.js";
import {
  GhostStateAccumulator,
  mergeGhostParsedData,
} from "./GhostStateAccumulator.js";
import { BlockTypePacket, BlockTypeSendPacket } from "./types.js";
import type { PacketData } from "./types.js";

const DEMO_DIR = path.resolve(import.meta.dirname, "..", "data");

function demoExists(file: string): boolean {
  return fs.existsSync(path.join(DEMO_DIR, file));
}

describe("mergeGhostParsedData", () => {
  it("overwrites scalars and preserves create-only fields", () => {
    const merged = mergeGhostParsedData(
      {
        type: "Player",
        isStatic: true,
        health: 1,
        position: { x: 0, y: 0, z: 0 },
      },
      { health: 0.5, position: { x: 1, y: 2, z: 3 } },
    );
    expect(merged).toEqual({
      type: "Player",
      isStatic: true,
      health: 0.5,
      position: { x: 1, y: 2, z: 3 },
    });
  });

  it("merges indexed entry arrays by index with entry replacement", () => {
    const merged = mergeGhostParsedData(
      {
        threads: [
          { index: 0, sequence: 5, forward: true, atEnd: false },
          { index: 1, sequence: 9, forward: true, atEnd: false },
        ],
      },
      { threads: [{ index: 1, sequence: 12, forward: false, atEnd: true }] },
    );
    expect(merged.threads).toEqual([
      { index: 0, sequence: 5, forward: true, atEnd: false },
      { index: 1, sequence: 12, forward: false, atEnd: true },
    ]);
  });

  it("retains images entries with dataBlockId 0 (slot clear)", () => {
    const merged = mergeGhostParsedData(
      { images: [{ index: 2, dataBlockId: 40, firing: true }] },
      { images: [{ index: 2, dataBlockId: 0 }] },
    );
    expect(merged.images).toEqual([{ index: 2, dataBlockId: 0 }]);
  });

  it("adds new indexed entries alongside existing ones", () => {
    const merged = mergeGhostParsedData(
      { sounds: [{ index: 0, dataBlockId: 7 }] },
      { sounds: [{ index: 3, dataBlockId: 8 }] },
    );
    expect(merged.sounds).toEqual([
      { index: 0, dataBlockId: 7 },
      { index: 3, dataBlockId: 8 },
    ]);
  });

  it("replaces non-indexed arrays wholesale", () => {
    const merged = mergeGhostParsedData(
      { wheels: [{ spring: 1 }, { spring: 2 }] },
      { wheels: [{ spring: 3 }, { spring: 4 }] },
    );
    expect(merged.wheels).toEqual([{ spring: 3 }, { spring: 4 }]);
  });
});

describe("EndGhosting side effects", () => {
  it("clears ghosts but retains datablocks (connection-lifetime state)", () => {
    const kit = createLiveParser({
      dataBlocks: [[161, { shapeName: "armor.dts" }]],
      ghosts: [{ index: 5, classId: 10 }],
    });
    // White-box: apply the EndGhosting side effect directly. The real
    // client (netGhost.cc:706) deletes only local ghosts; datablocks must
    // survive mission changes because the server's transmitDataBlocks
    // skips datablocks already sent on the connection.
    (
      kit.packetParser as unknown as {
        applyEventSideEffects(data: Record<string, unknown>): void;
      }
    ).applyEventSideEffects({ type: "GhostingMessageEvent", message: 2 });
    expect(kit.ghostTracker.size()).toBe(0);
    expect(kit.packetParser.getDataBlockDataMap()?.get(161)).toEqual({
      shapeName: "armor.dts",
    });
  });

  it("GhostStateAccumulator clears accumulated ghosts on EndGhosting", () => {
    const accumulator = new GhostStateAccumulator();
    accumulator.applyPacket({
      events: [],
      ghosts: [
        {
          index: 1,
          type: "create",
          classId: 10,
          updateBitsStart: 0,
          updateBitsEnd: 0,
          parsedData: { type: "Player" },
        },
      ],
    } as unknown as PacketData);
    expect(accumulator.size()).toBe(1);
    accumulator.applyPacket({
      events: [
        {
          classId: 20,
          guaranteed: true,
          dataBitsStart: 0,
          dataBitsEnd: 0,
          parsedData: { type: "GhostingMessageEvent", message: 2 },
        },
      ],
      ghosts: [],
    } as unknown as PacketData);
    expect(accumulator.size()).toBe(0);
  });
});

/**
 * The load-bearing regression tests: export all cross-packet parser state
 * at block K, seed a fresh parser stack with it, and verify both parsers
 * produce deep-equal output for the remainder of the stream. This is
 * exactly the watch-mode late-joiner scenario (relay exports, browser
 * seeds) using demo files as a deterministic packet source.
 */
const ROUND_TRIP_DEMOS = [
  // Vehicle-heavy demo (wheels, mounts).
  { file: "exogen_Harvester.rec", cutovers: [2_000, 12_000] },
  { file: "uploads_6_SterIO_2025_LT_Pub_SH.rec", cutovers: [3_000, 20_000] },
  // MPB (WheeledVehicle) created ~block 86k, wheel updates continue past
  // the cutover — guards seeded parsing of the wheel section, whose length
  // must not depend on state accumulated before the seed point.
  {
    file: "uploads_7_2025-04-26_21-30_Tacocat_CTFGame_MisadventureV2.rec",
    cutovers: [90_000],
  },
];

/** Bound runtime: compare at most this many blocks after the cutover. */
const MAX_CONTINUE_BLOCKS = 10_000;

describe("seeded parser round-trip", () => {
  for (const demo of ROUND_TRIP_DEMOS) {
    for (const cutover of demo.cutovers) {
      it(
        `${demo.file} @ block ${cutover}: seeded parser stays in lockstep`,
        { timeout: 120_000, skip: !demoExists(demo.file) },
        async () => {
          const parser = new DemoParser(
            fs.readFileSync(path.join(DEMO_DIR, demo.file)),
          );
          const { initialBlock } = await parser.load();

          // Seed from the demo's initial ghosts, mirroring how the demo
          // pipeline seeds its tracker. (A live relay connection has no
          // initial block — it sees every create from connect onward.)
          const accumulator = new GhostStateAccumulator();
          accumulator.applyPacket({
            events: [],
            ghosts: initialBlock.initialGhosts,
          } as unknown as PacketData);
          for (let i = 0; i < cutover; i++) {
            const block = parser.nextBlock();
            if (!block) break;
            if (block.type === BlockTypePacket && block.parsed) {
              accumulator.applyPacket(block.parsed as PacketData);
            }
          }

          const source = parser.getPacketParser();
          const tracker = parser.getGhostTracker();

          // The accumulator must track exactly the ghosts the parser knows.
          const trackerEntries = [...tracker.getAllGhosts().entries()];
          expect(accumulator.size()).toBe(trackerEntries.length);
          const seedByIndex = new Map(
            accumulator
              .getGhostSeeds()
              .map((seed) => [seed.index, seed.classId]),
          );
          for (const [index, entry] of trackerEntries) {
            expect(seedByIndex.get(index)).toBe(entry.classId);
          }

          const rejectedAtCutover = source.protocolRejected;

          const seeded = createLiveParser({
            dataBlocks: source.getDataBlockDataMap() ?? [],
            ghosts: trackerEntries.map(([index, entry]) => ({
              index,
              classId: entry.classId,
            })),
            connectionProtocolState: source.getConnectionProtocolState(),
            nextRecvEventSeq: source.getNextRecvEventSeq(),
            compressionPoint: source.getCompressionPoint(),
            pendingGuaranteedEvents: source.getPendingGuaranteedEvents(),
          });

          let compared = 0;
          for (let i = 0; i < MAX_CONTINUE_BLOCKS; i++) {
            const block = parser.nextBlock();
            if (!block) break;
            if (block.type === BlockTypeSendPacket) {
              seeded.packetParser.onSendPacketTrigger();
            } else if (block.type === BlockTypePacket) {
              let seededParsed: PacketData | undefined;
              try {
                seededParsed = seeded.packetParser.parsePacket(block.data);
              } catch {
                seededParsed = undefined;
              }
              // Fast path: string compare; fall back to toEqual for a diff.
              if (
                JSON.stringify(seededParsed) !== JSON.stringify(block.parsed)
              ) {
                expect(seededParsed).toEqual(block.parsed);
              }
              compared++;
            }
          }

          expect(compared).toBeGreaterThan(1_000);
          expect(seeded.packetParser.ghostsTrackerDiverged).toBe(0);
          expect(seeded.packetParser.ghostsFailed).toBe(0);
          // Both parsers see identical headers from identical state, so
          // rejects (if any) must match the source parser's count delta.
          expect(seeded.packetParser.protocolRejected).toBe(
            source.protocolRejected - rejectedAtCutover,
          );
        },
      );
    }
  }
});
