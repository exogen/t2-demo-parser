import type { ClassRegistry } from "./ClassRegistry.js";
import { createDefaultRegistry } from "./defaultRegistry.js";
import { GhostTracker } from "./GhostManager.js";
import { PacketParser } from "./PacketParser.js";
import type { ConnectionProtocolState, NetEventInfo } from "./types.js";
import type { ParsedData } from "./ClassRegistry.js";

export interface LiveParserKit {
  registry: ClassRegistry;
  ghostTracker: GhostTracker;
  packetParser: PacketParser;
}

export interface LiveParserSeed {
  /** objectId → parsed datablock data, copied into the parser's map. */
  dataBlocks?: Iterable<[number, ParsedData]>;
  /** Existing ghosts, so mid-stream updates aren't misread as creates. */
  ghosts?: Iterable<{ index: number; classId: number }>;
  connectionProtocolState?: ConnectionProtocolState;
  nextRecvEventSeq?: number;
  compressionPoint?: { x: number; y: number; z: number };
  pendingGuaranteedEvents?: Array<{
    absoluteSequenceNumber: number;
    event: NetEventInfo;
  }>;
  /** Passed to PacketParser; see its `haltOnFault` option (default true). */
  haltOnFault?: boolean;
}

/**
 * Protocol state for a parser that passively observes the server→client
 * stream while something else (e.g. a relay) owns the client→server side.
 * `lastSendSeq` is set very high so ack validation (lastSendSeq <
 * highestAck → reject) never fires when the server acks sequences the
 * observer didn't send. The connect-sequence bit is taken from the first
 * observed packet's header byte. Intended for the first packets of a
 * connection: `lastSeqRecvd` starts at 0, so the 9-bit sequence window
 * check rejects packets attached mid-stream (seed
 * `connectionProtocolState` from the exporter in that case).
 *
 * This is parser-only state. Never write it into a .rec initial block:
 * Tribes2.exe requires `notifyCount === lastSendSeq - highestAckedSeq`
 * and treats `lastSendSeq - highestAckedSeq > 0x1d` as a full send window
 * (no notify is queued for a SendPacket marker), so a demo seeded with
 * this value crashes on the first acknowledged packet. Use
 * `freshConnectionProtocolState` for a recording that starts at connect
 * time.
 */
export function passiveObserverProtocolState(
  firstPacketByte: number,
): ConnectionProtocolState {
  return {
    lastSeqRecvdAtSend: new Array(32).fill(0),
    lastSeqRecvd: 0,
    highestAckedSeq: 0,
    lastSendSeq: 0x1fffffff,
    ackMask: 0,
    connectSequence: (firstPacketByte >> 1) & 1,
    lastRecvAckAck: 0,
    connectionEstablished: true,
  };
}

/**
 * The ConnectionProtocol state of a connection that has not yet exchanged
 * a sequenced packet — what a demo whose stream starts at connect time
 * must seed (with a notify count of 0, since nothing is in flight). The
 * recorder must then write one SendPacket marker per packet it actually
 * sends, before the received packet that acks it; Tribes2.exe replays
 * those markers through checkPacketSend to rebuild the notify queue.
 */
export function freshConnectionProtocolState(
  connectSequence: number,
): ConnectionProtocolState {
  return {
    lastSeqRecvdAtSend: new Array(32).fill(0),
    lastSeqRecvd: 0,
    highestAckedSeq: 0,
    lastSendSeq: 0,
    ackMask: 0,
    connectSequence: connectSequence >>> 0,
    lastRecvAckAck: 0,
    connectionEstablished: true,
  };
}

/**
 * Create a parser stack for live server connections. Sets up the same
 * registry bindings as DemoParser but without requiring a demo file,
 * and includes a dataBlockDataMap for incremental datablock accumulation
 * via SimDataBlockEvent.
 *
 * With a seed, the stack resumes an in-progress stream from exported
 * state (mirroring DemoParser.setupPacketParser), so a late joiner can
 * continue parsing at a packet boundary in lockstep with the exporter.
 */
export function createLiveParser(seed?: LiveParserSeed): LiveParserKit {
  const registry = createDefaultRegistry();
  const ghostTracker = new GhostTracker();

  const dataBlockDataMap = new Map<number, ParsedData>();
  if (seed?.dataBlocks) {
    for (const [objectId, data] of seed.dataBlocks) {
      dataBlockDataMap.set(objectId, data);
    }
  }

  if (seed?.ghosts) {
    for (const ghost of seed.ghosts) {
      const parserEntry = registry.getGhostParser(ghost.classId);
      ghostTracker.createGhost(
        ghost.index,
        ghost.classId,
        parserEntry?.name ?? `unknown_${ghost.classId}`,
      );
    }
  }

  const packetParser = new PacketParser(registry, ghostTracker, {
    dataBlockDataMap,
    connectionProtocolState: seed?.connectionProtocolState,
    nextRecvEventSeq: seed?.nextRecvEventSeq,
    compressionPoint: seed?.compressionPoint,
    pendingGuaranteedEvents: seed?.pendingGuaranteedEvents,
    haltOnFault: seed?.haltOnFault,
  });

  return { registry, ghostTracker, packetParser };
}
