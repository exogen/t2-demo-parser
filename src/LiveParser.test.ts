import { describe, it, expect } from "vitest";
import { BitWriter } from "./BitWriter.js";
import {
  createLiveParser,
  passiveObserverProtocolState,
  freshConnectionProtocolState,
} from "./LiveParser.js";

/** A data packet with the given sequence number and no payload. */
function emptyPacket(seq: number, connectSeqBit = 0): Uint8Array {
  const w = new BitWriter();
  w.writeFlag(true); // gameFlag
  w.writeInt(connectSeqBit, 1);
  w.writeInt(seq, 9);
  w.writeInt(0, 9); // highestAck
  w.writeInt(0, 2); // DataPacket
  w.writeInt(0, 3); // ackByteCount
  w.writeFlag(false).writeFlag(false); // rate info
  w.writeU32(0); // lastMoveAck
  w.writeFlag(false); // damage flash
  w.writeFlag(false); // lock state
  w.writeFlag(false); // seeker
  w.writeFlag(false).writeFlag(false); // pinged, jammed
  w.writeFlag(false); // control object
  w.writeFlag(false); // target visibility
  w.writeFlag(false); // fov
  w.writeFlag(false).writeFlag(false); // no events
  w.writeFlag(false); // no ghosts
  return w.finish(2);
}

describe("passiveObserverProtocolState", () => {
  it("takes the connect-sequence bit from the first packet byte", () => {
    expect(passiveObserverProtocolState(0b10).connectSequence).toBe(1);
    expect(passiveObserverProtocolState(0b01).connectSequence).toBe(0);
    expect(passiveObserverProtocolState(0b10).lastSendSeq).toBe(0x1fffffff);
  });

  it("lets a fresh parser accept the opening packets of a connection", () => {
    const { packetParser } = createLiveParser();
    const first = emptyPacket(1, 1);
    packetParser.setConnectionProtocolState(
      passiveObserverProtocolState(first[0]),
    );
    packetParser.parsePacket(first);
    packetParser.parsePacket(emptyPacket(2, 1));
    expect(packetParser.packetsParsed).toBe(2);
    expect(packetParser.protocolRejected).toBe(0);
    expect(packetParser.protocolNoDispatch).toBe(0);
    expect(packetParser.faulted).toBe(false);
  });

  it("rejects packets whose connect-sequence bit does not match", () => {
    const { packetParser } = createLiveParser({
      connectionProtocolState: passiveObserverProtocolState(0b00),
    });
    packetParser.parsePacket(emptyPacket(1, 1));
    expect(packetParser.protocolRejected).toBe(1);
  });
});

describe("freshConnectionProtocolState", () => {
  it("is all zero apart from the connect sequence", () => {
    const state = freshConnectionProtocolState(773615057);
    expect(state.lastSendSeq).toBe(0);
    expect(state.highestAckedSeq).toBe(0);
    expect(state.lastSeqRecvd).toBe(0);
    expect(state.connectSequence).toBe(773615057);
    expect(state.connectionEstablished).toBe(true);
    expect(state.lastSeqRecvdAtSend).toEqual(new Array(32).fill(0));
  });
});

describe("createLiveParser seeding", () => {
  it("seeds ghosts and datablocks and shares one registry", () => {
    const kit = createLiveParser({
      ghosts: [{ index: 3, classId: 25 }],
      dataBlocks: [[17, { shapeName: "light_male.dts" }]],
    });
    expect(kit.ghostTracker.getGhost(3)?.className).toBe("Player");
    expect(kit.packetParser.getDataBlockDataMap()?.get(17)).toEqual({
      shapeName: "light_male.dts",
    });
    expect(kit.registry.getGhostClassId("Player")).toBe(25);
  });
});
