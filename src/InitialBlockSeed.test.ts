import { describe, it, expect } from "vitest";
import * as zlib from "zlib";
import { BitWriter } from "./BitWriter.js";
import { DemoParser } from "./DemoParser.js";
import { BlockTypeInfo, BlockTypePacket } from "./types.js";
import type { ProcessListState } from "./types.js";

const FRESH_PROCESS_LIST: ProcessListState = {
  dirty: false,
  currentTag: 0,
  lastTick: 0,
  lastTime: 0,
  lastDelta: 0,
};

/**
 * A from-connect initial block (no strings, datablocks, ghosts or control
 * object) laid out exactly as GameConnection::readDemoStartBlock
 * (FUN_005fb5c0) consumes it, with the ConnectionProtocol seed under test.
 * Unset fields take a fresh connection's values.
 */
function buildInitialBlock(seed: {
  lastSendSeq: number;
  highestAckedSeq: number;
  notifyCount: number;
  nextRecvEventSeq?: number;
  pendingSensorGroups?: number[];
  cameraPos?: number;
  lastMoveAck?: number;
  lastClientMove?: number;
  firstMoveIndex?: number;
  sensorGroup?: number;
  targetVisibleMask?: number[];
  defaultIffColor?: number[];
  controlObjectGhostIndex?: number;
  missionName?: string;
  missionCRC?: number;
  processLists?: ProcessListState[];
}): Uint8Array {
  const bs = new BitWriter();
  for (let i = 0; i < 1024; i++) bs.writeFlag(false); // tagged strings
  bs.writeU32(0); // datablock count
  bs.writeFlag(false); // datablock loop terminator
  bs.writeU8(1); // firstPerson
  bs.writeF32(seed.cameraPos ?? 0);
  bs.writeF32(10); // cameraSpeed
  bs.writeU32(seed.lastMoveAck ?? 0);
  bs.writeU32(seed.lastClientMove ?? 0);
  bs.writeU32(seed.firstMoveIndex ?? 0);
  bs.writeU32(seed.sensorGroup ?? 0);
  for (let i = 0; i < 16; i++) bs.writeU32(seed.targetVisibleMask?.[i] ?? 0);
  bs.writeU32(0); // move list count
  bs.writeFlag(true);
  bs.writeString("Standard\t\t\t0\t0\t");
  bs.writeFlag(false); // DemoValues terminator
  bs.writeBytes(seed.defaultIffColor ?? [255, 0, 0, 255]);
  for (let i = 0; i < 32 * 32; i++) bs.writeFlag(false);
  for (let i = 0; i < 512; i++) bs.writeFlag(false);
  for (let i = 0; i < 32; i++) bs.writeU32(0); // lastSeqRecvdAtSend
  bs.writeU32(0); // lastSeqRecvd
  bs.writeU32(seed.highestAckedSeq);
  bs.writeU32(seed.lastSendSeq);
  bs.writeU32(0); // ackMask
  bs.writeU32(1); // connectSequence
  bs.writeU32(0); // lastRecvAckAck
  bs.writeU8(1); // connectionEstablished
  bs.writeU32(0); // rtt
  bs.writeU32(0); // loss
  bs.writeU32(0); // PathManager count
  bs.writeU32(seed.notifyCount);
  bs.writeU32(seed.nextRecvEventSeq ?? 0);
  for (const sensorGroup of seed.pendingSensorGroups ?? []) {
    bs.writeFlag(true).writeInt(15, 6).writeInt(sensorGroup, 5);
  }
  bs.writeFlag(false);
  bs.writeU32(0); // ghosting sequence
  bs.writeFlag(false);
  bs.writeS32(seed.controlObjectGhostIndex ?? -1);
  bs.writeString(seed.missionName ?? "Katabatic");
  bs.writeU32(seed.missionCRC ?? 0xffffffff);
  // Client then server ProcessList state.
  for (const list of seed.processLists ?? [
    FRESH_PROCESS_LIST,
    FRESH_PROCESS_LIST,
  ]) {
    bs.writeU8(list.dirty ? 1 : 0);
    bs.writeU32(list.currentTag);
    bs.writeU32(list.lastTick);
    bs.writeU32(list.lastTime);
    bs.writeU32(list.lastDelta);
  }
  return bs.finish(1); // V12 writes size = position + 1
}

/**
 * A framed demo block: U16 LE (type << 12 | size), then the payload.
 */
function demoBlock(type: number, payload: Uint8Array): Buffer {
  const header = Buffer.alloc(2);
  header.writeUInt16LE((type << 12) | payload.length);
  return Buffer.concat([header, payload]);
}

function buildDemoFile(
  initialBlock: Uint8Array,
  blocks: Buffer = Buffer.alloc(0),
): Buffer {
  const ident = "Tribes2 Recording";
  const header = Buffer.alloc(1 + ident.length + 12);
  header[0] = ident.length;
  header.write(ident, 1, "latin1");
  header.writeUInt32LE(0x00330004, 1 + ident.length);
  header.writeUInt32LE(0, 1 + ident.length + 4);
  header.writeUInt32LE(initialBlock.length, 1 + ident.length + 8);
  return Buffer.concat([
    header,
    Buffer.from(initialBlock),
    zlib.deflateRawSync(blocks),
  ]);
}

describe("initial block engine-invariant warnings", () => {
  it("accepts a fresh-connection seed without warnings", async () => {
    const parser = new DemoParser(
      buildDemoFile(
        buildInitialBlock({
          lastSendSeq: 0,
          highestAckedSeq: 0,
          notifyCount: 0,
        }),
      ),
    );
    const { initialBlock } = await parser.load();
    expect(initialBlock.missionName).toBe("Katabatic");
    expect(initialBlock.controlObjectGhostIndex).toBe(-1);
    expect(initialBlock.warnings).toEqual([]);
    // Only bit padding plus the trailing pad byte remains: the ProcessList
    // states are read at the current bit position, not byte-aligned, so
    // the remainder is 8..15 bits.
    expect(initialBlock.phase2TrailingBits).toBeGreaterThanOrEqual(8);
    expect(initialBlock.phase2TrailingBits).toBeLessThan(16);
  });

  it("accepts in-flight packets when the notify count matches", async () => {
    const parser = new DemoParser(
      buildDemoFile(
        buildInitialBlock({
          lastSendSeq: 20335,
          highestAckedSeq: 20332,
          notifyCount: 3,
        }),
      ),
    );
    const { initialBlock } = await parser.load();
    expect(initialBlock.warnings).toEqual([]);
  });

  it("warns when the notify count cannot match the in-flight window", async () => {
    const parser = new DemoParser(
      buildDemoFile(
        buildInitialBlock({
          lastSendSeq: 0x1fffffff,
          highestAckedSeq: 0,
          notifyCount: 0,
        }),
      ),
    );
    const { initialBlock } = await parser.load();
    expect(initialBlock.warnings).toHaveLength(1);
    expect(initialBlock.warnings[0]).toMatch(/notify count 0 does not match/);
    expect(initialBlock.warnings[0]).toMatch(/536870911/);
  });
});

describe("named initial block fields", () => {
  const fresh = { lastSendSeq: 0, highestAckedSeq: 0, notifyCount: 0 };

  async function loadInitialBlock(
    seed: Parameters<typeof buildInitialBlock>[0],
  ) {
    const parser = new DemoParser(buildDemoFile(buildInitialBlock(seed)));
    return (await parser.load()).initialBlock;
  }

  it("names the six connection fields and keeps their raw values", async () => {
    const initialBlock = await loadInitialBlock({
      ...fresh,
      cameraPos: 1,
      lastMoveAck: 41,
      lastClientMove: 42,
      firstMoveIndex: 40,
      sensorGroup: 2,
    });
    expect(initialBlock).toMatchObject({
      cameraPos: 1,
      cameraSpeed: 10,
      lastMoveAck: 41,
      lastClientMove: 42,
      firstMoveIndex: 40,
      sensorGroup: 2,
    });
    expect(initialBlock.connectionFields).toEqual([
      0x3f800000, 0x41200000, 41, 42, 40, 2,
    ]);
  });

  it("reads mTargetVisibleMask, also exposed as the deprecated stateArray", async () => {
    const mask = Array.from({ length: 16 }, (_, i) =>
      i === 3 ? 0x80000001 : 0,
    );
    const initialBlock = await loadInitialBlock({
      ...fresh,
      targetVisibleMask: mask,
    });
    expect(initialBlock.targetVisibleMask).toEqual(mask);
    expect(initialBlock.stateArray).toEqual(mask);
  });

  it("reads the TargetManager's default IFF color in RGBA order", async () => {
    expect((await loadInitialBlock(fresh)).defaultIffColor).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
    const initialBlock = await loadInitialBlock({
      ...fresh,
      defaultIffColor: [1, 2, 3, 4],
    });
    expect(initialBlock.defaultIffColor).toEqual({ r: 1, g: 2, b: 3, a: 4 });
    expect(initialBlock.sensorGroupColors).toEqual([]);
  });

  it("reads a fresh connection's mission CRC as unsigned", async () => {
    expect((await loadInitialBlock(fresh)).missionCRC).toBe(0xffffffff);
  });

  it("reads the client, then the server ProcessList state, unaligned", async () => {
    // exogen_Harvester.rec's clocks.
    const client: ProcessListState = {
      dirty: true,
      currentTag: 37917,
      lastTick: 9869024,
      lastTime: 9869004,
      lastDelta: 20,
    };
    const server: ProcessListState = {
      dirty: false,
      currentTag: 0,
      lastTick: 9868992,
      lastTime: 9869004,
      lastDelta: 0,
    };
    const initialBlock = await loadInitialBlock({
      ...fresh,
      processLists: [client, server],
    });
    expect(initialBlock.clientProcessList).toEqual(client);
    expect(initialBlock.serverProcessList).toEqual(server);
    expect(initialBlock.phase2Valid).toBe(true);
    expect(initialBlock.phase2TrailingBits).toBeGreaterThanOrEqual(8);
    expect(initialBlock.phase2TrailingBits).toBeLessThan(16);
  });

  it("omits the ProcessList state when phase 2 stops before it", async () => {
    const initialBlock = await loadInitialBlock({
      ...fresh,
      controlObjectGhostIndex: 5,
    });
    expect(initialBlock.phase2Error).toMatch(/control object ghost 5/);
    expect(initialBlock.clientProcessList).toBeUndefined();
    expect(initialBlock.serverProcessList).toBeUndefined();
  });

  it("keeps the ProcessList state of an invalid block that reads to the end", async () => {
    const initialBlock = await loadInitialBlock({ ...fresh, missionName: "" });
    expect(initialBlock.phase2Valid).toBe(false);
    expect(initialBlock.phase2Error).toBeUndefined();
    expect(initialBlock.clientProcessList).toEqual(FRESH_PROCESS_LIST);
    expect(initialBlock.serverProcessList).toEqual(FRESH_PROCESS_LIST);
  });
});

describe("info blocks", () => {
  it("read $firstPerson from byte 0 alone, then the camera FOV", async () => {
    const info = (head: number[], fov: number) => {
      const payload = Buffer.alloc(8);
      payload.set(head);
      payload.writeFloatLE(fov, 4);
      return demoBlock(BlockTypeInfo, payload);
    };
    // Real recordings leave bytes 1-3 as uninitialized stack.
    const parser = new DemoParser(
      buildDemoFile(
        buildInitialBlock({
          lastSendSeq: 0,
          highestAckedSeq: 0,
          notifyCount: 0,
        }),
        Buffer.concat([info([1, 255, 148, 88], 90), info([0, 32, 62, 6], 120)]),
      ),
    );
    await parser.load();
    expect(parser.nextBlock()?.parsed).toEqual({
      firstPerson: true,
      cameraFov: 90,
    });
    expect(parser.nextBlock()?.parsed).toEqual({
      firstPerson: false,
      cameraFov: 120,
    });
  });
});

/** One ordered sensor-group event, followed by empty ghosts. */
function sensorGroupPacket(sequence: number, group: number): Buffer {
  const w = new BitWriter();
  w.writeFlag(true).writeInt(1, 1).writeInt(1, 9).writeInt(0, 9);
  w.writeInt(0, 2).writeInt(0, 3); // data packet, no ack bytes
  w.writeFlag(false).writeFlag(false); // rate info
  w.writeU32(0); // lastMoveAck
  for (let i = 0; i < 8; i++) w.writeFlag(false); // game state, no control
  w.writeFlag(false); // unguaranteed events end
  w.writeFlag(true)
    .writeFlag(false)
    .writeInt(sequence & 127, 7);
  w.writeInt(15, 6).writeInt(group, 5);
  w.writeFlag(false).writeFlag(false); // ordered events end, no ghosts
  return demoBlock(BlockTypePacket, w.finish());
}

describe("saved ordered event queue", () => {
  it.each([0, 127, 11284])(
    "delivers the saved prefix before the first new event (sequence %i)",
    async (next) => {
      const parser = new DemoParser(
        buildDemoFile(
          buildInitialBlock({
            lastSendSeq: 0,
            highestAckedSeq: 0,
            notifyCount: 0,
            nextRecvEventSeq: next,
            pendingSensorGroups: [2, 3],
          }),
          sensorGroupPacket(next + 2, 4),
        ),
      );
      await parser.load();
      const checkpoint = parser.createCheckpoint();
      for (let i = 0; i < 3; i++) {
        const block = parser.nextBlock()!;
        const packet = block.parsed as import("./types.js").PacketData;
        expect(block.parseError).toBeUndefined();
        expect(packet.parseFault).toBeUndefined();
        expect(packet.events.map((e) => e.parsedData?.sensorGroup)).toEqual([
          2, 3, 4,
        ]);
        expect(parser.getPacketParser().getNextRecvEventSeq()).toBe(next + 3);
        expect(parser.getPacketParser().getPendingGuaranteedEvents()).toEqual(
          [],
        );
        if (i === 0) parser.reset();
        else parser.restoreCheckpoint(checkpoint);
      }
    },
  );
});

describe("demo wire protocol override", () => {
  it.each([undefined, null, 51, 52])(
    "preserves protocol %s through load, reset and seeking",
    async (packetProtocolVersion) => {
      const parser = new DemoParser(
        buildDemoFile(
          buildInitialBlock({
            lastSendSeq: 0,
            highestAckedSeq: 0,
            notifyCount: 0,
          }),
        ),
        { packetProtocolVersion },
      );
      expect(parser.getPacketParser().getProtocolVersion()).toBe(
        packetProtocolVersion ?? null,
      );
      await parser.load();
      expect(parser.header.protocolVersion).toBe(0x330004);
      expect(parser.getPacketParser().getProtocolVersion()).toBe(
        packetProtocolVersion ?? null,
      );
      const checkpoint = parser.createCheckpoint();
      parser.reset();
      expect(parser.getPacketParser().getProtocolVersion()).toBe(
        packetProtocolVersion ?? null,
      );
      parser.restoreCheckpoint(checkpoint);
      expect(parser.getPacketParser().getProtocolVersion()).toBe(
        packetProtocolVersion ?? null,
      );
    },
  );
});
