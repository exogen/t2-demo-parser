import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DemoParser } from "./DemoParser.js";
import type { DemoBlock } from "./types.js";

const file = path.resolve(
  import.meta.dirname,
  "../data/exogen_Katabatic_vpad.rec",
);
function drain(parser: DemoParser) {
  const blocks: DemoBlock[] = [];
  let block: DemoBlock | undefined;
  while ((block = parser.nextBlock())) blocks.push(block);
  return blocks;
}

describe("demo checkpoints", () => {
  it("replays the exact decoded suffix repeatedly, including after reset", async () => {
    const parser = new DemoParser(await fs.readFile(file));
    await parser.load();
    parser.processBlocks(100);
    const checkpoint = parser.createCheckpoint();
    const before = structuredClone(checkpoint);
    const expected = drain(parser);
    expect(expected.length).toBeGreaterThan(0);
    const packetState = parser.getPacketParser().saveState();
    const ghosts = structuredClone(parser.getGhostTracker().getAllGhosts());
    for (let repeat = 0; repeat < 2; repeat++) {
      parser.reset();
      parser.restoreCheckpoint(checkpoint);
      expect(parser.blockCursor).toBe(100);
      expect(drain(parser)).toEqual(expected);
      expect(parser.getPacketParser().saveState()).toEqual(packetState);
      expect(parser.getGhostTracker().getAllGhosts()).toEqual(ghosts);
      expect(checkpoint).toEqual(before);
    }
  });

  it("preserves newly downloaded bytes when restoring an older checkpoint", async () => {
    const bytes = await fs.readFile(file);
    const { byteLength, header } = DemoParser.peekHeader(bytes);
    const prefix = byteLength + header.initialBlockSize;
    const half = prefix + Math.floor((bytes.length - prefix) / 2);
    const parser = new DemoParser(bytes.subarray(0, half), {
      incremental: true,
    });
    await parser.load();
    parser.processBlocks(10);
    const checkpoint = parser.createCheckpoint();
    const expected = drain(parser);
    parser.push(bytes.subarray(half));
    parser.finish();
    expected.push(...drain(parser));
    const bufferedTicks = parser.bufferedMoveTicks;
    parser.restoreCheckpoint(checkpoint);
    expect(parser.isComplete).toBe(true);
    expect(parser.bufferedMoveTicks).toBe(bufferedTicks);
    expect(drain(parser)).toEqual(expected);
  });

  it("rejects a checkpoint from a different recording", async () => {
    const bytes = await fs.readFile(file);
    const a = new DemoParser(bytes),
      b = new DemoParser(bytes);
    await Promise.all([a.load(), b.load()]);
    expect(() => b.restoreCheckpoint(a.createCheckpoint())).toThrow(
      /different/,
    );
  });
});
