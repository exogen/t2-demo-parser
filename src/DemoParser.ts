import { inflate } from "fflate";
import createDebug from "debug";
import { BitStream } from "./BitStream.js";
import { PacketParser } from "./PacketParser.js";
import { ClassRegistry } from "./ClassRegistry.js";
import type { GhostParserEntry } from "./ClassRegistry.js";
import { GhostTracker, registerGhostParsers } from "./GhostManager.js";
import { registerEventParsers } from "./EventParsers.js";
import { registerDataBlockParsers } from "./DataBlockParsers.js";
import {
  BlockTypePacket,
  BlockTypeSendPacket,
  BlockTypeMove,
  BlockTypeInfo,
  MaxTriggerKeys,
  NetEventClassBitSize,
  NetEventClassFirst,
  NetObjectClassBitSize,
  NetObjectClassFirst,
  GhostIdBitSize,
  DataBlockClassFirst,
  DataBlockClassNames,
  NetObjectClassNames,
  NetEventClassNames,
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
const debugInitial = createDebug("t2-demo-parser:initial");
const debugBlocks = createDebug("t2-demo-parser:blocks");

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

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.offset = 0;
    this.registry = new ClassRegistry();
    this.ghostTracker = new GhostTracker();

    // Register parser catalogs
    registerEventParsers(this.registry);
    registerGhostParsers(this.registry);
    registerDataBlockParsers(this.registry);

    // Bind DataBlock parsers deterministically using the known class name
    // mapping derived from binary analysis of the Tribes 2 executable.
    // ClassIds are assigned alphabetically (C strcmp) starting at
    // DataBlockClassFirst (128).
    const { bound: dbBound, missing: dbMissing } =
      this.registry.bindDeterministicDataBlocks(
        DataBlockClassNames,
        DataBlockClassFirst
      );
    if (dbMissing.length > 0) {
      debug(
        "DataBlock binding: %d/%d bound, missing parsers: %s",
        dbBound, DataBlockClassNames.length, dbMissing.join(", ")
      );
    }

    // Bind ghost (NetObject) parsers deterministically using the known
    // class name mapping derived from binary analysis. The 53 NetObject
    // classes are sorted alphabetically (C strcmp) and assigned sequential
    // classIds starting at NetObjectClassFirst (0).
    const { bound: ghostBound, missing: ghostMissing } =
      this.registry.bindDeterministicGhosts(
        NetObjectClassNames,
        NetObjectClassFirst
      );
    if (ghostMissing.length > 0) {
      debug(
        "Ghost binding: %d/%d bound, missing parsers: %s",
        ghostBound, NetObjectClassNames.length, ghostMissing.join(", ")
      );
    }

    // Bind event (NetEvent) parsers deterministically using the known
    // class name mapping derived from binary analysis. The 26 NetEvent
    // classes are sorted alphabetically (C strcmp) and assigned sequential
    // classIds starting at NetEventClassFirst (255).
    const { bound: eventBound, missing: eventMissing } =
      this.registry.bindDeterministicEvents(
        NetEventClassNames,
        NetEventClassFirst
      );
    if (eventMissing.length > 0) {
      debug(
        "Event binding: %d/%d bound, missing parsers: %s",
        eventBound, NetEventClassNames.length, eventMissing.join(", ")
      );
    }

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
      const data = this._decompressedData!;
      const view = this._decompressedView!;
      let count = 0;
      let off = 0;
      while (off + 2 <= data.length) {
        const typeSize = view.getUint16(off, true);
        const size = typeSize & 0xfff;
        off += 2 + size;
        if (off > data.length) break;
        count++;
      }
      this._blockCount = count;
    }
    return this._blockCount;
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
      header.identString, header.protocolVersion.toString(16),
      header.demoLengthMs, (header.demoLengthMs / 1000 / 60).toFixed(1),
      header.initialBlockSize
    );

    const initialBlockData = this.buffer.subarray(
      this.offset,
      this.offset + header.initialBlockSize
    );
    const initialBlock = this.readInitialBlock(initialBlockData);
    this.offset += header.initialBlockSize;

    // Phase 2: async decompress block stream
    const compressedData = this.buffer.subarray(this.offset);
    debug("compressed block stream: %d bytes", compressedData.length);

    const decompressedData = await new Promise<Uint8Array>((resolve, reject) => {
      inflate(compressedData, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    debug("decompressed block stream: %d bytes", decompressedData.length);

    this._decompressedData = decompressedData;
    this._decompressedView = new DataView(
      decompressedData.buffer,
      decompressedData.byteOffset,
      decompressedData.byteLength
    );

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
        this._blockCursor, size, off + 2, data.length - off - 2
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

    if (type === BlockTypePacket) {
      try {
        block.parsed = this.packetParser.parsePacket(blockData);
      } catch {
        // Skip unparseable packets
      }
    } else if (type === BlockTypeSendPacket) {
      this.packetParser.onSendPacketTrigger();
    } else if (type === BlockTypeMove && size === 64) {
      try {
        block.parsed = this.readRawMove(blockData);
      } catch {
        // Skip unparseable moves
      }
    } else if (type === BlockTypeInfo && size === 8) {
      try {
        block.parsed = this.readInfoBlock(blockData);
      } catch {
        // Skip unparseable info blocks
      }
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
        parserEntry?.name ?? `unknown_${ghost.classId}`
      );
    }

    const pp = new PacketParser(this.registry, gt, {
      dataBlockDataMap,
      connectionProtocolState: initialBlock.connectionState,
      nextRecvEventSeq: initialBlock.nextRecvEventSeq,
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

  private readHeader(): DemoHeader {
    // Read the identification string: U8 length + string
    const strLen = this.view.getUint8(this.offset);
    this.offset += 1;
    const identString = new TextDecoder("ascii").decode(
      this.buffer.subarray(this.offset, this.offset + strLen)
    );
    this.offset += strLen;

    // U32 protocol version
    const protocolVersion = this.view.getUint32(this.offset, true);
    this.offset += 4;

    // U32 demo length in ms
    const demoLengthMs = this.view.getUint32(this.offset, true);
    this.offset += 4;

    // U32 initial block size
    const initialBlockSize = this.view.getUint32(this.offset, true);
    this.offset += 4;

    return { identString, protocolVersion, demoLengthMs, initialBlockSize };
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
    debugInitial("after tagged strings bit=%d count=%d", bs.getCurPos(), taggedStrings.size);

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
        const className = classId >= DataBlockClassFirst &&
          classId < DataBlockClassFirst + DataBlockClassNames.length
          ? DataBlockClassNames[classId - DataBlockClassFirst]
          : `unknown(${classId})`;
        throw new Error(
          `No parser for DataBlock classId ${classId} (${className}) at bit ${dataBitsStart}`
        );
      }
    }

    debug(
      "all %d/%d DataBlocks parsed (%d payloads), bit position after DataBlocks: %d",
      dataBlockCount, expectedDataBlockCount, dataBlocks.size, bs.getCurPos()
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
    const scoreCount = bs.readU32();

    // --- B.7 Score entries × count (FUN_00601800) ---
    const scoreEntries: ScoreEntry[] = [];
    for (let i = 0; i < scoreCount; i++) {
      scoreEntries.push(this.readScoreEntry(bs));
    }
    debugInitial("after score entries bit=%d scoreCount=%d", bs.getCurPos(), scoreCount);

    // B.8: FUN_005fb130 — clears internal state, no bitstream I/O

    // --- B.8 DemoValues ---
    const demoValues = this.readDemoValues(bs);
    debugInitial("after demo values bit=%d demoValues=%d", bs.getCurPos(), demoValues.length);

    // --- B.9 Complex TargetManager (FUN_00670660) ---
    const { sensorGroupColors, targets: targetEntries } = this.readComplexTargetManager(bs);
    debugInitial("after complex target manager bit=%d targets=%d sensorGroupColors=%d", bs.getCurPos(), targetEntries.length, sensorGroupColors.length);

    // --- B.10 Parent: NetConnection::readDemoStartBlock (FUN_00588260) ---

    // B.10a ConnectionProtocol (FUN_0043d820)
    const connectionState = this.readConnectionProtocol(bs);
    debugInitial(
      "after connection protocol bit=%d lastRecv=%d highestAck=%d lastSend=%d connected=%s",
      bs.getCurPos(), connectionState.lastSeqRecvd, connectionState.highestAckedSeq,
      connectionState.lastSendSeq, connectionState.connectionEstablished
    );

    // B.10b RTT, B.10c packet loss
    const roundTripTime = bs.readF32();
    const packetLoss = bs.readF32();
    debugInitial("after RTT/loss bit=%d rtt=%d loss=%d", bs.getCurPos(), roundTripTime, packetLoss);

    // B.10d PathManager (FUN_00591ce0)
    const pathManager = this.readPathManager(bs);
    debugInitial("after path manager bit=%d entries=%d", bs.getCurPos(), pathManager.length);

    // B.10e Notify count only (FUN_00588260).
    // The reader allocates notify nodes in memory but does not consume
    // per-notify records from the bitstream in this phase.
    const notifyCount = bs.readU32();
    debugInitial("after notify count bit=%d notifyCount=%d", bs.getCurPos(), notifyCount);

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
    let missionName = "";
    let missionCRC = 0;
    let phase2Error: string | undefined;
    try {
      debugInitial("phase2 start bit=%d remaining=%d", bs.getCurPos(), totalBits - bs.getCurPos());

      // B.10f Events
      ({ nextRecvEventSeq, events: initialEvents } = this.readEventStartBlock(bs));
      debugInitial("after initial events bit=%d count=%d", bs.getCurPos(), initialEvents.length);

      // B.10g Ghosts
      const ghostResult = this.readGhostStartBlock(bs, dataBlocks);
      ghostingSequence = ghostResult.ghostingSequence;
      initialGhosts = ghostResult.ghosts;
      debugInitial("after initial ghosts bit=%d count=%d seq=%d", bs.getCurPos(), initialGhosts.length, ghostingSequence);

      // B.11 controlObjectGhostIndex
      controlObjectGhostIndex = bs.readS32();
      debugInitial("after control ghost index bit=%d control=%d", bs.getCurPos(), controlObjectGhostIndex);

      // B.12 If != -1: controlObject readPacketData
      if (controlObjectGhostIndex !== -1) {
        const ghost = ibGhostTracker.getGhost(controlObjectGhostIndex);
        if (ghost) {
          const parser = this.registry.getGhostParser(ghost.classId);
          if (parser?.readPacketData) {
            const conn = {
              compressionPoint: { x: 0, y: 0, z: 0 },
              ghostTracker: ibGhostTracker,
            };
            controlObjectData = parser.readPacketData(bs, conn);
            debugInitial("after control readPacketData bit=%d parser=%s", bs.getCurPos(), parser.name);
          }
        }
      }

      // B.13 $MissionName
      missionName = bs.readString();
      // B.14 mMissionCRC
      missionCRC = bs.readU32();
      // Byte-align (validate) before SimpleTargetManagers
      bs.setCurPos(((bs.getCurPos() + 7) >> 3) << 3);
      // B.15 Simple TargetManager ×2
      this.readSimpleTargetManager(bs);
      this.readSimpleTargetManager(bs);
      debugInitial('after sequential tail bit=%d mission="%s" CRC=0x%s', bs.getCurPos(), missionName, missionCRC.toString(16));
    } catch (e) {
      phase2Error = e instanceof Error ? e.message : String(e);
    } finally {
      this.ghostTracker = savedGhostTracker;
    }

    const remaining = totalBits - bs.getCurPos();
    const missionPrintableRatio = missionName.length > 0
      ? missionName
          .split("")
          .filter((c) => {
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
      initialEvents.length, initialGhosts.length, ghostingSequence,
      controlObjectGhostIndex, missionName, missionCRC.toString(16),
      phase2Valid, phase2Error ? ` error=${phase2Error}` : ""
    );

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
      missionName,
      missionCRC,
      phase2TrailingBits: remaining,
      phase2Valid,
      phase2Error,
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
    return { clientId, teamId, score, field0, field1, field2, isBot, triggerFlags };
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
      entry.sensorGroup = bs.readInt(5);  // team/type
      entry.targetData = bs.readInt(9);  // target data

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
    const entryCount = bs.readU32();
    for (let i = 0; i < entryCount; i++) {
      const entryId = bs.readU32();
      const recordCount = bs.readU32();
      const records: { field0: number; field1: number; field2: number; auxField: number }[] = [];
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
    bs.readU8();  // _read(1) = 8 bits
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

  private readEventStartBlock(
    bs: BitStream
  ): { nextRecvEventSeq: number; events: NetEventInfo[] } {
    const nextRecvEventSeq = bs.readU32();
    const events: NetEventInfo[] = [];
    debugInitial("event block: nextRecvEventSeq=%d bit=%d", nextRecvEventSeq, bs.getCurPos());
    while (bs.readFlag()) {
      const classId =
        bs.readInt(NetEventClassBitSize) + NetEventClassFirst;
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
      debugInitial("  event classId=%d bits=%d", classId, bs.getCurPos() - dataBitsStart);
    }
    return { nextRecvEventSeq, events };
  }

  private readGhostStartBlock(
    bs: BitStream,
    dataBlocks: Map<number, ParsedDataBlock>
  ): { ghostingSequence: number; ghosts: GhostUpdate[] } {
    const ghostingSequence = bs.readU32();
    const ghosts: GhostUpdate[] = [];
    debugInitial("ghost block: seq=%d bit=%d", ghostingSequence, bs.getCurPos());
    const ghostCatalog = this.registry.getGhostCatalog();
    const totalBits = bs.getBuffer().length * 8;

    // Build DataBlock data lookup for ghost parsers that need it
    // (e.g., WheeledVehicle needs shape name to determine wheel count).
    const dataBlockDataMap = new Map<number, Record<string, unknown>>();
    for (const [objectId, db] of dataBlocks) {
      dataBlockDataMap.set(objectId, db.data);
    }

    while (bs.readFlag()) {
      if (bs.isError()) break;

      const index = bs.readInt(GhostIdBitSize);
      const classId =
        bs.readInt(NetObjectClassBitSize) + NetObjectClassFirst;
      const updateBitsStart = bs.getCurPos();

      // Build ordered list of parser candidates.
      // Registry binding (from deterministic classId) is preferred over
      // DataBlock-based identification because the classId is authoritative
      // while the DataBlock type may be a base class (e.g., StaticShapeData
      // used by a BeaconObject, which extends StaticShape with extra fields).
      const candidates: { entry: GhostParserEntry; method: string }[] = [];
      const seen = new Set<GhostParserEntry>();

      // Peek at DataBlock flag to identify ghost via DataBlock type
      const { entry: dbEntry } = this.identifyGhostViaDataBlock(bs, dataBlocks, ghostCatalog);

      // Candidate 1: registry binding (deterministic classId)
      const regEntry = this.registry.getGhostParser(classId);
      if (regEntry) {
        candidates.push({ entry: regEntry, method: "registry" });
        seen.add(regEntry);
      }

      // Candidate 2: DataBlock-based identification (fallback)
      if (dbEntry && !seen.has(dbEntry)) {
        candidates.push({ entry: dbEntry, method: "datablock" });
        seen.add(dbEntry);
      }

      // Try each candidate with alignment validation
      const connOverrides = {
        getDataBlockData: (objectId: number) => dataBlockDataMap.get(objectId),
        getDataBlockParser: (cid: number) => this.registry.getDataBlockParser(cid),
      };
      let parsed = false;
      for (const { entry, method } of candidates) {
        const isTrusted = method === "registry";
        const result = this.tryGhostParser(bs, entry, updateBitsStart, totalBits, false, connOverrides, isTrusted);
        if (result !== false) {
          this.ghostTracker.createGhost(index, classId, entry.name);
          debugInitial(
            "  ghost idx=%d classId=%d parser=%s bits=%d via=%s",
            index, classId, entry.name, bs.getCurPos() - updateBitsStart, method
          );
          ghosts.push({
            index,
            type: "create",
            classId,
            updateBitsStart,
            updateBitsEnd: bs.getCurPos(),
            parsedData: result,
          });
          parsed = true;
          break;
        }
      }

      if (parsed) continue;

      // No candidate worked — stop parsing ghosts
      debugInitial(
        "  ghost idx=%d classId=%d NO PARSER (stopping at bit=%d, remaining=%d)",
        index, classId, updateBitsStart, totalBits - updateBitsStart
      );
      break;
    }

    debugInitial(
      "ghost loop ended at bit=%d remaining=%d count=%d",
      bs.getCurPos(), totalBits - bs.getCurPos(), ghosts.length
    );
    return { ghostingSequence, ghosts };
  }

  /**
   * Try parsing a ghost with a given parser and validate alignment.
   * Returns true if parsing succeeded and alignment is valid.
   * On success, the BitStream is positioned after the parsed ghost data.
   * On failure, the BitStream is restored to updateBitsStart.
   */
  private tryGhostParser(
    bs: BitStream,
    entry: GhostParserEntry,
    updateBitsStart: number,
    totalBits: number,
    silent = false,
    connOverrides?: Partial<import("./ClassRegistry.js").ConnectionContext>,
    trusted = false
  ): Record<string, unknown> | false {
    const savedPos = bs.savePos();
    if (!silent) {
      debugInitial("    try %s: startBit=%d", entry.name, updateBitsStart);
    }
    try {
      const parsedData = entry.unpackUpdate(bs, true, {
        compressionPoint: { x: 0, y: 0, z: 0 },
        ghostTracker: this.ghostTracker,
        ...connOverrides,
      });
      const bitsConsumed = bs.getCurPos() - updateBitsStart;
      const remaining = totalBits - bs.getCurPos();

      if (bs.isError() || (!trusted && bitsConsumed < 3)) {
        if (!silent) {
          debugInitial("    reject %s: bits=%d isError=%s", entry.name, bitsConsumed, bs.isError());
        }
        bs.restorePos(savedPos);
        return false;
      }

      // Validate alignment: if substantial data remains, the next
      // continuation flag must be 1 (more ghosts in the snapshot).
      if (remaining > 1000) {
        const peekPos = bs.getCurPos();
        const nextFlag = bs.readFlag();
        bs.setCurPos(peekPos);
        if (!nextFlag) {
          if (!silent) {
            debugInitial("    reject %s: bits=%d misaligned (remaining=%d)", entry.name, bitsConsumed, remaining);
          }
          bs.restorePos(savedPos);
          return false;
        }
      }

      return parsedData ?? {};
    } catch (e) {
      if (!silent) {
        debugInitial(
          "    reject %s: error at bit=%d: %s",
          entry.name, bs.getCurPos(),
          e instanceof Error ? e.message : String(e)
        );
      }
      bs.restorePos(savedPos);
      return false;
    }
  }

  /**
   * Peek at the GameBase DataBlock prefix to identify a ghost's parser.
   * GameBase subclass ghost creates always start with:
   *   flag(1b) + if flag: DataBlockId(11b)
   * The DataBlock type (e.g., "PlayerData") maps to the ghost parser
   * (e.g., "Player") by stripping the "Data" suffix.
   *
   * Returns { entry, dbFlag } where entry is the parser (if found) and
   * dbFlag indicates whether the first bit was 1 (DataBlock flag set).
   * In the initial block (mask=0xFFFFFFFF), dbFlag=false means the ghost
   * is definitely NOT a GameBase subclass.
   * The BitStream position is always restored after peeking.
   */
  private identifyGhostViaDataBlock(
    bs: BitStream,
    dataBlocks: Map<number, ParsedDataBlock> | undefined,
    ghostCatalog: Map<string, GhostParserEntry>
  ): { entry: GhostParserEntry | undefined; dbFlag: boolean } {
    if (!dataBlocks) return { entry: undefined, dbFlag: false };

    const savedPos = bs.savePos();
    let entry: GhostParserEntry | undefined;
    let dbFlag = false;

    try {
      dbFlag = bs.readFlag();
      if (dbFlag) {
        const dbId = bs.readInt(11);
        const db = dataBlocks.get(dbId);
        if (db) {
          const ghostName = db.className.replace(/Data$/, "");
          entry = ghostCatalog.get(ghostName);
          if (!entry) {
            debugInitial(
              "    identifyGhostViaDataBlock: dbId=%d className=%s ghostName=%s (no ghost parser)",
              dbId, db.className, ghostName
            );
          }
        } else {
          debugInitial("    identifyGhostViaDataBlock: dbId=%d (no DataBlock found)", dbId);
        }
      } else {
        debugInitial("    identifyGhostViaDataBlock: DataBlock flag=0");
      }
    } catch {
      // Ignore errors during peek
    }

    bs.restorePos(savedPos);
    return { entry, dbFlag };
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
      px, py, pz, pyaw, ppitch, proll,
      x, y, z, yaw, pitch, roll,
      id, sendCount, freeLook, trigger,
    };
  }

  /**
   * Parse an 8-byte info block (type 3).
   * Contains U32 + F32 (observed: always 1 + 120.0).
   */
  private readInfoBlock(data: Uint8Array): InfoBlock {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
      value1: dv.getUint32(0, true),
      value2: dv.getFloat32(4, true),
    };
  }
}
