---
feature: hooks
name: Sidecar & Hooks System
description: "Use when modifying sidecar hooks, background maintenance, marker lifecycle, memory/learning/decisions/knowledge processing, or curation. Keywords: sidecar, hooks, background processor, merge-observation, decisions-append, marker, .processing, SessionStart."
category: architecture
directories: ["scripts/hooks/", "shared/skills/sidecar/"]
referencedFiles:
  - scripts/hooks/lib/feature-knowledge.cjs
  - scripts/hooks/lib/decisions-index.cjs
  - scripts/hooks/lib/transcript-filter.cjs
  - scripts/hooks/lib/staleness.cjs
  - scripts/hooks/json-helper.cjs
  - scripts/hooks/sidecar-capture
  - scripts/hooks/sidecar-evaluate
  - scripts/hooks/sidecar-recover
  - scripts/hooks/session-start-context
  - shared/skills/sidecar/SKILL.md
  - src/cli/commands/decisions.ts
created: 2026-06-01
updated: 2026-06-01
---

# Sidecar & Hooks System

## Overview

The sidecar system is a three-hook pipeline that captures session context, evaluates what background work is needed, and coordinates a single background LLM agent to do that work. The hooks are installed from `scripts/hooks/` (source of truth) to `~/.devflow/scripts/hooks/` at `devflow init` time. The background agent is driven by `shared/skills/sidecar/SKILL.md`.

The system is explicitly split into two layers: **plumbing** (hooks, locks, marker files, atomic writes, JSONL logs) and **LLM** (all detection, semantic matching, content authoring, curation judgment). No `claude -p` subprocess for individual features — one background agent handles all pending task types sequentially.

## System Context

Five task types can be pending at any session start: `memory`, `learning`, `decisions`, `knowledge`, `curation`. Each gets its own marker file in `.devflow/sidecar/`. The three hooks are:

| Hook | Trigger | Role |
|------|---------|------|
| `sidecar-capture` | Stop (per turn) | Append assistant turn to queue; write `memory.json` marker when throttle (120s) expires |
| `sidecar-evaluate` | SessionEnd | Source eval-* modules; write per-session markers for learning/decisions/knowledge/curation |
| `session-start-context` | SessionStart | Recover stale `.processing`, collect pending markers, emit SIDECAR MAINTENANCE directive |

The main model's only action is a single `Agent(run_in_background: true)` call to the sidecar-processor. The processor claims, processes, and deletes each marker.

## Marker Lifecycle

```
sidecar-evaluate writes:
  .devflow/sidecar/{type}.{session_id}.json       ← pending marker

session-start-context reads:
  - sidecar_recover_stale()                       ← .processing → .json if stale
  - sidecar_collect_tasks()                       ← collects .json marker types
  - emits SIDECAR MAINTENANCE directive           ← instructs model to spawn processor

sidecar-processor (background agent) claims:
  mv {type}.{session}.json → {type}.{session}.processing   ← atomic claim
  touch {type}.{session}.processing                         ← heartbeat at phase start
  ... does LLM work ...
  rm {type}.{session}.processing                            ← success: delete
  (on error: leave .processing in place for retry)
```

The session suffix on marker filenames (`{type}.{session_id}.json`) is a concurrency fix (D57a): two simultaneous SessionStart events each process their own markers without racing on the same file.

## Stale Recovery (sidecar-recover)

`sidecar_recover_stale()` in `scripts/hooks/sidecar-recover` runs at the start of every SessionStart Section 2. It examines `.processing` files and applies per-type stale thresholds:

| Marker type | Stale threshold | Rationale |
|-------------|----------------|-----------|
| `memory` | 300s (5 min) | Memory agent is fast; 5 min = session crash |
| All others (`learning`, `decisions`, `knowledge`, `curation`) | 1800s (30 min) | LLM runs can be slow; avoid yanking active processor |

When a `.processing` file exceeds its threshold, it is renamed back to `.json` for retry. Retry count is stored in a sibling `.retries` file; at 3 retries the marker is renamed to `.failed` instead. `.failed` files are cleaned up after 24 hours. The `JUST_RECOVERED` variable (exported by `sidecar_recover_stale`) tells `sidecar_collect_tasks` to preserve existing `.retries` counters rather than resetting them (D56b).

The heartbeat rule pairs with these thresholds: the processor agent `touch`es each `.processing` file at the start of every phase to refresh its mtime, preventing the recovery mechanism from yanking an actively running processor.

## Spawn Throttle

`session-start-context` enforces a 120s spawn throttle via `.devflow/sidecar/.processor-spawned-at` (D57b). SessionStart fires on `/clear`, compact, and every new window. Without this throttle, three rapid `/clear` commands would spawn three background agents racing on the same markers. The throttle is written atomically (temp+mv).

## Queue: Memory Channel

`sidecar-capture` (Stop hook) appends assistant turns to `.devflow/memory/.pending-turns.jsonl` (JSONL, each line `{role, content, ts}`). The memory agent claims it atomically by renaming to `.pending-turns.processing`. If the session crashes mid-processing, `sidecar_recover_stale` in the next SessionStart renames `.processing` back to `.jsonl` — but only when no fresh `.jsonl` already exists (non-clobber guard, D56c).

Queue overflow: capped at 200 lines, truncated to 100 under a mkdir-based lock to prevent multi-session truncation races.

Decisions usage scanner (`decisions-usage-scan.cjs`) also runs in `sidecar-capture` — it increments cite counts in `.decisions-usage.json` when the assistant response contains `ADR-NNN` or `PF-NNN` references. This is independent of memory state.

## Transcript Channels (transcript-filter.cjs)

`sidecar-evaluate` uses `scripts/hooks/lib/transcript-filter.cjs` to extract two channels from the session transcript before writing markers:

- **USER_SIGNALS** — clean user-turn texts; fed to `learning` markers (workflow/procedural detection)
- **DIALOG_PAIRS** — adjacent `(assistant, user)` pairs; fed to `decisions` markers (decision/pitfall detection)

The filter rejects: `isMeta:true` entries, tool scaffolding (`sourceToolUseID`, `toolUseResult`), framework-injected XML wrappers (`<command-name>`, `<system-reminder>`, etc.), `tool_result` content items, and turns under 5 characters. Cap: last 80 turns, 1200 chars per turn.

## Plumbing Operations (json-helper.cjs)

Two key plumbing operations in `json-helper.cjs` handle all observation writes:

**`merge-observation <log> <newObsJson>`** — id-keyed reinforcement:
- Finds existing entry by `id` field in the JSONL log, merges evidence (FIFO cap-10, D12)
- If `id` type collides with an existing entry, appends `_b` suffix (D11)
- Self-creates parent directory and empty log on first write
- Caller holds `.devflow/sidecar/.reinforce.lock` (mkdir-based) EXTERNALLY — the lock is acquired by the processor around the Bash call, then released. Never held across tool calls.
- Writes atomically via temp+mv with O_EXCL flag

**`decisions-append <file> <type> <obs>`** — ADR/PF append-only:
- Assigns the next sequential `ADR-NNN` or `PF-NNN` number (scans existing headings)
- Appends the full section body with `- **Source**: self-learning:{obs_id}` marker
- Updates the `<!-- TL;DR: N decisions. Key: ... -->` header comment (last 5 active IDs)
- Acquires `.devflow/decisions/.decisions.lock` INTERNALLY — this is a self-locking op
- Never call `decisions-append` from a context that already holds `.decisions.lock` (deadlock)
- Append-only invariant: never deletes entries; curation deprecates by editing `- **Status**:`

## LLM-vs-Plumbing Principle

The boundary is strict:

| Plumbing (deterministic code) | LLM (background processor) |
|-------------------------------|---------------------------|
| Hook triggers, throttles, locks | Detection of patterns from signals |
| Atomic file writes, marker management | Semantic matching for obs_id reuse |
| JSONL log structure, id-keyed records | Content authoring (memory, artifacts, ADR/PF bodies) |
| `decisions-append` numbering | Curation judgment (what to deprecate, what to merge) |
| `staleness.cjs` annotation | Interpretation of staleness signal |
| `decisions-index.cjs` filtering | Promotion decisions (status, confidence) |

No `claude -p` subprocess is spawned for individual features. The sidecar skill (`shared/skills/sidecar/SKILL.md`) is the single spec the LLM processor follows.

## Staleness Signal (staleness.cjs)

`scripts/hooks/lib/staleness.cjs` annotates learning/decisions log entries with `mayBeStale: true` + `staleReason` when file paths extracted from `details`/`evidence` fields no longer exist on disk. The processor runs this before reinforcing (learning task) or selecting deprecation candidates (curation task). Staleness is a signal to the LLM, not an automatic action:

- During learning: skip promotion for stale-flagged entries; continue observing
- During curation: prefer stale-flagged entries as deprecation candidates, within the 7-day protection window and 5-changes cap

## Curation (eval-curation)

`eval-curation` (sourced by `sidecar-evaluate`) writes a `curation.{session}.json` marker, throttled to once every 7 days via `.devflow/decisions/.curation-last` epoch file. The curation task in the processor:

- Reads `.decisions-usage.json` directly for cite counts (not by calling `decisions-usage-scan.cjs`)
- Deprecates by directly editing the `- **Status**:` line and TL;DR comment
- Holds `.decisions.lock` once across the read-modify-write; uses Edit tool between two Bash calls (acquire / Edit / release) — never calls `decisions-append` during curation
- 5 changes per run maximum; 7-day protection window per entry

## Feature Knowledge Staleness (feature-knowledge.cjs)

`scripts/hooks/lib/feature-knowledge.cjs` is the runtime module for knowledge base operations:
- `checkStaleness(worktreePath, slug)` — runs `git log --after={lastUpdated}` against `referencedFiles` to detect whether a KB is stale
- `checkAllStaleness(worktreePath)` — single git log call for all entries (batched for efficiency)
- `updateIndex(worktreePath, entry)` — acquires `.devflow/features/.knowledge.lock` (mkdir-based) before writing `index.json`
- `findOverlapping(worktreePath, changedFiles)` — finds KBs whose referencedFiles overlap changed files (used by SessionEnd to decide which KBs need refresh)
- Slug validation: kebab-case only, no `..` or `/` (D52 defense-in-depth)

## Decisions Index (decisions-index.cjs)

`scripts/hooks/lib/decisions-index.cjs` provides a compact index for orchestration surfaces. It applies the D-A filter: strips sections with `- **Status**: Deprecated` or `- **Status**: Superseded` before building the index. The compact format is what orchestrators inject as `DECISIONS_CONTEXT`. Never loads the full decisions.md/pitfalls.md body into context — consumers call Read on demand.

## Anti-Patterns

- **Editing installed copies** — always edit `scripts/hooks/`, then `npm run build` + `devflow init`. Changes to `~/.devflow/scripts/hooks/` are silently overwritten on reinstall (avoids PF-007).
- **Calling `decisions-append` during curation** — it acquires `.decisions.lock` internally; calling it while holding that lock deadlocks. Use Edit tool for deprecation (avoids SKILL.md explicit warning).
- **Holding a lock across tool calls** — the processor's lock lifecycle must be: acquire → single Bash → release. Never span multiple tool calls under one lock.
- **Spawning multiple background agents** — the main model makes exactly one `Agent(run_in_background: true)` call. The processor handles all task types sequentially inside one agent.
- **Assuming `sidecar-dispatch` injects the SIDECAR directive** — after the LLM refactor, `sidecar-dispatch` is capture-only (UserPromptSubmit); the SIDECAR directive is emitted by `session-start-context` (SessionStart). `sidecar-dispatch` no longer drives the processor.
- **Using `decisions-usage-scan.cjs` to read cite counts** — it is a write-path tool that increments counts from session text. Read `.decisions-usage.json` directly for reporting or curation decisions.

## Gotchas

- **PF-006**: Claude Code renamed `response_text` → `last_assistant_message` in the Stop hook JSON silently (mid-May 2026). All 3+ projects had frozen memory for weeks. After any Claude Code version update, verify hook input field names against current docs. `sidecar-capture` now reads `last_assistant_message`; if Claude Code changes the API again, this will break silently — always test hook field presence after upgrades.
- **PF-007**: Source is `scripts/hooks/`; installed is `~/.devflow/scripts/hooks/`. Editing installed copies creates repo divergence and the changes are overwritten on next `devflow init`. Always source-first.
- **set -e / no-abort discipline** — `sidecar-capture` and `sidecar-evaluate` use `set -e`. However, `session-start-context` intentionally omits `set -e` because its three sections are independent — a failure in Section 1.5 must not prevent Section 2 from running. Never add `set -e` to `session-start-context`.
- **Background session guards** — all three hooks check `DEVFLOW_BG_UPDATER`, `DEVFLOW_BG_LEARNER`, `DEVFLOW_BG_KNOWLEDGE_REFRESH` env vars at the top and exit immediately to prevent feedback loops when the hook fires inside a background agent's subprocess.
- **Atomic writes everywhere** — all marker and state file writes use `tmp.$$` (PID-unique) + atomic `mv`. The `json-helper.cjs` uses `writeExclusive` (O_EXCL flag) for temp files to prevent TOCTOU symlink attacks.
- **Legacy `memory.json` marker** — the processor must also check for legacy `.devflow/sidecar/memory.json` (no session suffix) alongside the newer `memory.{session}.json` format for backward compatibility during transitions.
- **`feature-knowledge.cjs` uses `execFileSync` with array args** — never string-interpolate `lastUpdated` or worktree paths into shell strings. The module explicitly avoids shell injection via array arguments.

## Key Files

- `scripts/hooks/sidecar-capture` — Stop hook; queue append + memory marker write (120s throttle)
- `scripts/hooks/sidecar-evaluate` — SessionEnd hook; orchestrator sourcing eval-* modules
- `scripts/hooks/sidecar-recover` — stale `.processing` recovery helper; per-type thresholds
- `scripts/hooks/session-start-context` — SessionStart hook; recover → collect → emit directive
- `scripts/hooks/json-helper.cjs` — plumbing ops: `merge-observation`, `decisions-append`, atomic writes
- `scripts/hooks/lib/transcript-filter.cjs` — two-channel filter: USER_SIGNALS + DIALOG_PAIRS
- `scripts/hooks/lib/staleness.cjs` — annotates log entries with `mayBeStale` based on file existence
- `scripts/hooks/lib/feature-knowledge.cjs` — KB index, staleness checks, `updateIndex`, slug validation
- `scripts/hooks/lib/decisions-index.cjs` — compact decisions index with D-A filter for orchestrators
- `shared/skills/sidecar/SKILL.md` — full processor spec: claim, heartbeat, task types, error discipline

## Related

- **PF-006** (`.devflow/decisions/pitfalls.md`) — Claude Code Stop hook API changed silently; `response_text` → `last_assistant_message`. Defense: verify hook field names after every Claude Code update.
- **PF-007** (`.devflow/decisions/pitfalls.md`) — Edit source hooks (`scripts/hooks/`), never installed copies (`~/.devflow/scripts/hooks/`).
- **KB: cli-rules** (`.devflow/features/cli-rules/KNOWLEDGE.md`) — covers `src/cli/commands/` and `src/cli/utils/`, including the `devflow decisions` CLI which manages the decisions feature toggle and config surfaced here.
