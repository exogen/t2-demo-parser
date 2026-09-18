import { describe, it, expect } from "vitest";
import * as zlib from "zlib";
import { BitWriter } from "./BitWriter.js";
import { DemoParser } from "./DemoParser.js";

/**
 * A from-connect initial block (no strings, datablocks, ghosts or control
 * object) laid out exactly as GameConnection::readDemoStartBlock
 * (FUN_005fb5c0) consumes it, with the ConnectionProtocol seed under test.
 */
function buildInitialBlock(seed: {
  lastSendSeq: number;
  highestAckedSeq: number;
  notifyCount: number;
  nextRecvEventSeq?: number;
  pendingSensorGroups?: number[];
}): Uint8Array {
  const bs = new BitWriter();
  for (let i = 0; i < 1024; i++) bs.writeFlag(false); // tagged strings
  bs.writeU32(0); // datablock count
  bs.writeFlag(false); // datablock loop terminator
  bs.writeU8(1); // firstPerson
  bs.writeU32(0); // cameraPos
  bs.writeU32(0x41200000); // cameraSpeed 10.0f
  bs.writeU32(0); // lastMoveAck
  bs.writeU32(0); // lastClientMove
  bs.writeU32(0); // firstMoveIndex
  bs.writeU32(0); // aux
  for (let i = 0; i < 16; i++) bs.writeU32(0); // state array
  bs.writeU32(0); // move list count
  bs.writeFlag(true);
  bs.writeString("Standard\t\t\t0\t0\t");
  bs.writeFlag(false); // DemoValues terminator
  for (let i = 0; i < 4; i++) bs.writeU8(0); // TargetManager header
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
  bs.writeU32(0xffffffff); // no control object
  bs.writeString("Katabatic");
  bs.writeU32(0); // mission CRC
  for (let i = 0; i < 2; i++) {
    bs.writeU8(0);
    for (let j = 0; j < 4; j++) bs.writeU32(0);
  }
  return bs.finish(1); // V12 writes size = position + 1
}

function buildDemoFile(
  initialBlock: Uint8Array,
  blocks = Buffer.alloc(0),
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
    // Only bit padding plus the trailing pad byte remains: the simple
    // TargetManagers are read at the current bit position, not
    // byte-aligned, so the remainder is 8..15 bits.
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
  const bytes = w.finish();
  const header = Buffer.alloc(2);
  header.writeUInt16LE(bytes.length);
  return Buffer.concat([header, bytes]);
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
