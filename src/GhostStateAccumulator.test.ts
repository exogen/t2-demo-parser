import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { BitStream } from "./BitStream.js";
import { BitWriter } from "./BitWriter.js";
import { createDefaultRegistry } from "./defaultRegistry.js";
import { GhostTracker } from "./GhostManager.js";
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

  const mountedPlayer = {
    dataBlockId: 161,
    mountObject: 7,
    mountNode: 2,
    action: 16,
    actionHoldAtEnd: true,
    actionAtEnd: true,
    actionFirstPerson: true,
    actionAnimPos: 0.75,
    armAction: 3,
  };

  it("clears the seat action and mount node when a player unmounts", () => {
    expect(mergeGhostParsedData(mountedPlayer, { mountObject: -1 })).toEqual({
      dataBlockId: 161,
      mountObject: -1,
      armAction: 3,
    });
    expect(mountedPlayer.action).toBe(16);
    expect(mountedPlayer.mountNode).toBe(2);
  });

  it("applies a new action after an unmount in the same update", () => {
    expect(
      mergeGhostParsedData(mountedPlayer, {
        mountObject: -1,
        action: 20,
        actionHoldAtEnd: true,
        actionAtEnd: false,
        actionFirstPerson: false,
        actionAnimPos: 0.25,
      }),
    ).toEqual({
      dataBlockId: 161,
      mountObject: -1,
      armAction: 3,
      action: 20,
      actionHoldAtEnd: true,
      actionAtEnd: false,
      actionFirstPerson: false,
      actionAnimPos: 0.25,
    });
  });

  it.each([false, true])(
    "discards the previous action position when the next action omits it (atEnd=%s)",
    (actionAtEnd) => {
      const action = {
        action: 20,
        actionHoldAtEnd: true,
        actionAtEnd,
        actionFirstPerson: false,
      };
      const merged = mergeGhostParsedData(mountedPlayer, action);
      expect(merged).toMatchObject(action);
      expect(merged).not.toHaveProperty("actionAnimPos");
      expect(merged.armAction).toBe(3);
    },
  );

  it.each([0, 0.25])(
    "keeps the new action's explicit position %s",
    (actionAnimPos) => {
      expect(
        mergeGhostParsedData(mountedPlayer, {
          action: 20,
          actionHoldAtEnd: false,
          actionAtEnd: false,
          actionFirstPerson: false,
          actionAnimPos,
        }),
      ).toMatchObject({ action: 20, actionAnimPos });
    },
  );

  it("preserves action state when the update has no action or unmount", () => {
    expect(
      mergeGhostParsedData(mountedPlayer, { position: { x: 1, y: 2, z: 3 } }),
    ).toMatchObject(mountedPlayer);
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

describe("beam shooter scope", () => {
  const beamIndex = 9;
  const muzzle = { x: 1, y: 2, z: 3 };
  const endPos = { x: 4, y: 5, z: 6 };
  const shooter = {
    index: 7,
    type: "create",
    classId: 2,
    parsedData: { dataBlockId: 651 },
  };
  const beam = {
    index: beamIndex,
    type: "create",
    classId: 42,
    parsedData: {
      dataBlockId: 513,
      initialPosition: { x: 0, y: 0, z: 0 },
      endPos,
      sourceObject: shooter.index,
      sourceSlot: 2,
      clientOwned: true,
      truncated: false,
    },
  };
  const currentBeam = (accumulator: GhostStateAccumulator) =>
    accumulator.toInitialGhosts().find(({ index }) => index === beamIndex)
      ?.parsedData;

  it("clears the old shooter when a swing packet carries a standalone muzzle", () => {
    const accumulator = new GhostStateAccumulator();
    accumulator.applyPacket({
      events: [],
      ghosts: [beam, shooter],
    } as unknown as PacketData);
    accumulator.applyPacket({
      events: [],
      ghosts: [
        {
          index: beamIndex,
          type: "update",
          parsedData: { initialPosition: muzzle, endPos, truncated: true },
        },
      ],
    } as unknown as PacketData);
    expect(currentBeam(accumulator)).toEqual({
      dataBlockId: 513,
      initialPosition: muzzle,
      endPos,
      truncated: true,
    });

    const source = { sourceObject: 0, sourceSlot: 1, clientOwned: false };
    accumulator.applyPacket({
      events: [],
      ghosts: [
        {
          index: beamIndex,
          type: "update",
          parsedData: { ...source, endPos, truncated: false },
        },
        { ...shooter, index: 0 },
      ],
    } as unknown as PacketData);
    expect(currentBeam(accumulator)).toEqual({
      dataBlockId: 513,
      initialPosition: muzzle,
      endPos,
      truncated: false,
      ...source,
    });
  });

  it.each(["delete", "create", "ghost-always"])(
    "keeps a beam detached when its shooter's slot is reused after %s",
    (replacement) => {
      const accumulator = new GhostStateAccumulator();
      accumulator.applyPacket({
        events: [],
        ghosts: [beam, shooter],
      } as unknown as PacketData);
      expect(currentBeam(accumulator)).toMatchObject(beam.parsedData);

      if (replacement === "delete") {
        accumulator.applyPacket({
          events: [],
          ghosts: [{ index: shooter.index, type: "delete" }],
        } as unknown as PacketData);
        expect(currentBeam(accumulator)).not.toHaveProperty("sourceObject");
      }
      accumulator.applyPacket({
        events:
          replacement === "ghost-always"
            ? [
                {
                  parsedData: {
                    type: "GhostAlwaysObjectEvent",
                    ghostIndex: shooter.index,
                    classId: shooter.classId,
                    objectData: { dataBlockId: 652 },
                  },
                },
              ]
            : [],
        ghosts:
          replacement === "ghost-always"
            ? []
            : [{ ...shooter, parsedData: { dataBlockId: 652 } }],
      } as unknown as PacketData);

      expect(currentBeam(accumulator)).toEqual({
        dataBlockId: 513,
        initialPosition: beam.parsedData.initialPosition,
        endPos,
        truncated: false,
      });
    },
  );

  it("does not attach a stale source when its slot first appears on a later packet", () => {
    const accumulator = new GhostStateAccumulator();
    accumulator.applyPacket({
      events: [],
      ghosts: [beam],
    } as unknown as PacketData);
    expect(currentBeam(accumulator)).not.toHaveProperty("sourceObject");
    accumulator.applyPacket({
      events: [],
      ghosts: [shooter],
    } as unknown as PacketData);
    expect(currentBeam(accumulator)).not.toHaveProperty("sourceObject");
  });
});

describe("ELF and repair beam endpoints", () => {
  const linkTypes = [
    ["ELFProjectile", "targetObject"],
    ["RepairProjectile", "repairingObject"],
  ] as const;

  function decodeLink(name: (typeof linkTypes)[number][0], ...mask: boolean[]) {
    const registry = createDefaultRegistry();
    const classId = registry.getGhostClassId(name)!;
    const parser = registry.getGhostParser(classId)!;
    const writer = new BitWriter().writeFlag(false).writeFlag(false); // GameBase masks.
    for (const flag of mask) writer.writeFlag(flag);
    if (mask[0] && mask[1])
      writer.writeInt(0, 11).writeInt(3, 3).writeInt(7, 11);
    writer.writeU32(0x12345678);
    const stream = new BitStream(writer.finish());
    const parsedData = parser.unpackUpdate(stream, false, {
      compressionPoint: { x: 0, y: 0, z: 0 },
      ghostTracker: new GhostTracker(),
    });
    expect(stream.readU32()).toBe(0x12345678);
    expect(stream.isError()).toBe(false);
    return { classId, parsedData };
  }

  it.each(linkTypes)(
    "%s distinguishes an absent link from a sparse mask",
    (name, targetField) => {
      const detached = { sourceObject: -1, sourceSlot: -1, [targetField]: -1 };
      expect(decodeLink(name, false).parsedData).toEqual(
        name === "ELFProjectile" ? detached : {},
      );
      expect(decodeLink(name, true, false).parsedData).toEqual(detached);
      expect(decodeLink(name, true, true).parsedData).toEqual({
        sourceObject: 0,
        sourceSlot: 3,
        [targetField]: 7,
      });
    },
  );

  it.each(linkTypes)(
    "%s preserves only the endpoint lifetimes named by its latest update",
    (name, targetField) => {
      const accumulator = new GhostStateAccumulator();
      const linked = decodeLink(name, true, true);
      const current = () =>
        accumulator.toInitialGhosts().find(({ index }) => index === 9)
          ?.parsedData;
      const source = { index: 0, type: "create", classId: 25, parsedData: {} };
      const target = { ...source, index: 7 };
      accumulator.applyPacket({
        events: [],
        ghosts: [{ ...linked, type: "create", index: 9 }, source, target],
      } as unknown as PacketData);
      expect(current()).toEqual(linked.parsedData);

      // The target slot is recycled before the next snapshot is taken.
      accumulator.applyPacket({
        events: [],
        ghosts: [{ index: 7, type: "delete" }, target],
      } as unknown as PacketData);
      expect(current()).toEqual({ sourceObject: 0, sourceSlot: 3 });

      // Only a new wire update may bind the same numeric slot again.
      accumulator.applyPacket({
        events: [],
        ghosts: [{ ...linked, type: "update", index: 9 }],
      } as unknown as PacketData);
      expect(current()).toEqual(linked.parsedData);

      accumulator.applyPacket({
        events: [],
        ghosts: [source],
      } as unknown as PacketData);
      expect(current()).toEqual({ [targetField]: 7 });
      accumulator.applyPacket({
        events: [],
        ghosts: [{ index: 7, type: "delete" }],
      } as unknown as PacketData);
      expect(current()).toEqual({});
    },
  );
});

describe("TargetFreeEvent side effects", () => {
  it("detaches existing ghosts before the target id is reused", () => {
    const accumulator = new GhostStateAccumulator();
    accumulator.applyPacket({
      events: [],
      ghosts: [32, 33].map((targetId, index) => ({
        index,
        type: "create",
        classId: 10,
        parsedData: { type: "Player", targetId },
      })),
    } as unknown as PacketData);
    accumulator.applyPacket({
      events: [{ parsedData: { type: "TargetFreeEvent", targetId: 32 } }],
      ghosts: [],
    } as unknown as PacketData);
    expect(
      accumulator.toInitialGhosts().map((ghost) => ghost.parsedData?.targetId),
    ).toEqual([-1, 33]);
    accumulator.applyPacket({
      events: [],
      ghosts: [
        {
          index: 2,
          type: "create",
          classId: 10,
          parsedData: { type: "Player", targetId: 32 },
        },
      ],
    } as unknown as PacketData);
    expect(
      accumulator.toInitialGhosts().map((ghost) => ghost.parsedData?.targetId),
    ).toEqual([-1, 33, 32]);
  });

  it("applies a same-packet target assignment after the free event", () => {
    const accumulator = new GhostStateAccumulator();
    accumulator.applyPacket({
      events: [],
      ghosts: [
        {
          index: 0,
          type: "create",
          classId: 10,
          parsedData: { type: "Player", targetId: 32 },
        },
      ],
    } as unknown as PacketData);
    accumulator.applyPacket({
      events: [{ parsedData: { type: "TargetFreeEvent", targetId: 32 } }],
      ghosts: [{ index: 0, type: "update", parsedData: { targetId: 33 } }],
    } as unknown as PacketData);
    expect(accumulator.toInitialGhosts()[0].parsedData?.targetId).toBe(33);
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
          const accumulator = new GhostStateAccumulator(
            initialBlock.taggedStrings,
          );
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
            protocolVersion: source.getProtocolVersion(),
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
