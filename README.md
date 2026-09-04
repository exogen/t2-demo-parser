# t2-demo-parser

Parser for Tribes 2 demo recordings (`.rec` files) and live server packet
streams. Extracts game state, player movement, ghost object lifecycles,
network events, and animation timelines from recordings made by the Tribes 2
client (build 25034, Torque engine), and parses the same packet format
arriving from a live connection (see `createLiveParser`).

Designed for use in browser-based replay viewers. The async API keeps the main
thread responsive: in browsers, decompression runs in a Web Worker via
[fflate](https://github.com/101arrowz/fflate), and blocks are parsed lazily
one at a time.

Requires Node.js 18 or newer (or any modern browser).

## Quick start

```typescript
import { DemoParser, buildTimeline } from "t2-demo-parser";

const buffer = new Uint8Array(/* .rec file contents */);
const parser = new DemoParser(buffer);
const demo = await parser.parseFullDemo();

console.log(demo.header.demoLengthMs); // Duration in ms
console.log(demo.initialBlock.missionName); // e.g. "Rollercoaster"
console.log(demo.blocks.length); // Total block count
console.log(demo.initialBlock.dataBlocks.size); // DataBlock definitions

const timeline = buildTimeline(demo, parser.getRegistry());
console.log(timeline.controlObject.length); // Player position keyframes
console.log(timeline.ghostInstances.length); // Networked object lifecycles
```

## CLI

```bash
npx t2-demo-parser path/to/demo.rec
npx t2-demo-parser path/to/demo.rec --json   # export timeline JSON
```

---

## Concepts

A `.rec` file contains a snapshot of the game state at the moment recording
started (the **initial block**), followed by a compressed stream of
**blocks** — network packets, player inputs, and timing info — representing
everything the client received from the server during the recording.

- **Header**: file signature, protocol version, total duration, initial block size.
- **Initial block**: DataBlock definitions (shapes, sounds, projectile types),
  player scores, target info, connection state, initial ghost objects, and the
  mission/map name.
- **Block stream**: deflate-compressed sequence of blocks, each tagged with a
  type and size. Block types are packets (server-to-client network data), move
  inputs (player controls), info blocks (tick/FOV), and send-packet triggers.
- **Ghosts**: Torque's term for networked game objects. The server creates,
  updates, and destroys ghosts; each has a class (Player, Turret, Projectile,
  etc.) and an index (0–1023). Ghost state is delta-compressed with bitmasks.
- **Events**: one-shot network messages (remote commands, audio triggers,
  DataBlock transfers, etc.).
- **DataBlocks**: static definitions shared between client and server
  (PlayerData, WeaponData, VehicleData, etc.), referenced by ghost objects.
- **Timeline**: a high-level view extracted after parsing — timestamped
  keyframes for every ghost and the control object, suitable for driving
  Three.js animations.

---

## API reference

### `DemoParser`

Main entry point. Construct with a `Uint8Array` of the `.rec` file contents.
All parser bindings (53 ghost classes, 54 DataBlock classes, 26 event classes)
are set up deterministically in the constructor.

```typescript
const parser = new DemoParser(buffer: Uint8Array, options?: {
  incremental?: boolean; // feed the block stream via push()/finish()
  ignoreProtocolVersion?: boolean; // see below
  haltOnFault?: boolean; // passed to PacketParser (default true)
});
```

#### `async load(): Promise<LoadResult>`

Parse the header and initial block, then asynchronously decompress the block
stream. Does **not** parse any blocks — use `nextBlock()` to consume them.

The header is validated the way the game's demo playback validates it: the
ident string must be `"Tribes2 Recording"` and the protocol version must be
`0x330004` (build 25034), otherwise `load()` throws. The game refuses to play
other versions too, and their block formats are not guaranteed to match; pass
`{ ignoreProtocolVersion: true }` to try anyway. A buffer too short to hold
the initial block throws a `RangeError`.

Idempotent: calling `load()` again returns the cached result.

```typescript
interface LoadResult {
  header: DemoHeader;
  initialBlock: InitialBlockData;
}
```

#### `nextBlock(): DemoBlock | undefined`

Read and parse the next block from the decompressed stream. Returns `undefined`
when the stream is exhausted. Each call advances `blockCursor` by one.
Packets that the parser cannot fully consume are reported through
`PacketData.parseFault` (see `PacketParser` below); a block whose decoder
threw carries the message in `DemoBlock.parseError`.

Blocks are transient — only one exists in memory at a time (previous blocks are
eligible for GC unless you retain a reference).

#### `processBlocks(count: number): number`

Fast-forward through `count` blocks, processing each (updating ghost tracker,
connection state, etc.) but not retaining them. Returns the number of blocks
actually processed, which may be less than `count` if the stream runs out.

#### `reset(): void`

Reset the block stream to the beginning, re-seed the ghost tracker from the
initial block's ghosts, and create a fresh `PacketParser`. Allows replaying
the entire block stream from scratch.

#### `async parseFullDemo(): Promise<DemoFile>`

Convenience method: `load()` + drain all blocks into an array.

```typescript
interface DemoFile {
  header: DemoHeader;
  initialBlock: InitialBlockData;
  blocks: DemoBlock[];
}
```

#### Properties

| Property       | Type               | Description                                                                                      |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| `loaded`       | `boolean`          | Whether `load()` has been called.                                                                |
| `header`       | `DemoHeader`       | File header (throws if not loaded).                                                              |
| `initialBlock` | `InitialBlockData` | Initial game state (throws if not loaded).                                                       |
| `blockCount`   | `number`           | Total blocks in the stream. Lazily computed on first access by scanning the decompressed buffer. |
| `blockCursor`  | `number`           | Number of blocks consumed so far.                                                                |

#### Accessors

| Method              | Returns         | Description                                     |
| ------------------- | --------------- | ----------------------------------------------- |
| `getRegistry()`     | `ClassRegistry` | Parser registry with all bindings.              |
| `getGhostTracker()` | `GhostTracker`  | Current ghost state (mutated by `nextBlock()`). |
| `getPacketParser()` | `PacketParser`  | Packet parser with parse statistics.            |

---

### `DemoHeader`

```typescript
interface DemoHeader {
  identString: string; // "Tribes2 Recording"
  protocolVersion: number; // 0x330004
  demoLengthMs: number; // Total recording duration in milliseconds
  initialBlockSize: number; // Byte size of the initial block
}
```

---

### `InitialBlockData`

Snapshot of the game state at the moment recording started.

```typescript
interface InitialBlockData {
  // DataBlocks (static game definitions)
  dataBlocks: Map<number, ParsedDataBlock>; // objectId → parsed DataBlock
  dataBlockCount: number;
  dataBlockHeaders: DataBlockHeader[];

  // Player/team state
  scoreEntries: ScoreEntry[];
  targetEntries: TargetEntry[];
  sensorGroupColors: SensorGroupColor[];

  // Connection state
  connectionState: ConnectionProtocolState;
  roundTripTime: number;
  packetLoss: number;

  // Ghost objects present at recording start
  initialGhosts: GhostUpdate[];
  initialEvents: NetEventInfo[];

  // Control object (the recording player)
  controlObjectGhostIndex: number; // -1 if none
  controlObjectData?: Record<string, unknown>;
  // Compression point established by the control object's state (its
  // position), seeding compressed-point decodes in the first packets.
  initialCompressionPoint?: { x: number; y: number; z: number };
  firstPerson: boolean;

  // Mission info
  missionName: string;
  missionCRC: number;

  // Misc
  taggedStrings: Map<number, string>;
  demoValues: string[];
  connectionFields: number[];
  stateArray: number[];
  pathManager: PathManagerEntry[];
  notifyCount: number;
  nextRecvEventSeq: number;
  ghostingSequence: number;

  // Validation
  phase2Valid?: boolean;
  phase2Error?: string;
  phase2TrailingBits?: number;
  // Seeded state Tribes2.exe would crash on during playback (always empty
  // for recordings made by the game; see freshConnectionProtocolState).
  warnings: string[];
}
```

---

### `DemoBlock`

A single block from the compressed block stream.

```typescript
interface DemoBlock {
  index: number;
  type: number; // BlockTypePacket (0), BlockTypeSendPacket (1),
  // BlockTypeMove (2), or BlockTypeInfo (3)
  size: number; // Payload size in bytes
  data: Uint8Array; // Raw payload
  parsed?: PacketData | Move | InfoBlock;
  parseError?: string; // Set if decoding threw (a parser bug)
}

// Type 3 block: written after every received packet, replayed through
// setControlCameraFov on playback.
interface InfoBlock {
  firstPerson: boolean; // $firstPerson (byte 0; the other 3 bytes are garbage)
  cameraFov: number; // control camera FOV in degrees
}
```

---

### `PacketData`

Parsed contents of a network packet block.

```typescript
interface PacketData {
  dnetHeader: DnetHeader;
  rateInfo: RateInfo;
  gameState: GameState;
  events: NetEventInfo[];
  ghosts: GhostUpdate[];
  /** Set when any section failed to parse; the ghost tracker and
   *  event sequence no longer mirror the server, so a live consumer
   *  must re-sync from a fresh connection (the engine disconnects).
   *  The message names the parser and the underlying error. */
  parseFault?: { stage: "gameState" | "event" | "ghost"; message: string };
}
```

#### `GameState`

Per-packet game state from the server.

```typescript
interface GameState {
  lastMoveAck: number;
  damageFlash?: number;
  whiteOut?: number;
  pinged: boolean;
  jammed: boolean;
  controlObjectGhostIndex?: number;
  controlObjectDataStart?: number; // Bit offsets of the control object
  controlObjectDataEnd?: number; // update within the packet
  controlObjectData?: Record<string, unknown>;
  controlObjectError?: string; // Why readPacketData could not be applied
  compressionPoint?: { x: number; y: number; z: number };
  cameraFov?: number;
  targetVisibility?: { index: number; mask: number }[];

  // Seeker/lock-on fields
  selfLocked?: boolean;
  selfHomed?: boolean;
  seekerTracking?: boolean;
  seekerTrackingPos?: { x: number; y: number; z: number };
  seekerMode?: number;
  seekerObjectGhostIndex?: number;
  targetPos?: { x: number; y: number; z: number };
}
```

#### `GhostUpdate`

A create, update, or delete operation on a ghost object.

```typescript
interface GhostUpdate {
  index: number; // Ghost slot (0–1023)
  type: "create" | "update" | "delete";
  classId?: number; // Set on create
  updateBitsStart: number;
  updateBitsEnd: number;
  parsedData?: Record<string, unknown>; // Class-specific parsed fields
  failed?: boolean; // Could not be parsed; the ghost section stops here
  error?: string; // Parser name and error text when failed
}
```

#### `NetEventInfo`

A network event received from the server.

```typescript
interface NetEventInfo {
  classId: number;
  guaranteed: boolean;
  sequenceNumber?: number; // 7-bit wire sequence (guaranteed events)
  absoluteSequenceNumber?: number; // Unwrapped full sequence
  dataBitsStart: number;
  dataBitsEnd: number;
  parsedData?: Record<string, unknown>;
  failed?: boolean; // Event could not be parsed; stream
  // position after it is unreliable
  error?: string; // Parser name and error text when failed
}
```

---

### `Move`

Raw 64-byte player input struct (from type 2 blocks).

```typescript
interface Move {
  x: number;
  y: number;
  z: number; // Movement input per axis (float)
  yaw: number;
  pitch: number;
  roll: number; // Rotation deltas in radians
  // (server adds them each tick)
  px: number;
  py: number;
  pz: number; // Packed integer forms of x/y/z
  pyaw: number;
  ppitch: number;
  proll: number; // Packed rotation: fractional
  // turns × 65536 (16-bit range)
  id: number;
  sendCount: number;
  freeLook: boolean;
  trigger: boolean[]; // 6 trigger keys (fire, jet, jump, etc.)
}
```

---

### `ParsedDataBlock`

A static game object definition parsed from the initial block.

```typescript
interface ParsedDataBlock {
  classId: number;
  className: string; // e.g. "PlayerData", "WheeledVehicleData"
  objectId: number;
  data: Record<string, unknown>; // Class-specific fields (shapeName, etc.)
}
```

---

### Timeline functions

#### `buildTimeline(demo, registry): DemoTimeline`

Extract a time-indexed timeline from a fully parsed `DemoFile`. Every Move
block is one 32ms simulation tick (`MoveTickMs`), so a packet's timestamp is
the number of Move blocks before it × 32ms — exact demo time, the same clock
as `DemoParser.bufferedMoveTicks` and the seek guide below. `tickIntervalMs`
is always `MoveTickMs`.

```typescript
import { buildTimeline } from "t2-demo-parser";

const timeline = buildTimeline(demo, parser.getRegistry());
```

#### `getTimelineStats(timeline): TimelineStats`

Compute summary statistics from a timeline.

```typescript
interface TimelineStats {
  durationMs: number;
  tickIntervalMs: number;
  packetCount: number;
  controlObjectKeyframes: number;
  totalGhostInstances: number;
  ghostInstancesByClass: Map<string, number>;
  ghostKeyframesByClass: Map<string, number>;
  ghostsWithPosition: number;
  totalEvents: number;
  eventsByType: Map<string, number>;
}
```

#### `exportTimeline(timeline): ExportTimeline`

Convert a timeline to a compact JSON-serializable format for Three.js.
Positions and rotations are packed into arrays, and only ghost instances
with position data are included.

```typescript
interface ExportTimeline {
  durationMs: number;
  tickIntervalMs: number;
  controlObject: {
    t: number;
    p?: [number, number, number];
    v?: [number, number, number];
  }[];
  ghosts: ExportGhostInstance[];
  events: GameEvent[];
}
```

#### `DemoTimeline`

```typescript
interface DemoTimeline {
  durationMs: number;
  tickIntervalMs: number;
  packetCount: number;
  ghostInstances: GhostInstance[];
  controlObject: ControlObjectKeyframe[];
  events: GameEvent[];
}
```

#### `GhostInstance`

A continuous lifecycle of a ghost object, from creation to deletion.

```typescript
interface GhostInstance {
  ghostIndex: number;
  classId: number;
  className: string;
  spawnTime: number;
  despawnTime?: number;
  keyframes: GhostKeyframe[];
}
```

#### `GhostKeyframe`

```typescript
interface GhostKeyframe {
  time: number;
  position?: Vec3;
  rotation?: Quat | Vec3;
  velocity?: Vec3;
  data?: Record<string, unknown>;
}
```

#### `ControlObjectKeyframe`

```typescript
interface ControlObjectKeyframe {
  time: number;
  ghostIndex: number;
  position?: Vec3;
  velocity?: Vec3;
  data?: Record<string, unknown>;
}
```

---

### `PacketParser`

Available via `parser.getPacketParser()`. Exposes parse statistics.

| Property                | Type     | Description                                                     |
| ----------------------- | -------- | --------------------------------------------------------------- |
| `packetsParsed`         | `number` | Total packets successfully parsed.                              |
| `ghostCreatesParsed`    | `number` | Ghost create operations parsed.                                 |
| `ghostUpdatesParsed`    | `number` | Ghost update operations parsed.                                 |
| `ghostDeletes`          | `number` | Ghost delete operations.                                        |
| `ghostsFailed`          | `number` | Ghost operations that failed to parse.                          |
| `ghostsTrackerDiverged` | `number` | Ghost tracker inconsistencies detected.                         |
| `eventsParsed`          | `number` | Events parsed.                                                  |
| `eventsFailed`          | `number` | Events that failed to parse.                                    |
| `controlObjectParsed`   | `number` | Control object updates parsed.                                  |
| `controlObjectFailed`   | `number` | Control object updates that failed.                             |
| `protocolRejected`      | `number` | Packets rejected by the dnet protocol window.                   |
| `protocolNoDispatch`    | `number` | Packets accepted but not dispatched (duplicates/out-of-window). |
| `packetsDroppedAfterFault` | `number` | Packets returned empty because the parser had halted.        |

#### Faults and halting

The engine drops the connection on any packet it cannot read ("Invalid
packet"). `PacketParser` mirrors that: the first packet whose game state,
events, or ghosts fail to parse gets a `parseFault`, and by default the
parser **halts** — every later `parsePacket()` returns an empty `PacketData`
carrying the same fault and touches no state, because it would otherwise be
parsing against ghost and event state that no longer mirrors the server.

| Member      | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `fault`     | The first `ParseFault`, or `undefined`.                             |
| `faulted`   | `true` once a fault has been recorded.                              |

Pass `haltOnFault: false` (to `new PacketParser`, `new DemoParser`, or
`createLiveParser`) to keep parsing regardless; each later packet still
reports its own `parseFault` when it has one. To continue after a fault,
build a fresh parser: `DemoParser.reset()`, or a new `createLiveParser`
seeded from a known-good exported state.

#### State export (for seeding another parser)

These getters capture **all cross-packet parser state**, so a second parser
seeded with the same values (plus the ghost tracker contents and datablock
map) continues the stream in bit-lockstep with this one — the basis for
late-joiner catch-up in live streaming.

| Method                              | Returns                                          |
| ----------------------------------- | ------------------------------------------------ |
| `getConnectionProtocolState()`      | `ConnectionProtocolState` (dnet sequence window) |
| `getNextRecvEventSeq()`             | `number`                                         |
| `getPendingGuaranteedEvents()`      | Out-of-order guaranteed events awaiting dispatch |
| `getCompressionPoint()`             | `{ x, y, z }` (a copy)                           |
| `getDataBlockDataMap()`             | `ReadonlyMap<number, ParsedData> \| undefined`   |
| `setConnectionProtocolState(state)` | — (also a constructor option)                    |

---

### `createLiveParser(seed?): LiveParserKit`

Create a parser stack for live server connections. Sets up the same deterministic
registry bindings as `DemoParser` but without requiring a `.rec` file. Useful for
parsing packets from a live Tribes 2 connection (e.g. via a network proxy).

```typescript
import { createLiveParser } from "t2-demo-parser";

const { registry, ghostTracker, packetParser } = createLiveParser();
// Feed raw packet data through packetParser...
```

```typescript
interface LiveParserKit {
  registry: ClassRegistry;
  ghostTracker: GhostTracker;
  packetParser: PacketParser;
}
```

With a **seed**, the stack resumes an in-progress stream from another
parser's exported state, continuing at a packet boundary in bit-lockstep
with the exporter (the late-joiner catch-up scenario — see
`GhostStateAccumulator` below for producing the ghost seeds):

```typescript
interface LiveParserSeed {
  dataBlocks?: Iterable<[number, ParsedData]>; // objectId → parsed datablock
  ghosts?: Iterable<{ index: number; classId: number }>;
  connectionProtocolState?: ConnectionProtocolState;
  nextRecvEventSeq?: number;
  compressionPoint?: { x: number; y: number; z: number };
  pendingGuaranteedEvents?: Array<{
    absoluteSequenceNumber: number;
    event: NetEventInfo;
  }>;
  haltOnFault?: boolean; // default true, see PacketParser
}
```

### `passiveObserverProtocolState(firstPacketByte): ConnectionProtocolState`

Protocol state for a parser that passively observes the server→client
stream while something else (e.g. a relay) owns the client→server side.
Sets `lastSendSeq` high so ack validation never rejects packets that ack
sequences the observer didn't send. Intended for the first packets of a
connection; to attach mid-stream, seed `connectionProtocolState` from the
exporting parser instead.

Parser-only: never write this state into a `.rec` initial block. The game
requires the start block's notify count to equal
`lastSendSeq - highestAckedSeq` and treats a difference above 0x1d as a
full send window, so a demo seeded this way crashes Tribes2.exe on the
first acknowledged packet. `DemoParser` reports such files in
`initialBlock.warnings`.

```typescript
import { createLiveParser, passiveObserverProtocolState } from "t2-demo-parser";

const { packetParser } = createLiveParser();
// On the first received packet:
packetParser.setConnectionProtocolState(passiveObserverProtocolState(data[0]));
```

### `freshConnectionProtocolState(connectSequence): ConnectionProtocolState`

The state of a connection that has not yet exchanged a sequenced packet:
everything zero except the connect sequence, with `connectionEstablished`
set. This is what a recording that starts at connect time must seed
(with a notify count of 0), writing one SendPacket marker per packet the
recorder actually sends, before the received packet that acks it.

---

### `GhostStateAccumulator`

Maintains one merged full `parsedData` per live ghost by folding each
packet's creates/updates/deletes (plus `GhostAlwaysObjectEvent` creates and
EndGhosting clears). `toInitialGhosts()` yields entries shaped like a demo
recording's `initialGhosts` — the full-state ghost list a `.rec` starts
with when recorded mid-match — for hydrating a late joiner.

```typescript
import { GhostStateAccumulator, mergeGhostParsedData } from "t2-demo-parser";

const accumulator = new GhostStateAccumulator();
// After each parsed packet:
accumulator.applyPacket(packetData);

accumulator.toInitialGhosts(); // GhostUpdate[] with full merged parsedData
accumulator.getGhostSeeds(); // { index, classId }[] for createLiveParser
accumulator.size();
accumulator.clear();
```

`mergeGhostParsedData(base, update)` is the underlying merge rule: arrays
whose entries carry a numeric `index` (threads, images, sounds) merge
sparsely by index; other values are last-write-wins.

---

### `BitStream`

Low-level bit-packed data reader used internally. Exported for advanced use
cases like reading raw block payloads or implementing custom parsers.

```typescript
import { BitStream } from "t2-demo-parser";

const bs = new BitStream(uint8Array);
const flag = bs.readFlag();
const value = bs.readInt(10);
const str = bs.readString();
```

Reads never throw on short data: a read that would pass the end of the
buffer returns zero (or an empty buffer), leaves the cursor in place, and
sets the error flag, which `isError()` reports — the same contract as the
engine's BitStream. `readInt` throws a `RangeError` for bit counts above 32.
Strings are decoded byte-per-character (Latin-1); Tribes 2 tagged strings
begin with `"\x01"`.

### `BitWriter`

The matching LSB-first bit packer, for building test vectors and synthetic
packets: `writeFlag`, `writeInt`, `writeSignedInt`, `writeU8/U32/S32`,
`writeF32`, `writeFloat`, `writeBytes`, and `writeString` (Huffman, exactly
as the engine's `writeString`). `finish()` returns the packed `Uint8Array`.

```typescript
import { BitWriter, BitStream } from "t2-demo-parser";

const bytes = new BitWriter().writeFlag(true).writeInt(5, 4).writeString("hi").finish();
const bs = new BitStream(bytes); // readFlag() → true, readInt(4) → 5, readString() → "hi"
```

### `ClassRegistry` / `createDefaultRegistry()`

`createDefaultRegistry()` returns a registry with every built-in parser bound
to its deterministic classId — the same setup `DemoParser` and
`createLiveParser` use. Lookups go both ways:

| Method                                  | Returns                          |
| --------------------------------------- | -------------------------------- |
| `getGhostParser(classId)` etc.          | Parser entry for a bound classId |
| `getGhostClassId(name)` etc.            | Bound classId for a class name   |
| `getGhostCatalog()` etc.                | `ReadonlyMap<name, entry>`       |
| `getGhostBindings()` etc.               | `Map<classId, name>` (debug)     |

The `Event` and `DataBlock` variants of each method exist too.

---

### `GhostTracker`

Tracks the live state of all ghost objects. Available via
`parser.getGhostTracker()` or from `createLiveParser()`.

```typescript
const tracker = parser.getGhostTracker();
const ghost = tracker.getGhost(index); // GhostEntry | undefined
const all = tracker.getAllGhosts(); // ReadonlyMap<number, GhostEntry>
tracker.size(); // Number of active ghosts
```

```typescript
interface GhostEntry {
  classId: number;
  className: string;
}
```

Accumulated per-ghost state lives in `GhostStateAccumulator`, not in the
tracker.

---

### Constants

Block type constants for filtering `DemoBlock.type`:

```typescript
import {
  BlockTypePacket, // 0 — network packet
  BlockTypeSendPacket, // 1 — send-packet trigger (no data)
  BlockTypeMove, // 2 — 64-byte player input
  BlockTypeInfo, // 3 — 8-byte timing/FOV
  MoveTickMs, // 32 — one Move block per simulation tick
  DemoIdentString, // "Tribes2 Recording"
  DemoProtocolVersion, // 0x330004 (build 25034)
} from "t2-demo-parser";
```

Network protocol constants are also exported:

```typescript
import {
  MaxGhostCount, // 1024
  GhostIdBitSize, // 10
  NetStringTableMaxStrings, // 4096
  StringIdBitSize, // 12
  NetEventClassBitSize, // 6
  NetEventClassFirst, // 255
  NetObjectClassBitSize, // 7
  NetObjectClassFirst, // 0
  MaxPacketDataSize, // 1500
  MaxTriggerKeys, // 6
  MoveCountBits, // 5
  MaxMoveCount, // 30
  DataBlockObjectIdFirst, // 3
  DataBlockObjectIdBitSize, // 10
  DataBlockClassFirst, // 128
  DataBlockClassBitSize, // 7
} from "t2-demo-parser";
```

Class name arrays (sorted by C `strcmp`, matching the deterministic classId
assignment order):

```typescript
import {
  NetObjectClassNames, // 53 ghost class names
  DataBlockClassNames, // 54 DataBlock class names
  NetEventClassNames, // 26 event class names
} from "t2-demo-parser";
```

---

## Guides

### Get demo metadata without parsing blocks

Use `load()` to parse the header and initial block. This is fast (header +
initial block + async decompress) and gives you everything you need to set up
a scene before playing through the recording.

```typescript
const parser = new DemoParser(buffer);
const { header, initialBlock } = await parser.load();

// Duration
const durationMs = header.demoLengthMs;
const durationStr = `${Math.floor(durationMs / 60000)}m${Math.floor(
  (durationMs % 60000) / 1000,
)
  .toString()
  .padStart(2, "0")}s`;

// Mission / map name
const mission = initialBlock.missionName; // e.g. "Rollercoaster"

// Game mode / mission type — look in DemoValues
// $DemoValue_0 is typically the game mode (e.g. "CTFGame")
const gameMode = initialBlock.demoValues[0];

// Teams and players
for (const score of initialBlock.scoreEntries) {
  console.log(
    `Team ${score.teamId}: client ${score.clientId}, score ${score.score}`,
  );
}

// Player names from the target table
for (const target of initialBlock.targetEntries) {
  if (target.name) {
    console.log(`${target.name} (team ${target.sensorGroup})`);
  }
}

// DataBlocks (shapes, vehicles, weapons loaded for this mission)
for (const [id, db] of initialBlock.dataBlocks) {
  if (db.data.shapeName) {
    console.log(`${db.className}: ${db.data.shapeName}`);
  }
}

// Initial ghost objects (world state at recording start)
console.log(`${initialBlock.initialGhosts.length} ghosts at start`);
```

### Stream blocks one at a time (low memory)

After `load()`, call `nextBlock()` in a loop. Each block is parsed on demand
and can be released immediately. This avoids holding the entire block array
in memory.

```typescript
const parser = new DemoParser(buffer);
await parser.load();

let block;
while ((block = parser.nextBlock())) {
  if (block.type === BlockTypePacket && block.parsed) {
    const pkt = block.parsed as PacketData;
    // Process packet...
  }
}
```

### Seek to a specific time

There's no random-access index — blocks must be processed sequentially to
maintain ghost tracker state. To seek, reset and fast-forward.

Move blocks (type 2) are sent at a fixed 32ms tick rate. Count them to estimate
elapsed time.

```typescript
import { BlockTypeMove } from "t2-demo-parser";

const parser = new DemoParser(buffer);
await parser.load();

function seekTo(targetMs: number) {
  parser.reset();
  let moveCount = 0;
  let block;
  while ((block = parser.nextBlock())) {
    if (block.type === BlockTypeMove) moveCount++;
    if (moveCount * 32 >= targetMs) break;
  }
  return moveCount * 32; // Actual time reached
}

const actualMs = seekTo(60000); // Seek to ~1 minute
// Ghost tracker now reflects state at that point.
// Continue calling nextBlock() to play forward from here.
```

### Build a Three.js animation timeline

```typescript
import {
  DemoParser,
  buildTimeline,
  getTimelineStats,
  exportTimeline,
} from "t2-demo-parser";

const parser = new DemoParser(buffer);
const demo = await parser.parseFullDemo();
const timeline = buildTimeline(demo, parser.getRegistry());

// Summary
const stats = getTimelineStats(timeline);
console.log(`${stats.controlObjectKeyframes} player keyframes`);
console.log(`${stats.totalGhostInstances} ghost instances`);
console.log(`${stats.ghostsWithPosition} with position data`);

// Iterate ghost lifecycles
for (const inst of timeline.ghostInstances) {
  console.log(
    `${inst.className} #${inst.ghostIndex}: ${inst.keyframes.length} keyframes`,
  );
  for (const kf of inst.keyframes) {
    if (kf.position) {
      // Feed into Three.js KeyframeTrack...
    }
  }
}

// Export compact JSON for Three.js
const exported = exportTimeline(timeline);
// exported.controlObject — player position/velocity keyframes
// exported.ghosts — ghost position/rotation/velocity keyframes
// exported.events — timestamped game events
```

### Replay and compare (deterministic)

Parsing is fully deterministic. Resetting and replaying produces identical
results.

```typescript
const parser = new DemoParser(buffer);
await parser.load();

// First pass
while (parser.nextBlock()) {}
const stats1 = parser.getPacketParser().packetsParsed;

// Reset and replay
parser.reset();
while (parser.nextBlock()) {}
const stats2 = parser.getPacketParser().packetsParsed;

console.log(stats1 === stats2); // true
```

### Access parse statistics

After parsing, check the `PacketParser` stats to verify data quality.

```typescript
const parser = new DemoParser(buffer);
await parser.parseFullDemo();
const pp = parser.getPacketParser();

console.log(`Packets:        ${pp.packetsParsed}`);
console.log(`Ghost creates:  ${pp.ghostCreatesParsed}`);
console.log(`Ghost updates:  ${pp.ghostUpdatesParsed}`);
console.log(`Ghost deletes:  ${pp.ghostDeletes}`);
console.log(`Ghost failures: ${pp.ghostsFailed}`);
console.log(`Events:         ${pp.eventsParsed}`);
console.log(`Control object: ${pp.controlObjectParsed}`);
```

A healthy parse has 0 ghost failures and 0 tracker divergences.

### Identify ghost objects by class

The 53 ghost classes (Player, Turret, FlyingVehicle, etc.) are bound
deterministically. Use the registry to look up class names.

```typescript
const registry = parser.getRegistry();

// From a ghost update in a packet:
if (ghost.type === "create" && ghost.classId !== undefined) {
  const entry = registry.getGhostParser(ghost.classId);
  console.log(entry?.name); // e.g. "Player", "Turret", "LinearProjectile"
}

// From the ghost tracker (live state):
const tracker = parser.getGhostTracker();
const ghostEntry = tracker.getGhost(ghostIndex);
if (ghostEntry) {
  console.log(ghostEntry.className, ghostEntry.classId);
}
```

### Debug logging

The parser uses the [`debug`](https://www.npmjs.com/package/debug) package.
Enable namespaces to see detailed parse output:

```bash
# All parser output
DEBUG=t2-demo-parser* npx t2-demo-parser demo.rec

# Just initial block parsing
DEBUG=t2-demo-parser:initial npx t2-demo-parser demo.rec

# Just block stream parsing
DEBUG=t2-demo-parser:blocks npx t2-demo-parser demo.rec

# Per-event / per-ghost parse failures and tracker re-creates
DEBUG=t2-demo-parser:events,t2-demo-parser:ghosts,t2-demo-parser:ghost-tracker npx t2-demo-parser demo.rec
```

### Known limitations

- One archived demo (a 2000s-era recording) carries a TerrainBlock
  `GhostAlwaysObjectEvent` after a mission change whose payload holds 377 more
  bits than build 25034's `TerrainBlock::unpackUpdate` reads (a shared-prefix
  string with the terrain's material list, then 91 unidentified bits). Seven
  other mission-change TerrainBlock events in other demos match the binary
  exactly, so this is a conditional extension of an unidentified client
  build. The parser faults cleanly at that packet instead of guessing.
- `SimVoiceStreamEvent` follows the binary's layout (which differs from the
  V12 source), but no available demo contains voice traffic, so it is
  verified against the disassembly only.

---

## Upgrading from 2.x

Breaking changes in this version:

- **Halt on fault.** `PacketParser` stops after the first `parseFault`
  (`haltOnFault: false` restores the old behaviour).
- **Header validation.** `DemoParser.load()` throws on a wrong ident string or
  protocol version (`ignoreProtocolVersion: true` to override).
- **Timeline timestamps** come from Move ticks (32ms) instead of an even
  spread of packets over the demo length; `tickIntervalMs` is now 32.
- Removed fields: `GhostEntry.state`, `ConnectionContext.currentGhostIndex`,
  `SimDataBlockEventData._payloadBitPos` / `_needsClassParser`,
  `VehicleGhostData._controlledEarlyReturn`, `DebrisDataBlock.minSpinSpeed_dup`
  / `maxSpinSpeed_dup` (the second wire copy now lands in `minSpinSpeed` /
  `maxSpinSpeed`, as on the client). `GhostAlwaysObjectEventData._hasObjectData`
  is now `hasObjectData`; `DebrisGhostData.objectRef2` is folded into
  `objectRefs` (three entries); `ShapeBaseDataBlock.jetEffect` is `null`
  rather than `undefined` when absent.
- `SimVoiceStreamEventData` now reflects the binary's wire format
  (`sequence`, `codecId`, `streamId`, `clientId`, `partial`, `frameCount`,
  `audioData` or `frames`).
- A `SimDataBlockEvent` with no parser (or whose payload fails) now fails the
  event (and the packet) instead of returning silently misaligned.
- Parsed-data types are now type aliases without index signatures; property
  access on them is checked.
- `getAllGhosts()`, `getGhostCatalog()`, and `getDataBlockDataMap()` return
  read-only maps; `getCompressionPoint()` returns a copy.
- `ShapeBase` ghosts' `readPacketData` reads energy + recharge only (it was
  bound to the Vehicle reader).

## Supported classes

### Ghost classes (53)

AIObjective, AudioEmitter, BeaconObject, BombProjectile, Camera, Debris,
ELFProjectile, EnergyProjectile, FireballAtmosphere, FlareProjectile,
FlyingVehicle, ForceFieldBare, GameBase, GrenadeProjectile, HoverVehicle,
InteriorInstance, Item, Lightning, LinearFlareProjectile, LinearProjectile,
Marker, MissionArea, MissionMarker, ParticleEmissionDummy, PhysicalZone,
Player, Precipitation, Projectile, RepairProjectile, ScopeAlwaysShape,
SeekerProjectile, ShapeBase, ShockLanceProjectile, Shockwave,
SimpleNetObject, Sky, SniperProjectile, SpawnSphere, Splash, StaticShape,
StationFXPersonal, StationFXVehicle, Sun, TSStatic, TargetProjectile,
TerrainBlock, TracerProjectile, Trigger, Turret, VehicleBlocker,
WaterBlock, WayPoint, WheeledVehicle.

### DataBlock classes (54)

AudioDescription, AudioEnvironment, AudioProfile, AudioSampleEnvironment,
BombProjectileData, CameraData, CannedChatItem, CommanderIconData,
DebrisData, DecalData, ELFProjectileData, EffectProfile,
EnergyProjectileData, ExplosionData, FireballAtmosphereData,
FlareProjectileData, FlyingVehicleData, ForceFieldBareData, GameBaseData,
GrenadeProjectileData, HoverVehicleData, ItemData, JetEffectData,
LightningData, LinearFlareProjectileData, LinearProjectileData,
MissionMarkerData, ParticleData, ParticleEmissionDummyData,
ParticleEmitterData, PlayerData, PrecipitationData, ProjectileData,
RepairProjectileData, RunningLightData, SeekerProjectileData, SensorData,
ShapeBaseData, ShapeBaseImageData, ShockLanceProjectileData,
ShockwaveData, SimDataBlock, SniperProjectileData, SplashData,
StaticShapeData, StationFXPersonalData, StationFXVehicleData,
TSShapeConstructor, TargetProjectileData, TracerProjectileData,
TriggerData, TurretData, TurretImageData, WheeledVehicleData.

### Event classes (26)

CRCChallengeEvent, CRCChallengeResponseEvent, FogChallengeEvent,
GhostAlwaysObjectEvent, GhostingMessageEvent, GravityEvent,
LightningStrikeEvent, NetStringEvent, PathManagerEvent,
RemoteCommandEvent, RemoveClientTargetTypeEvent,
ResetClientTargetsEvent, SensorGroupColorEvent, SetMissionCRCEvent,
SetObjectActiveImageEvent, SetSensorGroupEvent, SetServerTargetEvent,
Sim2DAudioEvent, Sim3DAudioEvent, SimDataBlockEvent,
SimTargetAudioEvent, SimVoiceStreamEvent, SimpleMessageEvent,
TargetFreeEvent, TargetInfoEvent, TargetToEvent.
