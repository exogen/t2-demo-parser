import type { BitStream } from "./BitStream.js";
import type { EventData } from "./eventDataTypes.js";

/**
 * Base type for all parsed data objects. Individual parsers return more
 * specific interfaces, but the registry stores them generically.
 */
export type ParsedData = { [key: string]: unknown };

// --- Parser function signatures ---

export type EventParser = (
  bs: BitStream,
  conn: ConnectionContext
) => EventData;

export type GhostUpdateParser = (
  bs: BitStream,
  isInitial: boolean,
  conn: ConnectionContext
) => ParsedData;

export type GhostPacketDataParser = (
  bs: BitStream,
  conn: ConnectionContext
) => ParsedData;

export type DataBlockParser = (
  bs: BitStream
) => ParsedData;

/** Shared context passed to parsers from the connection state. */
export interface ConnectionContext {
  compressionPoint: { x: number; y: number; z: number };
  ghostTracker: GhostTrackerInterface;
  getDataBlockParser?: (classId: number) => DataBlockParserEntry | undefined;
  getDataBlockData?: (objectId: number) => ParsedData | undefined;
  getGhostParser?: (classId: number) => GhostParserEntry | undefined;
  /** Ghost index of the ghost currently being parsed (set per-ghost in readGhosts). */
  currentGhostIndex?: number;
}

/** Minimal interface for ghost tracker used by parsers. */
export interface GhostTrackerInterface {
  getGhost(index: number): GhostEntry | undefined;
}

export interface GhostEntry {
  classId: number;
  className: string;
  state: ParsedData;
}

export interface GhostParserEntry {
  name: string;
  unpackUpdate: GhostUpdateParser;
  readPacketData?: GhostPacketDataParser;
}

export interface EventParserEntry {
  name: string;
  unpack: EventParser;
}

export interface DataBlockParserEntry {
  name: string;
  unpackData: DataBlockParser;
}

/**
 * Registry mapping classIds to parser functions.
 * ClassIds are assigned deterministically by alphabetical sort (C strcmp)
 * at engine link time. Parsers are cataloged by name and bound to classIds
 * via bindDeterministicGhosts/Events/DataBlocks.
 */
export class ClassRegistry {
  private eventParsers = new Map<number, EventParserEntry>();
  private ghostParsers = new Map<number, GhostParserEntry>();
  private dataBlockParsers = new Map<number, DataBlockParserEntry>();

  // Named parser catalog (classId-independent)
  private eventCatalog = new Map<string, EventParserEntry>();
  private ghostCatalog = new Map<string, GhostParserEntry>();
  private dataBlockCatalog = new Map<string, DataBlockParserEntry>();

  // --- Catalog registration (name → parser, no classId yet) ---

  catalogEvent(entry: EventParserEntry): void {
    this.eventCatalog.set(entry.name, entry);
  }

  catalogGhost(entry: GhostParserEntry): void {
    this.ghostCatalog.set(entry.name, entry);
  }

  catalogDataBlock(entry: DataBlockParserEntry): void {
    this.dataBlockCatalog.set(entry.name, entry);
  }

  /**
   * Bind all DataBlock parsers deterministically using the known class name
   * mapping. For each class name in the sorted list, if we have a parser
   * in the catalog, bind it to classId = DataBlockClassFirst + index.
   */
  bindDeterministicDataBlocks(
    classNames: readonly string[],
    classFirst: number
  ): { bound: number; missing: string[] } {
    let bound = 0;
    const missing: string[] = [];
    for (let i = 0; i < classNames.length; i++) {
      const name = classNames[i];
      const entry = this.dataBlockCatalog.get(name);
      if (entry) {
        this.dataBlockParsers.set(classFirst + i, entry);
        bound++;
      } else {
        missing.push(name);
      }
    }
    return { bound, missing };
  }

  /**
   * Bind all event (NetEvent) parsers deterministically using the known
   * class name mapping. For each class name in the sorted list, if we have
   * a parser in the catalog, bind it to classId = classFirst + index.
   */
  bindDeterministicEvents(
    classNames: readonly string[],
    classFirst: number
  ): { bound: number; missing: string[] } {
    let bound = 0;
    const missing: string[] = [];
    for (let i = 0; i < classNames.length; i++) {
      const name = classNames[i];
      const entry = this.eventCatalog.get(name);
      if (entry) {
        this.eventParsers.set(classFirst + i, entry);
        bound++;
      } else {
        missing.push(name);
      }
    }
    return { bound, missing };
  }

  /**
   * Bind all ghost (NetObject) parsers deterministically using the known
   * class name mapping. For each class name in the sorted list, if we have
   * a parser in the catalog, bind it to classId = classFirst + index.
   */
  bindDeterministicGhosts(
    classNames: readonly string[],
    classFirst: number
  ): { bound: number; missing: string[] } {
    let bound = 0;
    const missing: string[] = [];
    for (let i = 0; i < classNames.length; i++) {
      const name = classNames[i];
      const entry = this.ghostCatalog.get(name);
      if (entry) {
        this.ghostParsers.set(classFirst + i, entry);
        bound++;
      } else {
        missing.push(name);
      }
    }
    return { bound, missing };
  }

  // --- Lookup ---

  getEventParser(classId: number): EventParserEntry | undefined {
    return this.eventParsers.get(classId);
  }

  getGhostParser(classId: number): GhostParserEntry | undefined {
    return this.ghostParsers.get(classId);
  }

  getDataBlockParser(classId: number): DataBlockParserEntry | undefined {
    return this.dataBlockParsers.get(classId);
  }

  // --- Catalog access ---

  getGhostCatalog(): Map<string, GhostParserEntry> {
    return this.ghostCatalog;
  }

  // --- Debug ---

  getEventBindings(): Map<number, string> {
    const bindings = new Map<number, string>();
    for (const [id, entry] of this.eventParsers) {
      bindings.set(id, entry.name);
    }
    return bindings;
  }

  getGhostBindings(): Map<number, string> {
    const bindings = new Map<number, string>();
    for (const [id, entry] of this.ghostParsers) {
      bindings.set(id, entry.name);
    }
    return bindings;
  }
}
