import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DemoParser } from "./DemoParser.js";
import type {
  LinearProjectileDataBlock,
  TracerProjectileDataBlock,
} from "./dataBlockDataTypes.js";

const DEMO_DIR = path.resolve(import.meta.dirname, "..", "data");

async function loadDataBlocks(file: string) {
  const buffer = fs.readFileSync(path.join(DEMO_DIR, file));
  const parser = new DemoParser(new Uint8Array(buffer));
  const { initialBlock } = await parser.load();
  return initialBlock.dataBlocks;
}

/**
 * Regression tests for projectile datablock field naming, which was
 * binary-verified against Tribes2.exe build 25034 (initPersistFields
 * FUN_0062b3c0 / FUN_0063fcb0 map names to the struct offsets that
 * unpackData reads in order). Prior to that verification several fields
 * were misassigned — most damagingly, the true lifetimeMS landed in a
 * field named `fizzleType`, breaking client-side projectile simulation.
 */
describe("projectile datablock field decoding", () => {
  it("decodes LinearProjectileData fields with engine semantics", async () => {
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    const linears: LinearProjectileDataBlock[] = [];
    for (const [, db] of dataBlocks) {
      if (
        db.className === "LinearProjectileData" ||
        db.className === "TracerProjectileData" ||
        db.className === "LinearFlareProjectileData"
      ) {
        linears.push(db.data as LinearProjectileDataBlock);
      }
    }
    expect(linears.length).toBeGreaterThan(0);

    for (const block of linears) {
      // lifetimeMS/fizzleTimeMS are real milliseconds, rounded up to a
      // 32ms tick by the engine's onAdd, and clamped to 511 ticks.
      expect(block.lifetimeMS! % 32).toBe(0);
      expect(block.lifetimeMS).toBeGreaterThanOrEqual(32);
      expect(block.lifetimeMS).toBeLessThanOrEqual(511 * 32);
      expect(block.fizzleTimeMS! % 32).toBe(0);
      // Angles are ranged 0–90 degrees on the wire.
      expect(block.reflectOnWaterImpactAngle).toBeGreaterThanOrEqual(0);
      expect(block.reflectOnWaterImpactAngle).toBeLessThanOrEqual(90);
      expect(typeof block.explodeOnDeath).toBe("boolean");
      expect(typeof block.doDynamicClientHits).toBe("boolean");
    }
  });

  it("decodes retail DiscProjectile exactly", async () => {
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    let disc: LinearProjectileDataBlock | undefined;
    for (const [, db] of dataBlocks) {
      const data = db.data as LinearProjectileDataBlock;
      if (
        db.className === "LinearProjectileData" &&
        data.dryVelocity === 90 &&
        data.explodeOnDeath === true
      ) {
        disc = data;
        break;
      }
    }
    expect(disc, "retail DiscProjectile datablock").toBeDefined();
    // disc.cs: lifetimeMS = fizzleTimeMS = 5000 → tick-rounded to 5024.
    expect(disc!.lifetimeMS).toBe(5024);
    expect(disc!.fizzleTimeMS).toBe(5024);
    // disc.cs: reflectOnWaterImpactAngle = 15.0.
    expect(disc!.reflectOnWaterImpactAngle).toBe(15);
  });

  it("decodes retail ChaingunBullet tracer fields exactly", async () => {
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    let bullet: TracerProjectileDataBlock | undefined;
    for (const [, db] of dataBlocks) {
      const data = db.data as TracerProjectileDataBlock;
      if (
        db.className === "TracerProjectileData" &&
        data.tracerTex0 === "special/tracer00" &&
        data.lifetimeMS === 3008
      ) {
        bullet = data;
        break;
      }
    }
    expect(bullet, "ChaingunBullet datablock").toBeDefined();
    // Values as recorded in this demo (a lightly modded server — tracer
    // length/width are doubled from retail, everything else matches
    // chaingun.cs). Each assertion pins a decode position: a swap with
    // any neighboring field would produce a nonsensical value here.
    expect(bullet!.dryVelocity).toBe(750);
    expect(bullet!.wetVelocity).toBe(280);
    expect(bullet!.fizzleTimeMS).toBe(3008);
    expect(bullet!.explodeOnDeath).toBe(false);
    // Chainguns are the only retail weapons with doDynamicClientHits.
    expect(bullet!.doDynamicClientHits).toBe(true);
    // activateDelayMS = -1 (retail default) read as U32.
    expect(bullet!.activateDelayMS).toBe(0xffffffff);
    expect(bullet!.tracerLength).toBe(30);
    expect(bullet!.tracerMinPixels).toBe(6);
    expect(bullet!.tracerWidth).toBeCloseTo(0.2, 5);
    expect(bullet!.tracerAlpha).toBe(false);
    // Retail chaingun.cs tracerColor: 211/255, 215/255, 120/255, 0.75.
    expect(bullet!.tracerColor!.r).toBeCloseTo(211 / 255, 2);
    expect(bullet!.tracerColor!.g).toBeCloseTo(215 / 255, 2);
    expect(bullet!.tracerColor!.b).toBeCloseTo(120 / 255, 2);
    expect(bullet!.crossViewAng).toBeCloseTo(0.99, 5);
    expect(bullet!.crossSize).toBeCloseTo(0.2, 5);
    expect(bullet!.renderCross).toBe(true);
    expect(bullet!.tracerTex1).toBe("special/tracercross");
  });
});
