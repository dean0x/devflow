# Complexity Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-18

## Issues in Your Changes (BLOCKING)

### HIGH

**Triple-duplicated .devflow/.gitignore content** - `scripts/hooks/ensure-devflow-init:29-76`, `src/cli/utils/migrations.ts:57-103`, `.devflow/.gitignore:1-46`
**Confidence**: 90%
- Problem: The canonical `.devflow/.gitignore` content is defined identically in three locations: (1) the committed `.devflow/.gitignore` file, (2) the `DEVFLOW_GITIGNORE_CONTENT` template string in `migrations.ts`, and (3) the heredoc in `ensure-devflow-init`. Any change to the transient-file list requires updating all three in lockstep, which is error-prone and violates single-source-of-truth. This is a new complexity introduced by this PR -- the old layout had `.gitignore` managed in one place.
- Fix: Define the canonical content in `project-paths.cjs` (e.g. `getDevflowGitignoreContent()`) and have both `ensure-devflow-init` and `migrations.ts` consume from it. The committed `.devflow/.gitignore` can remain as-is (it is the seed for new projects), but `ensure-devflow-init` and the migration should both source from a single programmatic definition. Alternatively, have `ensure-devflow-init` read the committed file directly rather than embedding a heredoc copy.

### MEDIUM

**Dual-module duplication: project-paths.cjs (323 lines) mirrors project-paths.ts (272 lines)** - `scripts/hooks/lib/project-paths.cjs`, `src/cli/utils/project-paths.ts`
**Confidence**: 85%
- Problem: The two modules contain 40+ identical functions that must be kept in manual sync. The header comments warn "CJS COUNTERPART ... must mirror this file exactly" and "TS COUNTERPART ... must mirror this file exactly", but there is no automated enforcement. If a new path function is added to one and forgotten in the other, hooks and CLI will disagree on file locations at runtime. This is an inherent complexity cost of the CJS/TS split that should be acknowledged and mitigated.
- Fix: Add a build-time or CI check that verifies both modules export the same function names (a simple script that diffs the export lists). Alternatively, generate the CJS module from the TS source at build time. This does not block the PR but will become a maintenance burden as path functions are added over time.

**MEMORY_SKIP_FILES set duplicates memMap keys** - `src/cli/utils/migrations.ts:106-144`
**Confidence**: 82%
- Problem: The `MEMORY_SKIP_FILES` set (39 entries) contains all the filenames from `memMap` (29 entries) plus 8 legacy V1 filenames. The `memMap` keys and the skip-set entries must stay in sync -- if a new mapped move is added to `memMap` but not added to `MEMORY_SKIP_FILES`, the catch-all `moveDirContents` on line 406 will attempt to move it a second time (to `memory/` instead of its correct destination). The comment on line 115 acknowledges this ("Explicit files handled by mapped moves below -- exclude from catch-all") but the coupling is implicit and fragile.
- Fix: Derive `MEMORY_SKIP_FILES` from `memMap` programmatically:
  ```typescript
  const MEMORY_SKIP_FILES = new Set([
    // Legacy V1 files that must NOT be migrated
    'knowledge', 'short', 'index.md', 'candidates.json',
    '.knowledge-usage.json', '.working-memory-last-trigger',
    '.working-memory-update.log', '.gitignore-configured',
    // Auto-derived from explicit memMap moves
    ...memMap.map(([name]) => name),
  ]);
  ```
  This eliminates the manual sync requirement between the two data structures.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**MIGRATION_CONSOLIDATE_TO_DEVFLOW run handler is 116 lines with 7 sequential steps** - `src/cli/utils/migrations.ts:338-453`
**Confidence**: 80%
- Problem: The `run` function for the consolidation migration spans 116 lines with 7 numbered steps (create dirs, mapped moves, sidecar move, decisions move, catch-all, features move, docs move, gitignore creation, gitignore cleanup, old dir removal). While each step is individually simple, the function as a whole exceeds the 50-line warning threshold. The sequential step structure is easy to follow, but the large memMap literal (29 entries) dominates the function body. Note: this is migration code that runs once per project, so the maintainability cost is limited -- it does not need to be refactored to the same standard as frequently-touched code. Acknowledges applies ADR-001 (clean break philosophy) -- the migration itself is the one-time cleanup item that ADR-001 explicitly allows.
- Fix: Extract the `memMap` definition to a module-level constant (like `MEMORY_SKIP_FILES` already is), which would reduce the `run` body to ~70 lines. The 7-step structure with comments is already well-organized -- no further decomposition needed for one-shot migration code.

## Pre-existing Issues (Not Blocking)

### HIGH

**learn.ts --reset handler is 156 lines with 6+ nesting levels** - `src/cli/commands/learn.ts:376-531`
**Confidence**: 92%
- Problem: The `--reset` handler spans 156 lines within a single `if (options.reset)` block, with nesting reaching 9 indentation levels (18 spaces at deepest). It handles lock acquisition, artifact inventory, confirmation prompt, artifact removal, transient file cleanup, sidecar cleanup, and config migration -- all in one block. This predates this PR (the changes here are mechanical path substitutions only), but it is a significant complexity hotspot.
- Fix: Extract into sub-functions: `inventoryArtifacts()`, `confirmReset()`, `executeReset()`. This would reduce the handler to ~20 lines of orchestration.

**json-helper.cjs main switch block is 1,260 lines** - `scripts/hooks/json-helper.cjs:688-1947`
**Confidence**: 95%
- Problem: The `if (require.main === module)` block contains a massive switch statement with 30+ cases spanning over 1,200 lines. This is a pre-existing issue -- the PR changes here are only signature refactoring (`memoryDir` to `projectRoot`). The file is 1,947 lines total, well beyond the 500-line critical threshold.
- Fix: Split into domain-specific submodules (the `sidecar-ops.cjs` extraction pattern on line 691-696 is already the right direction -- extend it to learning, decisions, and reconcile operations).

### MEDIUM

**decisions.ts is 869 lines with sequentially-chained if-blocks** - `src/cli/commands/decisions.ts`
**Confidence**: 85%
- Problem: The command handler is a single `.action()` callback with 11 sequential `if (options.X)` blocks. Pre-existing structure; this PR only changed path construction. Each block is independently readable, but the monolithic handler makes navigation difficult.
- Fix: Extract each option handler into a named function (e.g., `handleDecisionsReset()`, `handleDecisionsReview()`).

## Suggestions (Lower Confidence)

- **process.cwd() called repeatedly instead of cached** - `src/cli/commands/learn.ts:424-432`, `src/cli/commands/decisions.ts:422-428` (Confidence: 65%) -- Several option handlers call `process.cwd()` multiple times within the same block rather than caching it in a local variable. The PR improved some of these (e.g., `const cwd = process.cwd()` on learn.ts:424) but the pattern is inconsistent across handlers.

- **ensure-devflow-init could validate $1 is an absolute path** - `scripts/hooks/ensure-devflow-init:8` (Confidence: 62%) -- The guard `[ -z "$1" ] && return 1` checks for empty but not for relative paths, which could create `.devflow/` in unexpected locations if a hook passes a relative path.

- **Migration helper functions could use project-paths getters** - `src/cli/utils/migrations.ts:348-353` (Confidence: 70%) -- The consolidation migration constructs `path.join(devflowDir, 'memory')` etc. directly rather than using the `getMemoryDir()` / `getSidecarDir()` functions from `project-paths.ts`, creating a minor inconsistency with the module's stated purpose as "single source of truth for path layout."

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | 2 | 1 | - |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR's primary contribution -- centralizing path construction into `project-paths.cjs` and `project-paths.ts` -- is a clear complexity *reduction*. The new modules themselves are low complexity (pure functions, no control flow, no state). The mechanical path substitutions across 120 files are straightforward and correct.

The blocking HIGH issue (triple-duplicated gitignore content) should be addressed before merge to prevent drift. The MEDIUM blocking issues (CJS/TS sync enforcement, MEMORY_SKIP_FILES derivation) are worth addressing but do not block merge.

The migration code (applies ADR-001) is appropriately one-shot and does not need the same decomposition standards as production paths. Pre-existing complexity in `learn.ts`, `decisions.ts`, and `json-helper.cjs` was not introduced by this PR and should be addressed in a separate cleanup pass.
