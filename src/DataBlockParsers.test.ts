import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { DemoParser } from "./DemoParser.js";
import type {
  ELFProjectileDataBlock,
  EnergyProjectileDataBlock,
  LinearFlareProjectileDataBlock,
  LinearProjectileDataBlock,
  PlayerDataBlock,
  RepairProjectileDataBlock,
  ShapeBaseImageDataBlock,
  SniperProjectileDataBlock,
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
  it("decodes LinearFlareProjectileData with the engine's field names", async () => {
    // Stock PlasmaBolt (plasma.cs): numFlares 35, size[] 0.2/0.5/0.1,
    // flareColor "1 0.75 0.25", flareModTexture/flareBaseTexture. The old
    // decode read numFlares as an F32 and labelled the three sizes as
    // size/flareModTexture/smokeSize.
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    let plasma: LinearFlareProjectileDataBlock | undefined;
    for (const [, db] of dataBlocks) {
      if (
        db.className === "LinearFlareProjectileData" &&
        (db.data as LinearFlareProjectileDataBlock).projectileShapeName ===
          "plasmabolt.dts"
      ) {
        plasma = db.data as LinearFlareProjectileDataBlock;
      }
    }
    expect(plasma).toBeDefined();
    expect(plasma!.numFlares).toBe(35);
    expect(plasma!.sizes!.map((v) => Math.round(v * 100) / 100)).toEqual([
      0.2, 0.5, 0.1,
    ]);
    expect(plasma!.flareModTexture).toBe("flaremod");
    expect(plasma!.flareBaseTexture).toBe("flarebase");
    expect(plasma!.flareColor!.r).toBeCloseTo(1, 2);
    expect(plasma!.flareColor!.g).toBeCloseTo(0.75, 2);
    expect(plasma!.flareColor!.b).toBeCloseTo(0.25, 2);
  });

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

  it("decodes retail EnergyBolt (blaster) fields exactly", async () => {
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    let bolt: EnergyProjectileDataBlock | undefined;
    for (const [, db] of dataBlocks) {
      if (db.className === "EnergyProjectileData") {
        bolt = db.data as EnergyProjectileDataBlock;
        break;
      }
    }
    expect(bolt, "retail EnergyBolt datablock").toBeDefined();
    // blaster.cs: binary-verified names (initPersistFields FUN_00694b40,
    // unpackData FUN_00694d80) — these were previously mislabeled with
    // ELF-style beam field names.
    expect(bolt!.crossViewAng).toBeCloseTo(0.99, 5);
    expect(bolt!.crossSize).toBeCloseTo(0.55, 5);
    expect(bolt!.blurLifetime).toBeCloseTo(0.2, 5);
    expect(bolt!.blurWidth).toBeCloseTo(0.25, 5);
    expect(bolt!.blurColor!.r).toBeCloseTo(0.4, 5);
    expect(bolt!.blurColor!.g).toBeCloseTo(0, 5);
    expect(bolt!.blurColor!.b).toBeCloseTo(0, 5);
    expect(bolt!.texture0).toBe("special/blasterBolt");
    expect(bolt!.texture1).toBe("special/blasterBoltCross");
    // blaster.cs: scale = "0.25 20.0 1.0" (bolt quad half-width / length).
    expect(bolt!.scale!.x).toBeCloseTo(0.25, 5);
    expect(bolt!.scale!.y).toBeCloseTo(20, 5);
  });

  it("decodes retail BasicSniperShot (laser rifle) fields exactly", async () => {
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    let shot: SniperProjectileDataBlock | undefined;
    for (const [, db] of dataBlocks) {
      if (db.className === "SniperProjectileData") {
        shot = db.data as SniperProjectileDataBlock;
        break;
      }
    }
    expect(shot, "retail BasicSniperShot datablock").toBeDefined();
    // sniperRifle.cs values.
    expect(shot!.maxRifleRange).toBeCloseTo(1000, 5);
    expect(shot!.beamColor!.r).toBeCloseTo(1, 2);
    expect(shot!.beamColor!.g).toBeCloseTo(0.1, 2);
    expect(shot!.beamColor!.b).toBeCloseTo(0.1, 2);
    expect(shot!.fadeTime).toBeCloseTo(1.0, 5);
    expect(shot!.startBeamWidth).toBeCloseTo(0.145, 5);
    expect(shot!.endBeamWidth).toBeCloseTo(0.25, 5);
    expect(shot!.pulseSpeed).toBeCloseTo(6.0, 5);
    expect(shot!.pulseLength).toBeCloseTo(0.15, 5);
    expect(shot!.textures![0]).toBe("special/flare");
    expect(shot!.textures![1]).toBe("special/nonlingradient");
    expect(shot!.textures![2]).toBe("special/laserrip01");
    expect(shot!.textures![11]).toBe("special/sniper00");
  });

  it("decodes both ELF datablocks (gun and turret) exactly", async () => {
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    const elfs: ELFProjectileDataBlock[] = [];
    for (const [, db] of dataBlocks) {
      if (db.className === "ELFProjectileData") {
        elfs.push(db.data as ELFProjectileDataBlock);
      }
    }
    // Binary-verified names (initPersistFields FUN_0064a860, unpackData
    // FUN_0064ae00) — previously fabricated beam names. Two datablocks
    // exist: the handheld BasicELF at beamRange 38 (the z0dd/ZOD server
    // patch every surviving server lineage runs — "WHAT?? INCREASE ELF
    // RANGE?!!? was 37"; the stock script says 30) and the stock
    // ELFTurretBolt at 75 (ELFBarrelLarge.cs).
    expect(elfs.map((e) => e.beamRange).sort((a, b) => a! - b!)).toEqual([
      38, 75,
    ]);
    for (const elf of elfs) {
      expect(elf.mainBeamWidth).toBeCloseTo(0.1, 5);
      expect(elf.mainBeamSpeed).toBeCloseTo(9.0, 5);
      expect(elf.mainBeamRepeat).toBeCloseTo(0.25, 5);
      expect(elf.lightningWidth).toBeCloseTo(0.1, 5);
      expect(elf.lightningDist).toBeCloseTo(0.15, 5);
      expect(elf.textures).toEqual([
        "special/ELFBeam",
        "special/ELFLightning",
        "special/BlueImpact",
      ]);
    }
  });

  it("decodes retail DefaultRepairBeam fields exactly", async () => {
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    let repair: RepairProjectileDataBlock | undefined;
    for (const [, db] of dataBlocks) {
      if (db.className === "RepairProjectileData") {
        repair = db.data as RepairProjectileDataBlock;
        break;
      }
    }
    expect(repair, "retail DefaultRepairBeam datablock").toBeDefined();
    // repairpack.cs: binary-verified names (initPersistFields
    // FUN_00644910, unpackData FUN_00644c40); numSegments is an S32
    // whose raw bits the old decode read as a float.
    expect(repair!.beamRange).toBeCloseTo(10, 5);
    expect(repair!.beamWidth).toBeCloseTo(0.15, 5);
    expect(repair!.numSegments).toBe(20);
    expect(repair!.texRepeat).toBeCloseTo(0.2, 5);
    expect(repair!.blurFreq).toBeCloseTo(10.0, 5);
    expect(repair!.blurLifetime).toBeCloseTo(1.0, 5);
    expect(repair!.cutoffAngle).toBeCloseTo(25.0, 5);
    expect(repair!.textures).toEqual(["special/redbump2", "special/redflare"]);
  });

  it("decodes image-state transitions in the engine packing order", async () => {
    // Every retail weapon image opens Activate → (timeout) →
    // ActivateReady (e.g. blaster.cs stateTransitionOnTimeout[0]).
    // With the old rotated names, the timeout transition surfaced under
    // transitionGeneric0Out and consumers carried a remap table.
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    let checked = 0;
    for (const [, db] of dataBlocks) {
      if (db.className !== "ShapeBaseImageData") continue;
      const data = db.data as ShapeBaseImageDataBlock;
      const states = data.states;
      if (!states || states.length < 2) continue;
      if (states[0].name.toLowerCase() !== "activate") continue;
      const readyIndex = states.findIndex(
        (st) => st.name.toLowerCase() === "activateready",
      );
      if (readyIndex < 0) continue;
      // Transition values are 1-based state indices (0 = none).
      expect(states[0].transitionOnTimeout).toBe(readyIndex + 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
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

  it("decodes PlayerData movement/jet fields with engine semantics", async () => {
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    let armor: PlayerDataBlock | undefined;
    for (const [, db] of dataBlocks) {
      const data = db.data as PlayerDataBlock;
      // The armor the recorder wears: retail-value run/speed section.
      if (db.className === "PlayerData" && data.maxForwardSpeed === 15) {
        armor = data;
        break;
      }
    }
    expect(armor, "light armor PlayerData datablock").toBeDefined();
    // Retail player.cs values — each pins a decode position (previously
    // these landed in fields named jumpForce/runSurfaceAngle/etc.).
    expect(armor!.runForce).toBe(4968); // 55.2 * 90
    expect(armor!.maxBackwardSpeed).toBe(13);
    expect(armor!.maxSideSpeed).toBe(13);
    expect(armor!.underwaterVertJetFactor).toBeCloseTo(1.5, 5);
    expect(armor!.minLookAngle).toBeCloseTo(-1.5, 5);
    expect(armor!.maxLookAngle).toBeCloseTo(1.5, 5);
    // Jet energy fields must decode as plausible per-tick magnitudes
    // (this server mods them slightly, so no exact match): drain is a
    // fraction of maxEnergy(60), threshold is a small energy value.
    expect(armor!.jetEnergyDrain).toBeGreaterThan(0);
    expect(armor!.jetEnergyDrain).toBeLessThan(5);
    expect(armor!.underwaterJetEnergyDrain).toBeGreaterThan(0);
    expect(armor!.underwaterJetEnergyDrain).toBeLessThan(5);
    expect(armor!.minJetEnergy).toBeGreaterThanOrEqual(0);
    expect(armor!.minJetEnergy).toBeLessThan(10);
    // Heat signature rates — retail player.cs: 1/4 and 1/3. These are the
    // first two reads of the ground-impact tail; the old decode shifted
    // the whole section by two slots.
    expect(armor!.heatDecayPerSec).toBeCloseTo(0.25, 5);
    expect(armor!.heatIncreasePerSec).toBeCloseTo(1 / 3, 5);
    expect(armor!.groundImpactShakeDuration).toBeCloseTo(0.6, 5);
    expect(armor!.groundImpactShakeFalloff).toBeCloseTo(10, 5);
  });

  it("decodes StationFX node names and textures exactly", async () => {
    const dataBlocks = await loadDataBlocks("exogen_Katabatic_vpad.rec");
    let vehicleFX: Record<string, unknown> | undefined;
    let personalFX: Record<string, unknown> | undefined;
    for (const [, db] of dataBlocks) {
      if (db.className === "StationFXVehicleData") vehicleFX ??= db.data;
      if (db.className === "StationFXPersonalData") personalFX ??= db.data;
    }
    // serverVehicleHud.cs VehicleInvFX values.
    expect(vehicleFX, "StationFXVehicleData").toBeDefined();
    expect(vehicleFX!.glowNodeName).toBe("GLOWFX");
    expect(vehicleFX!.leftNodeName0).toBe("LFX1");
    expect(vehicleFX!.rightNodeName0).toBe("RFX1");
    expect(vehicleFX!.leftNodeName3).toBe("LFX4");
    expect(vehicleFX!.rightNodeName3).toBe("RFX4");
    expect(vehicleFX!.texture0).toBe("special/stationGlow");
    expect(vehicleFX!.texture1).toBe("special/stationLight2");
    // station.cs personal FX values.
    expect(personalFX, "StationFXPersonalData").toBeDefined();
    expect(personalFX!.leftNodeName).toBe("FX1");
    expect(personalFX!.rightNodeName).toBe("FX2");
    expect(personalFX!.texture0).toBe("special/stationLight");
  });
});
