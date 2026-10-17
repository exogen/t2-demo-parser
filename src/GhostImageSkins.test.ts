import { describe, expect, it } from "vitest";
import { GhostStateAccumulator } from "./GhostStateAccumulator.js";
import type { ParsedData } from "./ClassRegistry.js";
import type { ImageSlot } from "./ghostDataTypes.js";
import type { PacketData } from "./types.js";

function packet(
  events: ParsedData[] = [],
  ghosts: ParsedData[] = [],
): PacketData {
  return {
    events: events.map((parsedData) => ({ parsedData })),
    ghosts,
  } as unknown as PacketData;
}

const skin = (value?: string) => ({
  type: "NetStringEvent",
  id: 10,
  hasValue: value !== undefined,
  value,
});
const mount = (index = 3, extra: Partial<ImageSlot> = {}): ImageSlot => ({
  index,
  dataBlockId: 42,
  skinTagIndex: 10,
  loaded: true,
  ammo: true,
  wet: false,
  target: false,
  triggerDown: false,
  fireCount: 0,
  ...extra,
});
const create = (images: ImageSlot[], index = 0) => ({
  index,
  type: "create",
  classId: 10,
  parsedData: { images },
});
const images = (state: GhostStateAccumulator, ghost = 0) =>
  state.toInitialGhosts().find((g) => g.index === ghost)?.parsedData?.images;

describe("accumulated mounted-image skins", () => {
  it("captures skins at create/update time and leaves input packets untouched", () => {
    const state = new GhostStateAccumulator();
    const first = packet([skin("baseb")], [create([mount()])]);
    state.applyPacket(first);
    state.applyPacket(
      packet(
        [skin("beagle")],
        [{ index: 0, type: "update", parsedData: { images: [mount(4)] } }],
      ),
    );
    expect(images(state)).toEqual([
      { ...mount(), skinTagIndex: undefined, skinName: "baseb" },
      { ...mount(4), skinTagIndex: undefined, skinName: "beagle" },
    ]);
    expect((first.ghosts[0].parsedData?.images as ImageSlot[])[0]).toEqual(
      mount(),
    );

    state.applyPacket(
      packet(
        [],
        [{ index: 0, type: "update", parsedData: { images: [mount()] } }],
      ),
    );
    expect((images(state) as ImageSlot[])[0].skinName).toBe("beagle");
    expect((images(state) as ImageSlot[])[0]).not.toHaveProperty(
      "skinTagIndex",
    );
  });

  it("resolves GhostAlways images in event order, before ordinary ghost updates", () => {
    const state = new GhostStateAccumulator();
    state.applyPacket(
      packet(
        [
          skin("baseb"),
          {
            type: "GhostAlwaysObjectEvent",
            ghostIndex: 0,
            classId: 10,
            objectData: { images: [mount()] },
          },
          skin("beagle"),
        ],
        [create([mount()], 1)],
      ),
    );
    expect((images(state, 0) as ImageSlot[])[0].skinName).toBe("baseb");
    expect((images(state, 1) as ImageSlot[])[0].skinName).toBe("beagle");
  });

  it("copies seeded strings and retains them through EndGhosting", () => {
    const strings = new Map([[10, "baseb"]]);
    const state = new GhostStateAccumulator(strings);
    strings.set(10, "beagle");
    state.applyPacket(packet([], [create([mount()])]));
    state.applyPacket(packet([{ type: "GhostingMessageEvent", message: 2 }]));
    expect(state.size()).toBe(0);
    state.applyPacket(packet([], [create([mount()])]));
    expect((images(state) as ImageSlot[])[0].skinName).toBe("baseb");
    const fresh = new GhostStateAccumulator();
    fresh.applyPacket(packet([], [create([mount()])]));
    expect((images(fresh) as ImageSlot[])[0].skinName).toBe("");
  });

  it("preserves inline/default skins, clears and sparse updates without leaking old skins", () => {
    const state = new GhostStateAccumulator([[10, "baseb"]]);
    state.applyPacket(packet([], [create([mount()])]));
    state.applyPacket(
      packet(
        [],
        [
          {
            index: 0,
            type: "update",
            parsedData: {
              images: [
                { index: 3, dataBlockId: 0 },
                { index: 7, dataBlockId: 42, skinName: "base" },
              ],
            },
          },
        ],
      ),
    );
    expect(images(state)).toEqual([
      { index: 3, dataBlockId: 0 },
      { index: 7, dataBlockId: 42, skinName: "base" },
    ]);
    state.applyPacket(
      packet(
        [],
        [
          {
            index: 0,
            type: "update",
            parsedData: { images: [{ index: 7, dataBlockId: 42 }] },
          },
        ],
      ),
    );
    expect(images(state)).toEqual([
      { index: 3, dataBlockId: 0 },
      { index: 7, dataBlockId: 42 },
    ]);
    state.applyPacket(
      packet([], [{ index: 0, type: "delete" }, create([mount()])]),
    );
    expect(images(state)).toHaveLength(1);
    const exported = state.toInitialGhosts();
    (exported[0].parsedData!.images as ImageSlot[])[0].skinName = "changed";
    expect((images(state) as ImageSlot[])[0].skinName).toBe("baseb");
  });

  it("does not rebind missing or cleared string slots to later unrelated strings", () => {
    const state = new GhostStateAccumulator([[10, "baseb"]]);
    state.applyPacket(packet([skin()], [create([mount()])]));
    state.applyPacket(packet([skin("beagle")]));
    expect((images(state) as ImageSlot[])[0]).toMatchObject({ skinName: "" });
    expect((images(state) as ImageSlot[])[0]).not.toHaveProperty(
      "skinTagIndex",
    );
  });
});
