import { inflate, Inflate } from "fflate";
import createDebug from "debug";
import { BitStream } from "./BitStream.js";
import { PacketParser } from "./PacketParser.js";
import type { ClassRegistry, GhostParserEntry } from "./ClassRegistry.js";
import { createDefaultRegistry } from "./defaultRegistry.js";
import { GhostTracker } from "./GhostManager.js";
import {
  BlockTypePacket,
  BlockTypeSendPacket,
  BlockTypeMove,
  BlockTypeInfo,
  DemoIdentString,
  DemoProtocolVersion,
  MaxTriggerKeys,
  NetEventClassBitSize,
  NetEventClassFirst,
  NetObjectClassBitSize,
  NetObjectClassFirst,
  GhostIdBitSize,
  DataBlockClassFirst,
  DataBlockClassNames,
  SimDBEventObjectIdBits,
  SimDBEventClassIdBits,
  SimDBEventIndexBits,
  SimDBEventTotalBits,
} from "./types.js";
import type {
  DemoHeader,
  DemoFile,
  DemoBlock,
  InitialBlockData,
  ConnectionProtocolState,
  DataBlockHeader,
  ParsedDataBlock,
  PathManagerEntry,
  ScoreEntry,
  TargetEntry,
  Move,
  InfoBlock,
  GhostUpdate,
  NetEventInfo,
  LoadResult,
} from "./types.js";

const debug = createDebug("t2-demo-parser");
/**
 * Sequence numbers assigned to ordered events carried in the demo start
 * block: past every 32-bit sequence, so they stay queued without ever
 * matching `nextRecvEventSeq` (see setupPacketParser).
 */
const START_BLOCK_EVENT_SEQ_BASE = 0x1_0000_0000;

const debugInitial = createDebug("t2-demo-parser:initial");
const debugBlocks = createDebug("t2-demo-parser:blocks");

/**
 * Read a U32 count and reject it unless `minBitsPerEntry × count` bits
 * remain: exhausted reads return 0 without throwing, so a corrupt count
 * would otherwise spin allocating until memory ran out.
 */
function readCheckedCount(
  bs: BitStream,
  minBitsPerEntry: number,
  what: string,
): number {
  const count = bs.readU32();
  if (count > bs.getRemainingBits() / minBitsPerEntry) {
    throw new Error(`Invalid ${what}: ${count}`);
  }
  return count;
}

export class DemoParser {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number;
  private registry: ClassRegistry;
  private ghostTracker: GhostTracker;
  private packetParser: PacketParser;
  // Stepping API state
  private _loaded = false;
  private _header?: DemoHeader;
  private _initialBlock?: InitialBlockData;
  private _decompressedData?: Uint8Array;
  private _decompressedView?: DataView;
  private _blockStreamOffset = 0;
  private _blockCount?: number;
  private _blockCursor = 0;
  // Incremental mode: the compressed block stream arrives in chunks via
  // push() and is inflated as it goes; nextBlock() treats the end of the
  // decompressed data as a frontier (more may arrive) until finish().
  private readonly _incremental: boolean;
  private _complete = true;
  private _inflator?: Inflate;
  /** The zlib stream announced its own end (final deflate block seen) —
   *  later bytes are trailing garbage and further pushes would throw. */
  private _streamEnded = false;
  /** Backing store for the growing decompressed stream (incremental
   *  mode). `_decompressedData` is always a length-exact subarray of
   *  this, so every existing `.length`-based read stays correct. */
  private _backing?: Uint8Array;
  private _decompressedLength = 0;
  // Buffered-time scan state (see bufferedMoveTicks).
  private _scanOffset = 0;
  private _bufferedMoveTicks = 0;

  private readonly _ignoreProtocolVersion: boolean;
  private readonly _haltOnFault: boolean | undefined;

  constructor(
    buffer: Uint8Array,
    options?: {
      /** Feed the compressed block stream in chunks via push()/finish(). */
      incremental?: boolean;
      /**
       * Parse demos whose protocol version differs from build 25034's
       * (0x330004). The game itself refuses to play them, and the block
       * formats are not guaranteed to match, so expect faults.
       */
      ignoreProtocolVersion?: boolean;
      /** Passed to PacketParser; see its `haltOnFault` option. */
      haltOnFault?: boolean;
    },
  ) {
    this.buffer = buffer;
    this.view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    this.offset = 0;
    this._incremental = options?.incremental === true;
    this._ignoreProtocolVersion = options?.ignoreProtocolVersion === true;
    this._haltOnFault = options?.haltOnFault;
    // Parser catalogs bound to their deterministic classIds (derived from
    // binary analysis of the Tribes 2 executable).
    this.registry = createDefaultRegistry();
    this.ghostTracker = new GhostTracker();
    this.packetParser = new PacketParser(this.registry, this.ghostTracker);
  }

  getRegistry(): ClassRegistry {
    return this.registry;
  }

  getGhostTracker(): GhostTracker {
    return this.ghostTracker;
  }

  getPacketParser(): PacketParser {
    return this.packetParser;
  }

  // --- Stepping API getters ---

  get loaded(): boolean {
    return this._loaded;
  }

  get header(): DemoHeader {
    if (!this._loaded) throw new Error("must call load() first");
    return this._header!;
  }

  get initialBlock(): InitialBlockData {
    if (!this._loaded) throw new Error("must call load() first");
    return this._initialBlock!;
  }

  get blockCount(): number {
    if (!this._loaded) throw new Error("must call load() first");
    if (this._blockCount === undefined) {
      // Lazy scan: walk decompressed buffer counting U16 headers
      let count = 0;
      this._walkBlockHeaders(0, () => {
        count++;
      });
      this._blockCount = count;
    }
    return this._blockCount;
  }

  /**
   * Walk complete block headers from byte offset `from`, calling `visit`
   * for each; returns the offset of the first incomplete block (or the
   * end of the data).
   */
  private _walkBlockHeaders(
    from: number,
    visit: (type: number, size: number) => void,
  ): number {
    const data = this._decompressedData;
    const view = this._decompressedView;
    if (!data || !view) return from;
    let off = from;
    while (off + 2 <= data.length) {
      const typeSize = view.getUint16(off, true);
      const size = typeSize & 0xfff;
      if (off + 2 + size > data.length) break;
      visit(typeSize >> 12, size);
      off += 2 + size;
    }
    return off;
  }

  get blockCursor(): number {
    if (!this._loaded) throw new Error("must call load() first");
    return this._blockCursor;
  }

  // --- Stepping API methods ---

  /**
   * Async load: parses header, initial block (DataBlocks, events,
   * ghosts, control object, mission name), and asynchronously decompresses
   * the block stream. No block indexing — blocks are read lazily via nextBlock().
   *
   * Idempotent — second call returns cached result.
   */
  async load(): Promise<LoadResult> {
    if (this._loaded) {
      return {
        header: this._header!,
        initialBlock: this._initialBlock!,
      };
    }

    // Phase 1: header + initial block
    const header = this.readHeader();
    debug(
      'header: "%s" version=0x%s length=%dms (%smin) initialBlockSize=%d',
      header.identString,
      header.protocolVersion.toString(16),
      header.demoLengthMs,
      (header.demoLengthMs / 1000 / 60).toFixed(1),
      header.initialBlockSize,
    );

    if (this.buffer.length < this.offset + header.initialBlockSize) {
      if (this._incremental) {
        throw new RangeError(
          `incremental parser needs the full initial block up front: have ${
            this.buffer.length - this.offset
          } bytes, need ${header.initialBlockSize}`,
        );
      }
      throw new RangeError(
        `truncated demo: initial block needs ${header.initialBlockSize} bytes, have ${
          this.buffer.length - this.offset
        }`,
      );
    }
    const initialBlockData = this.buffer.subarray(
      this.offset,
      this.offset + header.initialBlockSize,
    );
    const initialBlock = this.readInitialBlock(initialBlockData);
    this.offset += header.initialBlockSize;

    if (this._incremental) {
      // Phase 2 (incremental): streaming inflate. Compressed bytes
      // arrive via push(); whatever tail the constructor buffer already
      // holds past the initial block is the first chunk. fflate's
      // Inflate emits decompressed output synchronously during push.
      this._complete = false;
      this._decompressedLength = 0;
      this._backing = new Uint8Array(1 << 20);
      this._decompressedData = this._backing.subarray(0, 0);
      this._decompressedView = new DataView(this._backing.buffer, 0, 0);
      this._inflator = new Inflate((chunk, final) => {
        this._appendDecompressed(chunk);
        if (final) this._streamEnded = true;
      });
      const tail = this.buffer.subarray(this.offset);
      // The prefix buffer has served its purpose (header + initial block
      // are parsed); don't retain arbitrary compressed tail bytes twice.
      if (tail.length > 0) this._inflator.push(tail);
    } else {
      // Phase 2: async decompress block stream
      const compressedData = this.buffer.subarray(this.offset);
      debug("compressed block stream: %d bytes", compressedData.length);

      const decompressedData = await new Promise<Uint8Array>(
        (resolve, reject) => {
          inflate(compressedData, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        },
      );
      debug("decompressed block stream: %d bytes", decompressedData.length);

      this._decompressedData = decompressedData;
      this._decompressedView = new DataView(
        decompressedData.buffer,
        decompressedData.byteOffset,
        decompressedData.byteLength,
      );
    }

    // Phase 3: set up PacketParser with seeded ghost tracker
    this.setupPacketParser(initialBlock);

    // Cache results
    this._header = header;
    this._initialBlock = initialBlock;
    this._blockStreamOffset = 0;
    this._blockCursor = 0;
    this._loaded = true;

    return { header, initialBlock };
  }

  /**
   * Parse just the fixed-size demo header from a byte prefix, without
   * constructing a parser. Throws RangeError when `bytes` is too short —
   * callers streaming a download retry as more data arrives. The
   * returned `byteLength` is where the initial block begins; the block
   * stream begins at `byteLength + header.initialBlockSize`.
   */
  static peekHeader(bytes: Uint8Array): {
    header: DemoHeader;
    byteLength: number;
  } {
    if (bytes.length < 1) throw new RangeError("incomplete header");
    const strLen = bytes[0];
    const byteLength = 1 + strLen + 12;
    if (bytes.length < byteLength) throw new RangeError("incomplete header");
    const identString = new TextDecoder("ascii").decode(
      bytes.subarray(1, 1 + strLen),
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const protocolVersion = view.getUint32(1 + strLen, true);
    const demoLengthMs = view.getUint32(1 + strLen + 4, true);
    const initialBlockSize = view.getUint32(1 + strLen + 8, true);
    return {
      header: { identString, protocolVersion, demoLengthMs, initialBlockSize },
      byteLength,
    };
  }

  /**
   * Incremental mode only: feed the next chunk of raw (compressed) block
   * stream bytes as they arrive. Inflation happens synchronously; any
   * blocks completed by this chunk become readable via nextBlock().
   * The chunk is not retained.
   */
  push(chunk: Uint8Array): void {
    if (!this._incremental) throw new Error("not an incremental parser");
    if (!this._loaded) throw new Error("must call load() first");
    if (this._complete) throw new Error("already finished");
    if (chunk.length === 0 || this._streamEnded) return;
    this._inflator!.push(chunk);
  }

  /**
   * Incremental mode only: signal that the download is complete. Flushes
   * the inflator; after this, running out of blocks means the true end
   * of the demo rather than the frontier.
   */
  finish(): void {
    if (!this._incremental) throw new Error("not an incremental parser");
    if (!this._loaded) throw new Error("must call load() first");
    if (this._complete) return;
    if (!this._streamEnded) {
      try {
        this._inflator!.push(new Uint8Array(0), true);
      } catch (err) {
        // A truncated zlib stream: the blocks inflated so far remain
        // valid (nextBlock bounds-checks the tail) — degrade to a
        // shorter demo rather than failing the whole load.
        debug("finish(): inflate flush failed: %o", err);
      }
    }
    this._inflator = undefined;
    this._complete = true;
    // Trim: the doubling backing store can overshoot by up to 2× —
    // release the slack now that the final length is known.
    if (this._backing && this._backing.length > this._decompressedLength) {
      const exact = this._backing.slice(0, this._decompressedLength);
      this._backing = exact;
      this._decompressedData = exact;
      this._decompressedView = new DataView(
        exact.buffer,
        exact.byteOffset,
        exact.byteLength,
      );
    }
  }

  /**
   * False only in incremental mode before finish(): nextBlock()
   * returning undefined then means "frontier — more data may arrive",
   * not the end of the demo.
   */
  get isComplete(): boolean {
    return this._complete;
  }

  /**
   * Bytes of decompressed block stream available so far. Grows during
   * an incremental feed; consumers that latched an "out of blocks"
   * state can compare against it to know new data has arrived.
   */
  get decompressedByteLength(): number {
    return this._incremental
      ? this._decompressedLength
      : (this._decompressedData?.length ?? 0);
  }

  /**
   * Move-tick blocks in the decompressed stream so far — each is one
   * fixed 32ms simulation tick, so this measures buffered DEMO TIME
   * exactly (compressed bytes don't: quiet stretches pack far denser).
   * Independent of the read cursor; unaffected by reset(). Maintained
   * incrementally as data arrives; a full lazy scan on first access
   * covers the one-shot mode.
   */
  get bufferedMoveTicks(): number {
    this._scanBufferedTicks();
    return this._bufferedMoveTicks;
  }

  private _scanBufferedTicks(): void {
    let ticks = this._bufferedMoveTicks;
    this._scanOffset = this._walkBlockHeaders(this._scanOffset, (type) => {
      if (type === BlockTypeMove) ticks++;
    });
    this._bufferedMoveTicks = ticks;
  }

  private _appendDecompressed(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    const needed = this._decompressedLength + chunk.length;
    let backing = this._backing!;
    if (needed > backing.length) {
      let capacity = backing.length;
      while (capacity < needed) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(backing.subarray(0, this._decompressedLength));
      backing = grown;
      this._backing = grown;
    }
    backing.set(chunk, this._decompressedLength);
    this._decompressedLength = needed;
    // Refresh the exact-length views; subarray shares memory, so this is
    // cheap and keeps every `.length`-based reader (nextBlock,
    // blockCount) correct without touching them.
    this._decompressedData = backing.subarray(0, needed);
    this._decompressedView = new DataView(backing.buffer, 0, needed);
    // The lazily-cached block count no longer covers the new bytes.
    this._blockCount = undefined;
  }

  /**
   * Read and parse the next block from the decompressed buffer.
   * Returns the parsed block, or undefined when all blocks are exhausted.
   * Each block is transient — only one in memory at a time.
   * Throws if load() has not been called.
   */
  nextBlock(): DemoBlock | undefined {
    if (!this._loaded) throw new Error("must call load() first");
    const data = this._decompressedData!;
    const view = this._decompressedView!;
    const off = this._blockStreamOffset;

    if (off + 2 > data.length) return undefined;

    const typeSize = view.getUint16(off, true);
    const type = typeSize >> 12;
    const size = typeSize & 0xfff;

    if (off + 2 + size > data.length) {
      debugBlocks(
        "block %d: size %d would exceed decompressed data (offset=%d remaining=%d), stopping",
        this._blockCursor,
        size,
        off + 2,
        data.length - off - 2,
      );
      return undefined;
    }

    const blockData = data.subarray(off + 2, off + 2 + size);
    this._blockStreamOffset = off + 2 + size;

    const block: DemoBlock = {
      index: this._blockCursor,
      type,
      size,
      data: blockData,
    };
    this._blockCursor++;

    // PacketParser reports problems through parseFault rather than
    // throwing; anything that does escape is a parser bug, and the raw
    // block plus the error text is kept for diagnosis.
    try {
      if (type === BlockTypePacket) {
        block.parsed = this.packetParser.parsePacket(blockData);
      } else if (type === BlockTypeSendPacket) {
        this.packetParser.onSendPacketTrigger();
      } else if (type === BlockTypeMove && size === 64) {
        block.parsed = this.readRawMove(blockData);
      } else if (type === BlockTypeInfo && size === 8) {
        block.parsed = this.readInfoBlock(blockData);
      }
    } catch (e) {
      block.parseError = e instanceof Error ? e.message : String(e);
      debugBlocks(
        "block %d (type %d, %d bytes) threw: %s",
        block.index,
        type,
        size,
        block.parseError,
      );
    }

    return block;
  }

  /**
   * Reset stepping state: resets stream offset and cursor to 0,
   * clears cached block count, and re-initializes the PacketParser
   * with a fresh ghost tracker seeded from the initial block.
   * Throws if load() has not been called.
   */
  reset(): void {
    if (!this._loaded) throw new Error("must call load() first");

    this._blockStreamOffset = 0;
    this._blockCursor = 0;
    this._blockCount = undefined;

    // Fresh ghost tracker + packet parser
    this.setupPacketParser(this._initialBlock!);
  }

  /**
   * Fast-forward through N blocks, processing each but not returning them.
   * Returns the number of blocks actually processed (may be less than count
   * if the stream is exhausted).
   * Throws if load() has not been called.
   */
  processBlocks(count: number): number {
    if (!this._loaded) throw new Error("must call load() first");
    let processed = 0;
    for (let i = 0; i < count; i++) {
      if (!this.nextBlock()) break;
      processed++;
    }
    return processed;
  }

  /**
   * Set up a fresh PacketParser seeded from the initial block's ghosts
   * and with the DataBlock data map for ghost parsers. Replaces
   * this.ghostTracker and this.packetParser.
   */
  private setupPacketParser(initialBlock: InitialBlockData): void {
    // Build DataBlock data map (objectId → parsed data)
    const dataBlockDataMap = new Map<number, Record<string, unknown>>();
    for (const [objectId, db] of initialBlock.dataBlocks) {
      dataBlockDataMap.set(objectId, db.data);
    }

    // Seed ghost tracker from initial block ghosts
    const gt = new GhostTracker();
    for (const ghost of initialBlock.initialGhosts) {
      if (ghost.type !== "create" || ghost.classId === undefined) continue;
      const parserEntry = this.registry.getGhostParser(ghost.classId);
      gt.createGhost(
        ghost.index,
        ghost.classId,
        parserEntry?.name ?? `unknown_${ghost.classId}`,
      );
    }

    const pp = new PacketParser(this.registry, gt, {
      dataBlockDataMap,
      connectionProtocolState: initialBlock.connectionState,
      nextRecvEventSeq: initialBlock.nextRecvEventSeq,
      compressionPoint: initialBlock.initialCompressionPoint,
      // NetConnection::eventReadStartBlock (FUN_00583ac0) appends the
      // start block's in-flight ordered events to the wait queue without
      // a sequence number (the field is never written; NetEvent's
      // constructor leaves it uninitialized), so in the engine they can
      // only ever dispatch by accident of heap contents. The deterministic
      // stand-in keeps them queued behind every possible real sequence
      // number, where they neither dispatch nor block dispatch.
      pendingGuaranteedEvents: initialBlock.initialEvents
        .filter((event) => !event.failed)
        .map((event, i) => ({
          absoluteSequenceNumber: START_BLOCK_EVENT_SEQ_BASE + i,
          event,
        })),
      haltOnFault: this._haltOnFault,
    });

    this.ghostTracker = gt;
    this.packetParser = pp;
  }

  /**
   * Full parse: async load + drain all blocks.
   */
  async parseFullDemo(): Promise<DemoFile> {
    const { header, initialBlock } = await this.load();
    const blocks: DemoBlock[] = [];
    let block: DemoBlock | undefined;
    while ((block = this.nextBlock())) blocks.push(block);
    return { header, initialBlock, blocks };
  }

  /**
   * Read and validate the header the way GameConnection's demo playback
   * does: the ident string must match and the protocol version must be
   * the one this build speaks (unless `ignoreProtocolVersion` is set).
   */
  private readHeader(): DemoHeader {
    const { header, byteLength } = DemoParser.peekHeader(
      this.buffer.subarray(this.offset),
    );
    this.offset += byteLength;
    if (header.identString !== DemoIdentString) {
      throw new Error(
        `not a Tribes 2 recording: ident string ${JSON.stringify(header.identString)}`,
      );
    }
    if (header.protocolVersion !== DemoProtocolVersion) {
      const detail = `protocol version 0x${header.protocolVersion.toString(16)} (expected 0x${DemoProtocolVersion.toString(16)})`;
      if (!this._ignoreProtocolVersion) {
        throw new Error(
          `unsupported demo ${detail}; the game rejects it too. Pass { ignoreProtocolVersion: true } to try anyway.`,
        );
      }
      debug("parsing demo with unexpected %s", detail);
    }
    return header;
  }

  /** Parse the initial block: DataBlocks, scores, targets, connection state,
   *  events, ghosts, control object, and mission name. */
  private readInitialBlock(data: Uint8Array): InitialBlockData {
    const bs = new BitStream(data);

    // --- A. Tagged string table (1024 entries) ---
    const taggedStrings = new Map<number, string>();
    for (let i = 0; i < 1024; i++) {
      if (bs.readFlag()) {
        taggedStrings.set(i, bs.readString());
      }
    }
    debugInitial(
      "after tagged strings bit=%d count=%d",
      bs.getCurPos(),
      taggedStrings.size,
    );

    // --- B.1 U32 datablockCount ---
    const expectedDataBlockCount = bs.readU32();

    // --- B.2 DataBlock loop ---
    const dataBlockHeaders: DataBlockHeader[] = [];
    const dataBlocks = new Map<number, ParsedDataBlock>();
    let dataBlockCount = 0;

    while (bs.readFlag()) {
      dataBlockCount++;
      const modified = bs.readFlag();
      if (!modified) {
        continue;
      }

      const objectId = bs.readInt(SimDBEventObjectIdBits);
      const classId = bs.readInt(SimDBEventClassIdBits) + DataBlockClassFirst;
      const index = bs.readInt(SimDBEventIndexBits);
      const total = bs.readInt(SimDBEventTotalBits);
      const dataBitsStart = bs.getCurPos();

      dataBlockHeaders.push({ objectId, classId, index, total, dataBitsStart });

      const parserEntry = this.registry.getDataBlockParser(classId);
      if (parserEntry) {
        const parsedData = parserEntry.unpackData(bs);
        dataBlocks.set(objectId, {
          classId,
          className: parserEntry.name,
          objectId,
          data: parsedData,
        });
      } else {
        const className =
          classId >= DataBlockClassFirst &&
          classId < DataBlockClassFirst + DataBlockClassNames.length
            ? DataBlockClassNames[classId - DataBlockClassFirst]
            : `unknown(${classId})`;
        throw new Error(
          `No parser for DataBlock classId ${classId} (${className}) at bit ${dataBitsStart}`,
        );
      }
    }

    debug(
      "all %d/%d DataBlocks parsed (%d payloads), bit position after DataBlocks: %d",
      dataBlockCount,
      expectedDataBlockCount,
      dataBlocks.size,
      bs.getCurPos(),
    );

    // --- B.3 $firstPerson (U8 boolean from GameConnection::writeDemoStartBlock) ---
    const firstPerson = bs.readU8() !== 0;
    // --- B.4 6× U32 connection fields ---
    // @0x8384, @0x8388, @0x83f8, @0x83fc, @0x8400, @0x8434
    const connectionFields: number[] = [];
    for (let i = 0; i < 6; i++) connectionFields.push(bs.readU32());

    // --- B.5 16× U32 state array ---
    // @0x83b8 + i*4, i=0..15
    const stateArray: number[] = [];
    for (let i = 0; i < 16; i++) stateArray.push(bs.readU32());

    // --- B.6 U32 score entry count ---
    // A score entry is at least 3 + 18 + 1 + 6 = 28 bits (FUN_00601800).
    const scoreCount = readCheckedCount(bs, 28, "score entry count");

    // --- B.7 Score entries × count (FUN_00601800) ---
    const scoreEntries: ScoreEntry[] = [];
    for (let i = 0; i < scoreCount; i++) {
      scoreEntries.push(this.readScoreEntry(bs));
    }
    debugInitial(
      "after score entries bit=%d scoreCount=%d",
      bs.getCurPos(),
      scoreCount,
    );

    // B.8: FUN_005fb130 — clears internal state, no bitstream I/O

    // --- B.8 DemoValues ---
    const demoValues = this.readDemoValues(bs);
    debugInitial(
      "after demo values bit=%d demoValues=%d",
      bs.getCurPos(),
      demoValues.length,
    );

    // --- B.9 Complex TargetManager (FUN_00670660) ---
    const { sensorGroupColors, targets: targetEntries } =
      this.readComplexTargetManager(bs);
    debugInitial(
      "after complex target manager bit=%d targets=%d sensorGroupColors=%d",
      bs.getCurPos(),
      targetEntries.length,
      sensorGroupColors.length,
    );

    // --- B.10 Parent: NetConnection::readDemoStartBlock (FUN_00588260) ---

    // B.10a ConnectionProtocol (FUN_0043d820)
    const connectionState = this.readConnectionProtocol(bs);
    debugInitial(
      "after connection protocol bit=%d lastRecv=%d highestAck=%d lastSend=%d connected=%s",
      bs.getCurPos(),
      connectionState.lastSeqRecvd,
      connectionState.highestAckedSeq,
      connectionState.lastSendSeq,
      connectionState.connectionEstablished,
    );

    // B.10b RTT, B.10c packet loss
    const roundTripTime = bs.readF32();
    const packetLoss = bs.readF32();
    debugInitial(
      "after RTT/loss bit=%d rtt=%d loss=%d",
      bs.getCurPos(),
      roundTripTime,
      packetLoss,
    );

    // B.10d PathManager (FUN_00591ce0)
    const pathManager = this.readPathManager(bs);
    debugInitial(
      "after path manager bit=%d entries=%d",
      bs.getCurPos(),
      pathManager.length,
    );

    // B.10e Notify count only (FUN_00588260).
    // The reader allocates notify nodes in memory but does not consume
    // per-notify records from the bitstream in this phase.
    const notifyCount = bs.readU32();
    // Engine invariant (verified in build 25034): the start block carries
    // one PacketNotify per in-flight packet, i.e. exactly
    // lastSendSeq - highestAckedSeq of them. checkPacketSend
    // (FUN_005877e0) refuses to queue a notify while windowFull
    // (FUN_0043d720: lastSendSeq - highestAckedSeq > 0x1d), and
    // handleNotify (FUN_005874d0) pops the queue head with no null check on
    // every newly acked sequence, so a mismatched seed crashes playback on
    // the first ack. Every Tribes2.exe recording satisfies this exactly.
    const warnings: string[] = [];
    const inFlight =
      (connectionState.lastSendSeq - connectionState.highestAckedSeq) >>> 0;
    if (notifyCount !== inFlight) {
      warnings.push(
        `notify count ${notifyCount} does not match in-flight packets ` +
          `(lastSendSeq ${connectionState.lastSendSeq} - highestAckedSeq ` +
          `${connectionState.highestAckedSeq} = ${inFlight}); Tribes2.exe ` +
          `dereferences an empty notify queue on the first ack`,
      );
    }
    debugInitial(
      "after notify count bit=%d notifyCount=%d",
      bs.getCurPos(),
      notifyCount,
    );

    // --- B.10f through B.15: events, ghosts, control object, mission ---
    // Uses a temporary ghost tracker for initial-block ghost parsing only.
    const totalBits = bs.getBuffer().length * 8;
    const ibGhostTracker = new GhostTracker();
    const savedGhostTracker = this.ghostTracker;
    this.ghostTracker = ibGhostTracker;

    let initialEvents: NetEventInfo[] = [];
    let nextRecvEventSeq = 0;
    let ghostingSequence = 0;
    let initialGhosts: GhostUpdate[] = [];
    let controlObjectGhostIndex = -1;
    let controlObjectData: Record<string, unknown> | undefined;
    let initialCompressionPoint:
      { x: number; y: number; z: number } | undefined;
    let missionName = "";
    let missionCRC = 0;
    let phase2Error: string | undefined;
    try {
      debugInitial(
        "phase2 start bit=%d remaining=%d",
        bs.getCurPos(),
        totalBits - bs.getCurPos(),
      );

      // B.10f Events
      ({ nextRecvEventSeq, events: initialEvents } =
        this.readEventStartBlock(bs));
      debugInitial(
        "after initial events bit=%d count=%d",
        bs.getCurPos(),
        initialEvents.length,
      );

      // B.10g Ghosts
      const ghostResult = this.readGhostStartBlock(bs, dataBlocks);
      ghostingSequence = ghostResult.ghostingSequence;
      initialGhosts = ghostResult.ghosts;
      const lastInitialGhost = initialGhosts[initialGhosts.length - 1];
      if (lastInitialGhost?.failed) {
        // The engine sets "Invalid packet." here and drops the connection
        // once the start block is done; the fields below are still read,
        // misaligned, exactly as it reads them.
        phase2Error ??= `initial ghost ${lastInitialGhost.index} (classId ${lastInitialGhost.classId}) failed: ${lastInitialGhost.error}`;
      }
      debugInitial(
        "after initial ghosts bit=%d count=%d seq=%d",
        bs.getCurPos(),
        initialGhosts.length,
        ghostingSequence,
      );

      // B.11 controlObjectGhostIndex
      controlObjectGhostIndex = bs.readS32();
      debugInitial(
        "after control ghost index bit=%d control=%d",
        bs.getCurPos(),
        controlObjectGhostIndex,
      );

      // B.12 If != -1: controlObject readPacketData
      if (controlObjectGhostIndex !== -1) {
        // The engine resolves the ghost and calls its readPacketData with
        // no fallback; if we cannot, every later read in the initial
        // block (mission name, CRC) would be misaligned, so fail phase 2.
        const ghost = ibGhostTracker.getGhost(controlObjectGhostIndex);
        if (!ghost) {
          throw new Error(
            `control object ghost ${controlObjectGhostIndex} not found among initial ghosts`,
          );
        }
        const parser = this.registry.getGhostParser(ghost.classId);
        if (!parser?.readPacketData) {
          throw new Error(
            `control object ghost ${controlObjectGhostIndex} (${ghost.className}) has no readPacketData parser`,
          );
        }
        // getGhostParser enables the nested vehicle readPacketData when
        // the recorder was piloting at recording start.
        const conn = {
          compressionPoint: { x: 0, y: 0, z: 0 },
          ghostTracker: ibGhostTracker,
          getGhostParser: (classId: number) =>
            this.registry.getGhostParser(classId),
        };
        controlObjectData = parser.readPacketData(bs, conn);
        // The control object's readPacketData establishes the
        // connection's compression point (its position) — carry it
        // into the packet parser seed.
        initialCompressionPoint = conn.compressionPoint;
        debugInitial(
          "after control readPacketData bit=%d parser=%s",
          bs.getCurPos(),
          parser.name,
        );
      }

      // B.13 $MissionName
      missionName = bs.readString();
      // B.14 mMissionCRC
      missionCRC = bs.readU32();
      // B.15 Simple TargetManager ×2. FUN_006021b0 reads U8 + 4×U32 at the
      // current bit position; the binary does not byte-align here.
      this.readSimpleTargetManager(bs);
      this.readSimpleTargetManager(bs);
      debugInitial(
        'after sequential tail bit=%d mission="%s" CRC=0x%s',
        bs.getCurPos(),
        missionName,
        missionCRC.toString(16),
      );
    } catch (e) {
      phase2Error = e instanceof Error ? e.message : String(e);
    } finally {
      this.ghostTracker = savedGhostTracker;
    }

    const remaining = totalBits - bs.getCurPos();
    const missionPrintableRatio =
      missionName.length > 0
        ? missionName.split("").filter((c) => {
            const code = c.charCodeAt(0);
            return code >= 0x20 && code <= 0x7e;
          }).length / missionName.length
        : 1;
    const phase2Valid =
      missionName.length > 0 &&
      missionPrintableRatio >= 0.8 &&
      phase2Error === undefined;

    debug(
      'initial block: events=%d ghosts=%d ghostingSeq=%d controlObj=%d mission="%s" CRC=0x%s valid=%s%s',
      initialEvents.length,
      initialGhosts.length,
      ghostingSequence,
      controlObjectGhostIndex,
      missionName,
      missionCRC.toString(16),
      phase2Valid,
      phase2Error ? ` error=${phase2Error}` : "",
    );
    for (const warning of warnings) {
      debug("initial block warning: %s", warning);
    }

    return {
      taggedStrings,
      dataBlockHeaders,
      dataBlockCount,
      dataBlocks,
      firstPerson,
      connectionFields,
      stateArray,
      scoreEntries,
      demoValues,
      sensorGroupColors,
      targetEntries,
      connectionState,
      roundTripTime,
      packetLoss,
      pathManager,
      notifyCount,
      nextRecvEventSeq,
      ghostingSequence,
      initialGhosts,
      initialEvents,
      controlObjectGhostIndex,
      controlObjectData,
      initialCompressionPoint,
      missionName,
      missionCRC,
      phase2TrailingBits: remaining,
      phase2Valid,
      phase2Error,
      warnings,
    };
  }

  /**
   * Read a score entry from FUN_00601800.
   * Format: 3 conditional U16s + 3 U6s + 1 flag + 6 flags.
   */
  private readScoreEntry(bs: BitStream): ScoreEntry {
    const clientId = bs.readFlag() ? bs.readInt(16) : 0;
    const teamId = bs.readFlag() ? bs.readInt(16) : 0;
    const score = bs.readFlag() ? bs.readInt(16) : 0;
    const field0 = bs.readInt(6);
    const field1 = bs.readInt(6);
    const field2 = bs.readInt(6);
    // FUN_006014e0: post-processing, no stream reads
    const isBot = bs.readFlag();
    const triggerFlags: boolean[] = [];
    for (let i = 0; i < 6; i++) triggerFlags.push(bs.readFlag());
    return {
      clientId,
      teamId,
      score,
      field0,
      field1,
      field2,
      isBot,
      triggerFlags,
    };
  }

  /**
   * Read DemoValues from FUN_005fb5c0 lines 388966-388980.
   * Format: while(readFlag()) { readString(value) }
   * Variable names are derived from index ($DemoValue_0, $DemoValue_1, etc.).
   */
  private readDemoValues(bs: BitStream): string[] {
    const values: string[] = [];
    while (bs.readFlag()) {
      values.push(bs.readString());
    }
    return values;
  }

  /**
   * Read Complex TargetManager from FUN_00670660.
   *
   * Phase 1: 4×U8 initial data
   * Phase 2: 32×32 grid — each cell: readFlag + if true: 4×U8
   * Phase 3: 512 target entries with conditional fields
   */
  private readComplexTargetManager(bs: BitStream): {
    sensorGroupColors: import("./types.js").SensorGroupColor[];
    targets: TargetEntry[];
  } {
    // Phase 1: FUN_0043efe0 — read 4 bytes (4×U8)
    bs.readU8();
    bs.readU8();
    bs.readU8();
    bs.readU8();

    // Phase 2: 32×32 sensor group color grid (IFF colors).
    // sensorGroupColors[group][targetGroup] = RGBA determines how targetGroup
    // appears to group (e.g., red for enemy, green for friendly).
    const sensorGroupColors: import("./types.js").SensorGroupColor[] = [];
    for (let group = 0; group < 32; group++) {
      for (let targetGroup = 0; targetGroup < 32; targetGroup++) {
        if (bs.readFlag()) {
          sensorGroupColors.push({
            group,
            targetGroup,
            r: bs.readU8(),
            g: bs.readU8(),
            b: bs.readU8(),
            a: bs.readU8(),
          });
        }
      }
    }

    // Phase 3: 512 target entries
    const targets: TargetEntry[] = [];
    for (let i = 0; i < 512; i++) {
      if (!bs.readFlag()) continue; // Target not active

      const entry: TargetEntry = {
        targetId: i,
        sensorGroup: 0,
        targetData: 0,
        damageLevel: 0,
      };

      // Conditional sensor data
      if (bs.readFlag()) {
        entry.sensorData = bs.readU32(); // F32 sensorData
      }
      // Conditional voice map data
      if (bs.readFlag()) {
        entry.voiceMapData = bs.readU32(); // F32 voiceMapData
      }
      // 5 conditional strings: name, skin, skinPref, voice, typeDescription
      if (bs.readFlag()) entry.name = bs.readString();
      if (bs.readFlag()) entry.skin = bs.readString();
      if (bs.readFlag()) entry.skinPref = bs.readString();
      if (bs.readFlag()) entry.voice = bs.readString();
      if (bs.readFlag()) entry.typeDescription = bs.readString();

      // Always-read fields
      entry.sensorGroup = bs.readInt(5); // team/type
      entry.targetData = bs.readInt(9); // target data

      // Targets >= 32 have additional DataBlock reference
      if (i >= 32) {
        if (bs.readFlag()) {
          entry.dataBlockRef = bs.readInt(11); // DataBlock reference (FUN_00436d10: readClassId)
        }
        // Virtual call notification — no bitstream I/O
      }

      // Damage level: readFloat(7) — always read for all active targets
      entry.damageLevel = bs.readFloat(7);

      targets.push(entry);
    }

    return { sensorGroupColors, targets };
  }

  /**
   * Read PathManager from FUN_00591ce0.
   * Decompiled format:
   * - U32 entryCount
   * - repeat entryCount:
   *   - U32 entryId
   *   - U32 recordCount
   *   - repeat recordCount:
   *     - U32 field0
   *     - U32 field1
   *     - U32 field2
   *     - U32 auxField
   */
  private readPathManager(bs: BitStream): PathManagerEntry[] {
    const entries: PathManagerEntry[] = [];
    const entryCount = readCheckedCount(bs, 64, "PathManager entry count");
    for (let i = 0; i < entryCount; i++) {
      const entryId = bs.readU32();
      const recordCount = readCheckedCount(
        bs,
        128,
        "PathManager record count",
      );
      const records: {
        field0: number;
        field1: number;
        field2: number;
        auxField: number;
      }[] = [];
      for (let j = 0; j < recordCount; j++) {
        records.push({
          field0: bs.readU32(),
          field1: bs.readU32(),
          field2: bs.readU32(),
          auxField: bs.readU32(),
        });
      }
      entries.push({ entryId, records });
    }
    return entries;
  }

  /**
   * Read Simple TargetManager from FUN_006021b0.
   * Format: U8 flag + 4×U32 = 136 bits total.
   */
  private readSimpleTargetManager(bs: BitStream): void {
    bs.readU8(); // _read(1) = 8 bits
    bs.readU32(); // 4× _read(4)
    bs.readU32();
    bs.readU32();
    bs.readU32();
  }

  private readConnectionProtocol(bs: BitStream): ConnectionProtocolState {
    const lastSeqRecvdAtSend: number[] = [];
    for (let i = 0; i < 32; i++) {
      lastSeqRecvdAtSend.push(bs.readU32());
    }
    const lastSeqRecvd = bs.readU32();
    const highestAckedSeq = bs.readU32();
    const lastSendSeq = bs.readU32();
    const ackMask = bs.readU32();
    const connectSequence = bs.readU32();
    const lastRecvAckAck = bs.readU32();
    const connectionEstablished = bs.readBool();

    return {
      lastSeqRecvdAtSend,
      lastSeqRecvd,
      highestAckedSeq,
      lastSendSeq,
      ackMask,
      connectSequence,
      lastRecvAckAck,
      connectionEstablished,
    };
  }

  private readEventStartBlock(bs: BitStream): {
    nextRecvEventSeq: number;
    events: NetEventInfo[];
  } {
    const nextRecvEventSeq = bs.readU32();
    const events: NetEventInfo[] = [];
    debugInitial(
      "event block: nextRecvEventSeq=%d bit=%d",
      nextRecvEventSeq,
      bs.getCurPos(),
    );
    while (bs.readFlag()) {
      const classId = bs.readInt(NetEventClassBitSize) + NetEventClassFirst;
      const dataBitsStart = bs.getCurPos();

      // Try to parse the event payload using the registry
      const parserEntry = this.registry.getEventParser(classId);
      let parsedData: Record<string, unknown> | undefined;

      if (parserEntry) {
        try {
          const conn = {
            compressionPoint: { x: 0, y: 0, z: 0 },
            ghostTracker: this.ghostTracker,
            getDataBlockParser: (cid: number) =>
              this.registry.getDataBlockParser(cid),
          };
          parsedData = parserEntry.unpack(bs, conn);
        } catch {
          // Can't parse — stop here
          events.push({
            classId,
            guaranteed: true,
            dataBitsStart,
            dataBitsEnd: dataBitsStart,
            failed: true,
          });
          break;
        }
      } else {
        // No parser — can't advance past this event
        events.push({
          classId,
          guaranteed: true,
          dataBitsStart,
          dataBitsEnd: dataBitsStart,
          failed: true,
        });
        break;
      }

      events.push({
        classId,
        guaranteed: true,
        dataBitsStart,
        dataBitsEnd: bs.getCurPos(),
        parsedData,
      });
      debugInitial(
        "  event classId=%d bits=%d",
        classId,
        bs.getCurPos() - dataBitsStart,
      );
    }
    return { nextRecvEventSeq, events };
  }

  private readGhostStartBlock(
    bs: BitStream,
    dataBlocks: Map<number, ParsedDataBlock>,
  ): { ghostingSequence: number; ghosts: GhostUpdate[] } {
    const ghostingSequence = bs.readU32();
    const ghosts: GhostUpdate[] = [];
    debugInitial(
      "ghost block: seq=%d bit=%d",
      ghostingSequence,
      bs.getCurPos(),
    );
    const totalBits = bs.getBuffer().length * 8;

    // DataBlock data lookup for ghost parsers that resolve datablock
    // fields during unpack.
    const dataBlockDataMap = new Map<number, Record<string, unknown>>();
    for (const [objectId, db] of dataBlocks) {
      dataBlockDataMap.set(objectId, db.data);
    }

    while (bs.readFlag()) {
      if (bs.isError()) break;

      const index = bs.readInt(GhostIdBitSize);
      const classId = bs.readInt(NetObjectClassBitSize) + NetObjectClassFirst;
      const updateBitsStart = bs.getCurPos();

      // NetConnection::ghostReadStartBlock (FUN_00585220): create the
      // object from the class id, call its unpackUpdate, register it.
      // An unknown class id or a failed registration is "Invalid packet."
      // — the engine stops reading ghosts and the connection is dead.
      // There is no second candidate and no plausibility check.
      const entry = this.registry.getGhostParser(classId);
      if (!entry) {
        debugInitial(
          "  ghost idx=%d classId=%d NO CLASS (stopping at bit=%d)",
          index,
          classId,
          updateBitsStart,
        );
        ghosts.push({
          index,
          type: "create",
          classId,
          updateBitsStart,
          updateBitsEnd: updateBitsStart,
          failed: true,
          error: `no ghost class bound to classId ${classId}`,
        });
        break;
      }

      let parsedData: Record<string, unknown>;
      try {
        parsedData =
          entry.unpackUpdate(bs, true, {
            compressionPoint: { x: 0, y: 0, z: 0 },
            ghostTracker: this.ghostTracker,
            getDataBlockData: (objectId: number) =>
              dataBlockDataMap.get(objectId),
            getDataBlockParser: (cid: number) =>
              this.registry.getDataBlockParser(cid),
          }) ?? {};
        if (bs.isError()) {
          throw new Error("ran past the end of the initial block");
        }
      } catch (e) {
        const error = `${entry.name}: ${e instanceof Error ? e.message : String(e)}`;
        debugInitial(
          "  ghost idx=%d classId=%d parser=%s FAILED at bit=%d: %s",
          index,
          classId,
          entry.name,
          bs.getCurPos(),
          error,
        );
        ghosts.push({
          index,
          type: "create",
          classId,
          updateBitsStart,
          updateBitsEnd: bs.getCurPos(),
          failed: true,
          error,
        });
        break;
      }

      this.ghostTracker.createGhost(index, classId, entry.name);
      debugInitial(
        "  ghost idx=%d classId=%d parser=%s bits=%d",
        index,
        classId,
        entry.name,
        bs.getCurPos() - updateBitsStart,
      );
      ghosts.push({
        index,
        type: "create",
        classId,
        updateBitsStart,
        updateBitsEnd: bs.getCurPos(),
        parsedData,
      });
    }

    debugInitial(
      "ghost loop ended at bit=%d remaining=%d count=%d",
      bs.getCurPos(),
      totalBits - bs.getCurPos(),
      ghosts.length,
    );
    return { ghostingSequence, ghosts };
  }

  /**
   * Parse a raw 64-byte Move struct from a type 2 block.
   *
   * Layout (all little-endian):
   *   S32 px, py, pz        (12 bytes, offsets 0-11)
   *   U32 pyaw, ppitch, proll (12 bytes, offsets 12-23)
   *   F32 x, y, z            (12 bytes, offsets 24-35)
   *   F32 yaw, pitch, roll   (12 bytes, offsets 36-47)
   *   U32 id                 (4 bytes, offset 48)
   *   U32 sendCount          (4 bytes, offset 52)
   *   bool freeLook          (1 byte, offset 56)
   *   bool trigger[6]        (6 bytes, offsets 57-62)
   *   padding                (1 byte, offset 63)
   */
  private readRawMove(data: Uint8Array): Move {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const px = dv.getInt32(0, true);
    const py = dv.getInt32(4, true);
    const pz = dv.getInt32(8, true);
    const pyaw = dv.getUint32(12, true);
    const ppitch = dv.getUint32(16, true);
    const proll = dv.getUint32(20, true);
    const x = dv.getFloat32(24, true);
    const y = dv.getFloat32(28, true);
    const z = dv.getFloat32(32, true);
    const yaw = dv.getFloat32(36, true);
    const pitch = dv.getFloat32(40, true);
    const roll = dv.getFloat32(44, true);
    const id = dv.getUint32(48, true);
    const sendCount = dv.getUint32(52, true);
    const freeLook = data[56] !== 0;
    const trigger: boolean[] = [];
    for (let i = 0; i < MaxTriggerKeys; i++) {
      trigger.push(data[57 + i] !== 0);
    }

    return {
      px,
      py,
      pz,
      pyaw,
      ppitch,
      proll,
      x,
      y,
      z,
      yaw,
      pitch,
      roll,
      id,
      sendCount,
      freeLook,
      trigger,
    };
  }

  /**
   * Parse an 8-byte info block (type 3).
   * Contains U32 + F32 (observed: always 1 + 120.0).
   */
  private readInfoBlock(data: Uint8Array): InfoBlock {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
      // GameConnection::handleRecordedBlock (FUN_005fb170) case 3 reads
      // only byte 0 as firstPerson and the F32 at +4 as the camera FOV.
      firstPerson: data[0] !== 0,
      cameraFov: dv.getFloat32(4, true),
    };
  }
}
