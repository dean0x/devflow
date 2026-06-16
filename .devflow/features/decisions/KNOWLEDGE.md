---
feature: decisions
name: Decisions & Pitfalls Ledger
description: "Use when working on the decisions/pitfalls pipeline, adding ops to json-helper.cjs, modifying render output, writing migrations, or modifying Dream SKILL behavior for decisions/curation. Keywords: decisions, pitfalls, ADR, ledger, assign-anchor, retire-anchor, render, dream-decisions, dream-curation, observations, decisions-log, decisions-ledger."
category: architecture
directories: [scripts/hooks, scripts/hooks/lib, src/cli/utils]
referencedFiles:
  - scripts/hooks/lib/decisions-format.cjs
  - scripts/hooks/lib/render-decisions.cjs
  - scripts/hooks/lib/decisions-index.cjs
  - scripts/hooks/lib/project-paths.cjs
  - scripts/hooks/lib/mkdir-lock.cjs
  - scripts/hooks/json-helper.cjs
  - scripts/hooks/dream-commit
  - src/cli/utils/decisions-ledger-migration.ts
  - src/cli/utils/observations.ts
  - shared/skills/dream-decisions/SKILL.md
  - shared/skills/dream-curation/SKILL.md
created: 2026-06-10
updated: 2026-06-16
---

# Decisions & Pitfalls Ledger

## Overview

The decisions & pitfalls ledger is a three-tier storage system where `decisions-ledger.jsonl` is the single source of truth for rendering, `decisions-log.jsonl` holds raw observation lifecycle state, and `decisions.md`/`pitfalls.md` are deterministic, active-only rendered views. All write operations flow through `json-helper.cjs` operations (`assign-anchor`, `retire-anchor`, `rotate-observations`) which own numbering, status transitions, and render triggering. The renderer (`render-decisions.cjs`) and format helpers (`decisions-format.cjs`) are kept deliberately separate: format can never drift between the add-path and the render-path because they share the exact same format functions.

The ledger lives in `.devflow/decisions/` alongside the raw log and archive. Only three files are committed to git: `decisions-ledger.jsonl`, `decisions.md`, and `pitfalls.md`. Everything else (log, archive, config, locks, usage state) is gitignored.

## System Context

**Purpose**: Capture architectural decisions (ADRs) and non-obvious failure modes (PFs) from development sessions. Surfaces them as `DECISIONS_CONTEXT` to all workflow commands so agents avoid re-discovering known patterns.

**Role in the larger system**: The Dream pipeline drives writes. `eval-decisions` (SessionEnd hook) emits a marker; the Dream agent at SessionStart claims it, calls `merge-observation` and `assign-anchor` via `json-helper.cjs`, then runs `dream-commit` to commit the ledger + rendered `.md`. Orchestrators (`/plan`, `/code-review`, `/resolve`) load a compact index via `decisions-index.cjs` and pass it as `DECISIONS_CONTEXT`; consumer agents use `devflow:apply-decisions` to read full bodies on demand.

**External dependencies**: `mkdir`-based locking (POSIX atomic), `git` for dream-commit safety rails, Node.js for all CJS helpers.

## Component Architecture

### Three-File Storage Split

| File | Committed | Purpose |
|---|---|---|
| `decisions-ledger.jsonl` | YES | Anchored rows only — the render source of truth |
| `decisions-log.jsonl` | NO | Raw observation lifecycle (observing → created) |
| `decisions-log.archive.jsonl` | NO | Rotated-out stale `observing` rows (>30 days old) |
| `decisions.md` | YES | Deterministic active-only render of ADR rows |
| `pitfalls.md` | YES | Deterministic active-only render of PF rows |

`decisions-ledger.jsonl` stores only rows with `anchor_id` set. `decisions-log.jsonl` stores all lifecycle rows; those promoted to anchored status are marked `status: 'created'` in the log but the canonical source is the ledger. The archive collects stale unanchored `observing` rows older than 30 days via `rotate-observations`.

### LearningObservation Schema (key fields)

The `LearningObservation` interface (canonical in `src/cli/utils/observations.ts`) extends the base observation fields with ledger-specific optional fields:

- `anchor_id` — stable ADR-NNN/PF-NNN ID, set once by `assign-anchor`, never recomputed
- `date` — YYYY-MM-DD, **decisions only** (pitfalls have no date — byte-compat contract)
- `decisions_status` — `'Accepted' | 'Active' | 'Deprecated' | 'Superseded' | 'Retired'`; distinct from `status` (observation lifecycle); omitted = active
- `amendments` — ordered array of `{date, note}` for ADR amendment history
- `raw_body` — verbatim `.md` body for migrated entries; when present the renderer emits it verbatim instead of re-formatting from `details`

### Format Authority: decisions-format.cjs

`decisions-format.cjs` is the **single source of truth** for all byte-compat output strings. It is imported by both `json-helper.cjs` (add-path via `assign-anchor`) and `render-decisions.cjs` (render-path), ensuring the format can never drift between them.

Key exported functions:
- `formatDecisionBody(row)` — formats from `details` string when `raw_body` absent; parses `context:`, `decision:`, `rationale:` segments
- `formatPitfallBody(row)` — formats from `details`; parses `area:`, `issue:`, `impact:`, `resolution:` segments
- `buildTldrLine(kind, rows)` — TL;DR comment line 1: `<!-- TL;DR: N {decisions|pitfalls}. Key: id1, id2 -->`; empty corpus = `Key: -->` (no trailing space)
- `initDecisionsContent(kind)` — initial file header with zero-corpus TL;DR

**Byte-compat asymmetry** (critical): decisions have `- **Date**: YYYY-MM-DD\n`; pitfalls have `- **Area**: ...\n` and NO Date line. This asymmetry is intentional and must be preserved — `assign-anchor` sets `date` only on decisions, not pitfalls.

### Renderer: render-decisions.cjs

Pure, idempotent, clock-free render function. Takes all ledger rows (unfiltered) and produces complete file content.

Filtering rules:
- `row.type` must match kind (`decision` → `decisions.md`, `pitfall` → `pitfalls.md`)
- `row.anchor_id` must be set (unanchored `observing` rows excluded)
- `decisions_status` not in `{Deprecated, Superseded, Retired}` (active only)

Per-row content: if `raw_body` present → emit verbatim (migrated entries); otherwise → call `formatDecisionBody`/`formatPitfallBody` from `decisions-format.cjs`.

Standalone CLI: `render-decisions.cjs render <worktree>` (takes lock before writing) and `render-decisions.cjs --check <worktree>` (diff without writing, exits 1 on drift).

Lock-free helper `renderAndWriteAll(worktreePath, rows)` is called by callers that already hold `.decisions.lock` (`assign-anchor`, `retire-anchor`, and the migration). This prevents double-lock deadlock.

## Component Interactions

### json-helper.cjs Operations

Three ledger-mutating operations (all run from `process.cwd()` as project root):

**`assign-anchor <type> <obs_id>`** — The primary add-path:
1. Acquires `.decisions.lock` (30s timeout, 60s stale-break)
2. Reads ledger to compute `max+1` over ALL anchored rows (including Retired) — ADR and PF sequences are independent
3. Zero-pads to 3 digits: ADR-001, ADR-002, ..., ADR-999
4. Reads the log row by `obs_id`; exits 1 if absent
5. Builds anchored ledger row (copies log row + adds `anchor_id`, `decisions_status`, and `date` for decisions)
6. Atomically appends row to ledger (temp+rename)
7. Marks log row `status: 'created'`
8. Registers entry in `.decisions-usage.json` (initial `cites: 0`)
9. Calls `renderAndWriteAll` (lock-free — already holds lock)
10. Releases lock; prints anchor ID to stdout

**`retire-anchor <anchor_id> <status>`** — Status flip:
- `status` must be `Deprecated | Superseded | Retired`
- Acquires `.decisions.lock`, flips `decisions_status` on the ledger row, re-renders both `.md`
- Idempotent (same status twice is safe)
- The entry vanishes from rendered `.md` but survives in the ledger — numbers are never reused

**`rotate-observations [<log>] [<archive>]`** — Stale log cleanup:
- Runs under `.observations.lock` (NOT `.decisions.lock`)
- Moves `status === 'observing'` rows with no `anchor_id` older than 30 days to archive
- Never touches anchored or `created`/`ready` rows

**`merge-observation <log> <newObsJson>`** — Observation upsert:
- ID-keyed: reinforces existing obs (increments count, merges evidence) or inserts new
- Caller-locked: the Dream agent acquires `.observations.lock` externally before calling this
- Passthrough for ledger fields: `anchor_id`, `date`, `decisions_status`, `amendments`, `raw_body`

**`count-active <worktree> <type>`** — Reads ledger; returns count of active anchored rows. Unlike `assign-anchor`, `retire-anchor`, and `rotate-observations` (which derive project root from `process.cwd()`), `count-active` requires the worktree path as `args[0]` and the type as `args[1]` — always call as `node "$HOME/.devflow/scripts/hooks/json-helper.cjs" count-active "$(pwd)" "decision"` or `"$(pwd)" "pitfall"`. The `devflow:dream-curation` SKILL.md example shows `count-active "decision"` (single arg), which would resolve `"decision"` as a filesystem path — use `"$(pwd)"` as the first arg in practice.

### Locking Discipline (ADR-017)

Two independent lock domains:

| Lock | Path | Held by |
|---|---|---|
| `.decisions.lock` | `.devflow/decisions/.decisions.lock` | `assign-anchor`, `retire-anchor`, `render` CLI |
| `.observations.lock` | `.devflow/dream/.observations.lock` | `rotate-observations`, Dream agent (wraps `merge-observation`) |

**Critical rule**: never hold both locks simultaneously. If both are needed, take `.decisions.lock` as outer. In practice: `assign-anchor` never needs `.observations.lock`; `rotate-observations` never needs `.decisions.lock`. The Dream agent holds `.observations.lock` around `merge-observation` calls, then releases it before calling `assign-anchor` (which self-locks `.decisions.lock`).

Lock implementation: POSIX `mkdir` atomic — `mkdir-lock.cjs` exports `acquireMkdirLock(lockDir, timeoutMs=30000, staleMs=60000)` and `releaseLock(lockDir)`. Stale lock break at 60 seconds.

### decisions-index.cjs

Parses `decisions.md` and `pitfalls.md` to produce a compact index string for `DECISIONS_CONTEXT`. Reads the already-rendered `.md` files (which contain only active entries) — no in-memory filtering needed. Output format: ID, title truncated to 60 chars, `[status]` tag, plus area suffix for pitfalls. Used by orchestrators via `node scripts/hooks/lib/decisions-index.cjs index <worktree>`.

## Integration Patterns

### Dream Pipeline Integration

The Dream SKILL for decisions (`shared/skills/dream-decisions/SKILL.md`) defines the add-path procedure:
1. Read `decisions-log.jsonl` for dedup context
2. Apply LLM judgment with the **abstain-by-default creation bar** (most sessions produce nothing)
3. **ADR-XOR-PF**: one incident → exactly one of ADR or PF, never both
4. **Dedup first**: if a matching obs exists in the log (any status including Retired), reinforce via `merge-observation` reusing its `obs_` id
5. Acquire `.observations.lock` externally, call `merge-observation`, release
6. If promoting: call `assign-anchor` (self-locks `.decisions.lock`)
7. After lock released: call `dream-commit decisions "add <anchor_id>" <session_id>`

The Dream SKILL for curation (`shared/skills/dream-curation/SKILL.md`) defines periodic housekeeping:
- Runs `rotate-observations` first (under `.observations.lock`)
- LLM selects up to 5 entries to retire per curation run (7-day protection window)
- Calls `retire-anchor` once per entry (each self-locks `.decisions.lock` — do NOT hold lock across multiple calls, that would deadlock)
- Calls `dream-commit curation "<action>" <session_id>` after all retirements

**Curation depends on decisions** (PR #244): `eval-curation` is now gated by `DECISIONS_ENABLED` — it returns immediately (using `return 0`, not `exit`) without touching `.curation-last` when decisions is disabled. `dream-collect-tasks` Pass 1 also sweeps curation markers when decisions is disabled. This prevents: (a) stray curation markers triggering an opus spawn when decisions is off, and (b) disabling decisions burning the 7-day curation suppression window on re-enable.

### dream-commit

Shell helper that stages only the allowed paths and commits with structured trailers:
```
chore(dream): <action>

Dream-Task: <task>
Dream-Session: <session_id>
Co-Authored-By: Devflow Dream <dream@devflow.local>
```

Staged paths depend on task: decisions/curation tasks stage `decisions-ledger.jsonl`, `decisions.md`, `pitfalls.md`; knowledge task additionally stages `features/index.json` and all `KNOWLEDGE.md` files.

Safety rails: skips if `autoCommit: false` in dream config (default ON), mid-rebase, mid-merge, mid-cherry-pick, or detached HEAD. Best-effort: git commit failure exits 0 (never blocks session).

The `autoCommit` gate is read from `.devflow/dream/config.json` — the `DreamConfig` interface (`src/cli/utils/dream-config.ts`) now has four fields: `{memory, decisions, knowledge, autoCommit}` (default all `true`). Toggling auto-commit per-project requires editing `config.json` directly or implementing a CLI toggle; `devflow decisions --status` reports the current `autoCommit` value. `dream-commit` reads `autoCommit` via jq (preferred) or `node json-helper.cjs get-field-file` as fallback — both accept the file path directly (no shell interpolation of file content).

## Constraints

**Render invariant**: `decisions.md` and `pitfalls.md` are always the output of `renderAndWriteAll`. Any manual edit will be silently overwritten on the next `assign-anchor` or `retire-anchor` call.

**Number reservation**: anchor IDs once assigned (including Retired) are never reused. `nextAnchorFromLedger` scans ALL anchored rows including retired ones for the current max.

**Gitignore policy** (in `.devflow/.gitignore`): ignore-by-default with explicit re-includes. Only `decisions-ledger.jsonl`, `decisions.md`, `pitfalls.md`, `features/index.json`, and `features/*/KNOWLEDGE.md` are committed.

## Anti-Patterns

**Hand-editing decisions.md or pitfalls.md**: Both files are generated. Any edit will be silently overwritten on the next `assign-anchor` or `retire-anchor` call. Use `retire-anchor` to remove entries; entries can be re-activated by editing `decisions-ledger.jsonl` directly and re-rendering.

**Calling decisions-append**: This operation was removed. All numbering is owned exclusively by `assign-anchor`.

**Holding .decisions.lock across multiple retire-anchor calls**: Each `retire-anchor` invocation self-acquires `.decisions.lock`. Attempting to hold the lock externally across multiple calls deadlocks.

**Calling rotate-observations under .decisions.lock**: Violates ADR-017. `rotate-observations` uses `.observations.lock`. Never hold both locks simultaneously.

**Adding new format strings outside decisions-format.cjs**: Any format addition outside this module creates a drift risk between the add-path and render-path outputs.

**Using ~/ paths for the renderer in migration code**: The migration resolves `render-decisions.cjs` from the bundled package (`dist/utils/` → `../../scripts/hooks/lib/`) not from `~/.devflow/scripts/`. The installed copy may not exist at migration time (PF-007).

## Gotchas

**decisions_status vs status**: Two distinct fields. `status` = observation lifecycle (`observing | ready | created | deprecated`). `decisions_status` = rendered entry status (`Accepted | Active | Deprecated | Superseded | Retired`). Confusing them leads to entries incorrectly excluded from (or included in) the rendered output.

**Date field asymmetry**: `assign-anchor` sets `date` only for `type === 'decision'`. Pitfall rows must not have a `date` field — `formatPitfallBody` does not emit one, so a pitfall row with `date` set would silently be ignored by the renderer.

**TL;DR empty corpus**: `buildTldrLine` with no rows produces `Key: -->` (single space, no trailing content before `-->`). Any other spacing breaks the byte-compat contract that `initDecisionsContent` establishes.

**Idempotency path in migration**: `migrateDecisionsLedger` re-renders even when `newRowsAdded === 0` (if the existing ledger is non-empty). This heals crashes that happened between ledger write and `renderAndWriteAll`. A completely empty ledger with no new rows returns early without acquiring the lock.

**Lock timeout vs stale break**: `acquireMkdirLock` defaults to 30s timeout and 60s stale break. A lock older than 60 seconds is forcibly broken. This means a process holding the lock for longer than 60 seconds risks having it stolen.

**dream-commit stages only allowed paths**: `git add` is called explicitly on individual files — never `git add -A`. Changing a file outside the allowed paths requires adding it to the staging list in `dream-commit`.

**re-activating a retired entry**: `retire-anchor` only accepts retiring statuses. To re-activate, directly edit the `decisions_status` field in `decisions-ledger.jsonl` to `Accepted` or `Active`, then run `render-decisions.cjs render <worktree>`.

## Key Files

- `scripts/hooks/lib/decisions-format.cjs` — byte-compat format authority; single source of truth for all output strings
- `scripts/hooks/lib/render-decisions.cjs` — pure renderer; `renderDecisionsFile()` + `renderAndWriteAll()` + CLI; exports `parseLedger()`
- `scripts/hooks/json-helper.cjs` — all ledger-mutating ops: `assign-anchor`, `retire-anchor`, `rotate-observations`, `merge-observation`, `count-active`
- `scripts/hooks/lib/decisions-index.cjs` — compact index builder for `DECISIONS_CONTEXT`; CLI: `node decisions-index.cjs index <worktree>`
- `scripts/hooks/lib/project-paths.cjs` — path registry for all `.devflow/decisions/` file paths; CJS counterpart to `src/cli/utils/project-paths.ts`
- `scripts/hooks/lib/mkdir-lock.cjs` — POSIX mkdir-based lock helper
- `scripts/hooks/dream-commit` — attributable git commit helper for Dream maintenance tasks
- `src/cli/utils/decisions-ledger-migration.ts` — `decisions-ledger-unify-v1` migration; preserve-verbatim backfill from existing `.md` + log
- `src/cli/utils/observations.ts` — canonical `LearningObservation` interface and type guard
- `shared/skills/dream-decisions/SKILL.md` — Dream agent procedure for detection/promotion (abstain-by-default, ADR-XOR-PF, dedup)
- `shared/skills/dream-curation/SKILL.md` — Dream agent procedure for housekeeping (retire-by-status iron law, rotation wiring)

## Related

- ADR-008 — LLM-vs-plumbing: all ops in `json-helper.cjs` and `render-decisions.cjs` are deterministic plumbing; LLM judgment lives exclusively in the Dream SKILLs
- ADR-017 — Locking discipline: `.decisions.lock` and `.observations.lock` are independent domains; never hold both simultaneously
- ADR-001 — Clean-break philosophy: `decisions-ledger-unify-v1` is the explicitly approved data-preserving exception
- PF-007 — Edit `scripts/hooks/` + `shared/` source, not installed `~/.devflow`; `npm run build` + `devflow init` to deploy; migration resolves renderer from bundled package path
- PF-002/PF-004 — Migration skip-list + idempotency patterns
- PF-010 — Installer file-list drift
