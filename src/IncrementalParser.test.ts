import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { DemoParser } from "./DemoParser.js";
import { BlockTypeMove } from "./types.js";
import type { DemoBlock } from "./types.js";

/**
 * Incremental (progressive download) mode must be byte-for-byte
 * equivalent to the one-shot parse: same header, same initial block,
 * same block sequence, regardless of how the compressed stream is
 * chunked — and the frontier (undefined from nextBlock() before
 * finish()) must be a pause, never an error or a skipped block.
 */

const DEMO_DIR = path.resolve(import.meta.dirname, "..", "data");
const DEMO_FILE = "exogen_Katabatic_vpad.rec";
const LARGER_DEMO_FILE =
  "auto-capture_2025-05-16_05-04_DemoBot-Mia_CTFGame_Firestorm.rec";

function readDemo(file: string): Uint8Array {
  const buf = fs.readFileSync(path.join(DEMO_DIR, file));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function blockDigest(block: DemoBlock, hash: crypto.Hash): void {
  hash.update(Uint8Array.of(block.type, block.size & 0xff, block.size >> 8));
  hash.update(block.data);
}

/** Drain all blocks, returning a digest + count of the full sequence. */
function drainAll(parser: DemoParser): { count: number; digest: string } {
  const hash = crypto.createHash("sha1");
  let count = 0;
  let block: DemoBlock | undefined;
  while ((block = parser.nextBlock())) {
    blockDigest(block, hash);
    count++;
  }
  return { count, digest: hash.digest("hex") };
}

async function fullParse(bytes: Uint8Array) {
  const parser = new DemoParser(bytes);
  const { header, initialBlock } = await parser.load();
  return { parser, header, initialBlock, ...drainAll(parser) };
}

async function incrementalParse(bytes: Uint8Array, chunkSize: number) {
  const { byteLength, header } = DemoParser.peekHeader(bytes);
  const prefixEnd = byteLength + header.initialBlockSize;
  // Prefix must contain the whole initial block; deliberately include a
  // ragged extra sliver so the constructor-tail push path is exercised.
  const sliver = 7;
  const parser = new DemoParser(bytes.subarray(0, prefixEnd + sliver), {
    incremental: true,
  });
  const loaded = await parser.load();
  const hash = crypto.createHash("sha1");
  let count = 0;
  for (let at = prefixEnd + sliver; at < bytes.length; at += chunkSize) {
    parser.push(bytes.subarray(at, Math.min(at + chunkSize, bytes.length)));
    // Interleave draining with pushing — the production consumer steps
    // between network chunks.
    let block: DemoBlock | undefined;
    while ((block = parser.nextBlock())) {
      blockDigest(block, hash);
      count++;
    }
  }
  parser.finish();
  let block: DemoBlock | undefined;
  while ((block = parser.nextBlock())) {
    blockDigest(block, hash);
    count++;
  }
  return {
    parser,
    header: loaded.header,
    initialBlock: loaded.initialBlock,
    count,
    digest: hash.digest("hex"),
  };
}

describe("incremental DemoParser", () => {
  it("peekHeader matches load()'s header and rejects short prefixes", async () => {
    const bytes = readDemo(DEMO_FILE);
    const { header, byteLength } = DemoParser.peekHeader(bytes);
    const full = new DemoParser(bytes);
    const loaded = await full.load();
    expect(header).toEqual(loaded.header);
    expect(byteLength).toBeGreaterThan(12);
    expect(() => DemoParser.peekHeader(bytes.subarray(0, 0))).toThrow(
      RangeError,
    );
    expect(() =>
      DemoParser.peekHeader(bytes.subarray(0, byteLength - 1)),
    ).toThrow(RangeError);
  });

  for (const chunkSize of [4096, 65521, 1 << 20]) {
    it(`chunked feed (${chunkSize}B) is block-for-block identical to one-shot`, async () => {
      const bytes = readDemo(DEMO_FILE);
      const oneShot = await fullParse(bytes);
      const inc = await incrementalParse(bytes, chunkSize);
      expect(inc.header).toEqual(oneShot.header);
      expect(inc.initialBlock.missionName).toEqual(
        oneShot.initialBlock.missionName,
      );
      expect(inc.count).toBe(oneShot.count);
      expect(inc.digest).toBe(oneShot.digest);
      expect(inc.parser.isComplete).toBe(true);
    });
  }

  it("larger demo: chunked feed matches one-shot", async () => {
    const bytes = readDemo(LARGER_DEMO_FILE);
    const oneShot = await fullParse(bytes);
    const inc = await incrementalParse(bytes, 128 * 1024);
    expect(inc.count).toBe(oneShot.count);
    expect(inc.digest).toBe(oneShot.digest);
  });

  it("treats the frontier as a pause: half-feed stalls, resumes, completes", async () => {
    const bytes = readDemo(DEMO_FILE);
    const oneShot = await fullParse(bytes);
    const { byteLength, header } = DemoParser.peekHeader(bytes);
    const prefixEnd = byteLength + header.initialBlockSize;
    // Split the COMPRESSED REGION in half (the initial block may be a
    // large share of a client-recorded demo, so file-halving could land
    // inside it and feed zero compressed bytes).
    const half = prefixEnd + Math.floor((bytes.length - prefixEnd) / 2);
    const parser = new DemoParser(bytes.subarray(0, prefixEnd), {
      incremental: true,
    });
    await parser.load();
    parser.push(bytes.subarray(prefixEnd, half));

    const hash = crypto.createHash("sha1");
    let count = 0;
    let block: DemoBlock | undefined;
    while ((block = parser.nextBlock())) {
      blockDigest(block, hash);
      count++;
    }
    // Stalled at the frontier, not ended.
    expect(parser.isComplete).toBe(false);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(oneShot.count);
    // Repeated probing at the frontier is safe and yields nothing.
    expect(parser.nextBlock()).toBeUndefined();
    expect(parser.nextBlock()).toBeUndefined();

    parser.push(bytes.subarray(half));
    parser.finish();
    while ((block = parser.nextBlock())) {
      blockDigest(block, hash);
      count++;
    }
    expect(parser.isComplete).toBe(true);
    expect(count).toBe(oneShot.count);
    expect(hash.digest("hex")).toBe(oneShot.digest);
  });

  it("reset() replays the grown stream from the start (backward seek)", async () => {
    const bytes = readDemo(DEMO_FILE);
    const oneShot = await fullParse(bytes);
    const { byteLength, header } = DemoParser.peekHeader(bytes);
    const prefixEnd = byteLength + header.initialBlockSize;
    const parser = new DemoParser(bytes.subarray(0, prefixEnd), {
      incremental: true,
    });
    await parser.load();
    for (let at = prefixEnd; at < bytes.length; at += 64 * 1024) {
      parser.push(bytes.subarray(at, Math.min(at + 64 * 1024, bytes.length)));
    }
    parser.finish();
    // Consume some, reset, then a full drain must equal the one-shot.
    for (let i = 0; i < 100; i++) parser.nextBlock();
    parser.reset();
    const replay = drainAll(parser);
    expect(replay.count).toBe(oneShot.count);
    expect(replay.digest).toBe(oneShot.digest);
  });

  it("rejects misuse: push on one-shot parsers, before load, after finish", async () => {
    const bytes = readDemo(DEMO_FILE);
    const oneShot = new DemoParser(bytes);
    await oneShot.load();
    expect(() => oneShot.push(new Uint8Array(1))).toThrow(/incremental/);
    expect(oneShot.isComplete).toBe(true);

    const { byteLength, header } = DemoParser.peekHeader(bytes);
    const prefixEnd = byteLength + header.initialBlockSize;
    const unloaded = new DemoParser(bytes.subarray(0, prefixEnd), {
      incremental: true,
    });
    expect(() => unloaded.push(new Uint8Array(1))).toThrow(/load/);

    const parser = new DemoParser(bytes.subarray(0, prefixEnd), {
      incremental: true,
    });
    await parser.load();
    parser.push(bytes.subarray(prefixEnd));
    parser.finish();
    expect(() => parser.push(new Uint8Array(1))).toThrow(/finished/);
    // finish() is idempotent.
    parser.finish();
  });

  it("bufferedMoveTicks counts move ticks exactly, in both modes", async () => {
    const bytes = readDemo(DEMO_FILE);
    // Ground truth: count Move blocks by draining a one-shot parse.
    const oneShot = new DemoParser(bytes);
    await oneShot.load();
    let moves = 0;
    let block;
    while ((block = oneShot.nextBlock())) {
      if (block.type === BlockTypeMove) moves++;
    }
    expect(oneShot.bufferedMoveTicks).toBe(moves);

    const { byteLength, header } = DemoParser.peekHeader(bytes);
    const prefixEnd = byteLength + header.initialBlockSize;
    const parser = new DemoParser(bytes.subarray(0, prefixEnd), {
      incremental: true,
    });
    await parser.load();
    let last = 0;
    for (let at = prefixEnd; at < bytes.length; at += 32 * 1024) {
      parser.push(bytes.subarray(at, Math.min(at + 32 * 1024, bytes.length)));
      const now = parser.bufferedMoveTicks;
      expect(now).toBeGreaterThanOrEqual(last); // monotonic
      last = now;
    }
    parser.finish();
    expect(parser.bufferedMoveTicks).toBe(moves);
    // Unaffected by the read cursor.
    parser.reset();
    expect(parser.bufferedMoveTicks).toBe(moves);
  });

  it("requires the full initial block up front", async () => {
    const bytes = readDemo(DEMO_FILE);
    const { byteLength, header } = DemoParser.peekHeader(bytes);
    const short = new DemoParser(
      bytes.subarray(0, byteLength + header.initialBlockSize - 1),
      { incremental: true },
    );
    await expect(short.load()).rejects.toThrow(RangeError);
  });
});
