---
feature: learning-capture-system
name: Learning & Capture System
description: "Use when modifying capture hooks (capture-prompt/capture-turn/capture-question), the learning or memory pending-turns queues, the Learning agent (src/assets/agents/learning.md), the session-start-context learning directive, the feature-config toggles, the learning tuning config, the decisions content files (decisions.md/pitfalls.md/index.md) or their ledger ops, or the devflow learning CLI. Keywords: capture-prompt, capture-turn, capture-question, queue-append, pending-turns, memory-worker, Learning agent, learning directive, LEARNING MAINTENANCE, DEVFLOW_BG_UPDATER, learning-lock, queue_read_gates, decisions_load, DECISIONS_CONTEXT, feature-config, config.json, learning.json, decisions-ledger, assign-anchor, retire-anchor, refresh-anchor, render-decisions, staged-write CAS, WORKING-MEMORY.md.new, segmentDetails, amendments."
category: architecture
directories:
  - src/assets/scripts/hooks
  - src/assets/agents/learning.md
  - src/cli/commands/learning.ts
  - src/cli/commands/memory.ts
  - src/core/feature-config.ts
  - src/core/learning-tuning-config.ts
  - src/core/learning-queue-cleanup.ts
  - src/core/project-paths.ts
  - src/hud/components/learning-counts.ts
  - src/assets/commands/_partials
created: 2026-07-15
updated: 2026-08-30
---

# Learning & Capture System

## Overview

A capture-then-process model where three always-on hooks write conversation turns into two
independently-gated JSONL queues, and two separate processors drain each queue on their own
schedule. The **memory queue** (`.devflow/memory/.pending-turns.jsonl`) is drained by the
detached `background-memory-update` worker on a 120s throttle. The **learning queue**
(`.devflow/learning/.pending-turns.jsonl`) is drained by the **Learning agent** — a Claude Code
background subagent that `session-start-context` instructs the main model to spawn whenever the
queue has pending turns. Scripts capture and trigger only; the Learning agent does all
decision/pitfall detection by reading and editing the data files directly via its own tool
access. There are no marker files, no deterministic detection thresholds, and no per-session
JSON state on the learning side.

The content produced by the Learning agent — `decisions.md`, `pitfalls.md`, `decisions-ledger.jsonl`,
`decisions-log.jsonl`, and `index.md` — **deliberately keeps its "decisions" naming** even
though the system is called "learning." See the Naming Boundary section below.

## System Architecture

### Two-Pipeline, Shared Capture

All three hooks source the same `queue-append` helper and call `queue_append_both`, which gates
each write independently via `_QG_MEMORY` / `_QG_LEARNING` flags:

```
UserPromptSubmit → capture-prompt
Stop             → capture-turn          ─── queue_append_both ──→  memory queue (.devflow/memory/)
PostToolUse      → capture-question                              └→  learning queue (.devflow/learning/)
```

Both queues share the same JSONL row shape `{role, content, ts}` with `role` values
`"user"`, `"assistant"`, or `"qa"` (Q&A pairs from `AskUserQuestion`). The pipes are
independent: disabling memory leaves the learning queue writing; disabling learning leaves
the memory queue writing.

### Feature Config Split

Feature toggles and tuning config live in two separate files with different locations:

| What | File | Contains |
|------|------|---------|
| Feature on/off | `.devflow/config.json` | `{memory, learning, knowledge}` booleans |
| Agent model/debug | `.devflow/learning/learning.json` | `{model, debug}` (project-level) |
| Global tuning | `~/.devflow/learning.json` | same shape, lower priority than project |

**`.devflow/config.json` is at the `.devflow/` root — not inside `learning/`.** All learning
runtime data (queue, content, tuning config) lives in `.devflow/learning/`.

Module `src/core/feature-config.ts` owns feature toggle reads/writes. Its `coerceConfig`
coalesces the legacy `decisions` key into `learning` — if both are present, `decisions` wins.
This preserves old configs silently.

Tuning resolution: project `learning.json` → global `~/.devflow/learning.json` → defaults
(`model: "opus"`, `debug: false`). Module `src/core/learning-tuning-config.ts` handles
the merge. The bash hook in `session-start-context` resolves the same priority chain directly
— duplicated by design so the hook needs no subprocess for TS evaluation.

### Capture Hook Protocol

All three capture hooks follow the same protocol, enforced in order:

1. **Re-entrancy guard first**: `if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then exit 0; fi`
   This runs before `hook-bootstrap` to minimize overhead. Without it, the background memory
   worker's own `claude -p` session would fire these hooks and double-capture its own turns.

2. **Single config fork**: `queue_read_gates "$DEVFLOW_DIR/config.json"` sets `_QG_MEMORY`
   and `_QG_LEARNING` in one subprocess (AC-P1 — exactly one fork per hook invocation).

3. **JSONL append via `queue_append_row`**: uses `jq` or `node JSON.stringify` — never string
   concatenation — to write `{role, content, ts}`. Creates queue file with `umask 077`.

4. **Overflow guard**: after append, if the queue exceeds 200 lines, acquire a
   `learning_lock_acquire` with 2s timeout and truncate to the newest 100 lines.

**`capture-turn` special behavior**: before queue append, it runs `decisions-usage-scan.cjs`
if the assistant message contains `ADR-\d+|PF-\d+` (D29 grep-first gate — cheap pattern
match prevents unnecessary subprocess). The scanner writes citation counts to
`.devflow/learning/.decisions-usage.json`. This runs regardless of queue feature flags.

**`capture-question` special behavior**: emits one `"qa"` row per answered question. Uses
ASCII SOH (`\001`) as delimiter for TAB-delimited question+answer rows — the same SOH pattern
used by `json_extract_cwd_field` for multi-field batched JSON extraction in a single
subprocess.

### session-start-context Directive

`session-start-context` (SessionStart, always-on) emits the `--- LEARNING MAINTENANCE ---`
directive when either of these is true:
- `.devflow/learning/.pending-turns.jsonl` is non-empty
- `.devflow/learning/.pending-turns.processing` exists AND is stale (>= 900 seconds)

A **fresh** `.processing` (< 900s) suppresses the directive — a live Learning agent already
owns that batch. Queue emptiness is the sole gate; there is no throttle, lock, or cap on the
learning side.

Model resolution (bash, same precedence as `learning-tuning-config.ts`):

```bash
# Project config → global → default
LEARNING_MODEL=""
[ -f "$LEARNING_DIR/learning.json" ] && LEARNING_MODEL=$(json_field_file ...)
[ -z "$LEARNING_MODEL" ] && [ -f "$HOME/.devflow/learning.json" ] && ...
LEARNING_MODEL="${LEARNING_MODEL:-opus}"
# Allowlist before interpolating into directive (defense-in-depth against config injection)
case "$LEARNING_MODEL" in opus|sonnet|haiku) ;; *) LEARNING_MODEL="opus" ;; esac
```

The allowlist check is the critical security gate — `learning.json` is user-controlled and a
newline-injected value must never land verbatim inside the SessionStart `additionalContext`.
The `opus` fallback is intentionally duplicated in bash and TypeScript (applies ADR-003 — the
bash hook must not shell out to TS just to read a default).

The emitted directive uses `subagent_type="Learning"` and `run_in_background: true`. The main
model is instructed never to mention the spawn in user-visible text.

### Learning Agent

`src/assets/agents/learning.md` (`name: Learning`, `model: opus`) is self-contained — it claims
its own queue, processes it, and cleans up without any external coordination layer.

**Claim protocol**:
1. If `.pending-turns.processing` is fresh (< 900s) → exit silently (another agent is live)
2. If `.pending-turns.processing` is stale (>= 900s) → re-claim: `touch` it (heartbeat),
   then fold in any new queue: `cat .pending-turns.jsonl >> .pending-turns.processing && unlink .pending-turns.jsonl`
3. Otherwise atomically claim: `mv .pending-turns.jsonl .pending-turns.processing`
   (the `mv` is atomic; losing the race means another agent claimed — exit silently)

**900s staleness discriminator** is shared verbatim between `session-start-context` (which
suppresses a fresh `.processing`) and the Learning agent (which re-claims a stale one). Both
must use the same threshold or the live-vs-crashed decision diverges.

**Processing**:
- Part 1 (detection): reads claimed turns + `decisions-log.jsonl`; appends/reinforces
  observations via Bash heredoc (one JSONL row at a time); promotes via `assign-anchor`;
  calls `refresh-anchor` after reinforcing any already-anchored obs
- Part 2 (curation): calls `rotate-observations`; retires stale entries via `retire-anchor`;
  calls `refresh-anchor` after updating cross-reference log rows during citation cleanup
- Heartbeat `touch` of `.processing` at the Part 1 → Part 2 boundary prevents a long run
  from being mistakenly re-claimed
- **Final act**: `unlink .devflow/learning/.pending-turns.processing` (applies PF-003 —
  bare `rm` is blocked by the deny-list; `unlink` is the required form)

**Ledger ops** (called from agent's Bash tool) — there are exactly four:
```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" assign-anchor "decision" "obs_xxx"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" assign-anchor "pitfall"  "obs_xxx"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" retire-anchor "ADR-NNN"  "Superseded"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" refresh-anchor "ADR-NNN"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" rotate-observations
```

Each op self-locks. Never wrap them in an external lock; never call more than one at a time.
`assign-anchor` atomically writes `decisions.md`, `pitfalls.md`, and `index.md`. These files
are **never hand-edited** — they are exclusively owned by the ledger ops and `render-decisions.cjs`.

**`assign-anchor` details**: Beyond minting the next anchor number, `assign-anchor` now (a) writes
`anchor_id` back into the log row (`status: 'created'`, `anchor_id: <id>`) — this arms guard (b)
so a second call for the same obs_id throws rather than minting a duplicate number; and (b) stamps
`date` on BOTH decision and pitfall rows at promotion. Older pitfall rows promoted before this
change may lack a `date` field — the D5 window fallback (see Gotchas) handles them.

**`refresh-anchor <anchor_id>` — fourth op (ADR-022 content-update path)**:
Re-projects an already-anchored log observation into the committed ledger row and re-renders
all three output files. Use after reinforcing an anchored obs (updating `pattern`/`details`/
`last_seen` in the log) to propagate the improvement to `decisions.md`/`pitfalls.md`/`index.md`.

Algorithm: (1) find the existing ledger row by `anchor_id`; (2) find the log obs by the
LEDGER ROW's `id` field — id-based lookup covers pre-write-back corpora where the log row
has no `anchor_id`; (3) re-project via `toLedgerRow`, preserving `decisions_status` and `date`
from the ledger (ledger-owned fields), taking content from the log (content authority); (4)
replace the ledger row and re-render atomically inside `.decisions.lock`. Echoes anchor_id on
stdout. **Never writes to the log.** Strips legacy-only fields (`evidence`, `confidence`,
`count`, `status`, `artifact_path`) — incremental normalization at re-projection time.

`refresh-anchor` calls do NOT count toward the ≤5 curation-changes bound in Part 2 — they
are projections, not new entries (applies ADR-022).

**details grammar** (applies to observation log rows written by the agent):
`details` is a `Key: value` string with segments separated by `;`. A segment that begins
with a recognised key name followed by `:` (anchored match — `reissue:` does NOT match
`issue:`) starts a new field; semicolons inside a value are preserved as `'; '-rejoined
continuations. Decision keys: `context`, `decision`, `rationale`. Pitfall keys: `area`,
`issue`, `impact`, `resolution`. The parser in `decisions-format.cjs#segmentDetails` is
the single authority for this grammar — never parse `details` strings by hand (avoids PF-042).

**7-day protection window (D5) fallback**: the window key is the ledger row's `date` field.
Pitfall rows promoted before date-stamping was added may lack `date`. Fallback chain:
ledger `date` → observation log row's `last_seen` → assume pre-date-stamping (outside window).
The agent must read the log row's `last_seen` explicitly before acting on old pitfall rows.

**PF-040 pointer-vs-citation gate**: before acting on a missing-path signal (a file cited
in `details`/`evidence` no longer exists), determine whether the reference is a live pointer
(the file a reader should follow today — repair the reference) or a historical citation (the
file the entry recorded deleting or retiring — leave the entry intact). A missing historical
citation confirms the decision was implemented; never retire an entry purely for that.

**Directory bootstrapping**: Both `assign-anchor` and `retire-anchor` call
`fs.mkdirSync(path.dirname(lockDir), { recursive: true })` before acquiring `.decisions.lock`.
`path.dirname(lockDir)` resolves to `.devflow/learning/`, so this creates the correct
directory tree on the first run of a fresh project — no pre-init needed.

**Error paths inside the lock use `throw`, not `process.exit`**: Any early-exit condition
that fires while holding `.decisions.lock` calls `throw new Error(...)` rather than
`process.exit(1)`. Node's `process.exit()` skips `finally` blocks; throwing ensures the
`finally` always runs `releaseLock(lockDir)`. An outer `catch (err)` in
`if (require.main === module)` catches the throw, writes `json-helper error: <message>`
to stderr, and exits 1. Net contract: controlled non-zero exit, lock always released.

### decisions-format.cjs

Shared pure formatting helpers that are the single source of truth for byte-compatible
output strings consumed by `assign-anchor`, `render-decisions.cjs`, and `session-start-context`.

Key functions:
- **`segmentDetails(detailsStr, keys)`**: anchored-key parser for `details` strings.
  Splits on `;`, checks whether each trimmed segment starts with a recognised `key:` prefix
  (case-insensitive, anchored at segment start). Non-matching segments are treated as
  continuations of the previous field (preserves embedded semicolons). `TL;DR` → `TL; DR`
  is a deliberate side-effect of this design. Applies PF-042.
- **`amendmentToString(entry)`**: normalises `{date, note}` objects (rendered `[date] note`)
  and pre-rendered strings to a single string. A bare `join` would emit `[object Object]`
  for the object shape — this normalisation is load-bearing.
- **`formatAmendmentsLine(amendments)`**: renders `- **Amendments**: text1; text2\n` — last
  line in the entry body. Returns `''` when absent/empty; never appears in index lines.
- **Date purity**: formatters read `row.date || ''` — no clock reads inside a formatter.
  Absent date renders as empty string for deterministic/idempotent output (D5).

### Memory Worker (background-memory-update)

**Staged-write CAS (applies ADR-023)**: the model is instructed to write ONLY the staging
file `WORKING-MEMORY.md.new` (never the real file). After the model exits:

1. Worker re-checks the staging file for `<!-- memory-head:` on line 1.
2. Re-checks real file cksum against the pre-run baseline (captured before content read;
   `ABSENT` sentinel when the file was absent — resolves toward false-conflict, never false-success).
3. If cksum matches → atomic `mv WORKING-MEMORY.md.new WORKING-MEMORY.md`; remove
   `.processing`; touch `.last-refresh-ok`.
4. If cksum differs → CONFLICT: discard staged file, keep `.processing` as the retry vehicle.
   `.last-refresh-ok` is NOT touched on conflict.

The stale-staged-file cleanup (`rm -f WORKING-MEMORY.md.new`) runs at the START of each
worker run so a watchdog-killed prior run's leftover does not corrupt the next CAS check.

**Prompt engineering**: the prompt carries three instruction blocks — RECONCILE BEFORE
CARRYING FORWARD (re-verify each `## Now`/`## Progress` item against `COMMITS_SINCE` + git
state + turns), STATUS DISCIPLINE BOTH DIRECTIONS (never upgrade without evidence AND never
restate a stale claim), and PROVENANCE (today's date for any stamped entries). The
`COMMITS_SINCE` computation is hex-gated + merge-base ancestry-checked before running
`git log`; a `TURNS_NOTE` disclosure is emitted when the 20-line turns window caps.

### pre-compact-memory Bootstrap Guard

The hook bootstraps a minimal `WORKING-MEMORY.md` only when BOTH gates pass:
- `GIT_HEAD_SHA` is a 40-hex SHA (guards against malformed stamps)
- `GIT_BRANCH` is non-empty (guards against detached HEAD)

Detached HEAD: `git branch --show-current` returns `""` → branch gate fails → no bootstrap.
Unborn branch (no commits): `git rev-parse HEAD` fails → SHA is empty → SHA gate fails.
An unstamped bootstrap would render as "synced @ unknown" at the next SessionStart.
The bootstrapped file uses the canonical 5 sections and carries the stamp on line 1.

### session-start-memory Refresh-Failing Detection (B4)

`detect_refresh_failing()` counts unprocessed turns from BOTH:
- `.pending-turns.jsonl` (primary queue)
- `.pending-turns.processing` (an orphaned CONFLICT-retry batch)

Before this fix, an orphaned `.processing` left by a CAS CONFLICT (mtime between 0s and the
D56c 300s cold-path gate) was invisible to State-C — the warning would never fire even though
content was stuck. The fix makes the two files additive for the depth count.

### decisions_load() and index.md Consumption

The compiled `decisions_load()` partial (from `src/assets/commands/_partials/_decisions.mds`) instructs
the main model to read `.devflow/learning/index.md` directly — no subprocess, no script
(applies ADR-007). If the file is absent or empty, `DECISIONS_CONTEXT` is set to `(none)`.
Commands that consume decisions use the `devflow:apply-decisions` skill: scan the index →
Read relevant entry bodies on demand → cite verbatim IDs. The index path is the only thing
the Learning agent renders at operation time — consuming commands never parse `decisions-ledger.jsonl`.

### Locking

`learning-lock` (sourced by capture hooks and `queue-append`) provides mkdir-based mutual
exclusion:
- `learning_lock_acquire <lock_dir> [timeout=3s]`: polls `mkdir`; breaks stale locks older
  than 30s (using `get_mtime`). Returns 0 on success, 1 on timeout.
- `learning_lock_release <lock_dir>`: `rmdir` (idempotent).

The lock scope is narrow — only the overflow truncation path acquires it. The JSONL append
itself is intentionally lock-free (accepted-class race, shared with the memory design).

### HUD Component

`src/hud/components/learning-counts.ts` exports `gatherLearningCounts(cwd)`: reads
`.devflow/learning/decisions-ledger.jsonl` directly and counts active anchored rows (those
with `anchor_id` set and `decisions_status` not in `{Deprecated, Superseded, Retired}`). It
does NOT read `decisions.md`/`pitfalls.md` — using the ledger as source of truth prevents
HUD coupling to markdown format (D309). Label: `Learning: N decisions, M pitfalls` (dimmed).

### CLI (`devflow learning`)

| Subcommand | Effect |
|-----------|--------|
| `--enable` | Sets `learning: true` in `.devflow/config.json` |
| `--disable` | Sets `learning: false`; drains both queue files (ENOENT-tolerant) |
| `--status` | Reads config + ledger counts |
| `--list` | Reads `decisions-log.jsonl` observations |
| `--configure` | Interactive model/debug wizard |
| `--clear` | Truncates `decisions-log.jsonl` |
| `--reset` | Removes `.devflow/learning/` state; prints pinned message: `Reset complete — removed .devflow/learning/ state.` |

## Naming Boundary (Critical Convention)

The Learning agent processes the queue and produces **decisions content**. Content identifiers
deliberately keep their original "decisions" names even though the outer system is called
"learning." Do not rename them — every workflow command, CLI, test, and hook references them
by these names:

- `decisions.md`, `pitfalls.md` — rendered ADR/PF output files
- `decisions-ledger.jsonl` — anchored ledger (render source of truth)
- `decisions-log.jsonl`, `decisions-log.archive.jsonl` — raw observation history
- `index.md` — pre-rendered compact index (consumed via plain Read per ADR-007)
- `decisions_status` — field in ledger rows
- `DECISIONS_CONTEXT`, `decisions_load()` — command partial macro identifiers
- `render-decisions.cjs`, `decisions-format.cjs`, `decisions-usage-scan.cjs` — scripts
- ADR-NNN / PF-NNN — anchor ID format

The directory is `learning/`, the feature toggle is `learning`, and the agent is `Learning` —
but everything the agent produces uses "decisions" identifiers. This is intentional. Future
agents must not "fix" the naming mismatch.

## Anti-Patterns

- **Reading feature flags with two separate `json_field_file` calls**: use `queue_read_gates`
  for a single subprocess (AC-P1). Two forks double the overhead on every hook invocation.

- **Editing `decisions.md`, `pitfalls.md`, or `index.md` directly in the Learning agent**:
  these files are exclusively owned by `assign-anchor`/`retire-anchor`/`refresh-anchor`/
  `render-decisions.cjs`. Hand-edits create rendering inconsistencies and get silently overwritten.

- **Editing the ledger directly for content changes**: the log is the content authority
  (ADR-022). To update an anchored entry's content, edit the log row then call `refresh-anchor`.
  Direct ledger edits bypass the `toLedgerRow` projector and can reintroduce legacy fields.

- **Using `rm` to delete `.pending-turns.processing`**: the recommended deny-list blocks bare
  `rm` for agent instruction deletions (PF-003). Use `unlink` in the agent's final act.

- **Skipping the model allowlist in `session-start-context`**: `learning.json` is user-controlled;
  interpolating an unsanitized value into the `additionalContext` block creates injection risk.
  Always apply the `opus|sonnet|haiku` case check before interpolation.

- **Adding a throttle or lock on the learning directive side**: queue emptiness is the natural
  gate. The hook checks queue non-empty or stale `.processing` — no throttle, no state file.
  A live `.processing` already suppresses the directive.

- **Omitting the `DEVFLOW_BG_UPDATER=1` guard**: the background memory worker spawns its own
  `claude -p` session that fires `UserPromptSubmit`/`Stop` hooks. Without this guard, the
  worker's turns get double-captured into both queues.

- **Counting `refresh-anchor` calls toward the ≤5 curation bound**: refresh-anchor is a
  re-projection (not a new entry); it does not consume a curation slot.

## Gotchas

- **900s staleness threshold is shared between two places**: `session-start-context` uses it
  to decide whether to emit the directive; the Learning agent uses it to decide whether to
  re-claim a stale `.processing`. If one changes, both must change — they will diverge
  silently otherwise.

- **`decisions` legacy key wins over `learning` in `coerceConfig`**: older configs that have
  `"decisions": false` will override a `"learning": true` in the same file. This is intentional
  (backward compatibility) but can cause confusion when reading a config with both keys.

- **HUD reads `decisions-ledger.jsonl`, not the `.md` files**: a row is active only when
  `anchor_id` is set (non-empty string) AND `decisions_status` is absent or not in the
  inactive set. An `observing` row with no `anchor_id` contributes 0 to the HUD count.

- **`capture-turn` runs `decisions-usage-scan.cjs` regardless of queue gates**: the grep-first
  check (`ADR-\d+|PF-\d+` in assistant message) precedes the feature flag check. If learning
  is disabled, usage scanning still runs for messages that match the pattern.

- **Project-level `learning.json` overrides global** in tuning config — opposite priority from
  feature config where there is no project-vs-global concept (`.devflow/config.json` is
  project-only).

- **`process.exit()` skips `finally` blocks in Node.js `.cjs` helpers**: Any locked code path
  that calls `process.exit(1)` directly will leak the lock directory. The established pattern
  in `json-helper.cjs` is to `throw new Error(...)` inside the locked `try` block and let the
  outer `catch (err)` in `if (require.main === module)` print `json-helper error: <message>`
  and exit 1. Copy this pattern for any new locked operation; never call `process.exit()`
  from inside a `try` that holds a lock directory.

- **`refresh-anchor` looks up the log obs by the LEDGER ROW's `id`** (not by `anchor_id`):
  pre-write-back corpora had no `anchor_id` stamped in the log row; matching on `id` covers all
  anchored entries. A log with the `anchor_id` written by `assign-anchor` is also found this
  way. Do not switch to anchor_id-based log lookup or pre-write-back repairs will fail.

- **D5 pitfall-rows date fallback**: pitfall rows promoted before date-stamping may have `date`
  absent in the ledger. The agent must read the observation log row's `last_seen` for the 7-day
  gate before acting on such rows — never assume the ledger row has `date`.

- **CAS CONFLICT leaves `.processing` as retry vehicle**: when `background-memory-update`
  detects a CONFLICT (real file changed during model run), it keeps `.processing` and does NOT
  touch `.last-refresh-ok`. The next worker spawn re-merges `.processing` with any new queue
  and retries. State-C detection in `session-start-memory` counts `.processing` lines toward
  the unprocessed depth, so users see the warning even when `.jsonl` is empty.

- **Pre-compact bootstrap skips detached HEAD and unborn branches**: if either `GIT_BRANCH`
  is empty or `GIT_HEAD_SHA` is not a 40-hex string, no bootstrap file is written. This
  prevents a stampless file that would render as "synced @ unknown" at the next SessionStart.

- **json_extract_cwd_field SOH delimiter**: `capture-turn` splits the combined `cwd+field`
  output using `$'\001'` (bash SOH literal). The jq side emits `""`. If you add a
  new hook that uses this helper, verify both branches (jq and node fallback) emit the same
  delimiter — the node fallback in `json-helper.cjs` uses `String.fromCharCode(1)`.

## Key Files

| File | Purpose |
|------|---------|
| `src/assets/scripts/hooks/capture-prompt` | UserPromptSubmit: dual-queue user turn append |
| `src/assets/scripts/hooks/capture-turn` | Stop: dual-queue assistant turn + usage scanner |
| `src/assets/scripts/hooks/capture-question` | PostToolUse: AskUserQuestion Q&A row append |
| `src/assets/scripts/hooks/queue-append` | Shared JSONL append + overflow truncation + queue_read_gates |
| `src/assets/scripts/hooks/learning-lock` | mkdir-based lock (30s stale-break) |
| `src/assets/scripts/hooks/session-start-context` | Emits learning directive + TL;DR decisions header |
| `src/assets/scripts/hooks/background-memory-update` | Detached worker: staged-write CAS, WORKING-MEMORY.md |
| `src/assets/scripts/hooks/pre-compact-memory` | PreCompact: backup.json + gated WORKING-MEMORY.md bootstrap |
| `src/assets/scripts/hooks/session-start-memory` | SessionStart: 3-state memory header + State-C refresh-failing |
| `src/assets/scripts/hooks/json-parse` | JSON helpers including json_extract_cwd_field (SOH delimiter) |
| `src/assets/agents/learning.md` | Learning agent spec (claim, detect, curate, unlink) |
| `src/assets/scripts/hooks/json-helper.cjs` | Four ledger ops: assign-anchor, retire-anchor, refresh-anchor, rotate-observations |
| `src/assets/scripts/hooks/lib/decisions-format.cjs` | segmentDetails, amendmentToString, formatAmendmentsLine, toLedgerRow, buildIndexContent |
| `src/assets/scripts/hooks/lib/render-decisions.cjs` | Pure renderer — decisions.md, pitfalls.md, index.md from ledger rows |
| `src/core/feature-config.ts` | `.devflow/config.json` read/write; `decisions`→`learning` coalesce |
| `src/core/learning-tuning-config.ts` | Tuning config merge (project → global → defaults) |
| `src/core/project-paths.ts` | Path construction — single source of truth for all `.devflow/` paths |
| `src/core/learning-queue-cleanup.ts` | Queue drain + legacy sweep helpers |
| `src/cli/commands/learning.ts` | `devflow learning` CLI |
| `src/hud/components/learning-counts.ts` | HUD counts from `decisions-ledger.jsonl` |
| `src/assets/commands/_partials/_decisions.mds` | `decisions_load()` macro (plain file Read per ADR-007) |
| `src/assets/scripts/hooks/decisions-usage-scan.cjs` | Citation counter (D29 grep-first gate) |

## Related

- **ADR-022** — decisions-log.jsonl is the single content authority; the ledger is an anchor registry; ops project log→ledger→rendered .md; `refresh-anchor` is the projection-refresh path
- **ADR-023** — staged compare-and-swap for the memory worker's write (`WORKING-MEMORY.md.new`)
- **PF-040** — guard against acting on a missing path that is a historical citation rather than a live pointer
- **PF-041** — guard reading a field its writer never persists fails open (e.g. `anchor_id` absent in pre-write-back log rows)
- **PF-042** — delimiter-regex parsing of free prose truncates silently; `segmentDetails` anchored-key approach avoids this
- **ADR-001** — config-only gates: feature toggles live in `.devflow/config.json`, not sentinel files; `decisions` legacy key coalesces to `learning` here
- **ADR-007** — `index.md` consumption is a plain Read; no subprocess, no `.cjs` script
- **PF-003** — agent instruction deletions use `unlink`, never bare `rm` (deny-list contract)
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — Knowledge agent write-back pattern (parallel write-through system)
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md` — Ambient orchestrator that also uses `session-start-context` for charter injection
