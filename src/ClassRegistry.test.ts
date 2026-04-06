import { describe, it, expect } from "vitest";
import { ClassRegistry } from "./ClassRegistry.js";
import type { BitStream } from "./BitStream.js";

/** Stub parser that reads nothing. */
const stubParser = (bs: BitStream) => ({});

describe("ClassRegistry", () => {
  describe("catalog and bind", () => {
    it("catalogs a ghost parser by name", () => {
      const reg = new ClassRegistry();
      reg.catalogGhost({ name: "Player", unpackUpdate: stubParser });
      expect(reg.getGhostCatalog().has("Player")).toBe(true);
    });
  });

  describe("deterministic binding", () => {
    it("binds ghost parsers alphabetically by C strcmp", () => {
      const reg = new ClassRegistry();
      // Register in non-alphabetical order
      reg.catalogGhost({ name: "WheeledVehicle", unpackUpdate: stubParser });
      reg.catalogGhost({ name: "Camera", unpackUpdate: stubParser });
      reg.catalogGhost({ name: "Player", unpackUpdate: stubParser });
      reg.catalogGhost({ name: "AIObjective", unpackUpdate: stubParser });

      // Bind using alphabetically sorted list (C strcmp = case-sensitive ASCII)
      const classNames = [
        "AIObjective",
        "Camera",
        "Player",
        "WheeledVehicle",
      ] as const;
      const result = reg.bindDeterministicGhosts(classNames, 0);

      expect(result.bound).toBe(4);
      expect(result.missing).toEqual([]);
      expect(reg.getGhostParser(0)?.name).toBe("AIObjective");
      expect(reg.getGhostParser(1)?.name).toBe("Camera");
      expect(reg.getGhostParser(2)?.name).toBe("Player");
      expect(reg.getGhostParser(3)?.name).toBe("WheeledVehicle");
    });

    it("reports missing parsers", () => {
      const reg = new ClassRegistry();
      reg.catalogGhost({ name: "Player", unpackUpdate: stubParser });

      const classNames = ["Camera", "Player", "Sky"] as const;
      const result = reg.bindDeterministicGhosts(classNames, 0);

      expect(result.bound).toBe(1);
      expect(result.missing).toEqual(["Camera", "Sky"]);
      expect(reg.getGhostParser(0)).toBeUndefined(); // Camera not cataloged
      expect(reg.getGhostParser(1)?.name).toBe("Player");
      expect(reg.getGhostParser(2)).toBeUndefined(); // Sky not cataloged
    });

    it("applies classFirst offset", () => {
      const reg = new ClassRegistry();
      reg.catalogEvent({
        name: "TestEvent",
        unpack: (bs, conn) => ({ type: "TestEvent" }),
      });

      const result = reg.bindDeterministicEvents(["TestEvent"], 255);
      expect(result.bound).toBe(1);
      expect(reg.getEventParser(255)?.name).toBe("TestEvent");
    });

    it("binds DataBlock parsers with offset 128", () => {
      const reg = new ClassRegistry();
      reg.catalogDataBlock({
        name: "AudioDescription",
        unpackData: stubParser,
      });
      reg.catalogDataBlock({
        name: "PlayerData",
        unpackData: stubParser,
      });

      const result = reg.bindDeterministicDataBlocks(
        ["AudioDescription", "PlayerData"],
        128
      );
      expect(result.bound).toBe(2);
      expect(reg.getDataBlockParser(128)?.name).toBe("AudioDescription");
      expect(reg.getDataBlockParser(129)?.name).toBe("PlayerData");
    });
  });

  describe("C strcmp sort order", () => {
    it("sorts uppercase before lowercase (ASCII order)", () => {
      // C strcmp sorts by byte value: 'A'=0x41 < 'Z'=0x5A < 'a'=0x61
      // This is critical for matching the Tribes 2 binary's deterministic classIds
      const names = ["Zebra", "apple", "Ant"];
      const sorted = [...names].sort(); // JS default sort is already by code point
      expect(sorted).toEqual(["Ant", "Zebra", "apple"]);
    });
  });
});
