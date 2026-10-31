import { inflate } from "fflate";

/**
 * Inflate a raw DEFLATE stream: natively (DecompressionStream, in browsers
 * and Node 18+) where the runtime supports it, else with fflate. Any native
 * failure (unsupported format, truncated or corrupt data) retries with
 * fflate, so callers get fflate's errors, like code 0 for a stream that
 * ends early.
 */
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([data as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // fflate decides.
    }
  }
  return new Promise((resolve, reject) => {
    inflate(data, (err, inflated) => {
      if (err) reject(err);
      else resolve(inflated);
    });
  });
}
