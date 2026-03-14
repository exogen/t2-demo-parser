# Decompiled Tribes 2 Binary Analysis

Analysis of the decompiled Tribes 2 binary (build 25034) at
`/Users/exogen/Projects/tribes2-decompiled/output/Tribes2.exe.c`.

## Key Function Mappings

| Address | Decompiled Name | Engine Equivalent | Description |
|---------|----------------|-------------------|-------------|
| 0x0043bf10 | FUN_0043bf10 | BitStream::readInt(N) | Read N bits as uint |
| 0x0043bf60 | FUN_0043bf60 | BitStream::writeInt(val, N) | Write N bits |
| 0x0043bdb0 | FUN_0043bdb0 | BitStream::writeFlag(bool) | Write 1-bit flag |
| 0x0043be10 | FUN_0043be10 | BitStream::readBits(N, &out) | Raw bit read |
| 0x0043bcc0 | FUN_0043bcc0 | BitStream::writeBits(N, &in) | Raw bit write |
| 0x0043f120 | FUN_0043f120 | getNextPow2(N) | Round up to power of 2 |
| 0x0043f150 | FUN_0043f150 | getBinLog2(N) | Floor of log2 (counts bits via shifting) |
| 0x00436ce0 | FUN_00436ce0 | BitStream::writeClassId(obj) | Write SimObject ID (11 bits via 0x800 range) |
| 0x00436d10 | FUN_00436d10 | BitStream::readClassId() | Read SimObject ID (11 bits) |
| 0x00436f70 | FUN_00436f70 | Sim::findObject(id) | Find SimObject by ID |
| 0x00423c30 | FUN_00423c30 | AbstractClassRep::create(id) | Create object by class ID |
| 0x005ffbc0 | FUN_005ffbc0 | SimDataBlockEvent::pack | Pack DataBlock event (network) |
| 0x005ffc90 | FUN_005ffc90 | SimDataBlockEvent::unpack | Unpack DataBlock event (network) |
| 0x00587c30 | FUN_00587c30 | NetConnection::startDemoRecord | Start recording demo |
| 0x00587e00 | FUN_00587e00 | NetConnection::writeDemoStartBlock (partial) | Write initial block (base class) |
| 0x0043d740 | FUN_0043d740 | ConnectionProtocol::writeDemoStartBlock | Write 32 U32 seq numbers + 6 U32 + U8 |
| 0x00591bd0 | FUN_00591bd0 | PathManager::writeDemoStartBlock | Write path manager data |
| 0x00583a30 | FUN_00583a30 | NetConnection::writeEventList | Write event linked list (6-bit classId) |
| 0x00585010 | FUN_00585010 | GhostManager::writeGhosts | Write ghost state |
| 0x005899a0 | FUN_005899a0 | NetStringTable::writeDemoStartBlock (?) | Write 0x400 string table entries |

## SimDataBlockEvent Format (Network)

The decompiled `SimDataBlockEvent::pack` (FUN_005ffbc0) shows:

```c
FUN_00436ce0(param_2, piVar2);                    // writeClassId(objectId) → 11 bits
FUN_0043bf60(classId - 0x80, log2(getNextPow2(0x80)));  // writeInt(classId-128, 7)
FUN_0043bf60(mIndex, 0xb);                        // writeInt(index, 11)
FUN_0043bf60(mTotal, 0xc);                        // writeInt(total, 12)
```

This suggests format: objectId(11) + classId(7) + index(11) + total(12) = 41 bits.

**However, empirical testing on actual .rec files shows the V12 format is correct:**

- V12 format: objectId(10)+3 + classId(7)+128 + index(10) + total(11) = 38 bits
- Tested on both initial block headers AND network SimDataBlockEvents
- V12 format gives consistent `total` values (1587 initial → 1664 network)
- Decompiled format gives `total=416` (less than initial 1587 — impossible)
- V12 `index < total` is always satisfied; decompiled format sometimes has `index >= total`

### Hypothesis for Discrepancy

The decompiled binary's `FUN_00436ce0` uses `0x800` (2048) as the SimObject ID range,
yielding 11-bit object IDs. This may represent the *full* SimObject ID space, but the
demo recording code (writeDemoStartBlock) may use a more compact format with
`DataBlockObjectIdBitSize=10` and subtracts `DataBlockObjectIdFirst=3` before writing.

The writeDemoStartBlock function was not clearly identified in the decompiled binary —
the DataBlock writing loop may be inlined or in a derived class override that wasn't
fully traced. The base class (FUN_00587e00) writes: ConnectionProtocol → PathManager →
Events → Ghosts, but the DataBlock loop is in a higher-level override.

## Initial Block Layout (writeDemoStartBlock hierarchy)

Based on the decompiled binary, the writeDemoStartBlock is called via vtable at offset
0xb0. The function hierarchy writes:

1. **DataBlocks** (via GameConnection override — not found in decompiled output)
   - Format: while(writeFlag(exists)) { writeFlag(modified); if modified: V12 header + packData }
2. **Camera state**: U8(firstPerson) + F32 values
3. **Move state**: 4×U32 + packed moves
4. **ConnectionProtocol** (FUN_0043d740): 32×U32 seq + 6×U32 + U8
5. **Two game-specific U32s** (offset 0xf0, 0xf4 in connection)
6. **PathManager** (FUN_00591bd0): U32 count + path data (usually count=0)
7. **Events** (FUN_00583a30): linked list with 6-bit classIds
8. **Ghosts** (FUN_00585010): ghost array with 10-bit IDs + 7-bit classIds

## Other Confirmed Constants

From the decompiled binary:
- Event classId: 6 bits, offset 0xFF (255) — confirmed in FUN_00583a30/FUN_00583ac0
- Ghost classId: 7 bits — confirmed in FUN_00585010
- Ghost ID: 10 bits — confirmed in FUN_00585010
- DataBlock classId: 7 bits, offset 0x80 (128) — confirmed in pack/unpack
- Resource loop: 0x800 (2048) IDs — FUN_00440580 iterates 0 to 0x7FF
- String table write: 0x400 (1024) entries — FUN_005899a0

## Ghost Index Lifecycle (authoritative behavior)

From decompiled `Tribes2.exe.c`:

- Receive-side ghost packet decode (`FUN_005841b0`):
  - delete branch: destroys local ghost and sets slot to null immediately.
  - non-delete branch:
    - if slot is null: reads 7-bit classId and creates a new ghost.
    - if slot is non-null: applies update to existing ghost.

- Send-side delete/reuse:
  - kill scheduling occurs in `FUN_00583db0` (marks killing state; slot not yet reusable).
  - actual free/reuse happens only on packet ack in `FUN_00583cf0`, via `FUN_00584560`.
  - dropped packet rollback is handled in `FUN_00583bf0` (re-queues kill/ghost operations).
  - new scope allocations pull from free-list in `FUN_005846b0`.

- End-ghosting reset:
  - `FUN_00584830` message case `2` clears local ghost objects across indices.

Implication for parser correctness:
- An update after a processed delete is invalid unless a create (or equivalent reset/rebind path) occurs first.
- The same ghost index is reusable for different entities over time, but only after sender-side free/ack (or reset), not immediately at kill write time.

## Validated Format (from .rec files + V12 reference)

The demo recording uses the V12 reference format for DataBlock headers:
- `writeInt(objectId - DataBlockObjectIdFirst, DataBlockObjectIdBitSize)` = writeInt(id-3, 10)
- `writeInt(classId - DataBlockClassFirst, DataBlockClassBitSize)` = writeInt(cls-128, 7)
- `writeInt(mIndex, DataBlockModifiedCountBits)` = writeInt(index, 10)
- `writeInt(mTotal, DataBlockModifiedCountBits + 1)` = writeInt(total, 11)

This is the ONLY format that produces consistent values across both the initial block
and the network event stream.
