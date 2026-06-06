---
feature: hooks
name: Dream & Hooks System
description: "Use when modifying dream hooks, background maintenance, marker lifecycle, memory/decisions/knowledge/curation processing, or per-task dream skills. Keywords: dream, hooks, background processor, merge-observation, decisions-append, marker, .processing, SessionStart, dream-capture, dream-evaluate, dream-memory, dream-decisions, dream-knowledge, dream-curation."
category: architecture
directories: ["scripts/hooks/", "shared/agents/"]
referencedFiles:
  - scripts/hooks/lib/feature-knowledge.cjs
  - scripts/hooks/lib/decisions-index.cjs
  - scripts/hooks/lib/transcript-filter.cjs
  - scripts/hooks/lib/staleness.cjs
  - scripts/hooks/json-helper.cjs
  - scripts/hooks/dream-capture
  - scripts/hooks/dream-collect-tasks
  - scripts/hooks/dream-dispatch
  - scripts/hooks/dream-evaluate
  - scripts/hooks/dream-recover
  - scripts/hooks/eval-curation
  - scripts/hooks/session-start-context
  - shared/agents/dream.md
  - shared/skills/dream-memory/SKILL.md
  - shared/skills/dream-decisions/SKILL.md
  - shared/skills/dream-knowledge/SKILL.md
  - shared/skills/dream-curation/SKILL.md
  - src/cli/commands/decisions.ts
created: 2026-06-01
updated: 2026-06-05
---

# Dream & Hooks System

## Overview

The Dream system is a three-hook pipeline that captures session context, evaluates what background work is needed, and coordinates per-task background LLM agents to do that work. The hooks are installed from `scripts/hooks/` (source of truth) to `~/.devflow/scripts/hooks/` at `devflow init` time. The background agent spec lives at `shared/agents/dream.md`; per-task procedures live in four skills (`dream-memory`, `dream-decisions`, `dream-knowledge`, `dream-curation`).

The system is explicitly split into two layers: **plumbing** (hooks, locks, marker files, atomic writes, JSONL logs) and **LLM** (all detection, semantic matching, content authoring, curation judgment). The Dream agent body is now minimal plumbing (claim + heartbeat + dispatch); all task intelligence lives in per-task skill files loaded dynamically at runtime.

## System Context

Four active task types can be pending at any session start: `memory`, `decisions`, `knowledge`, `curation`. Each gets its own marker file in `.devflow/dream/`. The three hooks are:

| Hook | Trigger | Role |
|------|---------|------|
| `dream-capture` | Stop (per turn) | Append assistant turn to queue; write `memory.json` marker when throttle (120s) expires |
| `dream-evaluate` | SessionEnd | Source eval-* modules; write per-session markers for decisions/knowledge/curation |
| `session-start-context` | SessionStart | Recover stale `.processing`, collect pending markers, emit per-task DREAM MAINTENANCE directives |

The learning task type has been removed. `dream-collect-tasks` now unconditionally deletes any orphaned `learning.*` marker files on sight (R1).

## Spawn Model: Per-Task Background Agents

`session-start-context` spawns **one background Dream agent per pending task type**, with a hardcoded task→model map:

| Task | Model | Rationale |
|------|-------|-----------|
| `memory` | haiku | Fast queue drain; no heavy LLM reasoning needed |
| `knowledge` | sonnet | KB refresh needs code reading; no cross-cutting analysis |
| `decisions` | opus | Semantic matching + quality ADR/PF authoring |
| `curation` | opus | Nuanced deprecation judgment against live docs |

**Exception — decisions + curation co-pending**: exactly ONE opus spawn is emitted, running decisions fully then curation fully (sequential). This prevents concurrent `.decisions.lock` contention between two opus agents.

Unknown task types are silently skipped — `dream-collect-tasks` should never emit them, but the emitter has belt-and-suspenders defense.

## Agent Architecture: Plumbing + Dynamic Skill

`shared/agents/dream.md` now holds only shared plumbing — Steps 0–1 (discover task, claim/heartbeat/merge) and error discipline — plus a dispatch table in Step 2:

> For each task type you claimed markers for, load the matching skill via the Skill tool and follow its procedure exactly.

The four per-task procedures live in separate skill files:

- `devflow:dream-memory` — queue drain + WORKING-MEMORY.md authoring
- `devflow:dream-decisions` — dialog-pair analysis + ADR/PF creation via `decisions-append`
- `devflow:dream-knowledge` — stale KB refresh + index update
- `devflow:dream-curation` — ADR/PF housekeeping (deprecate, merge, TL;DR rewrite)

The `model: sonnet` in the Dream agent frontmatter is a default only; `session-start-context` overrides it per-spawn with the correct model for each task.

## Marker Lifecycle

```
dream-evaluate writes:
  .devflow/dream/{type}.{session_id}.json       ← pending marker

session-start-context reads:
  - dream_recover_stale()                        ← .processing → .json if stale
  - dream_collect_tasks()                        ← collects .json marker types (4-arg: no learning)
  - raw-queue bridge                             ← adds memory task if .pending-turns.jsonl non-empty
  - emits per-task DREAM MAINTENANCE directives  ← one Agent() call per task (or combined for dec+cur)

Dream agent (background) claims:
  mv {type}.{session}.json → {type}.{session}.processing   ← atomic claim
  touch {type}.{session}.processing                         ← heartbeat at phase start
  ... loads per-task skill, follows procedure ...
  rm {type}.{session}.processing                            ← success: delete
  (on error: leave .processing in place for retry)
```

The session suffix on marker filenames (`{type}.{session_id}.json`) is a concurrency fix (D57a): two simultaneous SessionStart events each process their own markers without racing on the same file.

**Multi-marker merge**: When multiple `{type}.{session}.processing` files exist for one type, the Dream agent reads them all and unions their payloads before processing: decisions concatenate `dialogPairs` strings and union `existingObservationIds`; knowledge unions `staleSlugs`; memory and curation use single markers only. Input cap: last 30 dialog-pairs (bounds token cost per run).

## Stale Recovery (dream-recover)

`dream_recover_stale()` in `scripts/hooks/dream-recover` runs at the start of every SessionStart Section 2. It examines `.processing` files and applies per-type stale thresholds:

| Marker type | Stale threshold | Rationale |
|-------------|----------------|-----------|
| `memory` | 300s (5 min) | Memory agent is fast; 5 min = session crash |
| All others (`decisions`, `knowledge`, `curation`) | 1800s (30 min) | LLM runs can be slow; avoid yanking active processor |

When a `.processing` file exceeds its threshold, it is renamed back to `.json` for retry. Retry count is stored in a sibling `.retries` file; at 3 retries the marker is renamed to `.failed` instead. `.failed` files are cleaned up after 24 hours. The `JUST_RECOVERED` variable (exported by `dream_recover_stale`) tells `dream_collect_tasks` to preserve existing `.retries` counters rather than resetting them (D56b).

The heartbeat rule pairs with these thresholds: the Dream agent `touch`es each `.processing` file at the start of every phase to refresh its mtime, preventing the recovery mechanism from yanking an actively running processor.

## Spawn Throttle

`session-start-context` enforces a 120s spawn throttle via `.devflow/dream/.processor-spawned-at` (D57b). SessionStart fires on `/clear`, compact, and every new window. Without this throttle, three rapid `/clear` commands would spawn three sets of background agents racing on the same markers. The throttle is written atomically (temp+mv).

## Raw-Queue Bridge

Section 2 of `session-start-context` includes a fallback that adds the `memory` task type even when no `memory.json` marker file exists — if `.pending-turns.jsonl` is non-empty and memory is enabled. This handles the race window where `dream-capture` wrote turns to the queue but the session ended before the 120s marker-write throttle expired.

## Queue: Memory Channel

`dream-capture` (Stop hook) appends assistant turns to `.devflow/memory/.pending-turns.jsonl` (JSONL, each line `{role, content, ts}`). The Dream memory agent claims it atomically by renaming to `.pending-turns.processing`. If the session crashes mid-processing, `dream_recover_stale` in the next SessionStart renames `.processing` back to `.jsonl` — but only when no fresh `.jsonl` already exists (non-clobber guard, D56c).

Queue overflow: capped at 200 lines, truncated to 100 under a mkdir-based lock to prevent multi-session truncation races.

Decisions usage scanner (`decisions-usage-scan.cjs`) also runs in `dream-capture` — it increments cite counts in `.decisions-usage.json` when the assistant response contains `ADR-NNN` or `PF-NNN` references. This is independent of memory state.

## Transcript Channels (transcript-filter.cjs)

`dream-evaluate` uses `scripts/hooks/lib/transcript-filter.cjs` to extract channels from the session transcript before writing markers:

- **DIALOG_PAIRS** — adjacent `(assistant, user)` pairs; fed to `decisions` markers (decision/pitfall detection)

The `user-signals` extraction operation still exists in `transcript-filter.cjs` but is now orphaned-but-harmless: the learning pipeline has been removed and no remaining module consumes USER_SIGNALS. Only `decisions` uses `dialog-pairs`.

The filter rejects: `isMeta:true` entries, tool scaffolding, framework-injected XML wrappers, `tool_result` content items, and turns under 5 characters. Cap: last 80 turns, 1200 chars per turn.

## Lock Hardening in Per-Task Skills

The old `dream-evaluate` / Dream agent used a give-up-fast `mkdir || { sleep; exit }` pattern. The per-task skills now use **bounded retry+backoff** for both lock types:

```bash
# Pattern used in dream-decisions (.observations.lock) and dream-curation (.decisions.lock)
LOCK="<lockpath>"
_ACQUIRED=false
_BACKOFF=1
for _ATTEMPT in 1 2 3 4 5 6 7 8 9; do
  if mkdir "$LOCK" 2>/dev/null; then
    _ACQUIRED=true; break
  fi
  sleep "$_BACKOFF"
  _BACKOFF=$(( _BACKOFF < 8 ? _BACKOFF * 2 : 8 ))
done
if [ "$_ACQUIRED" != "true" ]; then
  echo "...: lock exhausted — leaving .processing for retry" >&2; exit 1
fi
```

9 attempts, ~30s total backoff cap. On exhaustion, exits with code 1 leaving `.processing` in place — dream-recover will retry rather than silently dropping the work.

## Plumbing Operations (json-helper.cjs)

Two key plumbing operations in `json-helper.cjs` handle all observation writes:

**`merge-observation <log> <newObsJson>`** — id-keyed reinforcement:
- Finds existing entry by `id` field in the JSONL log, merges evidence (FIFO cap-10, D12)
- If `id` type collides with an existing entry, appends `_b` suffix (D11)
- Self-creates parent directory and empty log on first write
- Caller holds `.devflow/dream/.observations.lock` (mkdir-based) EXTERNALLY — lock acquired by the per-task skill around the Bash call, then released. Never held across tool calls.
- Writes atomically via temp+mv with O_EXCL flag

**`decisions-append <file> <type> <obs>`** — ADR/PF append-only:
- Assigns the next sequential `ADR-NNN` or `PF-NNN` number (scans existing headings)
- Appends the full section body with `- **Source**: self-learning:{obs_id}` marker
- Updates the `<!-- TL;DR: N decisions. Key: ... -->` header comment (last 5 active IDs)
- Acquires `.devflow/decisions/.decisions.lock` INTERNALLY — this is a self-locking op
- Never call `decisions-append` from a context that already holds `.decisions.lock` (deadlock)
- Append-only invariant: never deletes entries; curation deprecates by editing `- **Status**:`

**`read-dream <file> <field>`** — reads a field from a dream JSON marker file; returns `[]` on any error.

## LLM-vs-Plumbing Principle

The boundary is strict:

| Plumbing (deterministic code) | LLM (background Dream agent + skills) |
|-------------------------------|-------------------------------|
| Hook triggers, throttles, locks | Detection of patterns from dialog pairs |
| Atomic file writes, marker management | Semantic matching for obs_id reuse |
| JSONL log structure, id-keyed records | Content authoring (memory, artifacts, ADR/PF bodies) |
| `decisions-append` numbering | Curation judgment (what to deprecate, what to merge) |
| `staleness.cjs` annotation | Interpretation of staleness signal |
| `decisions-index.cjs` filtering | Promotion decisions (status, confidence) |

No `claude -p` subprocess is spawned for individual features. The Dream agent spec (`shared/agents/dream.md`) is the single plumbing spec; per-task intelligence lives in skill files.

## Staleness Signal (staleness.cjs)

`scripts/hooks/lib/staleness.cjs` annotates decisions log entries with `mayBeStale: true` + `staleReason` when file paths extracted from `details`/`evidence` fields no longer exist on disk. The Dream curation skill runs this before selecting deprecation candidates. Staleness is a signal to the LLM, not an automatic action — a heavily-cited stale entry should survive over an uncited stale one.

## Curation (eval-curation + dream-curation skill)

`eval-curation` (sourced by `dream-evaluate`) writes a `curation.{session}.json` marker, throttled to once every 7 days via `.devflow/dream/.curation-last` epoch file. The `devflow:dream-curation` skill (loaded by the Dream agent) then:

- Reads `.decisions-usage.json` directly for cite counts (never calls `decisions-usage-scan.cjs`)
- Deprecates by directly editing the `- **Status**:` line and TL;DR comment using the Edit tool
- Holds `.decisions.lock` once across the read-modify-write via bounded retry+backoff (3-call lock lifecycle: acquire Bash / Edit tool(s) / release Bash)
- Never calls `decisions-append` during curation (would deadlock — `decisions-append` acquires `.decisions.lock` internally)
- 5 changes per run maximum; 7-day protection window per entry

Note: `.curation-last` lives in `.devflow/dream/` (not `.devflow/decisions/`), co-located with other Dream state.

## Feature Knowledge Staleness (feature-knowledge.cjs)

`scripts/hooks/lib/feature-knowledge.cjs` is the runtime module for knowledge base operations:
- `checkStaleness(worktreePath, slug)` — runs `git log --after={lastUpdated}` against `referencedFiles` to detect whether a KB is stale
- `checkAllStaleness(worktreePath)` — single git log call for all entries (batched for efficiency)
- `updateIndex(worktreePath, entry)` — acquires `.devflow/features/.knowledge.lock` (mkdir-based) before writing `index.json`
- `findOverlapping(worktreePath, changedFiles)` — finds KBs whose referencedFiles overlap changed files (used by SessionEnd to decide which KBs need refresh)
- Slug validation: kebab-case only, no `..` or `/` (D52 defense-in-depth)

## Decisions Index (decisions-index.cjs)

`scripts/hooks/lib/decisions-index.cjs` provides a compact index for orchestration surfaces. It applies the D-A filter: strips sections with `- **Status**: Deprecated` or `- **Status**: Superseded` before building the index. The compact format is what orchestrators inject as `DECISIONS_CONTEXT`. Never loads the full decisions.md/pitfalls.md body into context — consumers call Read on demand.

## Dream Config & Legacy Fallback

The primary source of truth for feature enabled-state is `.devflow/dream/config.json`. DreamConfig fields are now `{memory, decisions, knowledge}` — the `learning` field has been removed; `coerceConfig` drops it without error when migrating old configs. All three hooks and `session-start-context` include a transitional fallback that reads `.devflow/sidecar/config.json` when the dream config is absent — marked with `# dream-fallback: REMOVE after one release`.

## Anti-Patterns

- **Editing installed copies** — always edit `scripts/hooks/`, then `npm run build` + `devflow init`. Changes to `~/.devflow/scripts/hooks/` are silently overwritten on reinstall (PF-007).
- **Calling `decisions-append` during curation** — it acquires `.decisions.lock` internally; calling it while holding that lock deadlocks. Use the Edit tool for deprecation as documented in `dream-curation` skill.
- **Holding a lock across tool calls** — the Dream agent's lock lifecycle must be: acquire Bash → Edit tool(s) → release Bash. Never span multiple unrelated tool calls under one lock.
- **Spawning one agent to handle all tasks** — the new model is N per-task background agents (one per task type), not one agent doing all tasks sequentially. The only exception is decisions+curation co-pending, which shares one opus spawn to avoid lock contention.
- **Assuming `dream-dispatch` injects the DREAM directive** — `dream-dispatch` is capture-only (UserPromptSubmit); the DREAM MAINTENANCE directives are emitted by `session-start-context` (SessionStart) (ADR-009).
- **Using `additionalContext` for critical directives** — models deprioritize `additionalContext` when a user question is present; critical maintenance directives must be anchored to SessionStart (PF-008).
- **Using `decisions-usage-scan.cjs` to read cite counts** — it is a write-path tool that increments counts from session text. Read `.decisions-usage.json` directly for reporting or curation decisions.
- **Writing artifact content in deterministic scripts** — memory, observations, ADR/PF bodies, and knowledge bases must be authored by the LLM Dream agent via per-task skills; plumbing scripts handle only structural writes (ADR-008).
- **Expecting USER_SIGNALS to feed any active pipeline** — the learning pipeline is gone. `transcript-filter.cjs` still emits a `user-signals` op but nothing consumes it. Only `dialog-pairs` (decisions) is active.

## Gotchas

- **PF-006**: Claude Code renamed `response_text` → `last_assistant_message` in the Stop hook JSON silently (mid-May 2026). All 3+ projects had frozen memory for weeks. After any Claude Code version update, verify hook input field names against current docs. `dream-capture` now reads `last_assistant_message`; if Claude Code changes the API again, this will break silently — always test hook field presence after upgrades.
- **PF-007**: Source is `scripts/hooks/`; installed is `~/.devflow/scripts/hooks/`. Editing installed copies creates repo divergence and the changes are overwritten on next `devflow init`. Always source-first.
- **set -e / no-abort discipline** — `dream-capture` and `dream-evaluate` use `set -e`. However, `session-start-context` intentionally omits `set -e` because its two sections (1.5 decisions TL;DR and 2 dream pending-work) are independent — a failure in one must not prevent the other from running. Never add `set -e` to `session-start-context`.
- **Background session guards** — all three hooks check `DEVFLOW_BG_UPDATER`, `DEVFLOW_BG_LEARNER`, `DEVFLOW_BG_KNOWLEDGE_REFRESH` env vars at the top and exit immediately to prevent feedback loops when the hook fires inside a background agent's subprocess.
- **Atomic writes everywhere** — all marker and state file writes use `tmp.$$` (PID-unique) + atomic `mv`. The `json-helper.cjs` uses `writeExclusive` (O_EXCL flag) for temp files to prevent TOCTOU symlink attacks.
- **Legacy `memory.json` marker** — the Dream agent must also check for legacy `.devflow/dream/memory.json` (no session suffix) alongside the newer `memory.{session}.json` format for backward compatibility during transitions.
- **`feature-knowledge.cjs` uses `execFileSync` with array args** — never string-interpolate `lastUpdated` or worktree paths into shell strings. The module explicitly avoids shell injection via array arguments.
- **Raw-queue bridge** — the memory task can be added without a `memory.json` marker file if `.pending-turns.jsonl` is non-empty. The Dream agent must handle the memory task even when no marker was claimed (queue claim via `mv` soft-fails).
- **`dream-collect-tasks` 4-arg signature** — the function signature is now `dream_collect_tasks DREAM_DIR MEM_EN DEC_EN KNOW_EN`. There is no fifth `LEARN_EN` argument. Any call site passing 5 arguments is stale.
- **Per-task skill model override** — `shared/agents/dream.md` has `model: sonnet` in its frontmatter, but `session-start-context` overrides this per spawn. The agent frontmatter model is never actually used in production; the spawn-time model is authoritative.

## Key Files

- `scripts/hooks/dream-capture` — Stop hook; queue append + memory marker write (120s throttle)
- `scripts/hooks/dream-dispatch` — UserPromptSubmit hook; capture-only (user turn append to pending-turns queue); no directive emission
- `scripts/hooks/dream-evaluate` — SessionEnd hook; orchestrator sourcing eval-helpers + eval-decisions + eval-knowledge + eval-curation (eval-learning and eval-reinforce removed)
- `scripts/hooks/eval-curation` — sourced by dream-evaluate; writes `curation.{session}.json` marker on 7-day throttle; `.curation-last` in `.devflow/dream/`
- `scripts/hooks/dream-recover` — sourced helper; stale `.processing` recovery per-type thresholds; JUST_RECOVERED guard; orphaned pending-turns recovery
- `scripts/hooks/dream-collect-tasks` — 4-arg sourced helper; collects pending `.json` markers; unconditionally deletes learning.* markers (R1); COLLECT_LIMIT=50 FIFO
- `scripts/hooks/session-start-context` — SessionStart hook (no set -e); two independent sections: 1.5 decisions TL;DR, 2 per-task dream spawn directives (with raw-queue bridge)
- `scripts/hooks/json-helper.cjs` — plumbing ops: `merge-observation`, `decisions-append`, `read-dream`, atomic writes; does NOT contain judgment logic
- `scripts/hooks/lib/transcript-filter.cjs` — two-channel filter: USER_SIGNALS (orphaned, unused) + DIALOG_PAIRS (active, decisions only)
- `scripts/hooks/lib/staleness.cjs` — annotates log entries with `mayBeStale` based on file existence; signal-only (no CLI display surface)
- `scripts/hooks/lib/feature-knowledge.cjs` — KB index, staleness checks, `updateIndex`, slug validation
- `scripts/hooks/lib/decisions-index.cjs` — compact decisions index with D-A filter for orchestrators
- `shared/agents/dream.md` — Dream agent plumbing spec: Step 0 task discovery, Step 1 claim/heartbeat/multi-marker-merge, Step 2 per-task skill dispatch, error discipline
- `shared/skills/dream-memory/SKILL.md` — memory task procedure: queue drain + WORKING-MEMORY.md authoring (haiku)
- `shared/skills/dream-decisions/SKILL.md` — decisions task procedure: dialog-pair analysis, bounded retry+backoff on `.observations.lock`, `decisions-append` promotion (opus)
- `shared/skills/dream-knowledge/SKILL.md` — knowledge task procedure: stale KB refresh + index update (sonnet)
- `shared/skills/dream-curation/SKILL.md` — curation task procedure: deprecate/merge ADR/PF, bounded retry+backoff on `.decisions.lock`, Edit-tool deprecation (opus)

## Related

- **PF-006** (`.devflow/decisions/pitfalls.md`) — Claude Code Stop hook API changed silently; `response_text` → `last_assistant_message`. Defense: verify hook field names after every Claude Code update.
- **PF-007** (`.devflow/decisions/pitfalls.md`) — Edit source hooks (`scripts/hooks/`), never installed copies (`~/.devflow/scripts/hooks/`).
- **ADR-008** (`.devflow/decisions/decisions.md`) — LLM-vs-plumbing principle: artifact content must be LLM-authored; deterministic scripts handle only structural writes.
- **ADR-009** (`.devflow/decisions/decisions.md`) — Dream processor must be spawned at SessionStart, not via UserPromptSubmit (additionalContext deprioritized).
- **KB: cli-rules** (`.devflow/features/cli-rules/KNOWLEDGE.md`) — covers `src/cli/commands/` and `src/cli/utils/`, including the `devflow decisions` CLI which manages the decisions feature toggle and config surfaced here.
