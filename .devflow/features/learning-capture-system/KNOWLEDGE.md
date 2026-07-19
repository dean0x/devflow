---
feature: learning-capture-system
name: Learning & Capture System
description: "Use when modifying capture hooks (capture-prompt/capture-turn/capture-question), the learning or memory pending-turns queues, the Learning agent (shared/agents/learning.md), the session-start-context learning directive, the feature-config toggles, the learning tuning config, the decisions content files (decisions.md/pitfalls.md/index.md) or their ledger ops, or the devflow learning CLI. Keywords: capture-prompt, capture-turn, capture-question, queue-append, pending-turns, memory-worker, Learning agent, learning directive, LEARNING MAINTENANCE, DEVFLOW_BG_UPDATER, learning-lock, queue_read_gates, decisions_load, DECISIONS_CONTEXT, feature-config, config.json, learning.json, decisions-ledger, assign-anchor, retire-anchor, render-decisions."
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
updated: 2026-07-15
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

Module `src/cli/utils/feature-config.ts` owns feature toggle reads/writes. Its `coerceConfig`
coalesces the legacy `decisions` key into `learning` — if both are present, `decisions` wins.
This preserves old configs silently.

Tuning resolution: project `learning.json` → global `~/.devflow/learning.json` → defaults
(`model: "opus"`, `debug: false`). Module `src/cli/utils/learning-tuning-config.ts` handles
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
  observations via Bash heredoc (one JSONL row at a time); promotes via `assign-anchor`
- Part 2 (curation): calls `rotate-observations`; retires stale entries via `retire-anchor`
- Heartbeat `touch` of `.processing` at the Part 1 → Part 2 boundary prevents a long run
  from being mistakenly re-claimed
- **Final act**: `unlink .devflow/learning/.pending-turns.processing` (applies PF-003 —
  bare `rm` is blocked by the deny-list; `unlink` is the required form)

**Ledger ops** (called from agent's Bash tool):
```bash
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" assign-anchor "decision" "obs_xxx"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" assign-anchor "pitfall"  "obs_xxx"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" retire-anchor "ADR-NNN"  "Superseded"
node "$HOME/.devflow/scripts/hooks/json-helper.cjs" rotate-observations
```

Each op self-locks. Never wrap them in an external lock; never call more than one at a time.
`assign-anchor` atomically writes `decisions.md`, `pitfalls.md`, and `index.md`. These files
are **never hand-edited** — they are exclusively owned by `assign-anchor`/`retire-anchor`/
`render-decisions.cjs`.

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

`src/cli/hud/components/learning-counts.ts` exports `gatherLearningCounts(cwd)`: reads
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
  these files are exclusively owned by `assign-anchor`/`retire-anchor`/`render-decisions.cjs`.
  Hand-edits create rendering inconsistencies and get silently overwritten.

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

- **json_extract_cwd_field SOH delimiter**: `capture-turn` splits the combined `cwd+field`
  output using `$'\001'` (bash SOH literal). The jq side emits `""`. If you add a
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
| `src/assets/scripts/hooks/json-parse` | JSON helpers including json_extract_cwd_field (SOH delimiter) |
| `src/assets/agents/learning.md` | Learning agent spec (claim, detect, curate, unlink) |
| `src/core/feature-config.ts` | `.devflow/config.json` read/write; `decisions`→`learning` coalesce |
| `src/core/learning-tuning-config.ts` | Tuning config merge (project → global → defaults) |
| `src/core/project-paths.ts` | Path construction — single source of truth for all `.devflow/` paths |
| `src/core/learning-queue-cleanup.ts` | Queue drain + legacy sweep helpers |
| `src/cli/commands/learning.ts` | `devflow learning` CLI |
| `src/hud/components/learning-counts.ts` | HUD counts from `decisions-ledger.jsonl` |
| `src/assets/commands/_partials/_decisions.mds` | `decisions_load()` macro (plain file Read per ADR-007) |
| `src/assets/scripts/hooks/decisions-usage-scan.cjs` | Citation counter (D29 grep-first gate) |

## Related

- **ADR-001** — config-only gates: feature toggles live in `.devflow/config.json`, not sentinel files; `decisions` legacy key coalesces to `learning` here
- **ADR-002** — only `.devflow/features/` is git-tracked; all learning runtime files stay gitignored
- **ADR-003** — document end-state only; the bash `opus` default is duplicated by design so the hook avoids a TS subprocess
- **ADR-007** — `index.md` consumption is a plain Read; no subprocess, no `.cjs` script
- **PF-003** — agent instruction deletions use `unlink`, never bare `rm` (deny-list contract)
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — Knowledge agent write-back pattern (parallel write-through system)
- `.devflow/features/ambient-orchestrator/KNOWLEDGE.md` — Ambient orchestrator that also uses `session-start-context` for charter injection
