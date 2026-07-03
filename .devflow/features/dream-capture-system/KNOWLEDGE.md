---
feature: dream-capture-system
name: Dream & Capture System
description: "Use when modifying capture hooks (capture-prompt/capture-turn/capture-question), the memory or dream pending-turns queues, the background-memory-update detached worker, the Dream agent (shared/agents/dream.md), the session-start-context dream directive, or the dream/decisions config toggles. Keywords: capture-prompt, capture-turn, capture-question, queue-append, pending-turns, memory-worker, background-memory-update, Dream agent, dream directive, DREAM MAINTENANCE, DEVFLOW_BG_UPDATER, dream config, dream-lock."
category: architecture
directories:
  - scripts/hooks
  - shared/agents/dream.md
  - src/cli/commands/capture.ts
  - src/cli/commands/dream.ts
  - src/cli/commands/memory.ts
  - src/cli/commands/decisions.ts
  - src/cli/utils/decisions-config.ts
  - src/cli/utils/project-paths.ts
created: 2026-07-03
updated: 2026-07-04
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
into `decisions.md`/`pitfalls.md` (decisions pipeline).

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
| `decisions/decisions.md` / `pitfalls.md` | `render-decisions.cjs` (via `assign-anchor`/`retire-anchor`) | rendered ledger output |
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
at 1000 chars **independently**, so a long question can't swallow the answer. Every queue file
is created with mode `0600` (`umask 077`) on first write. After each append,
`queue_append_row` checks line count and — only when it exceeds 200 — truncates to the newest
100 lines under `dream_lock_acquire "<file>.lock" 2` (the *generic* `dream-lock` helper, 30s
stale-break — not the memory worker's own bespoke lock, see Gotchas).

`capture-turn` also runs the decisions-usage scanner (`decisions-usage-scan.cjs`) directly,
gated only by a grep for `ADR-[0-9]+|PF-[0-9]+` in the assistant message (cheap pre-filter) AND
`DECISIONS_ENABLED` — independent of whether anything gets queued. The scanner itself has no
gate of its own; the caller gates.

**Stop-array ordering contract**: `capture-turn` MUST be registered before `memory-worker` in
the Stop array. Nothing in either script enforces this — it is enforced entirely by `init.ts`'s
call order (`addCaptureHooks` before `addMemoryHooks`). `memory-worker`'s throttle/spawn
decision assumes the current turn was already appended earlier in the same Stop event
(append-before-spawn); reversing the array order would spawn the worker one turn behind.

### 2. memory-worker → background-memory-update

`memory-worker` owns ONLY the throttle + spawn decision — it never touches a queue file
itself. Throttle key: `.working-memory-last-trigger` mtime, 120s window. It touches the trigger
file **before** spawning (not after) so a second concurrent Stop hook within the same window
sees a fresh trigger and exits without double-spawning. If `claude` isn't on `PATH` or the
worker binary is missing/non-executable, it logs and exits 0 — the queue is left intact for the
next Stop event to retry. Note this hook does **not** check whether the queue is actually
non-empty before spawning; it spawns unconditionally once the throttle clears, and lets the
worker itself no-op cheaply (contrast the dream directive, which gates on queue content).

`background-memory-update`'s lifecycle, in order:
1. Re-entrancy guard (`DEVFLOW_BG_UPDATER`) first, then re-check `memory:false` at runtime
   (defense-in-depth — the feature may have been disabled after `memory-worker` already
   decided to spawn).
2. Acquire `.working-memory.lock` — 300s stale-break, 90s acquire timeout. 90s is deliberately
   **less than** `WATCHDOG_SECS` (120): a waiter gives up before the current holder's own
   watchdog would fire, so the queue is simply left for the next spawn rather than blocking.
3. **Orphan-only auto-clean**: if the queue has no `assistant`/`qa` row (user-only), truncate it
   and exit without an LLM run — prevents fabrication from a queue with nothing to synthesize.
4. Claim the queue: rename `.pending-turns.jsonl` → `.pending-turns.processing`. If a leftover
   `.processing` already exists (previous crash), merge new queue entries into it and cap at
   200→100 lines.
5. Build the last `MAX_TURNS=10` (20 lines) of context, read up to `65536` bytes of existing
   `WORKING-MEMORY.md`, gather git state.
6. Spawn `claude -p --model haiku --dangerously-skip-permissions --allowedTools 'Read,Write'`
   with the prompt on stdin (never argv — content may hold secrets), under a
   `WATCHDOG_SECS=120` (default) + 5s kill-grace watchdog.
7. Verify success: `WORKING-MEMORY.md` mtime strictly newer than the pre-run baseline **AND**
   its first line matches `<!-- memory-head:*`. Only then remove `.processing` and touch
   `.last-refresh-ok`.

**The watchdog kill mechanism** (memory worker) is worth reading verbatim once — it is the one
piece of non-obvious bash in this system:

```bash
set -m                                     # give claude its OWN process group (PGID == its PID),
DEVFLOW_BG_UPDATER=1 "$CLAUDE_BIN" -p ... & # even though this script is non-interactive
CLAUDE_PID=$!
set +m                                     # restore immediately so the watchdog subshell below
                                            # stays in THIS script's group, not claude's

( sleep "$WATCHDOG_SECS"; kill -TERM -"$CLAUDE_PID"; sleep "$GRACE"; kill -KILL -"$CLAUDE_PID"; ) &
WD_PID=$!
wait "$CLAUDE_PID"; CLAUDE_EXIT=$?
kill "$WD_PID" 2>/dev/null; wait "$WD_PID" 2>/dev/null  # cancel watchdog before a PID can recycle
```

Without `set -m`, the background `claude` child would inherit this script's own process group,
and `kill -TERM -"$CLAUDE_PID"` (the **negative** PID form kills an entire process group) would
kill the worker script itself along with `claude` — a self-kill bug. `set -m` is toggled back
off immediately after capturing `CLAUDE_PID` so it doesn't affect anything spawned afterward.
The watchdog subshell is cancelled as soon as `claude` exits, specifically to avoid a stray
`kill` hitting an unrelated, recycled PID after this script has already moved on.

### 3. session-start-context Section 2 → Dream agent

`session-start-context` gates both of its sections on the `decisions` field in dream config
(config-only). Section 2 emits the `--- DREAM MAINTENANCE ---` directive when work is pending:

- `.pending-turns.processing` exists and is **fresh** (younger than 900s) → a live Dream agent
  owns the batch → **suppressed**, even if new turns queued since the claim.
- `.pending-turns.processing` exists and is **stale** (900s or older) → crashed run → emit.
- otherwise `.pending-turns.jsonl` non-empty (`-s`) → emit.

When emitting, it resolves the model — project `decisions/decisions.json` → global
`~/.devflow/decisions.json` → `"opus"` — and injects a directive instructing the main model to
spawn `Agent(subagent_type="Dream", model="<resolved>", run_in_background: true, prompt:
"Process the pending decisions queue per your agent instructions. Project root: <root>")`
without narrating. Queue emptiness is the natural gate: no throttle, no lock, no
claude-on-PATH check (the agent runs inside the session that received the directive).

The **Dream agent** (`shared/agents/dream.md`) then:
1. Claims the queue itself: atomic
   `mv .pending-turns.jsonl .pending-turns.processing` — one winner across concurrent
   sessions; a lost `mv` means exit silently. A fresh `.processing` means another live agent —
   exit silently. A stale `.processing` is re-claimed (`touch` = heartbeat) and any new queue
   is folded in (`cat queue >> processing && rm -f queue`).
2. Reads everything directly with its Read tool: the claimed batch, `decisions-log.jsonl`
   (dedup), `decisions.md`/`pitfalls.md` (active entries), `.decisions-usage.json` (cite
   counts).
3. Writes observations directly — appends exactly one JSONL row via a quoted heredoc, or
   Edit-replaces a single existing row to reinforce it (bump `observations`, union `evidence`
   cap 10, update `last_seen`). Never rewrites the whole file.
4. Calls only the three ledger ops via Bash: `assign-anchor` (numbering + render),
   `retire-anchor` (status flip + render), `rotate-observations` (30-day archival). Each
   self-locks internally; the agent never wraps them in a lock of its own.
5. Heartbeats (`touch`) the claim file once at the detection→curation boundary so a long run
   is never mistaken for a crash.
6. Deletes `.pending-turns.processing` as its **final act**, strictly after every other write
   (consume-then-delete). A crash before that line leaves the batch for the next session's
   stale-merge recovery — the correct outcome for a partial run.
7. Ends with a 1–3 line summary. Native background-task visibility replaces any status file:
   there is nothing to touch and nothing for SessionStart to inject or delete.

### 4. Dream agent instructions (shared/agents/dream.md)

A normal shared agent (distributed to `devflow-core-skills` + `devflow-ambient`, installed to
`~/.claude/agents/devflow/dream.md`). Its **Iron Laws**: (a) `assign-anchor` owns numbering and
`render-decisions.cjs` owns the `.md` files — never hand-edit `decisions.md`/`pitfalls.md`;
(b) abstain-by-default — "most runs produce nothing, if unsure record nothing"; (c) ADR-XOR-PF —
one incident yields exactly one of an ADR or a PF, never both; (d) curation is bounded to
**≤5 changes per run** and a **7-day protection window** keyed on the ledger row's `date` field
(not anything in the rendered `.md`).

Detection (Part 1): scan `decisions-log.jsonl` for a matching existing entry first — reinforce
that row (single-line Edit) rather than creating a duplicate. Promote via `assign-anchor`
(self-locking on `.decisions.lock`) only when `quality_ok=true` and the pattern clears the
creation bar. Observation rows keep the full downstream schema (`id`, `type`, `pattern`,
`confidence`, `observations`, `first_seen`, `last_seen`, `status`, `evidence`, `details`,
`quality_ok`) — `assign-anchor`, `rotate-observations`, and `devflow decisions
--list/--status` all read it.

Curation (Part 2): run `rotate-observations` first (archives `observing` rows >30 days old to
`decisions-log.archive.jsonl`, never touches anchored/`created`/`ready` rows), ground counts
and cite data by reading the rendered files and `.decisions-usage.json` directly, check
referenced file paths still exist with Glob (a missing reference is a *preference* for
retirement, not an automatic trigger), then retire ≤5 candidates via
`retire-anchor <id> <status>`.

Contract tests pin these strings: `tests/dream-agent.test.ts` (frontmatter, claim protocol,
negatives — the agent must NOT reference `count-active`, `staleness.cjs`, `merge-observation`,
`.last-dream-ok`, or `last-run-summary`) and `tests/decisions/dream-curation.test.ts` +
`decisions-format.test.ts` (Iron Law, creation bar, curation bounds).

### 5. SessionStart injection (session-start-context, session-start-memory)

`session-start-context` injects the decisions TL;DR (the first line of
`decisions.md`/`pitfalls.md`, matched via `sed -n '1s/<!-- TL;DR: \(.*\) -->/\1/p'`) as
Section 1 and the Dream maintenance directive as Section 2 — both gated on the same
`decisions` config field the capture hooks read.

`session-start-memory` renders a 3-state header from the
`<!-- memory-head: <sha> branch: <name> -->` stamp on line 1 of `WORKING-MEMORY.md`: **A**
in-sync (stamp SHA == HEAD), **B** drifted (stamp SHA is a provable ancestor of HEAD — shown via
one `git log` walk reused for both the commit count and the display lines), **C**
refresh-failing banner (queue depth > 0 AND `.last-refresh-ok` missing or >600s old), shown *in
addition to* A or B. Before ever passing the parsed `STAMP_SHA` to git, it is hex-validated
(7-40 lowercase-hex chars, rejecting anything with a `-`-prefix or non-hex character) —
`WORKING-MEMORY.md` is treated as untrusted input. It also runs a self-contained **D56c
cold-path recovery**: an orphaned memory `.pending-turns.processing` older than 300s is renamed
back to `.pending-turns.jsonl`, but only if the live queue file doesn't already exist
(non-clobber — a concurrent session's fresh queue is never overwritten).
`background-memory-update` is the PRIMARY recovery owner (merges leftovers on its own next
spawn); this is only the fallback for when the worker never respawns at all. The dream side
needs no equivalent cold path: the Dream agent's own stale-merge in Step 0 is the recovery.

## Integration Patterns

**Re-entrancy guard convention**: every hook in this system AND the memory worker check
`DEVFLOW_BG_UPDATER` first — before `hook-bootstrap` is even sourced, to minimize overhead
inside a background session. The memory worker sets `DEVFLOW_BG_UPDATER=1` on its `claude -p`
child so hooks firing from *within* that nested session bail out in one line instead of
cascading a second spawn (or handing the nested session a Dream directive). The Dream agent
needs no guard variable: it is a subagent of the main session, and subagents do not fire
SessionStart/Stop hooks of their own.

**Two independent config layers**: `dream/config.json` (boolean feature toggles: `memory`,
`decisions`, `knowledge` — read fresh by every hook on every invocation) vs. `decisions.json`
(Dream agent tuning: `model`, `debug` — read by `session-start-context`'s model resolution and
`devflow decisions --configure`). Conflating the two is a common mistake — toggling a feature
never touches `model`/`debug`, and configuring the model never touches the boolean gates.

**CLI enable/disable**: both `memory.ts` and `decisions.ts` write config only. Hooks are never
removed by a single-feature disable because they are shared plumbing across features.
`decisions --disable` additionally drains the dream queue + `.processing` unconditionally — a
mid-run Dream agent whose claimed batch vanishes aborts without changes, which is the desired
outcome of disabling.

**Array-order contracts are enforced entirely by `init.ts`**: `capture-turn`/`memory-worker`
ordering (append-before-spawn) exists only because `addCaptureHooks` runs before
`addMemoryHooks` in `init.ts`'s single read-modify-write pass over `settings.json`. Reordering
those calls silently breaks the contract with no runtime error.

## Constraints

- **No argv content, ever**: user/assistant/turn content flows only via `claude -p`'s stdin in
  the memory worker, and the Dream directive's prompt is a path-only pointer — `ps(1)` can see
  argv system-wide, so content there would leak. The Dream agent reads the claimed batch itself
  via its Read tool.
- **Silent debug logging**: `dbg()` calls in `capture-turn`/`capture-question` explicitly never
  log message content (only lengths) — "SECURITY: Never log ASSISTANT_MSG or INPUT content —
  may contain secrets."
- **No daily/throttle cap on the dream side**: `DecisionsConfig` has no
  `max_daily_runs`/`throttle_minutes` (a legacy config on disk with those keys is silently
  ignored). Processing is bounded by queue non-emptiness at directive time.
- **Memory lock duration is watchdog-derived, not arbitrary**: the memory worker asserts that
  its lock's stale-threshold (300s) exceeds its own watchdog's total in-flight time
  (`WATCHDOG_SECS + WATCHDOG_KILL_GRACE_SECS` = 125s) with margin. Raising the
  `DEVFLOW_BG_WATCHDOG_SECS` override without re-verifying this invariant risks a live worker's
  lock being stale-broken out from under it. The dream side's equivalent constant is the shared
  900s `.processing` staleness threshold used by both the hook (suppress) and the agent
  (exit-vs-merge) — change it in both places or the discriminator desyncs.

## Anti-Patterns

- **Wrapping `assign-anchor`/`retire-anchor`/`rotate-observations` in your own lock
  acquisition**: all three self-lock internally; an external lock around them nests against the
  internal one and times out.
- **Whole-file rewrites of `decisions-log.jsonl`**: the Dream agent appends or Edit-replaces
  one JSONL row at a time. A whole-file rewrite races the capture-side `decisions-usage-scan`
  and any concurrent op's atomic log update.
- **Hand-editing `decisions.md`/`pitfalls.md`**: they are deterministically rendered from
  `decisions-ledger.jsonl` by `render-decisions.cjs`; any manual edit is silently overwritten on
  the next `assign-anchor`/`retire-anchor` call.
- **Adding a throttle, lock, or status file to the dream side**: the design intentionally has
  none — queue emptiness gates the directive, the atomic `mv` settles races, `.processing`
  mtime discriminates live from crashed, and the agent's final message is the visibility
  surface. New state files here are machinery regression.
- **Passing raw queue content into the directive or worker argv**: paths only; the processor
  reads content itself.

## Gotchas

- **Two distinct lock mechanisms, not one**: the generic `dream-lock` helper
  (`dream_lock_acquire`/`dream_lock_release`, 30s stale-break) is used only by `queue-append`'s
  overflow-truncation path. The memory worker defines its OWN inline
  `break_stale_lock`/`acquire_lock` pair (300s stale-break) tailored to its watchdog. Don't
  assume the 30s generic threshold applies to `.working-memory.lock`. The dream side has no
  lock at all — the `.processing` claim file plays that role.
- **`dream/config.json` is shared, multi-feature state**: `memory`, `decisions`, and `knowledge`
  all live in the same file. Any code that writes it (`updateFeature` in `dream-config.ts`) must
  read-modify-write, preserving keys it doesn't own — a naive overwrite silently disables
  sibling features. The read-modify-write is intentionally non-atomic (accepted: CLI toggles are
  single-threaded, human-paced actions).
- **Hooks snapshot at session start**: registering a hook for the FIRST time (a project's first
  `devflow init`, or the first `devflow memory --enable` on an install that had zero memory
  hooks) only takes effect for a NEW Claude Code session — the currently running session already
  loaded its hook list from `settings.json`. Toggling an ALREADY-REGISTERED hook's underlying
  feature (e.g. `--disable` then `--enable`) takes effect on the very next hook invocation within
  the same session, because every hook script re-reads `dream/config.json` fresh on every run.
- **Directive spawn depends on model compliance**: the hook only *asks* the main model to spawn
  the Dream agent. A model that skips the spawn delays processing to the next session — the
  queue persists (bounded by the 200→100 overflow truncation), so nothing is lost, but nothing
  is processed either. This is an accepted trade against the deleted worker machinery.
- **`claude -p` sessions receive the directive too**: SessionStart hooks fire in non-interactive
  sessions (except the memory worker's own, which the `DEVFLOW_BG_UPDATER` guard excludes). An
  unrelated `claude -p` run in the project may receive — and may or may not act on — the
  directive. Accepted-class exposure.
- **The project-root prompt**: the directive's prompt carries `Project root: <root>` because a
  session can start in a subdirectory; the agent runs every command from that root, so
  `$(pwd)`-relative op invocations (`render-decisions.cjs render "$(pwd)"`) resolve correctly.
- **Accepted append-vs-claim race**: `queue_append_row`'s overflow truncation is read-then-replace
  (`tail -100 file > tmp && mv tmp file`), not an in-place lock-held write. A lock-free
  concurrent append landing between the `tail` snapshot and the `mv` can be silently dropped.
  This is a known, accepted race class — the guarantee that actually holds is "the file is never
  corrupted" (every surviving line is valid JSON), not "no data is ever lost under a genuine
  race." The same acceptance covers a double stale-reclaim: two sessions that both start >900s
  after a crash can both re-claim the same batch (sub-second window); dedup rules and
  `assign-anchor`'s preconditions bound the damage to redundant analysis.
- **AskUserQuestion fixtures are empirically pinned, not invented**: `capture-question`'s parser
  was built against real payload samples mined from `~/.claude/projects` (see
  `tests/capture-hooks.test.ts`) because no genuine cancelled/interrupted or free-text ("Other")
  sample could be found anywhere on the machine despite an exhaustive search. The one real
  errored sample has `tool_response` as a **plain string** (`"InputValidationError: [...]"`),
  not an object. The handling contract this produced: any non-object `tool_response`, and any
  cancelled/absent shape, degrades to "zero rows, exit 0" rather than guessing at an unobserved
  shape — do not add special-case handling for a shape you haven't mined a real sample of.
- **Memory/dream file isolation is a hard invariant**: `cleanQueueFiles`
  (`devflow memory --clear`) touches only `getPendingTurnsPath`/`getPendingTurnsProcessingPath`
  under `memory/`, and skips a project entirely while `.working-memory.lock` is held.
  `devflow decisions --clear`/`--reset` resolve the git root explicitly and drain only the
  dream queue + decisions state. Neither command's cleanup logic ever crosses into the sibling
  feature's files.
- **The `opus` default is duplicated by design, in two languages**: `decisions-config.ts`'s
  `DEFAULTS.model` and `session-start-context`'s bash `DREAM_MODEL` resolution both implement
  the same project-`decisions.json` → global-`~/.devflow/decisions.json` → `"opus"` precedence
  independently, because the hook reads raw JSON directly rather than shelling out to the TS
  loader. Changing one default without the other silently desyncs the CLI-reported default from
  the directive's actual behavior.

## Key Files

- `scripts/hooks/capture-prompt`, `capture-turn`, `capture-question` — the three always-on
  capture hooks; all three source `queue-append` and share the truncate → `queue_read_gates` →
  `queue_append_both` shape
- `scripts/hooks/queue-append` — shared helper: `queue_append_row`, `queue_append_both`,
  `queue_read_gates` (single-fork config read)
- `scripts/hooks/memory-worker` — Stop-hook 120s throttle + touch-before-spawn +
  `background-memory-update` spawn
- `scripts/hooks/background-memory-update` — detached memory-refresh worker (haiku,
  skip-permissions, 300s/90s lock, 120s watchdog)
- `scripts/hooks/session-start-context` — SessionStart injection: decisions TL;DR (Section 1) +
  Dream maintenance directive with model resolution (Section 2)
- `shared/agents/dream.md` — the Dream agent: claim protocol, detection bar, curation bounds,
  consume-then-delete finishing
- `scripts/hooks/session-start-memory` — 3-state memory header + D56c cold path
- `scripts/hooks/dream-lock` — generic mkdir-based lock (30s stale-break); used only by
  `queue-append`, NOT by the memory worker's own bespoke lock
- `src/cli/commands/capture.ts` — hook (de)registration for the always-on capture bundle
- `src/cli/commands/dream.ts` — `removeDreamHook`/`hasDreamHook` upgrade cleanup of the retired
  spawn-dream-worker settings entry
- `src/cli/commands/memory.ts`, `decisions.ts` — CLI toggles, `cleanQueueFiles`,
  `--clear`/`--reset`, unconditional disable-drain
- `src/cli/utils/decisions-config.ts` — TS `DecisionsConfig` loader (`model`, `debug` only)
- `src/cli/utils/project-paths.ts` — single source of truth for every path referenced above; has
  a required CJS mirror at `scripts/hooks/lib/project-paths.cjs`

## Related

- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — sibling `.devflow/` persistence
  layer; contrast its write-through/in-command model against this system's queue + background
  processors.
- ADR-001 — the config-only gate (no sentinel files) and the `purge-dream-worker-state-v1`
  migration follow the clean-break precedent ADR-001 established.
- ADR-002 — contrast: unlike `.devflow/features/`, none of `.devflow/memory/`, `.devflow/dream/`,
  or `.devflow/decisions/` are git-tracked; every file in this system stays local and gitignored.
- ADR-003 — this knowledge base documents the current end state only, per ADR-003.
- `docs/working-memory.md`, `docs/reference/file-organization.md` — user-facing docs for the
  same architecture; consistent source for the file-tree summary above.
