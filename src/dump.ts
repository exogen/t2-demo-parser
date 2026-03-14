#!/usr/bin/env node
/**
 * Dump full decoded demo block data as JSON.
 * Usage: npx tsx src/dump.ts <file.rec> [output.json]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DemoParser } from "./DemoParser.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: dump <path-to-rec-file> [output-path]");
  process.exit(1);
}

const outputPath = process.argv[3]; // optional, defaults to stdout

const resolvedPath = path.resolve(filePath);
const buffer = fs.readFileSync(resolvedPath);

const parser = new DemoParser(buffer);
const demo = await parser.parseFullDemo();

const json = JSON.stringify(demo, (_key, value) => {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return `<${value.byteLength} bytes>`;
  }
  if (ArrayBuffer.isView(value) && "byteLength" in value) {
    return `<${value.byteLength} bytes>`;
  }
  return value;
}, 2);

if (outputPath) {
  const resolvedOutput = path.resolve(outputPath);
  fs.writeFileSync(resolvedOutput, json);
  console.error(`Written to ${resolvedOutput} (${json.length} bytes)`);
} else {
  process.stdout.write(json);
}
