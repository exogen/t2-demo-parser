import { describe, it, expect } from "vitest";
import { PacketParser } from "./PacketParser.js";
import { GhostTracker } from "./GhostManager.js";
import { passiveObserverProtocolState } from "./LiveParser.js";
import type {
  ClassRegistry,
  ConnectionContext,
  GhostParserEntry,
} from "./ClassRegistry.js";
import type { BitStream } from "./BitStream.js";

/** LSB-first bit packer matching BitStream's read order. */
class BitWriter {
  private bytes: number[] = [];
  private bit = 0;

  write(value: number, bitCount: number): this {
    for (let i = 0; i < bitCount; i++) {
      const byteIndex = this.bit >> 3;
      this.bytes[byteIndex] ??= 0;
      this.bytes[byteIndex] |= ((value >>> i) & 1) << (this.bit & 7);
      this.bit++;
    }
    return this;
  }

  flag(value: boolean): this {
    return this.write(value ? 1 : 0, 1);
  }

  /** Pad to a byte boundary plus some slack so nothing reads past the end. */
  finish(): Uint8Array {
    this.write(0, 16);
    return Uint8Array.from(this.bytes);
  }
}

const PLAYER = 25;
const CAMERA = 4;
const BROKEN = 9;

/** Header, rate info, and the game state up to the control-object flag. */
function packetPrefix(): BitWriter {
  const w = new BitWriter();
  w.flag(true); // gameFlag
  w.write(0, 1); // connectSeqBit
  w.write(1, 9); // seqNumber
  w.write(0, 9); // highestAck
  w.write(0, 2); // DataPacket
  w.write(0, 3); // ackByteCount
  w.flag(false).flag(false); // rate info
  w.write(0, 32); // lastMoveAck
  w.flag(false); // damage flash / whiteout
  w.flag(false); // lock state
  w.flag(false); // seeker state
  w.flag(false).flag(false); // pinged, jammed
  return w;
}

/** Target visibility loop, fov, and an empty event section. */
function afterControlObject(w: BitWriter): BitWriter {
  w.flag(false); // target visibility
  w.flag(false); // fov
  w.flag(false).flag(false); // no unguaranteed, no guaranteed events
  return w;
}

function makeParser(entries: Record<number, GhostParserEntry>): {
  parser: PacketParser;
  tracker: GhostTracker;
} {
  const registry = {
    getGhostParser: (classId: number) => entries[classId],
    getGhostClassId: (name: string) =>
      name === "Player" ? PLAYER : name === "Camera" ? CAMERA : undefined,
    getEventParser: () => undefined,
    getDataBlockParser: () => undefined,
  } as unknown as ClassRegistry;
  const tracker = new GhostTracker();
  const parser = new PacketParser(registry, tracker, {
    connectionProtocolState: passiveObserverProtocolState(0x01),
  });
  return { parser, tracker };
}

function packetDataEntry(
  name: string,
  calls: string[],
  bits: number,
): GhostParserEntry {
  return {
    name,
    unpackUpdate: () => ({}),
    readPacketData: (bs: BitStream, _conn: ConnectionContext) => {
      calls.push(name);
      return { marker: bs.readInt(bits) };
    },
  };
}

describe("PacketParser control object", () => {
  it("reads the tracked ghost's class only, like GameConnection::readPacket", () => {
    const calls: string[] = [];
    const { parser, tracker } = makeParser({
      [PLAYER]: packetDataEntry("Player", calls, 8),
      [CAMERA]: packetDataEntry("Camera", calls, 8),
    });
    tracker.createGhost(5, CAMERA, "Camera");

    const w = packetPrefix();
    w.flag(true).flag(true); // control object present, dirty
    w.write(5, 10); // ghost index
    w.write(0xa5, 8); // Camera::readPacketData payload
    afterControlObject(w);
    w.flag(false); // no ghosts

    const parsed = parser.parsePacket(w.finish());
    expect(calls).toEqual(["Camera"]);
    expect(parsed.gameState.controlObjectGhostIndex).toBe(5);
    expect(parsed.gameState.controlObjectData).toEqual({ marker: 0xa5 });
    expect(parsed.parseFault).toBeUndefined();
  });

  it("faults on an untracked control object instead of guessing its class", () => {
    // GameConnection::readPacket resolves the ghost and calls its virtual
    // readPacketData with no fallback; an unknown index is a null
    // dereference in the engine.
    const calls: string[] = [];
    const { parser } = makeParser({
      [PLAYER]: packetDataEntry("Player", calls, 8),
      [CAMERA]: packetDataEntry("Camera", calls, 8),
    });

    const w = packetPrefix();
    w.flag(true).flag(true);
    w.write(7, 10);
    w.write(0x3c, 8);
    afterControlObject(w);
    w.flag(false);

    const parsed = parser.parsePacket(w.finish());
    expect(calls).toEqual([]);
    expect(parsed.gameState.controlObjectData).toBeUndefined();
    expect(parsed.gameState.controlObjectError).toMatch(/not tracked/);
    expect(parsed.parseFault?.stage).toBe("gameState");
  });

  it("reports a gameState fault when the tracked class cannot read packet data", () => {
    const { parser, tracker } = makeParser({
      [BROKEN]: { name: "Item", unpackUpdate: () => ({}) },
    });
    tracker.createGhost(5, BROKEN, "Item");

    const w = packetPrefix();
    w.flag(true).flag(true);
    w.write(5, 10);
    afterControlObject(w);

    const parsed = parser.parsePacket(w.finish());
    expect(parsed.parseFault?.stage).toBe("gameState");
    expect(parsed.events).toEqual([]);
    expect(parsed.ghosts).toEqual([]);
  });
});

describe("PacketParser parse faults", () => {
  it("flags a ghost whose parser threw and stops the ghost section", () => {
    const { parser, tracker } = makeParser({
      [BROKEN]: {
        name: "Broken",
        unpackUpdate: () => {
          throw new Error("bad ghost");
        },
      },
    });

    const w = packetPrefix();
    w.flag(false); // no control object
    afterControlObject(w);
    w.flag(true); // ghost section
    w.write(0, 3); // idSize 3
    w.flag(true); // more ghosts
    w.write(2, 3); // index
    w.flag(false); // not a delete
    w.write(BROKEN, 7); // new ghost class

    const parsed = parser.parsePacket(w.finish());
    expect(parsed.ghosts).toHaveLength(1);
    expect(parsed.ghosts[0]).toMatchObject({
      index: 2,
      type: "create",
      classId: BROKEN,
      failed: true,
    });
    expect(parsed.parseFault?.stage).toBe("ghost");
    expect(parser.ghostsFailed).toBe(1);
    // The create never registered — the tracker no longer mirrors the
    // server, which is exactly why consumers must re-sync.
    expect(tracker.hasGhost(2)).toBe(false);
  });

  it("flags a create for an unregistered class as tracker divergence", () => {
    const { parser } = makeParser({});

    const w = packetPrefix();
    w.flag(false);
    afterControlObject(w);
    w.flag(true);
    w.write(0, 3);
    w.flag(true);
    w.write(4, 3);
    w.flag(false);
    w.write(77, 7);

    const parsed = parser.parsePacket(w.finish());
    expect(parsed.ghosts[0]).toMatchObject({ index: 4, failed: true });
    expect(parsed.parseFault?.stage).toBe("ghost");
    expect(parser.ghostsTrackerDiverged).toBe(1);
  });

  it("leaves parseFault unset on a clean packet", () => {
    const { parser } = makeParser({});
    const w = packetPrefix();
    w.flag(false);
    afterControlObject(w);
    w.flag(false);
    const parsed = parser.parsePacket(w.finish());
    expect(parsed.parseFault).toBeUndefined();
  });
});
