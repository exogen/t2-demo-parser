# Experiment Log

Purpose: keep a single source of truth for hypotheses, evidence, commands, outcomes, and next actions so we avoid repeating the same tests.

## Entry format

- `ID`: stable identifier
- `Date`: YYYY-MM-DD
- `Hypothesis`: what should improve and why
- `Evidence`: decompiled/objdump source of truth (function addresses)
- `Command`: exact command run
- `Result`: key metrics only
- `Decision`: accepted/rejected/inconclusive
- `Next`: concrete next step

## Entries

### E-2026-02-17-001
- `Date`: 2026-02-17
- `Hypothesis`: current baseline with default settings is still desynced in initial phase2.
- `Evidence`: `FUN_005fb5c0` (full initial block read), `FUN_00588260` (base start-block read), `FUN_00585220` (ghost start-block read).
- `Command`: `npm run -s dev -- demo022.rec`
- `Result`:
  - `initial.phase2.valid=false`
  - `initial.phase2.ghosts=34`
  - `initial.phase2.controlObj=-939264`
  - `initial.phase2.trailingBits=128260`
  - `pass2.seededInitialGhosts=0`
  - `ghostClassIdsUnique=128`
- `Decision`: accepted (baseline still invalid).
- `Next`: isolate first deterministic divergence in initial ghost stream.

### E-2026-02-17-002
- `Date`: 2026-02-17
- `Hypothesis`: disabling heuristic initial-ghost parser selection will expose deterministic failure point.
- `Evidence`: `FUN_00585220` shows deterministic per-ghost create loop with `readFlag + readInt(10) + readInt(7) + unpackUpdate`.
- `Command`: `HEURISTIC_GHOST_PARSER=0 DEBUG_INITIAL_PHASE2=1 DEBUG_INITIAL_CONTROL_CANDIDATES=1 npm run -s dev -- demo022.rec`
- `Result`:
  - `initial.phase2.ghosts=5` (idx/class: `0/4,1/25,2/39,3/39,4/48`)
  - `initial.phase2.controlObj=0`
  - control parser chosen `Camera`, consumed `227` bits, `cameraMode=7` (invalid range)
  - `initial.phase2.mission="t"`
  - `initial.phase2.trailingBits=188927`
- `Decision`: accepted (deterministic path still wrong; huge under-consumption remains).
- `Next`: treat `ShapeBase/Camera unpack/readPacketData` fidelity as high-priority.

### E-2026-02-17-003
- `Date`: 2026-02-17
- `Hypothesis`: the optional ShapeBase per-image trailing flag is over-read; disabling it may reduce drift.
- `Evidence`: `FUN_005ef0e0` image branch has runtime-dependent extra `readFlag` in one branch.
- `Command`: `HEURISTIC_GHOST_PARSER=0 SHAPEBASE_IMAGE_EXTRA_FLAG=0 DEBUG_INITIAL_PHASE2=1 npm run -s dev -- demo022.rec`
- `Result`:
  - regression vs E-002:
  - `initial.phase2.ghosts=3`
  - `initial.phase2.controlObj=671088640` (nonsense)
  - `initial.phase2.trailingBits=190353` (worse)
- `Decision`: rejected.
- `Next`: keep `SHAPEBASE_IMAGE_EXTRA_FLAG` default behavior for now.

### E-2026-02-17-004
- `Date`: 2026-02-17
- `Hypothesis`: control-object index width/encoding is wrong.
- `Evidence`: `FUN_005fb5c0` reads control object index via `(**(code **)(*param_1 + 4))(4,&iStack_18)` (32-bit read), then optional object `readPacketData`.
- `Command`: static verification in `/Users/exogen/Projects/tribes2-decompiled/output/Tribes2.exe.c` around `FUN_005fb5c0`.
- `Result`: parser behavior (`readS32`) matches binary.
- `Decision`: rejected as root cause.
- `Next`: continue on ghost payload fidelity before control-object read.

### E-2026-02-17-005
- `Date`: 2026-02-17
- `Hypothesis`: experiment tracking must be machine-readable to prevent repeated manual checks.
- `Evidence`: N/A (process/tooling improvement).
- `Command`: `EXPERIMENT_METRICS_PATH=reference/metrics/demo022-default.json npm run -s dev -- demo022.rec`
- `Result`:
  - metrics JSON produced at `reference/metrics/demo022-default.json`
  - includes initial phase2 validity/trailing, pass2 parse counters, class-id cardinalities, top unbound classIds
- `Decision`: accepted.
- `Next`: require a metrics JSON for every future parser hypothesis run.

### E-2026-02-17-006
- `Date`: 2026-02-17
- `Hypothesis`: direct default-vs-strict comparison should isolate whether heuristic ghost selection materially improves pass2.
- `Evidence`: same input (`demo022.rec`), only `HEURISTIC_GHOST_PARSER` toggled.
- `Command`:
  - `EXPERIMENT_METRICS_PATH=reference/metrics/demo022-default.json npm run -s dev -- demo022.rec`
  - `EXPERIMENT_METRICS_PATH=reference/metrics/demo022-strict.json HEURISTIC_GHOST_PARSER=0 npm run -s dev -- demo022.rec`
- `Result`:
  - phase2 differs (`ghosts=34` default vs `ghosts=5` strict; `control=-939264` vs `0`)
  - pass2 core packet counters are effectively unchanged in both runs:
  - `eventsParsed=8810`, `ghostCreatesParsed=1804`, `ghostUpdatesParsed=8892`, `ghostsFailed=1714`
- `Decision`: accepted.
- `Next`: focus on initial-block fidelity first; pass2 packet parser quality is currently insensitive to this toggle.

### E-2026-02-17-007
- `Date`: 2026-02-17
- `Hypothesis`: phase2 mission-string corruption is due to missing string-buffer mode in phase2 only.
- `Evidence`: `FUN_0043c630` (BitStream string decode with optional prefix flag), mission read at `FUN_005fb5c0` line calling stream vfunc `+0x1c`.
- `Command`: `HEURISTIC_GHOST_PARSER=0 DEBUG_INITIAL_PHASE2=1 DEBUG_INITIAL_STRING_BUFFER=1 npm run -s dev -- demo022.rec`
- `Result`:
  - phase2 stayed invalid
  - mission still garbled (`"ñ"`), control parser still produced invalid camera mode
  - trailing bits remained huge (`188922`)
- `Decision`: rejected.
- `Next`: keep phase2 string-buffer toggle off by default.

### E-2026-02-17-008
- `Date`: 2026-02-17
- `Hypothesis`: initial-block phase1 needs string-buffer mode globally.
- `Evidence`: same string decode path (`FUN_0043c630`) plus early initial-block read path in `FUN_005fb5c0`.
- `Command`: `HEURISTIC_GHOST_PARSER=0 DEBUG_INITIAL_LAYOUT=1 DEBUG_INITIAL_LAYOUT_STRING_BUFFER=1 DEBUG_INITIAL_STRING_BUFFER=1 npm run -s dev -- demo022.rec`
- `Result`:
  - catastrophic regression: datablock count decoded as `3221225474`
  - parser entered runaway parse and hit Node OOM
- `Decision`: rejected.
- `Next`: do not re-run global initial-layout string-buffer mode.

### E-2026-02-17-009
- `Date`: 2026-02-17
- `Hypothesis`: control-object parsing should be deterministic by class parser only, matching binary behavior (`FUN_005fb5c0` + vfunc `+0x108`).
- `Evidence`: decompiled camera readPacketData (`FUN_005cc530`) and control read callsite in `FUN_005fb5c0`.
- `Command`:
  - strict deterministic mode: `STRICT_CONTROL_PARSER=1 STRICT_INITIAL_CONTROL_PARSER=1 EXPERIMENT_METRICS_PATH=reference/metrics/demo022-strict-control-only-restored.json npm run -s dev -- demo022.rec`
  - restored default comparison: `EXPERIMENT_METRICS_PATH=reference/metrics/demo022-default-restored.json npm run -s dev -- demo022.rec`
- `Result`:
  - strict deterministic mode regressed pass2 (`eventsParsed=8059`, `ghostsFailed=2573`)
  - restored default matched prior baseline exactly (`eventsParsed=8810`, `ghostsFailed=1714`)
- `Decision`: mixed.
- `Next`: keep heuristic control parser as default for now; keep strict mode behind env flags for targeted debugging only.

### E-2026-02-25-010
- `Date`: 2026-02-25
- `Hypothesis`: ghost index lifecycle must match binary semantics exactly: delete is immediate on receive; index reuse is allowed only after sender-side kill ack/free (or EndGhosting clear), so parser should not synthesize ghost creates after failed parses.
- `Evidence`:
  - receiver delete/create/update path: `FUN_005841b0`
  - sender kill staging (not free yet): `FUN_00583db0`
  - sender free on ack: `FUN_00583cf0` + `FUN_00584560`
  - sender drop rollback (re-kill/re-ghost): `FUN_00583bf0`
  - ghost slot allocation from free list: `FUN_005846b0`
  - end-ghosting clear path: `FUN_00584830` (message case 2)
- `Command`:
  - `npm run build`
  - `npx tsx -e '...parse demo022 and report ghost failure/over52 counts...'`
- `Result`:
  - build passes
  - strict lifecycle (no synth-create on ghost parse fail) gives:
  - `packets=28120`
  - `ghostOps=56987`
  - `failPkts=2654`
  - `failOps=2654`
  - `over52=2611`
  - first bad op remains `pkt=301 seq=367 idx=121 classId=68`
- `Decision`: accepted as lifecycle-correctness guard; packet completion regression confirms we were previously hiding desync with heuristic tracker mutations.
- `Next`: fix upstream bit-accurate ghost/event unpacking causing the first bounded failure; do not use tracker mutation to mask desync.

### E-2026-02-25-011
- `Date`: 2026-02-25
- `Hypothesis`: packet-301 might be incorrectly accepted by parser due to incomplete protocol checks (sequence/ack/connect handling mismatch).
- `Evidence`:
  - `FUN_0043d2d0` and `FUN_0043d4d0` disassembled with `r2` from `/Users/exogen/Projects/tribes2-decompiled/Tribes2_build-25034_patch-rc2a/GameData/Tribes2.exe`.
  - `FUN_0043d4d0` branches match parser gate logic: connect bit, ack-byte/type bounds, seq window, ack window, duplicate/non-data suppression.
- `Command`:
  - `r2 -q -AA -c "s 0x0043d2d0; pdf; s 0x0043d4d0; pdf" .../Tribes2.exe`
  - `npx tsx /tmp/check301.ts`
- `Result`:
  - packet window around first bad:
    - `pkt301 seq=367 type=0 ackBytes=1 ackMask=255 gameData=true bad=create idx=121 classId=68`
  - aggregate gate stats:
    - `protocolRejected=0`
    - `protocolNoDispatch=0`
    - `packetsParsed=28120`
- `Decision`: accepted (packet 301 is currently treated as valid/dispatching under decompiled-aligned gate logic).
- `Next`: investigate bitstream/state fidelity before/within ghost decode, not protocol header gating.

### E-2026-02-25-012
- `Date`: 2026-02-25
- `Hypothesis`: first bad classId at packet 301 is driven by specific ghost lifecycle mismatch around `idx=121` deletes.
- `Evidence`:
  - targeted lifecycle trace around packets `201`, `212`, `219`, `301`.
  - decompiled ghost read loop `FUN_005841b0` confirms `idSize=readInt(3)+3` and per-op header order.
- `Command`:
  - `npx tsx src/diag-delete-matrix.ts demo022.rec`
  - `npx tsx /tmp/trace_idx121.ts`
  - `npx tsx /tmp/pkt219_dump.ts`
- `Result`:
  - baseline: `firstBad=pkt301 idx121 classId68`
  - suppress `delete(pkt201,idx121)`: no change (`firstBad=pkt301 idx121 classId68`)
  - suppress `delete(pkt219,idx121)`: shifts to `firstBad=pkt370 idx173 classId68`
  - suppress both `pkt201+pkt219`: regresses (`firstBad=pkt301 idx393 classId96`, `totalBad` increases)
  - traced baseline lifecycle:
    - `pkt201: delete idx121`
    - `pkt212: create idx121 class19`
    - `pkt219: delete idx121`
    - `pkt301: create idx121 class68 (stop)`
- `Decision`: accepted (packet 219 transition is the most sensitive currently observed state edge; packet 201 is not).
- `Next`: focus on why packet-219 decode/state path leads to idx121 absence at pkt301 (either false delete at pkt219 or missed recreate between pkt219..301).

## Do-not-repeat list

- Do not re-run `SHAPEBASE_IMAGE_EXTRA_FLAG=0` unless `readShapeBaseUpdate` changes.
- Do not re-open control-index width hypothesis unless decompile evidence changes.
- Always capture metrics with `EXPERIMENT_METRICS_PATH=<file>` for every new hypothesis run.
- Do not enable `DEBUG_INITIAL_LAYOUT_STRING_BUFFER=1` on full demo parses (known catastrophic misalignment/OOM).
