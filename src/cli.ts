#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { DemoParser } from "./DemoParser.js";
import {
  BlockTypePacket,
  BlockTypeSendPacket,
  BlockTypeMove,
  BlockTypeInfo,
} from "./types.js";
import type { PacketData } from "./types.js";
import {
  buildTimeline,
  getTimelineStats,
  exportTimeline,
} from "./Timeline.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: t2-demo-parser <path-to-rec-file>");
  process.exit(1);
}

const resolvedPath = path.resolve(filePath);
console.log(`Parsing: ${resolvedPath}`);
console.log(`File size: ${fs.statSync(resolvedPath).size} bytes`);
console.log();

const buffer = fs.readFileSync(resolvedPath);

// ================================================================
// Full parse with automatic discovery
// ================================================================
const parser = new DemoParser(buffer);
const demo = await parser.parseFullDemo();

const registry = parser.getRegistry();
const packetBlocks = demo.blocks.filter((b) => b.type === BlockTypePacket);
const parsedPackets = packetBlocks.filter(
  (b) => b.parsed && "dnetHeader" in b.parsed
);

// ================================================================
// DataBlock summary from initial block parsing
// ================================================================
{
  const shapeBlocks = [...demo.initialBlock.dataBlocks.values()].filter(
    (db) => db.data.shapeName
  );
  if (shapeBlocks.length > 0) {
    console.log(`DataBlocks with shapeName (${shapeBlocks.length} total):`);
    for (const db of shapeBlocks.slice(0, 20)) {
      console.log(
        `  objId=${db.objectId} classId=${db.classId} [${db.className}]: ${db.data.shapeName}`
      );
    }
    if (shapeBlocks.length > 20) {
      console.log(`  ... and ${shapeBlocks.length - 20} more`);
    }
  }

  const dbByClass = new Map<string, number>();
  for (const [_objId, db] of demo.initialBlock.dataBlocks) {
    dbByClass.set(db.className, (dbByClass.get(db.className) || 0) + 1);
  }
  if (dbByClass.size > 0) {
    console.log("DataBlock types parsed:");
    for (const [name, count] of [...dbByClass.entries()].sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${name}: ${count}`);
    }
  }
}

// ================================================================
// Output results
// ================================================================
console.log();
console.log("=== Summary ===");
console.log(
  `Protocol version: 0x${demo.header.protocolVersion.toString(16)}`
);
console.log(
  `Demo length: ${demo.header.demoLengthMs}ms (${formatTime(demo.header.demoLengthMs)})`
);

const moveBlocks = demo.blocks.filter((b) => b.type === BlockTypeMove);
const infoBlocks = demo.blocks.filter((b) => b.type === BlockTypeInfo);
const sendPacketBlocks = demo.blocks.filter(
  (b) => b.type === BlockTypeSendPacket
);

// Analyze ghost failures and unbound operations
const ghostFailuresByClass = new Map<string, number>();
const unboundGhostOps = new Map<number, { creates: number; updates: number }>();
for (const block of parsedPackets) {
  const pkt = block.parsed as PacketData;
  for (const ghost of pkt.ghosts) {
    if (ghost.classId !== undefined && ghost.parsedData === undefined && ghost.type !== "delete") {
      const binding = registry.getGhostParser(ghost.classId);
      if (binding) {
        ghostFailuresByClass.set(binding.name, (ghostFailuresByClass.get(binding.name) || 0) + 1);
      } else {
        const entry = unboundGhostOps.get(ghost.classId) || { creates: 0, updates: 0 };
        if (ghost.type === "create") entry.creates++;
        else entry.updates++;
        unboundGhostOps.set(ghost.classId, entry);
      }
    }
  }
}
if (ghostFailuresByClass.size > 0) {
  console.log("\nGhost failures by type:");
  for (const [name, count] of [...ghostFailuresByClass.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`);
  }
}
if (unboundGhostOps.size > 0) {
  console.log(`\nUnbound ghost classIds (${unboundGhostOps.size} total):`);
  for (const [classId, ops] of [...unboundGhostOps.entries()].sort(
    (a, b) => (b[1].creates + b[1].updates) - (a[1].creates + a[1].updates)
  ).slice(0, 10)) {
    console.log(`  classId ${classId}: ${ops.creates} creates, ${ops.updates} updates`);
  }
}

console.log();
console.log(`Total blocks: ${demo.blocks.length}`);
console.log(`  Packet blocks (type 0): ${packetBlocks.length}`);
console.log(`  SendPacket blocks (type 1): ${sendPacketBlocks.length}`);
console.log(`  Move blocks (type 2): ${moveBlocks.length}`);
console.log(`  Info blocks (type 3): ${infoBlocks.length}`);

// Sequence numbers
if (parsedPackets.length > 0) {
  const seqNums = parsedPackets.map(
    (b) => (b.parsed as PacketData).dnetHeader.seqNumber
  );
  let seqGaps = 0;
  for (let i = 1; i < seqNums.length; i++) {
    const expected = (seqNums[i - 1] + 1) & 0x1ff;
    if (seqNums[i] !== expected) seqGaps++;
  }
  console.log();
  console.log(
    `Sequence numbers: ${seqNums[0]} → ${seqNums[seqNums.length - 1]}, ` +
      `${seqGaps} gaps out of ${seqNums.length - 1} transitions`
  );
}

// Collect classId stats
const eventClassIds = new Map<number, number>();
const ghostClassIds = new Map<number, number>();
for (const block of parsedPackets) {
  const pkt = block.parsed as PacketData;
  for (const evt of pkt.events) {
    eventClassIds.set(evt.classId, (eventClassIds.get(evt.classId) || 0) + 1);
  }
  for (const ghost of pkt.ghosts) {
    if (ghost.classId !== undefined) {
      ghostClassIds.set(
        ghost.classId,
        (ghostClassIds.get(ghost.classId) || 0) + 1
      );
    }
  }
}

// Show event bindings
if (eventClassIds.size > 0) {
  console.log();
  console.log(`Event classIds (${eventClassIds.size} unique):`);
  for (const [id, count] of [...eventClassIds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)) {
    const binding = registry.getEventParser(id);
    console.log(
      `  ${id}: ${count} occurrences${binding ? ` → ${binding.name}` : ""}`
    );
  }
}

// Show ghost bindings
if (ghostClassIds.size > 0) {
  console.log();
  console.log(`Ghost classIds (${ghostClassIds.size} unique):`);
  for (const [id, count] of [...ghostClassIds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)) {
    const binding = registry.getGhostParser(id);
    console.log(
      `  ${id}: ${count} occurrences${binding ? ` → ${binding.name}` : ""}`
    );
  }
}

// Ghost tracker state
const ghostTracker = parser.getGhostTracker();
const allGhosts = ghostTracker.getAllGhosts();
if (allGhosts.size > 0) {
  console.log();
  console.log(`Active ghosts (${allGhosts.size} total):`);
  const classCounts = new Map<string, number>();
  for (const [_idx, ghost] of allGhosts) {
    const name = ghost.className || `unknown(${ghost.classId})`;
    classCounts.set(name, (classCounts.get(name) || 0) + 1);
  }
  for (const [name, count] of [...classCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${name}: ${count}`);
  }
}

// Player position trajectory
const positionSamples: {
  blockIdx: number;
  pos: { x: number; y: number; z: number };
}[] = [];
for (const block of parsedPackets) {
  const pkt = block.parsed as PacketData;
  if (pkt.gameState.compressionPoint) {
    positionSamples.push({
      blockIdx: block.index,
      pos: pkt.gameState.compressionPoint,
    });
  }
  const cod = pkt.gameState.controlObjectData as
    | Record<string, unknown>
    | undefined;
  if (cod?.position) {
    positionSamples.push({
      blockIdx: block.index,
      pos: cod.position as { x: number; y: number; z: number },
    });
  }
}

if (positionSamples.length > 0) {
  console.log();
  console.log(`Player position samples: ${positionSamples.length}`);
  const step = Math.max(1, Math.floor(positionSamples.length / 8));
  for (let i = 0; i < positionSamples.length; i += step) {
    const s = positionSamples[i];
    console.log(
      `  block[${s.blockIdx}]: (${s.pos.x.toFixed(1)}, ${s.pos.y.toFixed(1)}, ${s.pos.z.toFixed(1)})`
    );
  }
}

// Ghost updates with position data
let ghostsWithPosition = 0;
for (const block of parsedPackets) {
  const pkt = block.parsed as PacketData;
  for (const ghost of pkt.ghosts) {
    if (ghost.parsedData?.position) ghostsWithPosition++;
  }
}
if (ghostsWithPosition > 0) {
  console.log();
  console.log(`Ghost updates with position data: ${ghostsWithPosition}`);
}

// First 5 packets detail
if (parsedPackets.length > 0) {
  console.log();
  console.log("First 5 packets:");
  for (const block of parsedPackets.slice(0, 5)) {
    const pkt = block.parsed as PacketData;
    console.log(
      `  [${block.index}] seq=${pkt.dnetHeader.seqNumber} events=${pkt.events.length} ghosts=${pkt.ghosts.length}`
    );
    if (pkt.gameState.controlObjectGhostIndex !== undefined) {
      console.log(
        `    controlObject=ghost#${pkt.gameState.controlObjectGhostIndex}` +
          (pkt.gameState.controlObjectData ? " (parsed)" : " (unparsed)")
      );
    }
    if (pkt.gameState.compressionPoint) {
      const cp = pkt.gameState.compressionPoint;
      console.log(
        `    pos=(${cp.x.toFixed(1)}, ${cp.y.toFixed(1)}, ${cp.z.toFixed(1)})`
      );
    }
    if (pkt.gameState.cameraFov !== undefined) {
      console.log(`    cameraFov=${pkt.gameState.cameraFov}`);
    }
    for (const evt of pkt.events.slice(0, 3)) {
      const p = evt.parsedData;
      console.log(
        `    event: classId=${evt.classId}${p ? ` → ${(p as any).type || "?"}` : " (unparsed)"}`
      );
    }
    for (const ghost of pkt.ghosts.slice(0, 3)) {
      const name = ghost.classId !== undefined
        ? registry.getGhostParser(ghost.classId)?.name || `?`
        : "";
      console.log(
        `    ghost: idx=${ghost.index} ${ghost.type}${name ? ` [${name}]` : ""}${ghost.parsedData ? " (parsed)" : ""}`
      );
    }
  }
}

// Parsed moves
const parsedMoves = moveBlocks.filter((b) => b.parsed && "yaw" in b.parsed);
console.log();
console.log(`Parsed moves: ${parsedMoves.length}`);

// ================================================================
// Build timeline
// ================================================================
console.log();
console.log("=== Timeline ===");
const timeline = buildTimeline(demo, registry);
const stats = getTimelineStats(timeline);

console.log(
  `Duration: ${formatTime(stats.durationMs)}, ` +
    `tick interval: ${stats.tickIntervalMs.toFixed(1)}ms, ` +
    `${stats.packetCount} packets`
);
console.log(`Control object keyframes: ${stats.controlObjectKeyframes}`);
console.log(
  `Ghost instances: ${stats.totalGhostInstances} (${stats.ghostsWithPosition} with position data)`
);

// Ghost instances by class (top types)
if (stats.ghostInstancesByClass.size > 0) {
  console.log();
  console.log("Ghost instances by class:");
  for (const [name, count] of [...stats.ghostInstancesByClass.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)) {
    const kfCount = stats.ghostKeyframesByClass.get(name) || 0;
    console.log(`  ${name}: ${count} instances, ${kfCount} keyframes`);
  }
}

// Events summary
if (stats.eventsByType.size > 0) {
  console.log();
  console.log(`Events: ${stats.totalEvents} total`);
  for (const [type, count] of [...stats.eventsByType.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)) {
    console.log(`  ${type}: ${count}`);
  }
}

// Sample player positions from timeline
if (timeline.controlObject.length > 0) {
  console.log();
  console.log("Player trajectory (from timeline):");
  const step = Math.max(1, Math.floor(timeline.controlObject.length / 6));
  for (let i = 0; i < timeline.controlObject.length; i += step) {
    const co = timeline.controlObject[i];
    if (co.position) {
      console.log(
        `  ${formatTime(co.time)}: (${co.position.x.toFixed(1)}, ${co.position.y.toFixed(1)}, ${co.position.z.toFixed(1)})`
      );
    }
  }
}

// Sample Player ghost trajectories
const playerInstances = timeline.ghostInstances.filter(
  (inst) => inst.className === "Player" && inst.keyframes.some((kf) => kf.position)
);
if (playerInstances.length > 0) {
  console.log();
  console.log(`Player ghost instances: ${playerInstances.length}`);
  for (const inst of playerInstances.slice(0, 3)) {
    const posKfs = inst.keyframes.filter((kf) => kf.position);
    const first = posKfs[0];
    const last = posKfs[posKfs.length - 1];
    console.log(
      `  ghost#${inst.ghostIndex}: ${posKfs.length} position keyframes, ` +
        `${formatTime(inst.spawnTime)}–${inst.despawnTime !== undefined ? formatTime(inst.despawnTime) : "active"}`
    );
    if (first?.position && last?.position) {
      console.log(
        `    first: (${first.position.x.toFixed(1)}, ${first.position.y.toFixed(1)}, ${first.position.z.toFixed(1)}) at ${formatTime(first.time)}`
      );
      console.log(
        `    last:  (${last.position.x.toFixed(1)}, ${last.position.y.toFixed(1)}, ${last.position.z.toFixed(1)}) at ${formatTime(last.time)}`
      );
    }
  }
}

// ================================================================
// Experiment metrics export (optional via env)
// ================================================================
{
  const metricsPath = process.env.EXPERIMENT_METRICS_PATH;
  if (metricsPath) {
    const metrics = {
      timestampIso: new Date().toISOString(),
      inputFile: resolvedPath,
      initialPhase2: {
        valid: demo.initialBlock.phase2Valid ?? false,
        trailingBits: demo.initialBlock.phase2TrailingBits ?? null,
        error: demo.initialBlock.phase2Error ?? null,
        events: demo.initialBlock.initialEvents.length,
        ghosts: demo.initialBlock.initialGhosts.length,
        ghostingSequence: demo.initialBlock.ghostingSequence,
        controlObjectGhostIndex: demo.initialBlock.controlObjectGhostIndex,
        missionName: demo.initialBlock.missionName,
        missionCRC: demo.initialBlock.missionCRC,
      },
      counts: {
        blocksTotal: demo.blocks.length,
        packetBlocks: packetBlocks.length,
        parsedPackets: parsedPackets.length,
        moveBlocks: moveBlocks.length,
        infoBlocks: infoBlocks.length,
        eventClassIdsUnique: eventClassIds.size,
        ghostClassIdsUnique: ghostClassIds.size,
        unboundGhostClassIds: unboundGhostOps.size,
      },
      topUnboundGhostClassIds: [...unboundGhostOps.entries()]
        .sort(
          (a, b) =>
            b[1].creates +
            b[1].updates -
            (a[1].creates + a[1].updates)
        )
        .slice(0, 20)
        .map(([classId, ops]) => ({
          classId,
          creates: ops.creates,
          updates: ops.updates,
        })),
    };

    const resolvedMetricsPath = path.resolve(metricsPath);
    fs.writeFileSync(resolvedMetricsPath, JSON.stringify(metrics, null, 2));
    console.log();
    console.log(`Experiment metrics written: ${resolvedMetricsPath}`);
  }
}

// ================================================================
// JSON export (optional --json flag)
// ================================================================
if (process.argv.includes("--json")) {
  const exportData = exportTimeline(timeline);
  const outputPath = resolvedPath.replace(/\.rec$/i, ".timeline.json");
  fs.writeFileSync(outputPath, JSON.stringify(exportData));
  console.log();
  console.log(`Timeline exported to: ${outputPath}`);
  console.log(
    `  ${exportData.controlObject.length} control keyframes, ` +
      `${exportData.ghosts.length} ghost tracks, ` +
      `${exportData.events.length} events`
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}
