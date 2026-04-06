import type {
  DemoFile,
  DemoBlock,
  PacketData,
  GhostUpdate,
  NetEventInfo,
} from "./types.js";
import { BlockTypePacket } from "./types.js";
import type { ClassRegistry, ParsedData } from "./ClassRegistry.js";
import type { Vec3, Quat } from "./dataTypes.js";

export type { Vec3, Quat };

// ============================================================
// Timeline data structures for Three.js animation output
// ============================================================

/** A single keyframe for a ghost object. */
export interface GhostKeyframe {
  time: number;
  position?: Vec3;
  rotation?: Quat | Vec3;
  velocity?: Vec3;
  data?: ParsedData;
}

/** A continuous lifecycle segment of a ghost (from create to delete). */
export interface GhostInstance {
  ghostIndex: number;
  classId: number;
  className: string;
  spawnTime: number;
  despawnTime?: number;
  keyframes: GhostKeyframe[];
}

/** Keyframe for the control object (recording player). */
export interface ControlObjectKeyframe {
  time: number;
  ghostIndex: number;
  position?: Vec3;
  velocity?: Vec3;
  data?: ParsedData;
}

/** A timestamped game event. */
export interface GameEvent {
  time: number;
  type: string;
  classId: number;
  guaranteed: boolean;
  data?: ParsedData;
}

/** Complete timeline extracted from a demo file. */
export interface DemoTimeline {
  durationMs: number;
  tickIntervalMs: number;
  packetCount: number;
  ghostInstances: GhostInstance[];
  controlObject: ControlObjectKeyframe[];
  events: GameEvent[];
}

// ============================================================
// Timeline builder
// ============================================================

/**
 * Extracts a time-indexed DemoTimeline from a parsed DemoFile.
 *
 * Timestamps are derived by distributing packet blocks evenly across
 * the demo duration (Torque sends packets at a fixed tick rate).
 */
export function buildTimeline(
  demo: DemoFile,
  registry: ClassRegistry
): DemoTimeline {
  const packetBlocks: { block: DemoBlock; pkt: PacketData }[] = [];

  for (const block of demo.blocks) {
    if (
      block.type === BlockTypePacket &&
      block.parsed &&
      "dnetHeader" in block.parsed
    ) {
      packetBlocks.push({ block, pkt: block.parsed });
    }
  }

  const packetCount = packetBlocks.length;
  const durationMs = demo.header.demoLengthMs;
  const tickIntervalMs = packetCount > 1 ? durationMs / (packetCount - 1) : 0;

  // Track active ghost instances (ghostIndex → current instance)
  const activeGhosts = new Map<number, GhostInstance>();
  const allInstances: GhostInstance[] = [];
  const controlObject: ControlObjectKeyframe[] = [];
  const events: GameEvent[] = [];

  // Seed active ghosts from the initial block — these ghosts were created
  // before recording started and only receive updates in the packet stream.
  for (const ghost of demo.initialBlock.initialGhosts) {
    if (ghost.type === "create" && ghost.classId !== undefined) {
      const parserEntry = registry.getGhostParser(ghost.classId);
      const instance: GhostInstance = {
        ghostIndex: ghost.index,
        classId: ghost.classId,
        className: parserEntry?.name ?? `ghost_${ghost.classId}`,
        spawnTime: 0,
        keyframes: [],
      };
      if (ghost.parsedData) {
        instance.keyframes.push(makeGhostKeyframe(0, ghost.parsedData));
      }
      activeGhosts.set(ghost.index, instance);
      allInstances.push(instance);
    }
  }

  for (let i = 0; i < packetBlocks.length; i++) {
    const time = i * tickIntervalMs;
    const { pkt } = packetBlocks[i];

    // --- Control object position ---
    if (pkt.gameState.compressionPoint || pkt.gameState.controlObjectData) {
      const coData = pkt.gameState.controlObjectData;
      const coPos = coData?.position;
      const rawPosition = isVec3(coPos)
        ? coPos
        : pkt.gameState.compressionPoint;
      const position =
        rawPosition && isValidPosition(rawPosition) ? rawPosition : undefined;

      if (position) {
        const coVel = coData?.velocity;
        controlObject.push({
          time,
          ghostIndex: pkt.gameState.controlObjectGhostIndex ?? -1,
          position,
          velocity: isVec3(coVel) ? coVel : undefined,
          data: coData,
        });
      }
    }

    // --- Events ---
    for (const evt of pkt.events) {
      const parserEntry = registry.getEventParser(evt.classId);
      events.push({
        time,
        type: parserEntry?.name ?? `event_${evt.classId}`,
        classId: evt.classId,
        guaranteed: evt.guaranteed,
        data: evt.parsedData,
      });
    }

    // --- Ghost updates ---
    for (const ghost of pkt.ghosts) {
      if (ghost.type === "create" && ghost.classId !== undefined) {
        // End any existing instance at this index (shouldn't happen often)
        const prev = activeGhosts.get(ghost.index);
        if (prev && prev.despawnTime === undefined) {
          prev.despawnTime = time;
        }

        const parserEntry =
          ghost.classId !== undefined
            ? registry.getGhostParser(ghost.classId)
            : undefined;

        const instance: GhostInstance = {
          ghostIndex: ghost.index,
          classId: ghost.classId,
          className: parserEntry?.name ?? `ghost_${ghost.classId}`,
          spawnTime: time,
          keyframes: [],
        };

        if (ghost.parsedData) {
          instance.keyframes.push(
            makeGhostKeyframe(time, ghost.parsedData)
          );
        }

        activeGhosts.set(ghost.index, instance);
        allInstances.push(instance);
      } else if (ghost.type === "update") {
        const instance = activeGhosts.get(ghost.index);
        if (instance && ghost.parsedData) {
          instance.keyframes.push(
            makeGhostKeyframe(time, ghost.parsedData)
          );
        }
      } else if (ghost.type === "delete") {
        const instance = activeGhosts.get(ghost.index);
        if (instance) {
          instance.despawnTime = time;
          activeGhosts.delete(ghost.index);
        }
      }
    }
  }

  return {
    durationMs,
    tickIntervalMs,
    packetCount,
    ghostInstances: allInstances,
    controlObject,
    events,
  };
}

/**
 * Check if a Vec3 position is within reasonable game world bounds.
 * Rejects IEEE 754 denormalized values (e.g., 1.66e-34) that indicate
 * garbage data from bit stream misalignment.
 */
function isValidPosition(pos: Vec3): boolean {
  const vals = [pos.x, pos.y, pos.z];
  return vals.every(
    (v) =>
      Number.isFinite(v) &&
      Math.abs(v) < 50000 &&
      (Math.abs(v) >= 0.01 || v === 0)
  );
}

function isVec3(v: unknown): v is Vec3 {
  if (v === null || typeof v !== "object") return false;
  const o = v as ParsedData;
  return (
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.z === "number"
  );
}

/** Extract position/rotation/velocity from parsed ghost data into a keyframe. */
function makeGhostKeyframe(
  time: number,
  data: ParsedData
): GhostKeyframe {
  const kf: GhostKeyframe = { time };

  if (isVec3(data.position) && isValidPosition(data.position)) {
    kf.position = data.position;
  }
  if (isVec3(data.rotation)) {
    // Rotation may be Vec3 (euler) or Quat (with w).
    kf.rotation = data.rotation;
  }
  if (isVec3(data.velocity)) {
    kf.velocity = data.velocity;
  }

  // Store full data for consumers that need more detail
  kf.data = data;

  return kf;
}

// ============================================================
// Timeline summary / stats
// ============================================================

export interface TimelineStats {
  durationMs: number;
  tickIntervalMs: number;
  packetCount: number;
  controlObjectKeyframes: number;
  totalGhostInstances: number;
  ghostInstancesByClass: Map<string, number>;
  ghostKeyframesByClass: Map<string, number>;
  ghostsWithPosition: number;
  totalEvents: number;
  eventsByType: Map<string, number>;
}

export function getTimelineStats(timeline: DemoTimeline): TimelineStats {
  const ghostInstancesByClass = new Map<string, number>();
  const ghostKeyframesByClass = new Map<string, number>();
  let ghostsWithPosition = 0;

  for (const inst of timeline.ghostInstances) {
    ghostInstancesByClass.set(
      inst.className,
      (ghostInstancesByClass.get(inst.className) || 0) + 1
    );
    ghostKeyframesByClass.set(
      inst.className,
      (ghostKeyframesByClass.get(inst.className) || 0) + inst.keyframes.length
    );
    if (inst.keyframes.some((kf) => kf.position !== undefined)) {
      ghostsWithPosition++;
    }
  }

  const eventsByType = new Map<string, number>();
  for (const evt of timeline.events) {
    eventsByType.set(evt.type, (eventsByType.get(evt.type) || 0) + 1);
  }

  return {
    durationMs: timeline.durationMs,
    tickIntervalMs: timeline.tickIntervalMs,
    packetCount: timeline.packetCount,
    controlObjectKeyframes: timeline.controlObject.length,
    totalGhostInstances: timeline.ghostInstances.length,
    ghostInstancesByClass,
    ghostKeyframesByClass,
    ghostsWithPosition,
    totalEvents: timeline.events.length,
    eventsByType,
  };
}

// ============================================================
// JSON export for Three.js consumption
// ============================================================

/** Slimmed-down ghost instance for JSON export (no raw data blobs). */
interface ExportGhostKeyframe {
  t: number;
  p?: [number, number, number];
  r?: [number, number, number] | [number, number, number, number];
  v?: [number, number, number];
}

interface ExportGhostInstance {
  ghostIndex: number;
  classId: number;
  className: string;
  spawnTime: number;
  despawnTime?: number;
  keyframes: ExportGhostKeyframe[];
}

interface ExportControlKeyframe {
  t: number;
  p?: [number, number, number];
  v?: [number, number, number];
}

export interface ExportTimeline {
  durationMs: number;
  tickIntervalMs: number;
  controlObject: ExportControlKeyframe[];
  ghosts: ExportGhostInstance[];
  events: GameEvent[];
}

/**
 * Convert a DemoTimeline to a compact JSON-serializable format
 * suitable for Three.js consumption. Positions/rotations are
 * packed into arrays, and only ghost instances with position
 * data are included.
 */
export function exportTimeline(timeline: DemoTimeline): ExportTimeline {
  const controlObject: ExportControlKeyframe[] = timeline.controlObject
    .filter((co) => co.position !== undefined)
    .map((co) => {
      const kf: ExportControlKeyframe = { t: Math.round(co.time) };
      if (co.position)
        kf.p = [co.position.x, co.position.y, co.position.z];
      if (co.velocity) kf.v = [co.velocity.x, co.velocity.y, co.velocity.z];
      return kf;
    });

  const ghosts: ExportGhostInstance[] = [];
  for (const inst of timeline.ghostInstances) {
    // Only export instances that have at least one valid position keyframe
    const posKeyframes = inst.keyframes.filter(
      (kf) => kf.position !== undefined
    );
    if (posKeyframes.length === 0) continue;

    const keyframes: ExportGhostKeyframe[] = posKeyframes.map((kf) => {
      const ekf: ExportGhostKeyframe = { t: Math.round(kf.time) };
      if (kf.position)
        ekf.p = [kf.position.x, kf.position.y, kf.position.z];
      if (kf.rotation) {
        const r = kf.rotation;
        ekf.r =
          "w" in r
            ? [r.x, r.y, r.z, r.w]
            : [r.x, r.y, r.z];
      }
      if (kf.velocity)
        ekf.v = [kf.velocity.x, kf.velocity.y, kf.velocity.z];
      return ekf;
    });
    if (keyframes.length === 0) continue;

    ghosts.push({
      ghostIndex: inst.ghostIndex,
      classId: inst.classId,
      className: inst.className,
      spawnTime: Math.round(inst.spawnTime),
      despawnTime:
        inst.despawnTime !== undefined
          ? Math.round(inst.despawnTime)
          : undefined,
      keyframes,
    });
  }

  return {
    durationMs: timeline.durationMs,
    tickIntervalMs: timeline.tickIntervalMs,
    controlObject,
    ghosts,
    events: timeline.events,
  };
}
