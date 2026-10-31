import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { DemoParser } from "./DemoParser.js";
import type { DemoBlock } from "./types.js";

/**
 * fork() must parse exactly what a fresh parser over the same bytes
 * parses, from the first block, without disturbing (or being disturbed
 * by) the parser it was forked from.
 */

const DEMO_DIR = path.resolve(import.meta.dirname, "..", "data");
const DEMO_FILE = "exogen_Katabatic_vpad.rec";

function readDemo(file: string): Uint8Array {
  const buf = fs.readFileSync(path.join(DEMO_DIR, file));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Parsed output as stable JSON (Maps and byte arrays included). */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Map) return { map: [...item] };
    if (item instanceof Set) return { set: [...item] };
    if (ArrayBuffer.isView(item))
      return {
        bytes: Buffer.from(
          item.buffer,
          item.byteOffset,
          item.byteLength,
        ).toString("hex"),
      };
    if (typeof item === "bigint") return { bigint: String(item) };
    return item;
  });
}

function digestBlock(block: DemoBlock, hash: crypto.Hash): void {
  hash.update(serialize({ ...block, data: undefined }));
  hash.update(block.data);
}

/** Digest of the next `limit` blocks' raw bytes and parsed output. */
function drain(
  parser: DemoParser,
  limit = Infinity,
): { count: number; digest: string } {
  const hash = crypto.createHash("sha1");
  let count = 0;
  let block: DemoBlock | undefined;
  while (count < limit && (block = parser.nextBlock())) {
    digestBlock(block, hash);
    count++;
  }
  return { count, digest: hash.digest("hex") };
}

async function freshParse(bytes: Uint8Array) {
  const parser = new DemoParser(bytes);
  await parser.load();
  return drain(parser);
}

describe("DemoParser.fork", () => {
  it("parses the whole demo exactly like a fresh parser", async () => {
    const bytes = readDemo(DEMO_FILE);
    const expected = await freshParse(bytes);
    const source = new DemoParser(bytes);
    await source.load();
    expect(drain(source.fork())).toEqual(expected);
  });

  it("starts at the first block whatever the source's position, and leaves it there", async () => {
    const bytes = readDemo(DEMO_FILE);
    const expected = await freshParse(bytes);
    const source = new DemoParser(bytes);
    await source.load();
    const head = drain(source, 500);
    const fork = source.fork();
    expect(fork.blockCursor).toBe(0);
    expect(drain(fork)).toEqual(expected);

    // The source carries on from where it was, as if never forked.
    const rest = drain(source);
    expect(head.count + rest.count).toBe(expected.count);
    const reference = new DemoParser(bytes);
    await reference.load();
    drain(reference, 500);
    expect(rest).toEqual(drain(reference));
  });

  it("shares the loaded header and initial block", async () => {
    const source = new DemoParser(readDemo(DEMO_FILE));
    const loaded = await source.load();
    const fork = source.fork();
    expect(fork.loaded).toBe(true);
    expect(fork.header).toBe(loaded.header);
    expect(fork.initialBlock).toBe(loaded.initialBlock);
    expect(await fork.load()).toEqual(loaded);
  });

  it("forks a finished incremental parser, but not one still receiving data", async () => {
    const bytes = readDemo(DEMO_FILE);
    const expected = await freshParse(bytes);
    const { byteLength, header } = DemoParser.peekHeader(bytes);
    const prefixEnd = byteLength + header.initialBlockSize;
    const source = new DemoParser(bytes.subarray(0, prefixEnd), {
      incremental: true,
    });
    await source.load();
    const tail = bytes.subarray(prefixEnd);
    const half = Math.floor(tail.length / 2);
    source.push(tail.subarray(0, half));
    expect(() => source.fork()).toThrow(/before finish/);
    source.push(tail.subarray(half));
    source.finish();
    expect(drain(source.fork())).toEqual(expected);
  });

  it("requires a loaded parser", () => {
    expect(() => new DemoParser(readDemo(DEMO_FILE)).fork()).toThrow(
      /load\(\) first/,
    );
  });
});
