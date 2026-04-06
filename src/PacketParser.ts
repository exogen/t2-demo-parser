import createDebug from "debug";
import { BitStream } from "./BitStream.js";
import {
  DataPacket,
  MaxGhostCount,
  GhostMsgEndGhosting,
  NetEventClassBitSize,
  NetEventClassFirst,
  NetObjectClassBitSize,
  NetObjectClassFirst,
} from "./types.js";

const debugGhosts = createDebug("t2-demo-parser:ghosts");
import type {
  ConnectionProtocolState,
  DnetHeader,
  RateInfo,
  GameState,
  PacketData,
  NetEventInfo,
  GhostUpdate,
} from "./types.js";
import type {
  ClassRegistry,
  ConnectionContext,
  GhostParserEntry,
  ParsedData,
} from "./ClassRegistry.js";
import type { EventData, SimDataBlockEventData } from "./eventDataTypes.js";
import type { GhostTracker } from "./GhostManager.js";

/**
 * Parses individual network packets from demo recording blocks.
 *
 * Packet layout (from the server connection perspective):
 *   1. dnet header (processRawPacket)
 *   2. Rate info (handlePacket)
 *   3. GameConnection::readPacket — game state, moves, etc.
 *   4. NetConnection::readPacket — events, then ghosts
 */
export class PacketParser {
  private registry: ClassRegistry;
  private ghostTracker: GhostTracker;
  private compressionPoint = { x: 0, y: 0, z: 0 };
  private controlParserByGhostIndex = new Map<number, GhostParserEntry>();
  private dataBlockDataMap?: Map<number, ParsedData>;
  private lastSeqRecvdAtSend = new Array<number>(32).fill(0);
  private lastSeqRecvd = 0;
  private highestAckedSeq = 0;
  private lastSendSeq = 0;
  private recvAckMask = 0;
  private connectSequence = 0;
  private lastRecvAckAck = 0;
  private _connectionEstablished = false;
  private nextRecvEventSeq = 0;
  private pendingGuaranteedEvents: Array<{
    absoluteSequenceNumber: number;
    event: NetEventInfo;
  }> = [];

  // Stats
  controlObjectParsed = 0;
  controlObjectFailed = 0;
  eventsParsed = 0;
  eventsFailed = 0;
  ghostCreatesParsed = 0;
  ghostUpdatesParsed = 0;
  ghostDeletes = 0;
  ghostsFailed = 0;
  /** Ghosts where our tracker says "new" but the classId is unregistered.
   *  This indicates a tracker divergence: the server sent UPDATE data
   *  (no classId prefix) for a ghost we don't have, so we misread the
   *  first 7 bits of update data as a classId. */
  ghostsTrackerDiverged = 0;
  packetsParsed = 0;
  protocolRejected = 0;
  protocolNoDispatch = 0;

  constructor(
    registry: ClassRegistry,
    ghostTracker: GhostTracker,
    options?: {
      dataBlockDataMap?: Map<number, ParsedData>;
      connectionProtocolState?: ConnectionProtocolState;
      nextRecvEventSeq?: number;
    }
  ) {
    this.registry = registry;
    this.ghostTracker = ghostTracker;
    this.dataBlockDataMap = options?.dataBlockDataMap;
    if (options?.connectionProtocolState) {
      this.setConnectionProtocolState(options.connectionProtocolState);
    }
    if (typeof options?.nextRecvEventSeq === "number") {
      this.nextRecvEventSeq = options.nextRecvEventSeq >>> 0;
    }
  }

  getCompressionPoint(): { x: number; y: number; z: number } {
    return this.compressionPoint;
  }

  getDataBlockDataMap(): Map<number, ParsedData> | undefined {
    return this.dataBlockDataMap;
  }

  private getConnectionContext(): ConnectionContext {
    const dbMap = this.dataBlockDataMap;
    return {
      compressionPoint: this.compressionPoint,
      ghostTracker: this.ghostTracker,
      getDataBlockParser: (classId: number) =>
        this.registry.getDataBlockParser(classId),
      getDataBlockData: dbMap
        ? (objectId: number) => dbMap.get(objectId)
        : undefined,
      getGhostParser: (classId: number) => this.registry.getGhostParser(classId),
    };
  }

  private _setNextRecvEventSeq(nextRecvEventSeq: number): void {
    this.nextRecvEventSeq = nextRecvEventSeq >>> 0;
  }

  setConnectionProtocolState(state: ConnectionProtocolState): void {
    this.lastSeqRecvdAtSend = state.lastSeqRecvdAtSend.slice(0, 32);
    while (this.lastSeqRecvdAtSend.length < 32) {
      this.lastSeqRecvdAtSend.push(0);
    }
    this.lastSeqRecvd = state.lastSeqRecvd >>> 0;
    this.highestAckedSeq = state.highestAckedSeq >>> 0;
    this.lastSendSeq = state.lastSendSeq >>> 0;
    this.recvAckMask = state.ackMask >>> 0;
    this.connectSequence = state.connectSequence >>> 0;
    this.lastRecvAckAck = state.lastRecvAckAck >>> 0;
    this._connectionEstablished = state.connectionEstablished;
  }

  /**
   * Emulate ConnectionProtocol::buildSendPacketHeader (FUN_0043d2d0, data path).
   * Demo block type 1 indicates a local send-packet trigger.
   */
  onSendPacketTrigger(): void {
    this.lastSendSeq = (this.lastSendSeq + 1) >>> 0;
    this.lastSeqRecvdAtSend[this.lastSendSeq & 0x1f] = this.lastSeqRecvd >>> 0;
  }

  /**
   * Emulates ConnectionProtocol::processRawPacket (FUN_0043d4d0).
   * A packet may be syntactically valid but still ignored for game payload
   * dispatch due to sequence/connect-window checks or duplicate seq numbers.
   */
  private applyProtocolHeader(dnetHeader: DnetHeader): {
    accepted: boolean;
    dispatchData: boolean;
  } {
    if (dnetHeader.connectSeqBit !== (this.connectSequence & 1)) {
      return { accepted: false, dispatchData: false };
    }
    if (dnetHeader.ackByteCount > 4 || dnetHeader.packetType > 2) {
      return { accepted: false, dispatchData: false };
    }

    let seqNumber = (
      dnetHeader.seqNumber | (this.lastSeqRecvd & 0xffff_fe00)
    ) >>> 0;
    if (seqNumber < this.lastSeqRecvd) {
      seqNumber = (seqNumber + 0x200) >>> 0;
    }
    if (this.lastSeqRecvd + 0x1f < seqNumber) {
      return { accepted: false, dispatchData: false };
    }

    let highestAck = (
      dnetHeader.highestAck | (this.highestAckedSeq & 0xffff_fe00)
    ) >>> 0;
    if (highestAck < this.highestAckedSeq) {
      highestAck = (highestAck + 0x200) >>> 0;
    }
    if (this.lastSendSeq < highestAck) {
      return { accepted: false, dispatchData: false };
    }

    const seqShift = (seqNumber - this.lastSeqRecvd) & 0x1f;
    this.recvAckMask = (this.recvAckMask << seqShift) >>> 0;
    if (dnetHeader.packetType === DataPacket) {
      this.recvAckMask = (this.recvAckMask | 1) >>> 0;
    }

    for (let ackSeq = this.highestAckedSeq + 1; ackSeq <= highestAck; ackSeq++) {
      const isAcked = (
        dnetHeader.ackMask & (1 << ((highestAck - ackSeq) & 0x1f))
      ) !== 0;
      if (isAcked) {
        this.lastRecvAckAck = this.lastSeqRecvdAtSend[ackSeq & 0x1f] >>> 0;
      }
    }
    if (seqNumber - this.lastRecvAckAck > 0x20) {
      this.lastRecvAckAck = seqNumber - 0x20;
    }
    this.highestAckedSeq = highestAck;

    const dispatchData =
      this.lastSeqRecvd !== seqNumber && dnetHeader.packetType === DataPacket;
    this.lastSeqRecvd = seqNumber;

    return { accepted: true, dispatchData };
  }

  parsePacket(data: Uint8Array): PacketData {
    const bs = new BitStream(data);

    // 1. Parse dnet header
    const dnetHeader = this.readDnetHeader(bs);
    const protocol = this.applyProtocolHeader(dnetHeader);

    this.packetsParsed++;

    // ConnectionProtocol may reject this packet entirely (window/connect checks),
    // or accept it but suppress game dispatch (duplicate seq / non-data packet).
    if (!protocol.accepted) {
      this.protocolRejected++;
      return {
        dnetHeader,
        rateInfo: {},
        gameState: this.emptyGameState(),
        events: [],
        ghosts: [],
      };
    }
    if (!protocol.dispatchData) {
      this.protocolNoDispatch++;
      return {
        dnetHeader,
        rateInfo: {},
        gameState: this.emptyGameState(),
        events: [],
        ghosts: [],
      };
    }

    // 2. Rate info (NetConnection::handlePacket)
    const rateInfo = this.readRateInfo(bs);

    // 3. Game state (GameConnection::readPacket — server connection path)
    bs.setStringBuffer(true);
    const gameState = this.readGameState(bs);

    // Only read events/ghosts if game state completed successfully.
    // When game state bails (control object dirty with no parser), the
    // stream position is wrong and we'd read garbage data.
    const gameStateComplete =
      gameState.controlObjectDataStart === undefined ||
      gameState.controlObjectData !== undefined;

    // 4. Events (NetConnection::readPacket -> eventReadPacket)
    const events = gameStateComplete ? this.readEvents(bs) : [];

    // Only read ghosts if all events were successfully parsed.
    // When an event can't be parsed, readEvents returns early and the
    // stream position is wrong — reading ghosts would produce garbage.
    const lastEvent = events[events.length - 1];
    const eventsComplete =
      !lastEvent || lastEvent.dataBitsEnd !== lastEvent.dataBitsStart;

    // 5. Ghosts (NetConnection::readPacket -> ghostReadPacket)
    const ghostSectionStart = gameStateComplete && eventsComplete
      ? bs.getCurPos()
      : undefined;
    const ghosts =
      gameStateComplete && eventsComplete
        ? this.readGhosts(bs, dnetHeader.seqNumber)
        : [];

    bs.setStringBuffer(false);

    return { dnetHeader, rateInfo, gameState, events, ghosts, ghostSectionStart };
  }

  /**
   * Parse the dnet packet header (from processRawPacket in dnet.cc).
   */
  private readDnetHeader(bs: BitStream): DnetHeader {
    const gameFlag = bs.readFlag();
    const connectSeqBit = bs.readInt(1);
    const seqNumber = bs.readInt(9);
    const highestAck = bs.readInt(9);
    const packetType = bs.readInt(2);
    const ackByteCount = bs.readInt(3);
    const ackMask = ackByteCount > 0 ? bs.readInt(8 * ackByteCount) : 0;

    return {
      gameFlag,
      connectSeqBit,
      seqNumber,
      highestAck,
      packetType,
      ackByteCount,
      ackMask,
    };
  }

  /**
   * Parse rate info from handlePacket in netConnection.cc.
   */
  private readRateInfo(bs: BitStream): RateInfo {
    const info: RateInfo = {};
    if (bs.readFlag()) {
      info.updateDelay = bs.readInt(10);
      info.packetSize = bs.readInt(10);
    }
    if (bs.readFlag()) {
      info.maxUpdateDelay = bs.readInt(10);
      info.maxPacketSize = bs.readInt(10);
    }
    return info;
  }

  /**
   * Parse game state from GameConnection::readPacket (server connection path).
   */
  private readGameState(bs: BitStream): GameState {
    const lastMoveAck = bs.readInt(32);

    // Damage flash / whiteout
    let damageFlash: number | undefined;
    let whiteOut: number | undefined;
    if (bs.readFlag()) {
      if (bs.readFlag()) {
        damageFlash = bs.readFloat(7);
      }
      if (bs.readFlag()) {
        whiteOut = bs.readFloat(7) * 1.5;
      }
    }

    // Lock/homing state
    let selfLocked: boolean | undefined;
    let selfHomed: boolean | undefined;
    if (bs.readFlag()) {
      selfLocked = bs.readFlag();
      selfHomed = bs.readFlag();
    }

    // Seeker tracking state
    let seekerTracking: boolean | undefined;
    let seekerTrackingPos: { x: number; y: number; z: number } | undefined;
    let seekerMode: number | undefined;
    let seekerObjectGhostIndex: number | undefined;
    let targetPos: { x: number; y: number; z: number } | undefined;
    if (bs.readFlag()) {
      seekerTracking = bs.readFlag();
      // Binary 0x005fc020: when seekerTracking is true, reads 3×F32 (Point3F)
      // for the seeker target position (stored at connection+0x8454)
      if (seekerTracking) {
        seekerTrackingPos = {
          x: bs.readF32(),
          y: bs.readF32(),
          z: bs.readF32(),
        };
      }
      seekerMode = bs.readRangedU32(0, 2);
      if (seekerMode === 1) {
        if (bs.readFlag()) {
          seekerObjectGhostIndex = bs.readRangedU32(0, MaxGhostCount - 1);
        }
      } else if (seekerMode === 2) {
        targetPos = {
          x: bs.readF32(),
          y: bs.readF32(),
          z: bs.readF32(),
        };
      }
    }

    // Sensor ping/jam flags
    const pinged = bs.readFlag();
    const jammed = bs.readFlag();

    // Control object state
    let controlObjectGhostIndex: number | undefined;
    let controlObjectDataStart: number | undefined;
    let controlObjectDataEnd: number | undefined;
    let controlObjectData: ParsedData | undefined;
    let compressionPoint: { x: number; y: number; z: number } | undefined;

    if (bs.readFlag()) {
      if (bs.readFlag()) {
        // Control object is dirty — full update via readPacketData.
        // In Tribes 2 (build 25034), only Player and Camera override
        // writePacketData/readPacketData, so the control object is
        // always one of these two classes. We try candidates in order:
        //   1. Tracker classId (may be stale due to ghost index recycling)
        //   2. Cached parser from previous successful parse of this index
        //   3. Player (classId 25) — the normal control object
        //   4. Camera (classId 4) — spectator mode
        const gIndex = bs.readInt(10);
        controlObjectGhostIndex = gIndex;
        controlObjectDataStart = bs.getCurPos();
        const start = bs.savePos();
        const ghost = this.ghostTracker.getGhost(gIndex);

        const preferredEntry = ghost
          ? this.registry.getGhostParser(ghost.classId)
          : undefined;
        const cachedEntry = this.controlParserByGhostIndex.get(gIndex);
        const playerEntry = this.registry.getGhostParser(25); // Player
        const cameraEntry = this.registry.getGhostParser(4);  // Camera

        // Build candidate list (deduplicated, only those with readPacketData)
        const candidates: GhostParserEntry[] = [];
        const seen = new Set<string>();
        const addCandidate = (entry: GhostParserEntry | undefined): void => {
          if (!entry?.readPacketData) return;
          if (seen.has(entry.name)) return;
          seen.add(entry.name);
          candidates.push(entry);
        };
        addCandidate(preferredEntry);
        addCandidate(cachedEntry);
        addCandidate(playerEntry);
        addCandidate(cameraEntry);

        let parsed = false;
        for (const entry of candidates) {
          bs.restorePos(start);
          try {
            const conn = this.getConnectionContext();
            const data = entry.readPacketData!(bs, conn);
            const bitsConsumed = bs.getCurPos() - controlObjectDataStart!;
            if (bitsConsumed <= 0 || bs.isError()) {
              continue;
            }

            controlObjectData = data;
            controlObjectDataEnd = bs.getCurPos();
            this.controlParserByGhostIndex.set(gIndex, entry);
            if (conn.compressionPoint !== this.compressionPoint) {
              this.compressionPoint = conn.compressionPoint;
              compressionPoint = this.compressionPoint;
            }
            this.controlObjectParsed++;
            parsed = true;
            break;
          } catch {
            // Try next candidate.
          }
        }

        if (!parsed) {
          bs.restorePos(start);
          // No parser — bail from game state
          controlObjectDataEnd = controlObjectDataStart;
          this.controlObjectFailed++;
          return {
            lastMoveAck,
            damageFlash,
            whiteOut,
            selfLocked,
            selfHomed,
            seekerTracking,
            seekerTrackingPos,
            seekerMode,
            seekerObjectGhostIndex,
            targetPos,
            pinged,
            jammed,
            controlObjectGhostIndex,
            controlObjectDataStart,
            controlObjectDataEnd,
            controlObjectData,
            targetVisibility: [],
          };
        }
      } else {
        // Compression point update — always accept (engine doesn't validate)
        compressionPoint = {
          x: bs.readF32(),
          y: bs.readF32(),
          z: bs.readF32(),
        };
        this.compressionPoint = compressionPoint;
      }
    }

    // Target visibility masks
    const targetVisibility: { index: number; mask: number }[] = [];
    while (bs.readFlag()) {
      targetVisibility.push({
        index: bs.readInt(4),
        mask: bs.readInt(32),
      });
    }

    // Camera FOV
    let cameraFov: number | undefined;
    if (bs.readFlag()) {
      cameraFov = bs.readInt(8);
    }

    return {
      lastMoveAck,
      damageFlash,
      whiteOut,
      selfLocked,
      selfHomed,
      seekerTracking,
      seekerTrackingPos,
      seekerMode,
      seekerObjectGhostIndex,
      targetPos,
      pinged,
      jammed,
      controlObjectGhostIndex,
      controlObjectDataStart,
      controlObjectDataEnd,
      controlObjectData,
      compressionPoint,
      targetVisibility: targetVisibility.length > 0 ? targetVisibility : undefined,
      cameraFov,
    };
  }

  /**
   * Parse events from eventReadPacket in netEvent.cc.
   *
   * Two phases:
   *   1. Unguaranteed events: while(readFlag) { classId(6b) + unpack }
   *   2. Guaranteed events: while(readFlag) { seqFlag(1b), [seq(7b)], classId(6b) + unpack }
   */
  private readEvents(bs: BitStream): NetEventInfo[] {
    const dispatchedEvents: NetEventInfo[] = [];
    let unguaranteedPhase = true;
    let prevGuaranteedSeq = -2;

    while (true) {
      const bit = bs.readFlag();
      if (unguaranteedPhase && !bit) {
        // Transition to guaranteed phase. Binary immediately reads one more
        // continuation bit for that phase.
        unguaranteedPhase = false;
        const guaranteedBit = bs.readFlag();
        if (!guaranteedBit) {
          this.dispatchGuaranteedEvents(dispatchedEvents);
          break;
        }
      } else if (!unguaranteedPhase && !bit) {
        this.dispatchGuaranteedEvents(dispatchedEvents);
        break;
      } else if (!bit) {
        break;
      }

      let sequenceNumber: number | undefined;
      let absoluteSequenceNumber: number | undefined;
      if (!unguaranteedPhase) {
        if (bs.readFlag()) {
          sequenceNumber = (prevGuaranteedSeq + 1) & 0x7f;
        } else {
          sequenceNumber = bs.readInt(7);
        }
        prevGuaranteedSeq = sequenceNumber;
        absoluteSequenceNumber =
          sequenceNumber | (this.nextRecvEventSeq & 0xffffff80);
        if (absoluteSequenceNumber < this.nextRecvEventSeq) {
          absoluteSequenceNumber += 0x80;
        }
      }

      const classId = bs.readInt(NetEventClassBitSize) + NetEventClassFirst;
      const dataBitsStart = bs.getCurPos();

      const parserEntry = this.registry.getEventParser(classId);
      let parsedData: ParsedData | undefined;

      if (parserEntry) {
        try {
          const conn = this.getConnectionContext();
          parsedData = parserEntry.unpack(bs, conn);
          this.eventsParsed++;
        } catch {
          this.eventsFailed++;
          dispatchedEvents.push({
            classId,
            guaranteed: !unguaranteedPhase,
            sequenceNumber,
            absoluteSequenceNumber,
            dataBitsStart,
            dataBitsEnd: dataBitsStart,
          });
          return dispatchedEvents;
        }
      } else {
        // No parser — cannot advance safely.
        dispatchedEvents.push({
          classId,
          guaranteed: !unguaranteedPhase,
          sequenceNumber,
          absoluteSequenceNumber,
          dataBitsStart,
          dataBitsEnd: dataBitsStart,
        });
        return dispatchedEvents;
      }

      const event: NetEventInfo = {
        classId,
        guaranteed: !unguaranteedPhase,
        sequenceNumber,
        absoluteSequenceNumber,
        dataBitsStart,
        dataBitsEnd: bs.getCurPos(),
        parsedData,
      };

      if (unguaranteedPhase) {
        dispatchedEvents.push(event);
        if (parsedData) {
          this.applyEventSideEffects(parsedData);
        }
      } else if (absoluteSequenceNumber !== undefined) {
        this.enqueueGuaranteedEvent(absoluteSequenceNumber, event);
      }
    }

    return dispatchedEvents;
  }

  private enqueueGuaranteedEvent(
    absoluteSequenceNumber: number,
    event: NetEventInfo
  ): void {
    let insertAt = 0;
    while (
      insertAt < this.pendingGuaranteedEvents.length &&
      this.pendingGuaranteedEvents[insertAt].absoluteSequenceNumber <
        absoluteSequenceNumber
    ) {
      insertAt++;
    }
    this.pendingGuaranteedEvents.splice(insertAt, 0, {
      absoluteSequenceNumber,
      event,
    });
  }

  private dispatchGuaranteedEvents(dispatchedEvents: NetEventInfo[]): void {
    while (
      this.pendingGuaranteedEvents.length > 0 &&
      this.pendingGuaranteedEvents[0].absoluteSequenceNumber ===
        this.nextRecvEventSeq
    ) {
      const queued = this.pendingGuaranteedEvents.shift();
      if (!queued) break;
      this.nextRecvEventSeq = (this.nextRecvEventSeq + 1) >>> 0;
      dispatchedEvents.push(queued.event);
      if (queued.event.parsedData) {
        this.applyEventSideEffects(queued.event.parsedData);
      }
    }
  }

  /**
   * Apply event side effects that alter ghost index state.
   * These effects occur before ghostReadPacket on the same packet.
   */
  private applyEventSideEffects(parsedData: ParsedData): void {
    const eventType = parsedData.type;

    if (eventType === "GhostingMessageEvent") {
      const message = parsedData.message;
      // Tribes 2 handleGhostMessage: EndGhosting clears all local ghosts
      // and invalidates all datablocks (they get re-sent for the new mission).
      if (typeof message === "number" && message === GhostMsgEndGhosting) {
        this.ghostTracker.clear();
        this.dataBlockDataMap?.clear();
      }
      return;
    }

    if (eventType === "GhostAlwaysObjectEvent") {
      const ghostIndex = parsedData.ghostIndex;
      const classId = parsedData.classId;
      if (typeof ghostIndex === "number" && typeof classId === "number") {
        const parserEntry = this.registry.getGhostParser(classId);
        this.ghostTracker.createGhost(
          ghostIndex,
          classId,
          parserEntry?.name ?? `unknown_${classId}`
        );
      }
    }

    // SimDataBlockEvent: store parsed DataBlock data so ghost parsers
    // (e.g., WheeledVehicle wheel count) can look it up by objectId.
    if (eventType === "SimDataBlockEvent" && this.dataBlockDataMap) {
      const dbEvent = parsedData as SimDataBlockEventData;
      if (
        dbEvent.dataBlockData &&
        typeof dbEvent.objectId === "number"
      ) {
        this.dataBlockDataMap.set(dbEvent.objectId, dbEvent.dataBlockData);
      }
    }
  }

  /**
   * Parse ghosts from ghostReadPacket in netGhost.cc.
   */
  private readGhosts(bs: BitStream, seqNumber: number): GhostUpdate[] {
    const ghosts: GhostUpdate[] = [];

    if (!bs.readFlag()) {
      return ghosts;
    }

    const idSize = bs.readInt(3) + 3;

    while (bs.readFlag()) {
      // If the stream ran out of data during the moreFlag read, the
      // readFlag returned false (terminating the loop) with error set.
      // Check here for the case where readFlag returned true but the
      // subsequent header reads exhaust the stream.
      if (bs.isError()) break;

      const index = bs.readInt(idSize);

      // If the stream ran out of data during header reads, stop processing.
      // Without this check, exhausted reads return 0 (defaulting index to 0,
      // classId to 0) and the ghost parser runs on empty data, producing
      // a "successful" parse that consumed 0 bits.
      if (bs.isError()) break;

      if (bs.readFlag()) {
        // Ghost is being deleted
        this.ghostTracker.deleteGhost(index);
        this.ghostDeletes++;
        ghosts.push({
          index,
          type: "delete",
          updateBitsStart: bs.getCurPos(),
          updateBitsEnd: bs.getCurPos(),
        });
        continue;
      }

      const isNew = !this.ghostTracker.hasGhost(index);
      let classId: number | undefined;

      if (isNew) {
        classId = bs.readInt(NetObjectClassBitSize) + NetObjectClassFirst;
      } else {
        classId = this.ghostTracker.getGhost(index)?.classId;
      }

      const updateBitsStart = bs.getCurPos();
      const parserEntry = classId !== undefined
        ? this.registry.getGhostParser(classId)
        : undefined;

      // Detect tracker divergence: we think this is a new ghost (not in our
      // tracker) but the classId is unregistered. This almost certainly means
      // the server sent UPDATE data (no classId prefix) for a ghost our tracker
      // lost, and we misread the first 7 bits of update data as a classId.
      // This is engine-consistent — the real client would also fail here
      // because classId lookup would return NULL, triggering packet drop.
      if (isNew && !parserEntry) {
        this.ghostsTrackerDiverged++;
        debugGhosts(
          "DIVERGED pkt=%d seq=%d idx=%d classId=%d bit=%d/%d trackerSize=%d " +
          "(server sent UPDATE for ghost not in our tracker; 7-bit classId is actually update data)",
          this.packetsParsed, seqNumber, index, classId,
          updateBitsStart, bs.getMaxPos(), this.ghostTracker.size()
        );
        ghosts.push({
          index,
          type: "create",
          classId,
          updateBitsStart,
          updateBitsEnd: updateBitsStart,
        });
        return ghosts;
      }

      let parsed = false;

      if (parserEntry) {
        try {
          const conn = this.getConnectionContext();
          conn.currentGhostIndex = index;
          const parsedData = parserEntry.unpackUpdate(bs, isNew, conn);
          const endPos = bs.getCurPos();

          if (isNew && classId !== undefined) {
            this.ghostTracker.createGhost(index, classId, parserEntry.name);
            this.ghostCreatesParsed++;
          } else {
            this.ghostUpdatesParsed++;
          }

          ghosts.push({
            index,
            type: isNew ? "create" : "update",
            classId,
            updateBitsStart,
            updateBitsEnd: endPos,
            parsedData,
          });
          parsed = true;
        } catch (e) {
          this.ghostsFailed++;
          const op = isNew ? "create" : "update";
          const message = e instanceof Error ? e.message : String(e);
          debugGhosts(
            "FAIL pkt=%d seq=%d #%d idx=%d op=%s classId=%d parser=%s bit=%d/%d trackerSize=%d err=%s",
            this.packetsParsed, seqNumber, ghosts.length, index, op, classId,
            parserEntry.name, updateBitsStart, bs.getMaxPos(),
            this.ghostTracker.size(), message
          );
        }
      }

      if (parsed) continue;

      debugGhosts(
        "STOP pkt=%d seq=%d idx=%d op=%s classId=%d parser=%s bit=%d/%d",
        this.packetsParsed, seqNumber, index, isNew ? "create" : "update",
        classId, parserEntry?.name ?? "NONE", updateBitsStart, bs.getMaxPos()
      );

      // Record and stop — can't parse this ghost's data.
      ghosts.push({
        index,
        type: isNew ? "create" : "update",
        classId,
        updateBitsStart,
        updateBitsEnd: updateBitsStart,
      });
      return ghosts;
    }

    return ghosts;
  }

  private emptyGameState(): GameState {
    return {
      lastMoveAck: 0,
      pinged: false,
      jammed: false,
    };
  }
}
