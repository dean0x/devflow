---
feature: dream-capture-system
name: Dream & Capture System
description: "Use when modifying capture hooks (capture-prompt/capture-turn/capture-question), the memory or dream pending-turns queues, the background-memory-update or background-dream-update detached workers, dream-procedure.md, or the dream/decisions config toggles. Keywords: capture-prompt, capture-turn, capture-question, queue-append, pending-turns, memory-worker, spawn-dream-worker, background-memory-update, background-dream-update, dream-procedure, watchdog, DEVFLOW_BG_DREAM, DEVFLOW_BG_UPDATER, dream config, decisions dual-signal, dream-lock."
category: architecture
directories:
  - scripts/hooks
  - src/cli/commands/capture.ts
  - src/cli/commands/dream.ts
  - src/cli/commands/memory.ts
  - src/cli/commands/decisions.ts
  - src/cli/utils/decisions-config.ts
  - src/cli/utils/project-paths.ts
created: 2026-07-03
updated: 2026-07-03
---

# Dream & Capture System

## Overview

This system replaced the old SessionEnd marker-pipeline (`dream-capture`, `dream-dispatch`,
`dream-evaluate`, `eval-decisions`, `eval-curation`, `dream-recover`, `dream-collect-tasks`)
with a capture-then-spawn model: three always-on hooks append conversation turns to two
independently-gated JSONL queues, and two detached `claude -p` workers drain those queues on
their own schedule. There are no marker files, no per-session JSON state, and no Claude Code
subagent anywhere in this flow — everything downstream of capture is a plain shell script or a
`claude -p` process reading a plain-text procedure file.

The two workers — `background-memory-update` (working memory) and `background-dream-update`
(decisions detection + curation) — share one proven skeleton (lock → leftover-merge →
rename-to-claim → watchdog-bounded `claude -p` → stamp-advance success gate) but are tuned
independently for their own trust model, latency budget, and recovery semantics. Treat them as
siblings, not clones: several numbers and permission choices below deliberately differ between
them, and copying one worker's constant onto the other is a real mistake (see Anti-Patterns).

## System Context

**Purpose**: (1) preserve session context across restarts/`/clear`/compaction (working memory)
and (2) detect architectural decisions and pitfalls from conversation turns, rendering them
into `decisions.md`/`pitfalls.md` (decisions pipeline) — both without a SessionEnd hook or a
Claude Code subagent.

**Role in the larger system**: two of the three per-project background systems under
`.devflow/`. The third — feature knowledge — is write-through and in-command (spawned directly
by orchestrator commands at workflow end), not part of this system; see
`.devflow/features/feature-knowledge-system/KNOWLEDGE.md`.

**External dependencies**: the `claude` CLI on `PATH` (spawned via `claude -p`, never the
interactive TUI); `jq` with a `node` fallback for all JSON parsing (`_HAS_JQ`/`_JSON_AVAILABLE`,
set once by `json-parse`); `git` (only `session-start-memory`'s drift detection and
`background-memory-update`'s stamp gathering shell out to it).

## Component Architecture

**Hooks** (registered in `~/.claude/settings.json`, all always-on — no per-feature
hook-registration toggle):

| Hook | Event | Registration position | Spawns? |
|---|---|---|---|
| `capture-prompt` | UserPromptSubmit | — | never |
| `capture-turn` | Stop | **before** `memory-worker` | never |
| `capture-question` | PostToolUse (matcher `AskUserQuestion`) | — | never |
| `memory-worker` | Stop | **after** `capture-turn` | `background-memory-update` |
| `spawn-dream-worker` | SessionStart | **last** in the SessionStart array | `background-dream-update` |
| `session-start-memory` | SessionStart | before `session-start-context` | never |
| `session-start-context` | SessionStart | before `spawn-dream-worker` | never |
| `pre-compact-memory` | PreCompact | — | never |

**Detached workers** (plain executables, not hooks — spawned via
`nohup ... </dev/null >>/dev/null 2>&1 & disown`, never registered in settings.json):

| Worker | Spawned by | Model | Permission mode |
|---|---|---|---|
| `background-memory-update` | `memory-worker` | `haiku` | `--dangerously-skip-permissions`, `--allowedTools 'Read,Write'` |
| `background-dream-update` | `spawn-dream-worker` | resolved (default `opus`) | `--allowedTools 'Read,Grep,Glob,Write,Edit,Bash'` — **no** skip-permissions |

**State** (all under `.devflow/`, none git-tracked — contrast ADR-002):

| File | Written by | Purpose |
|---|---|---|
| `memory/.pending-turns.jsonl` | capture hooks | memory queue |
| `dream/.pending-turns.jsonl` | capture hooks | decisions queue |
| `dream/config.json` | `dream-config.ts` (`updateFeature`) | shared toggle: `memory`, `decisions`, `knowledge` |
| `decisions/decisions.json` / `~/.devflow/decisions.json` | `devflow decisions --configure` | worker tuning: `model`, `debug` only |
| `memory/WORKING-MEMORY.md` | `background-memory-update` | rendered working memory |
| `decisions/decisions.md` / `pitfalls.md` | `render-decisions.cjs` (via `assign-anchor`/`retire-anchor`) | rendered ledger output |
| `memory/.last-refresh-ok` / `dream/.last-dream-ok` | respective worker, on success | success stamps |
| `dream/last-run-summary` | dream worker agent, only if changed | injected once by `session-start-context`, then deleted |

## Component Interactions

### 1. Dual-append (capture-prompt / capture-turn / capture-question)

All three capture hooks share one shape: resolve `PROJECT_ROOT` (via `resolve-project-root`,
falling back to `CWD`), truncate content, then call exactly two `queue-append` functions:

- `queue_read_gates "$DREAM_DIR/config.json" "$DEVFLOW_DIR/decisions/.disabled"` — **one
  config-read subprocess fork** returning both `_QG_MEMORY` and `_QG_DECISIONS` (AC-P1).
  `decisions` is forced `"false"` when the sentinel file exists regardless of the config value —
  this is the dual-signal gate, computed here and re-checked independently by
  `spawn-dream-worker` and again by `background-dream-update` (three checkpoints total).
- `queue_append_both <memory_queue> <dream_queue> <memory_enabled> <dream_enabled> <role>
  <content> <ts>` — appends the SAME row to whichever queue(s) are enabled, independently.

Row schema is always `{role, content, ts}`: `role` ∈ `user` (capture-prompt) | `assistant`
(capture-turn) | `qa` (capture-question, one row per answered question). Truncation:
prompts/assistant messages cap at 2000 chars; a `qa` row's question and answer are each capped
at 1000 chars **independently**, so a long question can't swallow the answer. Every queue file
is created with mode `0600` (`umask 077`) on first write. After each append,
`queue_append_row` checks line count and — only when it exceeds 200 — truncates to the newest
100 lines under `dream_lock_acquire "<file>.lock" 2` (the *generic* `dream-lock` helper, 30s
stale-break — not to be confused with either worker's own bespoke lock, see Gotchas).

`capture-turn` also runs the decisions-usage scanner (`decisions-usage-scan.cjs`) directly,
gated only by a grep for `ADR-[0-9]+|PF-[0-9]+` in the assistant message (cheap pre-filter) AND
`DECISIONS_ENABLED` — independent of whether anything gets queued.

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
worker itself no-op cheaply (contrast `spawn-dream-worker` below, which gates on queue content).

`background-memory-update`'s lifecycle, in order:
1. Both re-entrancy guards (`DEVFLOW_BG_DREAM`, `DEVFLOW_BG_UPDATER`) first, then re-check
   `memory:false` at runtime (defense-in-depth — the feature may have been disabled after
   `memory-worker` already decided to spawn).
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

### 3. spawn-dream-worker → background-dream-update

`spawn-dream-worker` puts both re-entrancy guards before even `hook-bootstrap` is sourced (same
as every hook in this system), then gates the spawn on ALL of: the decisions dual-signal
(config `decisions` field AND no `.disabled` sentinel) **AND** (`.pending-turns.jsonl`
non-empty **OR** a leftover `.pending-turns.processing` exists) **AND** `claude` resolvable on
`PATH`. Unlike the old `session-start-context` Section 2 flow this replaced, it emits **no
stdout directive** — it silently spawns the worker itself, the same pattern `memory-worker`
already used.

`background-dream-update` mirrors `background-memory-update`'s skeleton but every tuning knob
differs:
1. Re-checks the full dual-signal at runtime (defense-in-depth), plus its own `claude`-on-`PATH`
   check.
2. Acquires `.worker.lock` — **900s** stale-break, **2s fail-fast** acquire (not a 90s wait — a
   waiter here has nothing to contribute once the holder has claimed the queue; the next
   `spawn-dream-worker` invocation, i.e. the next SessionStart, simply retries).
3. Claims the queue the same rename + leftover-merge + 200→100-cap way.
4. Resolves `MODEL` from `decisions/decisions.json` (project) → `~/.devflow/decisions.json`
   (global) → hardcoded `"opus"` — a literal duplicate of `DecisionsConfig`'s own default in
   `decisions-config.ts`, kept in sync intentionally rather than shelling out to the TS loader
   (this worker reads raw JSON directly).
5. Builds a **short pointer prompt** — paths only (`Read {procedure file} and follow it`, plus
   the claimed-queue/log/rendered-file paths) — never the raw queue content itself. Untrusted
   conversation content therefore never appears in this worker's prompt or argv; the agent reads
   the claimed snapshot itself via its own Read tool.
6. Captures `PRE_DREAM_MTIME` (the `.last-dream-ok` mtime, or 0) **before** spawning.
7. Runs a **NASA/JPL Rule 5** runtime assertion — `STALE_THRESHOLD (900) > WATCHDOG_SECS+GRACE
   (605)` — that hard-fails (`exit 1`) before ever spawning `claude` if a future edit breaks the
   invariant that a live worker can never be evicted by the stale-lock break.
8. `cd`s to `$PROJECT_ROOT` before spawning (see Gotchas — the cwd trap).
9. Spawns `claude -p --model $MODEL --allowedTools 'Read,Grep,Glob,Write,Edit,Bash'
   --output-format text` (no `--dangerously-skip-permissions` — contrast the memory worker)
   under a `WATCHDOG_SECS=600` (default) + 5s kill-grace watchdog.
10. Verifies success: `.last-dream-ok` mtime strictly greater than the pre-spawn baseline
    (file-vs-file, not file-vs-wallclock — avoids a false negative when the agent touches the
    stamp in the same wall-clock second the worker started). Only then removes `.processing`.

**The watchdog kill mechanism** (identical shape in both workers) is worth reading verbatim
once — it is the one piece of non-obvious bash in this whole system:

```bash
set -m                                   # give claude its OWN process group (PGID == its PID),
DEVFLOW_BG_DREAM=1 "$CLAUDE_BIN" -p ... & # even though this script is non-interactive
CLAUDE_PID=$!
set +m                                   # restore immediately so the watchdog subshell below
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
Both workers cancel the watchdog subshell as soon as `claude` exits, specifically to avoid a
stray `kill` hitting an unrelated, recycled PID after this script has already moved on.

### 4. dream-procedure.md (the agent's own instructions)

Not a Claude Code skill — skills don't load in `claude -p` sessions — just a plain markdown
file the spawned agent reads via its own Read tool. Its **Iron Laws**: (a) `assign-anchor` owns
numbering and `render-decisions.cjs` owns the `.md` files — never hand-edit
`decisions.md`/`pitfalls.md`; (b) abstain-by-default — "most runs produce nothing, if unsure
record nothing"; (c) ADR-XOR-PF — one incident yields exactly one of an ADR or a PF, never
both; (d) curation is bounded to **≤5 changes per run** and a **7-day protection window** keyed
on the ledger row's `date` field (not anything in the rendered `.md`).

Detection (Part 1): scan `decisions-log.jsonl` for a matching existing entry first — reuse its
`obs_` id via `merge-observation` (self-locking on `.observations.lock`, call it plainly, never
wrap your own lock around it) rather than creating a duplicate. Promote via `assign-anchor`
(self-locking on `.decisions.lock`) only when `quality_ok=true` and the pattern clears the
creation bar.

Curation (Part 2): run `rotate-observations` first (archives `observing` rows >30 days old to
`decisions-log.archive.jsonl`, never touches anchored/`created`/`ready` rows), then read the
`staleness.cjs` signal (a *preference* for retirement, not an automatic trigger) before
selecting ≤5 candidates to retire via `retire-anchor <id> <status>`.

**Run visibility**: write `dream/last-run-summary` (1-3 lines) ONLY if the ledger actually
changed this run — if nothing changed, do not create the file at all. `session-start-context`
injects its content once, then unconditionally deletes it (inject-once-then-delete), regardless
of whether the content was empty.

**Finishing**: touch `.last-dream-ok` **last**, strictly after every other write. This is the
worker script's sole success signal; a run that errors or is watchdog-killed correctly never
reaches this line, leaving `.processing` for the next spawn to retry.

### 5. SessionStart injection (session-start-context, session-start-memory)

`session-start-context` injects the decisions TL;DR (the first line of
`decisions.md`/`pitfalls.md`, matched via `sed -n '1s/<!-- TL;DR: \(.*\) -->/\1/p'`) plus, when
present, the dream worker's `last-run-summary`. Its TL;DR section is gated **only** on the
`.disabled` sentinel — not on the `dream/config.json` `decisions` field the other three
checkpoints (capture hooks, `spawn-dream-worker`, `background-dream-update`) all check. In the
normal CLI flow this never diverges (`devflow decisions --disable` always writes both signals
together), but it means this one call site is a single-signal check where every other decisions
call site in the system is dual-signal.

`session-start-memory` renders a 3-state header from the
`<!-- memory-head: <sha> branch: <name> -->` stamp on line 1 of `WORKING-MEMORY.md`: **A**
in-sync (stamp SHA == HEAD), **B** drifted (stamp SHA is a provable ancestor of HEAD — shown via
one `git log` walk reused for both the commit count and the display lines), **C**
refresh-failing banner (queue depth > 0 AND `.last-refresh-ok` missing or >600s old), shown *in
addition to* A or B. Before ever passing the parsed `STAMP_SHA` to git, it is hex-validated
(7-40 lowercase-hex chars, rejecting anything with a `-`-prefix or non-hex character) —
`WORKING-MEMORY.md` is treated as untrusted input. It also runs a self-contained **D56c
cold-path recovery**: an orphaned `.pending-turns.processing` older than 300s is renamed back to
`.pending-turns.jsonl`, but only if the live queue file doesn't already exist (non-clobber — a
concurrent session's fresh queue is never overwritten). `background-memory-update` is the
PRIMARY recovery owner (merges leftovers on its own next spawn); this is only the fallback for
when the worker never respawns at all.

## Integration Patterns

**Re-entrancy guard convention**: every hook in this system AND both workers check
`DEVFLOW_BG_UPDATER` and `DEVFLOW_BG_DREAM` first — before `hook-bootstrap` is even sourced, to
minimize overhead inside a background session. Each worker sets its OWN variable when spawning
its `claude -p` child (`DEVFLOW_BG_UPDATER=1` for memory, `DEVFLOW_BG_DREAM=1` for dream) so
that hooks firing from *within* that nested session bail out in one line instead of cascading a
second spawn.

**Two independent config layers**: `dream/config.json` (boolean feature toggles: `memory`,
`decisions`, `knowledge` — read fresh by every hook on every invocation) vs. `decisions.json`
(worker tuning: `model`, `debug` — read only by the dream worker and
`devflow decisions --configure`). Conflating the two is a common mistake — toggling a feature
never touches `model`/`debug`, and configuring the model never touches the boolean gates.

**CLI enable/disable asymmetry**: both `memory.ts` and `decisions.ts` follow the same rule —
`--enable` installs hooks (if not already present) AND writes config; `--disable` ONLY writes
config (`memory: false` / `decisions: false` + `.disabled` sentinel). Hooks are never removed by
a single-feature disable because they are shared plumbing across features.

**Array-order contracts are enforced entirely by `init.ts`**: neither
`capture-turn`/`memory-worker` nor the SessionStart trio encode their own ordering —
`addCaptureHooks` must run before `addMemoryHooks`, and `addContextHook` before `addDreamHook`,
in `init.ts`'s single read-modify-write pass over `settings.json`. Reordering those calls
silently breaks the append-before-spawn and TL;DR-before-dream-spawn contracts with no runtime
error.

## Constraints

- **No argv content, ever**: user/assistant/turn content flows only via `claude -p`'s stdin in
  both workers — `ps(1)` can see argv system-wide, so any content there would leak. The dream
  worker's prompt is a path-only pointer for exactly this reason.
- **Silent debug logging**: `dbg()` calls in `capture-turn`/`capture-question` explicitly never
  log message content (only lengths) — "SECURITY: Never log ASSISTANT_MSG or INPUT content —
  may contain secrets."
- **No daily/throttle cap on the dream worker**: dropped in this simplification
  (`DecisionsConfig` no longer has `max_daily_runs`/`throttle_minutes` — a legacy config on disk
  with those keys is silently ignored). The worker is bounded instead by queue non-emptiness at
  spawn time.
- **Lock durations are watchdog-derived, not arbitrary**: both workers assert at runtime that
  their lock's stale-threshold exceeds their own watchdog's total in-flight time
  (`WATCHDOG_SECS + WATCHDOG_KILL_GRACE_SECS`) with margin — memory: 300 > 125; dream: 900 >
  605. Raising either the `DEVFLOW_BG_WATCHDOG_SECS` override or the base constant without
  re-verifying this invariant risks a live worker's lock being stale-broken out from under it.

## Anti-Patterns

- **Copying the memory worker's 90s lock-wait onto the dream worker (or vice versa)**: the two
  lock philosophies are intentionally different (memory waits because losing an eager refresh
  is wasteful; dream fails fast at 2s because a waiter has nothing to contribute once another
  worker already claimed the queue).
- **Copying `--dangerously-skip-permissions` onto the dream worker**: the memory worker only
  ever calls `Read`/`Write` on one file; the dream worker calls `Bash` against ledger-mutating
  scripts and must go through the explicit `--allowedTools` allowlist without the
  skip-permissions bypass.
- **Wrapping `merge-observation`/`assign-anchor`/`retire-anchor` in your own lock acquisition**:
  all three self-lock internally; an external lock around them nests against the internal one
  and times out.
- **Passing raw queue content into a worker's prompt or argv**: both workers pass only paths;
  the agent (dream) or the worker script itself (memory, via `EXTRACTED`/`TURNS_TEXT` built from
  the claimed file) handles content — never argv.
- **Hand-editing `decisions.md`/`pitfalls.md`**: they are deterministically rendered from
  `decisions-ledger.jsonl` by `render-decisions.cjs`; any manual edit is silently overwritten on
  the next `assign-anchor`/`retire-anchor` call.

## Gotchas

- **Three distinct lock mechanisms, not one**: the generic `dream-lock` helper
  (`dream_lock_acquire`/`dream_lock_release`, 30s stale-break) is used only by `queue-append`'s
  overflow-truncation path. Each worker instead defines its OWN inline
  `break_stale_lock`/`acquire_lock` pair with its own stale-threshold (memory 300s, dream 900s)
  tailored to its own watchdog — neither worker calls into `dream-lock` at all. Don't assume the
  30s generic threshold applies to `.working-memory.lock` or `.worker.lock`.
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
  This is exactly why the CLI asymmetry in Integration Patterns exists.
- **The cwd trap**: `background-dream-update` explicitly `cd`s to `$PROJECT_ROOT` before
  spawning `claude` because `dream-procedure.md` drives the agent with `$(pwd)`-relative Bash
  invocations (e.g. `count-active "$(pwd)"`, `render-decisions.cjs render "$(pwd)"`). The worker
  can be spawned with a CWD deep inside the project (see `resolve-project-root`), so process cwd
  is not guaranteed to equal the project root without this `cd` — omitting it would render
  decisions into a stray nested `.devflow/` or the wrong project entirely.
- **Accepted append-vs-claim race**: `queue_append_row`'s overflow truncation is read-then-replace
  (`tail -100 file > tmp && mv tmp file`), not an in-place lock-held write. A lock-free
  concurrent append landing between the `tail` snapshot and the `mv` can be silently dropped.
  This is a known, accepted, pre-existing race class (extracted unchanged from the old
  `dream-capture`/`dream-dispatch` queue-overflow logic, not introduced by this simplification) —
  the guarantee that actually holds is "the file is never corrupted" (every surviving line is
  valid JSON), not "no data is ever lost under a genuine race."
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
  `devflow decisions --clear`/`--reset` resolve the git root explicitly and skip a project
  entirely while `dream/.worker.lock` is held (a plain existence check, deferring to the
  worker — not a lock acquisition, so it never races it). Neither command's cleanup logic ever
  crosses into the sibling feature's files.
- **The `opus` default is duplicated by design, in two languages**: `decisions-config.ts`'s
  `DEFAULTS.model` and `background-dream-update`'s bash `MODEL` resolution both implement the
  same project-`decisions.json` → global-`~/.devflow/decisions.json` → `"opus"` precedence
  independently, because the bash worker reads raw JSON directly rather than shelling out to the
  TS loader. Changing one default without the other silently desyncs the CLI-reported default
  from the worker's actual behavior.

## Key Files

- `scripts/hooks/capture-prompt`, `capture-turn`, `capture-question` — the three always-on
  capture hooks; all three source `queue-append` and share the truncate → `queue_read_gates` →
  `queue_append_both` shape
- `scripts/hooks/queue-append` — shared helper: `queue_append_row`, `queue_append_both`,
  `queue_read_gates` (single-fork dual-signal read)
- `scripts/hooks/memory-worker` — Stop-hook 120s throttle + touch-before-spawn +
  `background-memory-update` spawn
- `scripts/hooks/spawn-dream-worker` — SessionStart dual-signal + queue-or-processing +
  claude-on-PATH gate, spawns `background-dream-update`
- `scripts/hooks/background-memory-update` — detached memory-refresh worker (haiku,
  skip-permissions, 300s/90s lock, 120s watchdog)
- `scripts/hooks/background-dream-update` — detached decisions worker (opus default,
  allowlist-only, 900s/2s lock, 600s watchdog)
- `scripts/hooks/dream-procedure.md` — the plain-text procedure the dream worker's agent reads
  and follows; Iron Laws for detection + curation
- `scripts/hooks/session-start-context`, `session-start-memory` — SessionStart injection hooks
  (decisions TL;DR + last-run-summary; 3-state memory header + D56c cold path)
- `scripts/hooks/dream-lock` — generic mkdir-based lock (30s stale-break); used only by
  `queue-append`, NOT by either worker's own bespoke lock
- `src/cli/commands/capture.ts`, `dream.ts` — hook (de)registration for the always-on capture
  bundle and `spawn-dream-worker`
- `src/cli/commands/memory.ts`, `decisions.ts` — CLI toggles, `cleanQueueFiles`,
  `--clear`/`--reset`
- `src/cli/utils/decisions-config.ts` — TS `DecisionsConfig` loader (`model`, `debug` only — no
  throttle/cap fields)
- `src/cli/utils/project-paths.ts` — single source of truth for every path referenced above; has
  a required CJS mirror at `scripts/hooks/lib/project-paths.cjs`

## Related

- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — sibling `.devflow/` persistence
  layer; contrast its write-through/in-command model against this system's SessionStart-spawned
  detached workers.
- ADR-001 — this branch's own `purge-dream-marker-pipeline-v1` migration and the wholesale
  deletion of the old marker-pipeline files follow the same clean-break precedent ADR-001
  established.
- ADR-002 — contrast: unlike `.devflow/features/`, none of `.devflow/memory/`, `.devflow/dream/`,
  or `.devflow/decisions/` are git-tracked; every file in this system stays local and gitignored.
- ADR-003 — this knowledge base documents the post-branch end state only, per ADR-003; the
  branch itself practiced it (e.g. the dedicated "fix stale cross-phase comment references"
  cleanup commit), leaving no tombstone comments behind.
- `docs/working-memory.md`, `docs/reference/file-organization.md` — user-facing docs already
  updated for this end-state; consistent source for the file-tree summary above.
