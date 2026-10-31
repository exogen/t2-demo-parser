import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { inflateSync } from "fflate";
import { DemoParser } from "./DemoParser.js";
import { inflateRaw } from "./inflateRaw.js";

const DEMO_DIR = path.resolve(import.meta.dirname, "..", "data");

/** A real demo's compressed block stream. */
function blockStream(): Uint8Array {
  const buf = fs.readFileSync(path.join(DEMO_DIR, "exogen_Katabatic_vpad.rec"));
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const { byteLength, header } = DemoParser.peekHeader(bytes);
  return bytes.subarray(byteLength + header.initialBlockSize);
}

describe("inflateRaw", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("inflates natively to exactly what fflate produces", async () => {
    const compressed = blockStream();
    expect(typeof DecompressionStream).toBe("function");
    expect(await inflateRaw(compressed)).toEqual(inflateSync(compressed));
  });

  it("uses fflate without DecompressionStream", async () => {
    const compressed = blockStream();
    vi.stubGlobal("DecompressionStream", undefined);
    expect(await inflateRaw(compressed)).toEqual(inflateSync(compressed));
  });

  it("falls back to fflate when the runtime can't inflate raw deflate", async () => {
    const compressed = blockStream();
    vi.stubGlobal(
      "DecompressionStream",
      class {
        constructor() {
          throw new TypeError("Unsupported compression format");
        }
      },
    );
    expect(await inflateRaw(compressed)).toEqual(inflateSync(compressed));
  });

  it("reports a stream that ends early with fflate's error", async () => {
    const compressed = blockStream();
    await expect(
      inflateRaw(compressed.subarray(0, compressed.length >> 1)),
    ).rejects.toMatchObject({ code: 0 });
  });
});
