import createDebug from "debug";
import { ClassRegistry } from "./ClassRegistry.js";
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

const debug = createDebug("t2-demo-parser");

/**
 * A registry with every built-in parser cataloged and bound to its
 * deterministic classId (the sorted class-name tables in types.ts, derived
 * from the Tribes 2 build 25034 binary). Shared by DemoParser and
 * createLiveParser so both stacks resolve classes identically.
 */
export function createDefaultRegistry(): ClassRegistry {
  const registry = new ClassRegistry();
  registerEventParsers(registry);
  registerGhostParsers(registry);
  registerDataBlockParsers(registry);

  const bindings = [
    {
      kind: "DataBlock",
      result: registry.bindDeterministicDataBlocks(
        DataBlockClassNames,
        DataBlockClassFirst,
      ),
      total: DataBlockClassNames.length,
    },
    {
      kind: "Ghost",
      result: registry.bindDeterministicGhosts(
        NetObjectClassNames,
        NetObjectClassFirst,
      ),
      total: NetObjectClassNames.length,
    },
    {
      kind: "Event",
      result: registry.bindDeterministicEvents(
        NetEventClassNames,
        NetEventClassFirst,
      ),
      total: NetEventClassNames.length,
    },
  ];
  for (const { kind, result, total } of bindings) {
    if (result.missing.length > 0) {
      debug(
        "%s binding: %d/%d bound, missing parsers: %s",
        kind,
        result.bound,
        total,
        result.missing.join(", "),
      );
    }
  }
  return registry;
}
