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
}

/** Minimal interface for ghost tracker used by parsers. */
export interface GhostTrackerInterface {
  getGhost(index: number): GhostEntry | undefined;
}

export interface GhostEntry {
  classId: number;
  className: string;
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

interface Catalog<T extends { name: string }> {
  byName: Map<string, T>;
  byClassId: Map<number, T>;
  classIdByName: Map<string, number>;
}

function newCatalog<T extends { name: string }>(): Catalog<T> {
  return { byName: new Map(), byClassId: new Map(), classIdByName: new Map() };
}

/**
 * Bind every cataloged parser whose name appears in `classNames` to
 * classId = classFirst + index. Names without a parser are reported.
 */
function bindCatalog<T extends { name: string }>(
  catalog: Catalog<T>,
  classNames: readonly string[],
  classFirst: number,
): { bound: number; missing: string[] } {
  let bound = 0;
  const missing: string[] = [];
  for (let i = 0; i < classNames.length; i++) {
    const name = classNames[i];
    const entry = catalog.byName.get(name);
    if (entry) {
      catalog.byClassId.set(classFirst + i, entry);
      catalog.classIdByName.set(name, classFirst + i);
      bound++;
    } else {
      missing.push(name);
    }
  }
  return { bound, missing };
}

function bindingsOf<T extends { name: string }>(
  catalog: Catalog<T>,
): Map<number, string> {
  const bindings = new Map<number, string>();
  for (const [id, entry] of catalog.byClassId) {
    bindings.set(id, entry.name);
  }
  return bindings;
}

/**
 * Registry mapping classIds to parser functions.
 * ClassIds are assigned deterministically by alphabetical sort (C strcmp)
 * at engine link time. Parsers are cataloged by name and bound to classIds
 * via bindDeterministicGhosts/Events/DataBlocks.
 */
export class ClassRegistry {
  private events = newCatalog<EventParserEntry>();
  private ghosts = newCatalog<GhostParserEntry>();
  private dataBlocks = newCatalog<DataBlockParserEntry>();

  // --- Catalog registration (name → parser, no classId yet) ---
  //
  // Parsers return precisely typed objects (PlayerGhostData, ...), which
  // are stored behind the generic ParsedData shape. The generic signatures
  // let each parser keep its own return type — so a misspelled field is a
  // compile error inside the parser — while the registry erases it.

  catalogEvent<T extends EventData>(entry: {
    name: string;
    unpack: (bs: BitStream, conn: ConnectionContext) => T;
  }): void {
    this.events.byName.set(entry.name, entry);
  }

  catalogGhost<T extends object, P extends object = ParsedData>(entry: {
    name: string;
    unpackUpdate: (bs: BitStream, isInitial: boolean, conn: ConnectionContext) => T;
    readPacketData?: (bs: BitStream, conn: ConnectionContext) => P;
  }): void {
    this.ghosts.byName.set(entry.name, entry as unknown as GhostParserEntry);
  }

  catalogDataBlock<T extends object>(entry: {
    name: string;
    unpackData: (bs: BitStream) => T;
  }): void {
    this.dataBlocks.byName.set(
      entry.name,
      entry as unknown as DataBlockParserEntry,
    );
  }

  // --- Deterministic binding (classId = classFirst + index in the sorted
  //     class name list) ---

  bindDeterministicDataBlocks(
    classNames: readonly string[],
    classFirst: number,
  ): { bound: number; missing: string[] } {
    return bindCatalog(this.dataBlocks, classNames, classFirst);
  }

  bindDeterministicEvents(
    classNames: readonly string[],
    classFirst: number,
  ): { bound: number; missing: string[] } {
    return bindCatalog(this.events, classNames, classFirst);
  }

  bindDeterministicGhosts(
    classNames: readonly string[],
    classFirst: number,
  ): { bound: number; missing: string[] } {
    return bindCatalog(this.ghosts, classNames, classFirst);
  }

  // --- Lookup by classId ---

  getEventParser(classId: number): EventParserEntry | undefined {
    return this.events.byClassId.get(classId);
  }

  getGhostParser(classId: number): GhostParserEntry | undefined {
    return this.ghosts.byClassId.get(classId);
  }

  getDataBlockParser(classId: number): DataBlockParserEntry | undefined {
    return this.dataBlocks.byClassId.get(classId);
  }

  // --- Lookup by class name (bound classId) ---

  getEventClassId(name: string): number | undefined {
    return this.events.classIdByName.get(name);
  }

  getGhostClassId(name: string): number | undefined {
    return this.ghosts.classIdByName.get(name);
  }

  getDataBlockClassId(name: string): number | undefined {
    return this.dataBlocks.classIdByName.get(name);
  }

  // --- Catalog access (name → parser, independent of binding) ---

  getEventCatalog(): ReadonlyMap<string, EventParserEntry> {
    return this.events.byName;
  }

  getGhostCatalog(): ReadonlyMap<string, GhostParserEntry> {
    return this.ghosts.byName;
  }

  getDataBlockCatalog(): ReadonlyMap<string, DataBlockParserEntry> {
    return this.dataBlocks.byName;
  }

  // --- Debug: classId → parser name ---

  getEventBindings(): Map<number, string> {
    return bindingsOf(this.events);
  }

  getGhostBindings(): Map<number, string> {
    return bindingsOf(this.ghosts);
  }

  getDataBlockBindings(): Map<number, string> {
    return bindingsOf(this.dataBlocks);
  }
}
