---
feature: dream-capture-system
name: Dream & Capture System
description: "Use when modifying capture hooks (capture-prompt/capture-turn/capture-question), the memory or dream pending-turns queues, the background-memory-update detached worker, the Dream agent (shared/agents/dream.md), the session-start-context dream directive, or the dream/decisions config toggles. Keywords: capture-prompt, capture-turn, capture-question, queue-append, pending-turns, memory-worker, background-memory-update, Dream agent, dream directive, DREAM MAINTENANCE, DEVFLOW_BG_UPDATER, dream config, dream-lock, json_extract_cwd_field, dream-cleanup, DREAM_MODEL allowlist, decisions index, index.md."
category: architecture
directories:
  - scripts/hooks
  - shared/agents/dream.md
  - src/cli/commands/capture.ts
  - src/cli/commands/dream.ts
  - src/cli/commands/memory.ts
  - src/cli/commands/decisions.ts
  - src/cli/utils/decisions-config.ts
  - src/cli/utils/decisions-ledger-migration.ts
  - src/cli/utils/dream-cleanup.ts
  - src/cli/utils/project-paths.ts
  - src/cli/hud/components/decisions-counts.ts
  - commands/_partials
created: 2026-07-03
updated: 2026-07-11
---

# Dream & Capture System

## Overview

A capture-then-process model with two deliberately different processors: three always-on hooks
append conversation turns to two independently-gated JSONL queues; the **memory** queue is
drained by a detached `claude -p` worker (`background-memory-update`) on a 120s throttle, and
the **dream** (decisions) queue is drained by the **Dream agent** — a Claude Code background
subagent that `session-start-context` instructs the main model to spawn whenever the queue has
pending turns. Scripts capture and trigger; the Dream agent does all processing by reading and
editing the data files directly. There are no marker files, no per-session JSON state, no
worker locks on the dream side, and no status/stamp files: the claimed queue batch itself is
the only dream-side state, deleted as the agent's final act.

## System Context

**Purpose**: (1) preserve session context across restarts/`/clear`/compaction (working memory)
and (2) detect architectural decisions and pitfalls from conversation turns, rendering them
into `decisions.md`/`pitfalls.md`/`index.md` (decisions pipeline).

**Role in the larger system**: two of the three per-project background systems under
`.devflow/`. The third — feature knowledge — is write-through and in-command (spawned directly
by orchestrator commands at workflow end), not part of this system; see
`.devflow/features/feature-knowledge-system/KNOWLEDGE.md`.

**External dependencies**: the `claude` CLI on `PATH` (memory worker only — the Dream agent is
an in-session subagent, not a `claude -p` child); `jq` with a `node` fallback for all JSON
parsing (`_HAS_JQ`/`_JSON_AVAILABLE`, set once by `json-parse`); `git` (only
`session-start-memory`'s drift detection and `background-memory-update`'s stamp gathering
shell out to it).

## Component Architecture

**Hooks** (registered in `~/.claude/settings.json`, all always-on — no per-feature
hook-registration toggle):

| Hook | Event | Registration position | Spawns? |
|---|---|---|---|
| `capture-prompt` | UserPromptSubmit | — | never |
| `capture-turn` | Stop | **before** `memory-worker` | never |
| `capture-question` | PostToolUse (matcher `AskUserQuestion`) | — | never |
| `memory-worker` | Stop | **after** `capture-turn` | `background-memory-update` |
| `session-start-memory` | SessionStart | before `session-start-context` | never |
| `session-start-context` | SessionStart | last | never (emits the Dream spawn **directive**) |
| `pre-compact-memory` | PreCompact | — | never |

**Processors**:

| Processor | Kind | Triggered by | Model | Tool surface |
|---|---|---|---|---|
| `background-memory-update` | detached `claude -p` worker (`nohup … & disown`) | `memory-worker` (120s throttle) | `haiku` | `--dangerously-skip-permissions`, `--allowedTools 'Read,Write'` |
| Dream agent (`shared/agents/dream.md`) | Claude Code background subagent | `session-start-context` Section 2 directive → main model spawns `Agent(subagent_type="Dream", run_in_background: true)` | resolved per directive (default `opus`) | frontmatter `tools`: Read, Bash, Write, Edit, Glob, Grep |

**State** (all under `.devflow/`, none git-tracked — contrast ADR-002):

| File | Written by | Purpose |
|---|---|---|
| `memory/.pending-turns.jsonl` | capture hooks | memory queue |
| `dream/.pending-turns.jsonl` | capture hooks | decisions queue |
| `dream/.pending-turns.processing` | Dream agent (atomic `mv` claim) | claimed batch — deleted as the agent's final act; mtime is the live/crashed discriminator (900s) |
| `dream/config.json` | `dream-config.ts` (`updateFeature`) | shared toggle: `memory`, `decisions`, `knowledge` |
| `decisions/decisions.json` / `~/.devflow/decisions.json` | `devflow decisions --configure` | Dream agent tuning: `model`, `debug` only |
| `memory/WORKING-MEMORY.md` | `background-memory-update` | rendered working memory |
| `decisions/decisions.md` / `pitfalls.md` | `render-decisions.cjs` (via `assign-anchor`/`retire-anchor`) | rendered ledger body files — written before `index.md`; crash leaves body files without a stale index |
| `decisions/index.md` | `render-decisions.cjs` `renderAndWriteAll` (written **last**, crash-safe) | compact write-time ADR/PF index — consumed by workflow commands via `decisions_load()` plain Read; `(none)` sentinel when ledger is empty |
| `memory/.last-refresh-ok` | memory worker, on success | memory success stamp (the dream side has no stamp — the deleted `.processing` IS success) |

## Component Interactions

### 1. Dual-append (capture-prompt / capture-turn / capture-question)

All three capture hooks share one shape: resolve `PROJECT_ROOT` (via `resolve-project-root`,
falling back to `CWD`), truncate content, then call exactly two `queue-append` functions:

- `queue_read_gates "$DREAM_DIR/config.json"` — **one config-read subprocess fork** returning
  both `_QG_MEMORY` and `_QG_DECISIONS` (AC-P1). The gate is config-only (mirrors memory's
  ADR-001): missing config file defaults both to `"true"`.
- `queue_append_both <memory_queue> <dream_queue> <memory_enabled> <dream_enabled> <role>
  <content> <ts>` — appends the SAME row to whichever queue(s) are enabled, independently.

Row schema is always `{role, content, ts}`: `role` ∈ `user` (capture-prompt) | `assistant`
(capture-turn) | `qa` (capture-question, one row per answered question). Truncation:
prompts/assistant messages cap at 2000 chars; a `qa` row's question and answer are each capped
at 1000 chars **independently**. Every queue file is created with mode `0600` (`umask 077`) on
first write. After each append, `queue_append_row` checks line count and — only when it exceeds
200 — truncates to the newest 100 lines under `dream_lock_acquire "<file>.lock" 2`.

`capture-turn` also runs the decisions-usage scanner (`decisions-usage-scan.cjs`) directly,
gated only by a grep for `ADR-[0-9]+|PF-[0-9]+` in the assistant message AND
`DECISIONS_ENABLED` — independent of whether anything gets queued.

**Stop-array ordering contract**: `capture-turn` MUST be registered before `memory-worker` in
the Stop array. This is enforced entirely by `init.ts`'s call order (`addCaptureHooks` before
`addMemoryHooks`). Reversing the array order would spawn the worker one turn behind.

**Shared cwd+field extraction (`json_extract_cwd_field`)**: the single home of the `cwd`-plus-
arbitrary-field extraction is `json_extract_cwd_field <field>` in `scripts/hooks/json-parse`,
backed by the `extract-cwd-field` node op in `json-helper.cjs`. Both branches delimit the two
output values with ASCII SOH (0x01) — written only as the jq `` escape or the node
`'\x01'` literal, **never as a literal control byte in source**. `json_extract_cwd_prompt` is
a thin delegating wrapper around `json_extract_cwd_field "prompt"`.

### 2. memory-worker → background-memory-update

`memory-worker` owns ONLY the throttle + spawn decision. Throttle key: `.working-memory-last-trigger`
mtime, 120s window. It touches the trigger file **before** spawning. Note this hook does **not**
check whether the queue is actually non-empty before spawning; it spawns unconditionally once the
throttle clears, and lets the worker itself no-op cheaply.

`background-memory-update`'s lifecycle, in order:
1. Re-entrancy guard (`DEVFLOW_BG_UPDATER`) first, then re-check `memory:false` at runtime.
2. Acquire `.working-memory.lock` — 300s stale-break, 90s acquire timeout (less than
   `WATCHDOG_SECS=120` so a waiter gives up before the current holder's watchdog fires).
3. **Orphan-only auto-clean**: if the queue has no `assistant`/`qa` row, truncate and exit without an LLM run.
4. Claim the queue: rename `.pending-turns.jsonl` → `.pending-turns.processing`. Merge any leftover `.processing` from a previous crash.
5. Build context from last `MAX_TURNS=10` (20 lines), up to 65536 bytes of existing `WORKING-MEMORY.md`, git state.
6. Spawn `claude -p --model haiku --dangerously-skip-permissions --allowedTools 'Read,Write'` with prompt on stdin (never argv), under a `WATCHDOG_SECS=120` + 5s kill-grace watchdog.
7. Verify: `WORKING-MEMORY.md` mtime strictly newer AND first line matches `<!-- memory-head:*`. Only then remove `.processing` and touch `.last-refresh-ok`.

**The watchdog kill mechanism** (worth reading once — the non-obvious bash):

```bash
set -m                                     # give claude its OWN process group (PGID == its PID)
DEVFLOW_BG_UPDATER=1 "$CLAUDE_BIN" -p ... &
CLAUDE_PID=$!
set +m                                     # restore so the watchdog subshell stays in THIS group

( sleep "$WATCHDOG_SECS"; kill -TERM -"$CLAUDE_PID"; sleep "$GRACE"; kill -KILL -"$CLAUDE_PID"; ) &
WD_PID=$!
wait "$CLAUDE_PID"; CLAUDE_EXIT=$?
kill "$WD_PID" 2>/dev/null; wait "$WD_PID" 2>/dev/null  # cancel watchdog before a PID can recycle
```

Without `set -m`, `kill -TERM -"$CLAUDE_PID"` (negative PID kills an entire process group)
would kill the worker script itself. The watchdog is cancelled as soon as `claude` exits.

### 3. session-start-context Section 2 → Dream agent

`session-start-context` gates both sections on the `decisions` field in dream config (config-only).
Section 2 emits the `--- DREAM MAINTENANCE ---` directive when work is pending:

- `.pending-turns.processing` **fresh** (< 900s) → a live Dream agent owns the batch → **suppressed**.
- `.pending-turns.processing` **stale** (≥ 900s) → crashed run → emit.
- otherwise `.pending-turns.jsonl` non-empty (`-s`) → emit.

When emitting, it resolves the model via project `decisions/decisions.json` → global
`~/.devflow/decisions.json` → `"opus"`, then validates against a `case "$DREAM_MODEL" in
opus|sonnet|haiku)` allowlist before ever interpolating into the directive text.

The **Dream agent** (`shared/agents/dream.md`) then:
1. Claims the queue: atomic `mv .pending-turns.jsonl .pending-turns.processing`. Lost `mv` = exit silently. Stale `.processing` is re-claimed (`touch` heartbeat) and any new queue is folded in.
2. Reads everything directly with its Read tool: the claimed batch, `decisions-log.jsonl`, `decisions.md`/`pitfalls.md`/`index.md` (active entries), `.decisions-usage.json`.
3. Writes observations directly — appends one JSONL row via heredoc, or Edit-replaces a single existing row to reinforce it. Never rewrites the whole file.
4. Calls only the three ledger ops via Bash: `assign-anchor` (numbering + render), `retire-anchor` (status flip + render), `rotate-observations` (30-day archival). Each self-locks internally.
5. Heartbeats (`touch`) the claim file once at the detection→curation boundary.
6. Deletes `.pending-turns.processing` as its **final act** (consume-then-delete).
7. Ends with a 1–3 line summary.

### 4. Dream agent instructions (shared/agents/dream.md)

A normal shared agent (distributed to `devflow-core-skills` + `devflow-ambient`). Its **Iron
Laws**: (a) `assign-anchor` owns numbering and `render-decisions.cjs` owns ALL THREE rendered
files — **never hand-edit `decisions.md`, `pitfalls.md`, or `index.md`**; (b) abstain-by-default
— "most runs produce nothing, if unsure record nothing"; (c) ADR-XOR-PF — one incident yields
exactly one of an ADR or a PF; (d) curation bounded to **≤5 changes per run** and a **7-day
protection window** keyed on the ledger row's `date` field.

Detection (Part 1): scan `decisions-log.jsonl` for a matching existing entry first — reinforce
that row (single-line Edit) rather than creating a duplicate. Promote via `assign-anchor` only
when `quality_ok=true`. Curation (Part 2): run `rotate-observations` first, then retire ≤5
candidates via `retire-anchor <id> <status>`.

Contract tests: `tests/dream-agent.test.ts` (frontmatter, claim protocol, negatives) and
`tests/decisions/dream-curation.test.ts` + `decisions-format.test.ts`.

### 5. DECISIONS_CONTEXT loading (workflow commands)

Every workflow command that consumes `DECISIONS_CONTEXT` does so via the `decisions_load()`
partial defined in `commands/_partials/_decisions.mds`. The partial is a **plain Read** — zero
subprocess:

1. Read `{worktree}/.devflow/decisions/index.md`.
2. If the file exists and is non-empty: use its content as `DECISIONS_CONTEXT`.
3. If absent or empty: set `DECISIONS_CONTEXT` to `(none)`.

`index.md` is written by `renderAndWriteAll` in `render-decisions.cjs` **last** (after body
files), so a crash leaves body files intact with `index.md` missing — the `(none)` fallback
handles this gracefully. `devflow:apply-decisions` then resolves full body content on demand via
explicit Read of `decisions.md`/`pitfalls.md`. The `_decisions.mds` partial is compiled into
all 12 command host files at build time via `npm run build:mds`; see the feature-knowledge-system
KB for MDS build mechanics.

**Byte format of index.md**: entry lines with two-space `PF-NNN  ` footer padding, absolute
footer paths, `(none)` sentinel for empty ledgers, no trailing newline from `buildIndexContent`
+ a single `\n` added at write time. Format is test-pinned in `tests/decisions/`.

### 6. SessionStart injection (session-start-context, session-start-memory)

`session-start-context` injects the decisions TL;DR (first line of `decisions.md`/`pitfalls.md`,
matched via `sed -n '1s/<!-- TL;DR: \(.*\) -->/\1/p'`) as Section 1 and the Dream maintenance
directive as Section 2 — both gated on the same `decisions` config field the capture hooks read.

`session-start-memory` renders a 3-state header from the `<!-- memory-head: <sha> branch: <name> -->`
stamp on line 1 of `WORKING-MEMORY.md`: **A** in-sync (stamp SHA == HEAD), **B** drifted
(stamp SHA is a provable ancestor), **C** refresh-failing banner (queue depth > 0 AND
`.last-refresh-ok` missing or >600s old). Before passing the parsed `STAMP_SHA` to git, it is
hex-validated (7-40 lowercase-hex chars). It also runs a self-contained **D56c cold-path
recovery**: an orphaned memory `.pending-turns.processing` older than 300s is renamed back to
`.pending-turns.jsonl` only if the live queue file doesn't already exist (non-clobber).

### 7. HUD decisions/pitfalls counts

`gatherDecisionsCounts` reads `decisions-ledger.jsonl` directly and counts active rows by type,
mirroring `render-decisions.cjs`'s own `isActive()` exactly. This mirror is no longer an
unenforced convention — `tests/hud-decisions-counts.test.ts` `require()`s
`scripts/hooks/lib/render-decisions.cjs`'s exported `isActive()` directly and asserts the TS
and CJS implementations agree across the **full** `decisions_status` matrix.

## Integration Patterns

**Re-entrancy guard convention**: every hook and the memory worker check `DEVFLOW_BG_UPDATER`
first. The memory worker sets it on its `claude -p` child so hooks firing from within the
nested session bail out without cascading a second spawn.

**Two independent config layers**: `dream/config.json` (boolean feature toggles: `memory`,
`decisions`, `knowledge`) vs. `decisions.json` (Dream agent tuning: `model`, `debug`). Toggling
a feature never touches `model`/`debug`, and configuring the model never touches boolean gates.

**DECISIONS_CONTEXT consumption is a plain file read**: `_decisions.mds`'s `decisions_load()`
reads `index.md` directly — no subprocess, no `.cjs` script at runtime. The deleted
`decisions-index.cjs` script (which ran at command invocation time) has been replaced by the
write-time `index.md` artifact. Any new workflow command that needs `DECISIONS_CONTEXT` should
import `decisions_load()` from `commands/_partials/_decisions.mds` and compile via build:mds;
it must NOT shell out to any script.

**Bootstrap/migration story**: existing projects without `index.md` are bootstrapped by the
`render-decisions-index-v1` per-project migration (runs on `devflow init`): reads
`decisions-ledger.jsonl`, acquires `.decisions.lock`, writes only `index.md` — never
rewrites body files. No-op when the ledger is absent (index will be written on the next Dream
run). The `purge-orphaned-decisions-index-v1` global migration removes the stale installed
`~/.devflow/scripts/hooks/lib/decisions-index.cjs` (the installer copies additively and never
deletes, so the orphan would otherwise linger).

**CLI enable/disable**: both `memory.ts` and `decisions.ts` write config only. Hooks are never
removed by a single-feature disable because they are shared plumbing across features.
`decisions --disable` additionally drains the dream queue + `.processing` unconditionally.

**`decisions.ts` is a thin router over named handlers**: `handleStatus`, `handleList`,
`handleConfigure`, `handleReset`, `handleClear`, `handleEnable`, `handleDisable` each own their
full path resolution and I/O. The four state-mutating handlers share a `requireGitRoot(actionSuffix)`
guard.

**`dream-cleanup.ts` centralizes the two dream-side cleanup predicates**: `sweepLegacyDreamMarkers
(dreamDir)` is shared by `devflow decisions --reset` and `purge-dream-marker-pipeline-v1`.
`drainDreamQueue(gitRoot)` is shared by `--clear`/`--disable`.

**Array-order contracts are enforced entirely by `init.ts`**: `capture-turn`/`memory-worker`
ordering (append-before-spawn) exists only because `addCaptureHooks` runs before `addMemoryHooks`.

## Constraints

- **No argv content, ever**: content flows only via `claude -p`'s stdin (memory worker) or the Dream agent's own Read tool. `ps(1)` can see argv system-wide.
- **Silent debug logging**: `dbg()` calls in capture hooks never log message content (only lengths).
- **No daily/throttle cap on the dream side**: `DecisionsConfig` has no `max_daily_runs`/`throttle_minutes`.
- **Memory lock duration is watchdog-derived**: lock stale-threshold (300s) exceeds watchdog total (125s) with margin. The dream side's equivalent is the 900s `.processing` staleness threshold — change it in both the hook and the agent or the discriminator desyncs.
- **No literal SOH bytes in hook source**: the ASCII SOH delimiter must only appear as the jq `` escape or node `'\x01'` literal.

## Anti-Patterns

- **Wrapping `assign-anchor`/`retire-anchor`/`rotate-observations` in your own lock**: all three self-lock internally; an external lock nests and times out.
- **Whole-file rewrites of `decisions-log.jsonl`**: races the capture-side scanner and any concurrent op's log update.
- **Hand-editing any renderer-owned file (`decisions.md`, `pitfalls.md`, or `index.md`)**: deterministically rendered by `render-decisions.cjs`; a manual edit is silently overwritten on the next `assign-anchor`/`retire-anchor` call.
- **Adding a throttle, lock, or status file to the dream side**: queue emptiness gates the directive; the atomic `mv` settles races; `.processing` mtime discriminates live from crashed. New state files here are machinery regression.
- **Shelling out to a script at command invocation time to get DECISIONS_CONTEXT**: the index is already written at render time; a plain Read of `index.md` is sufficient and zero-cost. Use `decisions_load()` from `_decisions.mds`.
- **Passing raw queue content into the directive or worker argv**: paths only — the processor reads content itself.
- **Re-implementing the cwd+field split inline in a new capture hook**: call `json_extract_cwd_field <field>` (or the `json_extract_cwd_prompt` wrapper) rather than hand-rolling a new jq/node two-value split.
- **Interpolating `DREAM_MODEL` (or any config-sourced string) into a directive without an allowlist**: validate against the `opus|sonnet|haiku` `case` allowlist before use.

## Gotchas

- **Two distinct lock mechanisms, not one**: the generic `dream-lock` helper (`dream_lock_acquire`, 30s stale-break) is used only by `queue-append`'s overflow-truncation path. The memory worker defines its OWN inline lock (300s stale-break). Don't assume the 30s generic threshold applies to `.working-memory.lock`. The dream side has no lock at all — `.processing` plays that role.
- **`dream/config.json` is shared, multi-feature state**: `memory`, `decisions`, and `knowledge` all live in the same file. Any code that writes it must read-modify-write, preserving keys it doesn't own.
- **Hooks snapshot at session start**: registering a hook for the FIRST time only takes effect for a NEW Claude Code session. Toggling an ALREADY-REGISTERED hook's feature takes effect on the very next invocation (every hook re-reads `dream/config.json` fresh).
- **Directive spawn depends on model compliance**: the hook only *asks* the main model to spawn the Dream agent. A model that skips the spawn delays processing to the next session — nothing is lost, but nothing is processed.
- **`claude -p` sessions receive the directive too**: SessionStart hooks fire in non-interactive sessions (except the memory worker's own, excluded by `DEVFLOW_BG_UPDATER`). An unrelated `claude -p` run may receive — and may or may not act on — the directive.
- **`index.md` absent = `(none)` — not an error**: a crash during `renderAndWriteAll` (which writes body files first, index last) leaves `index.md` missing while body files are intact. `decisions_load()` handles this with the `(none)` fallback. The index will be re-written on the next successful render.
- **Accepted append-vs-claim race**: `queue_append_row`'s overflow truncation is read-then-replace, not a lock-held write — a lock-free concurrent append can be silently dropped. The guarantee that holds is "the file is never corrupted", not "no data is ever lost."
- **AskUserQuestion fixtures are empirically pinned, not invented**: `capture-question`'s parser was built against real payload samples (`tests/capture-hooks.test.ts`). Any non-object `tool_response`, and any cancelled/absent shape, degrades to "zero rows, exit 0".
- **Memory/dream file isolation is a hard invariant**: `devflow memory --clear` and `devflow decisions --clear`/`--reset` never cross into the sibling feature's files.
- **The `opus` default is duplicated by design, in two languages**: `decisions-config.ts`'s `DEFAULTS.model` and `session-start-context`'s bash `DREAM_MODEL` resolution both implement the same project→global→`"opus"` precedence independently. Changing one without the other silently desyncs the CLI-reported default.
- **`json_extract_cwd_field` is the one place both jq and node branches must stay in lockstep**: changing the delimiter or field-defaulting behavior in one branch without the other reintroduces the jq/node divergence this extraction was meant to eliminate.

## Key Files

- `scripts/hooks/capture-prompt`, `capture-turn`, `capture-question` — three always-on capture hooks; share the truncate → `queue_read_gates` → `queue_append_both` shape.
- `scripts/hooks/json-parse` — sources `_HAS_JQ`/`_JSON_AVAILABLE` and every `json_*` helper, including `json_extract_cwd_field` (single home of the SOH delimiter)
- `scripts/hooks/json-helper.cjs` — node fallback for every `json_*` op, including `extract-cwd-field`
- `scripts/hooks/queue-append` — shared helper: `queue_append_row`, `queue_append_both`, `queue_read_gates`
- `scripts/hooks/memory-worker` — Stop-hook 120s throttle + touch-before-spawn + spawn
- `scripts/hooks/background-memory-update` — detached memory-refresh worker (haiku, skip-permissions, 300s/90s lock, 120s watchdog)
- `scripts/hooks/session-start-context` — SessionStart injection: TL;DR (Section 1) + Dream directive with `opus|sonnet|haiku` allowlist (Section 2)
- `shared/agents/dream.md` — Dream agent: claim protocol, detection bar, curation bounds, consume-then-delete finishing; Iron Law covers `decisions.md`/`pitfalls.md`/`index.md`
- `scripts/hooks/session-start-memory` — 3-state memory header + D56c cold path
- `scripts/hooks/dream-lock` — generic mkdir-based lock (30s stale-break); used only by `queue-append`
- `scripts/hooks/lib/render-decisions.cjs` — exports `renderAndWriteAll` (writes all three files: body files first, `index.md` last), `selectActiveRows`, `isActive`; `--check` mode treats missing/stale `index.md` as drift
- `scripts/hooks/lib/decisions-format.cjs` — formatting helpers; exports `buildIndexContent(activeDecisionRows, activePitfallRows, {decisionsFilePath, pitfallsFilePath})` for index construction
- `src/cli/utils/project-paths.ts` — single source of truth for every path; `getDecisionsIndexPath` is the canonical locator for `decisions/index.md`; required CJS mirror at `scripts/hooks/lib/project-paths.cjs`
- `src/cli/utils/decisions-ledger-migration.ts` — exports `renderDecisionsIndex(projectRoot)`: lock-held, index-only write used by `render-decisions-index-v1` migration; no-op without ledger
- `commands/_partials/_decisions.mds` — defines and exports `decisions_load()`: plain Read of `index.md` with `(none)` fallback; compiled into all 12 command hosts by `build:mds`; see feature-knowledge-system KB for MDS build mechanics
- `src/cli/commands/memory.ts`, `decisions.ts` — CLI toggles; `decisions.ts`'s `.action` is a thin router to named handlers sharing `requireGitRoot`
- `src/cli/utils/dream-cleanup.ts` — `sweepLegacyDreamMarkers` and `drainDreamQueue` (shared cleanup predicates)
- `src/cli/utils/decisions-config.ts` — TS `DecisionsConfig` loader (`model`, `debug` only)
- `src/cli/hud/components/decisions-counts.ts` — HUD counts; active-row semantics contract-tested against `render-decisions.cjs`'s `isActive()`
- `tests/config-disable-guards.test.ts` — guards on the config-only disable contract across memory/decisions
- `tests/hud-decisions-counts.test.ts` — pins HUD/CJS `isActive()` agreement across the full `decisions_status` matrix

## Related

- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — sibling `.devflow/` persistence layer; contrast its write-through/in-command model against this system's queue + background processors. Owns the MDS build mechanics that compile `_decisions.mds` into command hosts.
- ADR-001 — the config-only gate (no sentinel files) and `purge-dream-worker-state-v1` follow the clean-break precedent ADR-001 established.
- ADR-002 — contrast: unlike `.devflow/features/`, none of `.devflow/memory/`, `.devflow/dream/`, or `.devflow/decisions/` are git-tracked; every file here stays local and gitignored.
- ADR-003 — this knowledge base documents the current end state only, per ADR-003.
- `docs/working-memory.md`, `docs/reference/file-organization.md` — user-facing docs for the same architecture.
