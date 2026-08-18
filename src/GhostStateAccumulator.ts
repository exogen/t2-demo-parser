import createDebug from "debug";
import { GhostMsgEndGhosting } from "./types.js";
import type { GhostUpdate, PacketData } from "./types.js";
import type { ParsedData } from "./ClassRegistry.js";
import type { GhostAlwaysObjectEventData } from "./eventDataTypes.js";

const debug = createDebug("t2-demo-parser:ghost-state");

interface AccumulatedGhost {
  classId: number;
  parsedData: ParsedData;
}

function isIndexedEntryArray(value: unknown): value is Array<{
  index: number;
  [key: string]: unknown;
}> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { index?: unknown }).index === "number",
    )
  );
}

/**
 * Fold a sparse masked ghost update onto accumulated full state.
 *
 * Each masked wire section writes complete values for the fields it
 * covers, so scalars and plain objects are last-write-wins. Arrays whose
 * entries carry a numeric `index` (threads, images, sounds) are sparse:
 * an update only includes changed entries, so they merge by index with
 * entry replacement. (An images entry with `dataBlockId: 0` must replace
 * rather than delete — "slot cleared" is meaningful state.) Positionally
 * complete arrays (wheels) replace wholesale. Create-only fields survive
 * because the create's data is the merge base.
 */
export function mergeGhostParsedData(
  base: ParsedData,
  update: ParsedData,
): ParsedData {
  const merged: ParsedData = { ...base };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    const existing = merged[key];
    if (isIndexedEntryArray(value) && isIndexedEntryArray(existing)) {
      const byIndex = new Map<number, { index: number }>();
      for (const entry of existing) byIndex.set(entry.index, entry);
      for (const entry of value) byIndex.set(entry.index, entry);
      merged[key] = [...byIndex.values()].sort((a, b) => a.index - b.index);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Maintains one merged full ParsedData per live ghost by folding each
 * packet's creates/updates/deletes (plus GhostAlwaysObjectEvent creates
 * and EndGhosting clears). `toInitialGhosts()` then yields entries
 * shaped like a demo recording's InitialBlockData.initialGhosts — the
 * full-state ghost list a `.rec` starts with when recorded mid-match —
 * for hydrating a late joiner.
 */
export class GhostStateAccumulator {
  private ghosts = new Map<number, AccumulatedGhost>();

  applyPacket(parsed: PacketData): void {
    // Events apply before ghosts, matching packet layout (readEvents
    // runs before readGhosts and its side effects alter ghost state).
    for (const event of parsed.events) {
      const data = event.parsedData;
      if (!data) continue;
      if (
        data.type === "GhostingMessageEvent" &&
        data.message === GhostMsgEndGhosting
      ) {
        this.clear();
      } else if (data.type === "GhostAlwaysObjectEvent") {
        const ghostAlways = data as GhostAlwaysObjectEventData;
        if (typeof ghostAlways.classId === "number" && ghostAlways.objectData) {
          this.ghosts.set(ghostAlways.ghostIndex, {
            classId: ghostAlways.classId,
            parsedData: structuredClone(ghostAlways.objectData),
          });
        }
      }
    }

    for (const ghost of parsed.ghosts) {
      if (ghost.type === "delete") {
        this.ghosts.delete(ghost.index);
        continue;
      }
      if (!ghost.parsedData) continue;
      if (ghost.type === "create" && typeof ghost.classId === "number") {
        this.ghosts.set(ghost.index, {
          classId: ghost.classId,
          parsedData: structuredClone(ghost.parsedData),
        });
      } else if (ghost.type === "update") {
        const existing = this.ghosts.get(ghost.index);
        if (!existing) {
          // Divergence signal: an update for a ghost we never saw created.
          debug("update for unknown ghost index %d", ghost.index);
          continue;
        }
        existing.parsedData = mergeGhostParsedData(
          existing.parsedData,
          structuredClone(ghost.parsedData),
        );
      }
    }
  }

  clear(): void {
    this.ghosts.clear();
  }

  size(): number {
    return this.ghosts.size;
  }

  /** Seed entries for `createLiveParser({ ghosts })`. */
  getGhostSeeds(): Array<{ index: number; classId: number }> {
    return [...this.ghosts.entries()].map(([index, ghost]) => ({
      index,
      classId: ghost.classId,
    }));
  }

  toInitialGhosts(): GhostUpdate[] {
    return [...this.ghosts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, ghost]) => ({
        index,
        type: "create" as const,
        classId: ghost.classId,
        updateBitsStart: 0,
        updateBitsEnd: 0,
        parsedData: structuredClone(ghost.parsedData),
      }));
  }
}
