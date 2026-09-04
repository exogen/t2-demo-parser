import { describe, it, expect } from "vitest";
import { buildTimeline, exportTimeline, getTimelineStats } from "./Timeline.js";
import { createDefaultRegistry } from "./defaultRegistry.js";
import {
  BlockTypeMove,
  BlockTypePacket,
  BlockTypeInfo,
  MoveTickMs,
} from "./types.js";
import type {
  DemoBlock,
  DemoFile,
  GhostUpdate,
  InitialBlockData,
  PacketData,
} from "./types.js";

const registry = createDefaultRegistry();
const PLAYER = registry.getGhostClassId("Player")!;
const ITEM = registry.getGhostClassId("Item")!;

function packet(
  ghosts: GhostUpdate[] = [],
  gameState: Partial<PacketData["gameState"]> = {},
): PacketData {
  return {
    dnetHeader: {
      gameFlag: true,
      connectSeqBit: 0,
      seqNumber: 0,
      highestAck: 0,
      packetType: 0,
      ackByteCount: 0,
      ackMask: 0,
    },
    rateInfo: {},
    gameState: { lastMoveAck: 0, pinged: false, jammed: false, ...gameState },
    events: [],
    ghosts,
  };
}

function ghost(
  index: number,
  type: GhostUpdate["type"],
  classId?: number,
  parsedData?: Record<string, unknown>,
): GhostUpdate {
  return { index, type, classId, updateBitsStart: 0, updateBitsEnd: 0, parsedData };
}

function demo(
  blocks: Array<{ type: number; parsed?: PacketData }>,
  initialGhosts: GhostUpdate[] = [],
): DemoFile {
  const demoBlocks: DemoBlock[] = blocks.map((b, index) => ({
    index,
    type: b.type,
    size: 0,
    data: new Uint8Array(0),
    parsed: b.parsed,
  }));
  const initialBlock = { initialGhosts } as unknown as InitialBlockData;
  return {
    header: {
      identString: "Tribes2 Recording",
      protocolVersion: 0x330004,
      demoLengthMs: 1000,
      initialBlockSize: 0,
    },
    initialBlock,
    blocks: demoBlocks,
  };
}

const move = { type: BlockTypeMove };

describe("buildTimeline", () => {
  it("timestamps packets by the move ticks that precede them", () => {
    const d = demo([
      { type: BlockTypePacket, parsed: packet([ghost(1, "create", ITEM, { position: { x: 1, y: 2, z: 3 } })]) },
      move,
      move,
      { type: BlockTypeInfo },
      { type: BlockTypePacket, parsed: packet([ghost(1, "update", undefined, { position: { x: 4, y: 5, z: 6 } })]) },
      move,
      { type: BlockTypePacket, parsed: packet([ghost(1, "delete")]) },
    ]);
    const t = buildTimeline(d, registry);
    expect(t.tickIntervalMs).toBe(MoveTickMs);
    expect(t.packetCount).toBe(3);
    expect(t.ghostInstances).toHaveLength(1);
    const inst = t.ghostInstances[0];
    expect(inst.className).toBe("Item");
    expect(inst.spawnTime).toBe(0);
    expect(inst.keyframes.map((k) => k.time)).toEqual([0, 2 * MoveTickMs]);
    expect(inst.despawnTime).toBe(3 * MoveTickMs);
  });

  it("seeds instances from the initial block and ends them on re-create", () => {
    const d = demo(
      [
        move,
        { type: BlockTypePacket, parsed: packet([ghost(7, "create", PLAYER, { position: { x: 9, y: 9, z: 9 } })]) },
      ],
      [ghost(7, "create", ITEM, { position: { x: 1, y: 1, z: 1 } })],
    );
    const t = buildTimeline(d, registry);
    expect(t.ghostInstances).toHaveLength(2);
    expect(t.ghostInstances[0].className).toBe("Item");
    expect(t.ghostInstances[0].despawnTime).toBe(MoveTickMs);
    expect(t.ghostInstances[1].className).toBe("Player");
    expect(t.ghostInstances[1].spawnTime).toBe(MoveTickMs);
  });

  it("filters implausible positions but keeps exact zeros", () => {
    const d = demo([
      {
        type: BlockTypePacket,
        parsed: packet([
          ghost(1, "create", ITEM, { position: { x: 1e-30, y: 0, z: 0 } }),
          ghost(2, "create", ITEM, { position: { x: 0, y: 0, z: 0 } }),
          ghost(3, "create", ITEM, { position: { x: 0.001, y: 60000, z: 0 } }),
          ghost(4, "create", ITEM, { position: { x: 0.001, y: -12.5, z: 300 } }),
        ]),
      },
    ]);
    const t = buildTimeline(d, registry);
    const withPos = t.ghostInstances.map((i) => i.keyframes[0].position !== undefined);
    expect(withPos).toEqual([false, true, false, true]);
  });

  it("records control object keyframes from readPacketData or the compression point", () => {
    const d = demo([
      { type: BlockTypePacket, parsed: packet([], { compressionPoint: { x: 1, y: 2, z: 3 } }) },
      move,
      {
        type: BlockTypePacket,
        parsed: packet([], {
          controlObjectGhostIndex: 5,
          controlObjectData: { position: { x: 7, y: 8, z: 9 }, velocity: { x: 1, y: 0, z: 0 } },
        }),
      },
    ]);
    const t = buildTimeline(d, registry);
    expect(t.controlObject).toHaveLength(2);
    expect(t.controlObject[0]).toMatchObject({ time: 0, ghostIndex: -1, position: { x: 1, y: 2, z: 3 } });
    expect(t.controlObject[1]).toMatchObject({ time: MoveTickMs, ghostIndex: 5, velocity: { x: 1, y: 0, z: 0 } });

    const stats = getTimelineStats(t);
    expect(stats.controlObjectKeyframes).toBe(2);
    const exported = exportTimeline(t);
    expect(exported.controlObject.map((k) => k.t)).toEqual([0, MoveTickMs]);
    expect(exported.tickIntervalMs).toBe(MoveTickMs);
  });
});
