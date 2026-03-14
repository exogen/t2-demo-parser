import { describe, it, expect } from "vitest";
import { GhostTracker } from "./GhostManager.js";

describe("GhostTracker", () => {
  it("creates and retrieves ghosts", () => {
    const tracker = new GhostTracker();
    tracker.createGhost(42, 25, "Player");

    expect(tracker.hasGhost(42)).toBe(true);
    const ghost = tracker.getGhost(42);
    expect(ghost).toBeDefined();
    expect(ghost!.classId).toBe(25);
    expect(ghost!.className).toBe("Player");
    expect(ghost!.state).toEqual({});
  });

  it("returns undefined for non-existent ghosts", () => {
    const tracker = new GhostTracker();
    expect(tracker.getGhost(0)).toBeUndefined();
    expect(tracker.hasGhost(0)).toBe(false);
  });

  it("deletes ghosts", () => {
    const tracker = new GhostTracker();
    tracker.createGhost(10, 5, "Debris");
    expect(tracker.hasGhost(10)).toBe(true);

    tracker.deleteGhost(10);
    expect(tracker.hasGhost(10)).toBe(false);
  });

  it("overwrites ghost at same index (index reuse)", () => {
    const tracker = new GhostTracker();
    tracker.createGhost(7, 25, "Player");
    tracker.createGhost(7, 4, "Camera");

    const ghost = tracker.getGhost(7);
    expect(ghost!.classId).toBe(4);
    expect(ghost!.className).toBe("Camera");
  });

  it("tracks size correctly", () => {
    const tracker = new GhostTracker();
    expect(tracker.size()).toBe(0);

    tracker.createGhost(0, 25, "Player");
    tracker.createGhost(1, 4, "Camera");
    expect(tracker.size()).toBe(2);

    tracker.deleteGhost(0);
    expect(tracker.size()).toBe(1);
  });

  it("clears all ghosts", () => {
    const tracker = new GhostTracker();
    tracker.createGhost(0, 25, "Player");
    tracker.createGhost(1, 4, "Camera");
    tracker.createGhost(2, 5, "Debris");

    tracker.clear();
    expect(tracker.size()).toBe(0);
    expect(tracker.hasGhost(0)).toBe(false);
    expect(tracker.hasGhost(1)).toBe(false);
    expect(tracker.hasGhost(2)).toBe(false);
  });

  it("getAllGhosts returns the internal map", () => {
    const tracker = new GhostTracker();
    tracker.createGhost(0, 25, "Player");
    tracker.createGhost(1, 4, "Camera");

    const all = tracker.getAllGhosts();
    expect(all.size).toBe(2);
    expect(all.get(0)?.className).toBe("Player");
    expect(all.get(1)?.className).toBe("Camera");
  });
});
