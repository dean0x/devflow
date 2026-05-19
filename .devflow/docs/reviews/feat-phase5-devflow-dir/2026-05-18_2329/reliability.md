# Reliability Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-18

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Migration `memoryDir` context resolves to new path before consolidation runs** - `src/cli/utils/migrations.ts:689`
**Confidence**: 82%
- Problem: `runPerProjectMigration` constructs `memoryDir` via `getMemoryDir(projectRoot)` which now returns `.devflow/memory/` (the new layout). The older purge migrations (`purge-legacy-knowledge-v2`, `purge-legacy-knowledge-v3`) receive this as `ctx.memoryDir`. While the purge functions were updated to use `projectRoot` when available (via the `getDecisionsDir(projectRoot)` codepath), the `purgeLegacyDecisionsEntries` function still uses `memoryDir` directly for the orphan `PROJECT-PATTERNS.md` cleanup at line 188: `path.join(memoryDir, 'PROJECT-PATTERNS.md')`. On an upgrading project where the consolidation migration has NOT yet run (it is last in the list), this constructs `.devflow/memory/PROJECT-PATTERNS.md` instead of `.memory/PROJECT-PATTERNS.md`. The file silently fails to be found (non-fatal), but the orphan is never cleaned up.
- Fix: Either (a) use `projectRoot` to construct the path when available: `const projectPatternsPath = projectRoot ? path.join(projectRoot, '.memory', 'PROJECT-PATTERNS.md') : path.join(memoryDir, 'PROJECT-PATTERNS.md');`, or (b) move the orphan cleanup into the consolidation migration itself where the old `.memory/` path is still available.

### MEDIUM

**Learning lock placed in `.devflow/memory/` instead of `.devflow/learning/`** - `src/cli/commands/learn.ts:378`
**Confidence**: 85%
- Problem: The learning lock directory is constructed as `path.join(memoryDir, '.learning.lock')` which resolves to `.devflow/memory/.learning.lock`. All other learning files now live under `.devflow/learning/`. The `.devflow/.gitignore` lists `learning/.learning.lock/` as gitignored (line 12), but the actual lock is under `memory/` (which is blanket-gitignored anyway, so no functional breakage). However, this creates a consistency gap: the learning lock is the only learning artifact not in the learning directory. If `memory/` blanket-gitignore is ever refined, this lock would be exposed. Additionally, the `.devflow/.gitignore` entry `learning/.learning.lock/` is dead (nothing creates a lock there).
- Fix: Add `getLearningLockDir` to the `project-paths` modules returning `.devflow/learning/.learning.lock`, and use it in `learn.ts` line 378.

**Stale JSDoc comment references `.memory/.decisions.lock`** - `scripts/hooks/lib/feature-knowledge.cjs:306`
**Confidence**: 80%
- Problem: Comment says "Follows the same pattern as .memory/.decisions.lock" but the lock is now at `.devflow/decisions/.decisions.lock`. Stale comments erode trust in documentation and make debugging harder.
- Fix: Update the comment to reference `.devflow/decisions/.decisions.lock`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`ensure-devflow-init` features/index.json bootstrap is not atomic** - `scripts/hooks/ensure-devflow-init:23-24`
**Confidence**: 80%
- Problem: The `printf '{"version":1,"features":{}}' > "$_DEVFLOW_DIR/features/index.json"` write is not atomic. If two concurrent sessions race past the `[ ! -f ]` guard, one could truncate the file while the other is writing. The practical risk is low (deterministic content), but all other write paths in the codebase use atomic temp+mv patterns.
- Fix: Write to a temp file and `mv` it into place, or use a simple `[ ! -f ] && printf ... > tmp && mv tmp target` pattern consistent with the sidecar-capture atomic writes.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`moveFile` TOCTOU between access check and rename** - `src/cli/utils/migrations.ts:17-23` (Confidence: 65%) -- The access-then-rename sequence is not atomic; a concurrent process could delete the source between checks. The idempotent design makes this tolerable for a one-shot migration, but a try-rename-then-catch-ENOENT pattern would be more robust.

- **MEMORY_SKIP_FILES set duplicates explicit memMap entries** - `src/cli/utils/migrations.ts:106-144` (Confidence: 70%) -- The skip set must stay in sync with the memMap entries manually. If a future change adds a new file to memMap but forgets to add it to the skip set, it would be moved twice (once by the map, then again by the catch-all into memory/). Consider deriving the skip set programmatically from the memMap keys.

- **`decisions --reset` removes entire decisions directory including committed files** - `src/cli/commands/decisions.ts:452` (Confidence: 75%) -- `fs.rm(getDecisionsDir(...), { recursive: true })` removes `.devflow/decisions/` which now contains `decisions.md` and `pitfalls.md` (committed to git). Previous layout had these under `.memory/decisions/` which was fully gitignored. The confirmation prompt guards against accidental invocation, but the blast radius has increased.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The path consolidation is well-executed: centralized path modules are in sync (CJS/TS parity verified), the migration is idempotent and resumable, lock patterns carry correct timeout bounds, and the gitignore coverage is thorough. The blocking HIGH issue (orphan cleanup using wrong path) has limited practical impact (the file is a v1 artifact that may not exist on most installs) but represents a verifiable bug in the migration logic. The learning lock location inconsistency should be addressed to prevent future gitignore drift. Note: this PR adds migration code for a directory rename refactor -- the PR description frames this as intentional given the scope of the restructuring. (Context: ADR-001 advises clean-break philosophy for devflow refactors; PF-001 warns against unverified migration code. The migration here moves user data, not adding backward-compat shims, which is a distinct concern from PF-001's area.)
