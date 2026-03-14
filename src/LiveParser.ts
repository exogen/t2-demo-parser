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

export interface LiveParserKit {
  registry: ClassRegistry;
  ghostTracker: GhostTracker;
  packetParser: PacketParser;
}

/**
 * Create a parser stack for live server connections. Sets up the same
 * registry bindings as DemoParser but without requiring a demo file,
 * and includes a dataBlockDataMap for incremental datablock accumulation
 * via SimDataBlockEvent.
 */
export function createLiveParser(): LiveParserKit {
  const registry = new ClassRegistry();
  const ghostTracker = new GhostTracker();

  registerEventParsers(registry);
  registerGhostParsers(registry);
  registerDataBlockParsers(registry);

  registry.bindDeterministicDataBlocks(DataBlockClassNames, DataBlockClassFirst);
  registry.bindDeterministicGhosts(NetObjectClassNames, NetObjectClassFirst);
  registry.bindDeterministicEvents(NetEventClassNames, NetEventClassFirst);

  const dataBlockDataMap = new Map<number, Record<string, unknown>>();
  const packetParser = new PacketParser(registry, ghostTracker, {
    dataBlockDataMap,
  });

  return { registry, ghostTracker, packetParser };
}
