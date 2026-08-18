import { ClassRegistry } from "./ClassRegistry.js";
import { GhostTracker } from "./GhostManager.js";
import { PacketParser } from "./PacketParser.js";
import { registerEventParsers } from "./EventParsers.js";
import { registerGhostParsers } from "./GhostManager.js";
import { registerDataBlockParsers } from "./DataBlockParsers.js";
import {
  DataBlockClassFirst,
  DataBlockClassNames,
  NetObjectClassFirst,
  NetObjectClassNames,
  NetEventClassFirst,
  NetEventClassNames,
} from "./types.js";
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
  const registry = new ClassRegistry();
  const ghostTracker = new GhostTracker();

  registerEventParsers(registry);
  registerGhostParsers(registry);
  registerDataBlockParsers(registry);

  registry.bindDeterministicDataBlocks(
    DataBlockClassNames,
    DataBlockClassFirst,
  );
  registry.bindDeterministicGhosts(NetObjectClassNames, NetObjectClassFirst);
  registry.bindDeterministicEvents(NetEventClassNames, NetEventClassFirst);

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
  });

  return { registry, ghostTracker, packetParser };
}
