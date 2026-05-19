# Complexity Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### HIGH

**MIGRATION_CONSOLIDATE_TO_DEVFLOW run function is 120+ lines with 7 sequential phases** - `src/cli/utils/migrations.ts:274-396`
**Confidence**: 85%
- Problem: The `consolidate-to-devflow-dir` migration's `run` function spans ~120 lines across 7 numbered phases (create dirs, explicit mapped moves, move sidecar, move decisions, catch-all, move features, move docs, create gitignore, clean gitignore, remove old dirs). While each phase is straightforward, the combined length pushes well past the 50-line warning threshold for function length. The cyclomatic complexity is low (mostly sequential), but the cognitive load of tracking what moves where across 26 memMap entries plus 3 moveDirContents calls plus gitignore operations is significant.
- Fix: Extract phases into named helper functions. The 26-entry `memMap` array (lines 294-323) and the gitignore cleanup (lines 363-381) are self-contained and could be separate functions like `buildMemoryMoveMap()` and `cleanStaleGitignoreEntries(projectRoot, staleEntries)`. This would bring the orchestrating `run` function under 50 lines while preserving the clear phase numbering as function calls.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**json-helper.cjs main switch statement exceeds 900 lines** - `scripts/hooks/json-helper.cjs:699-1920`
**Confidence**: 90%
- Problem: The `json-helper.cjs` main block is a single giant switch statement with 25+ case branches spanning ~1200 lines. This PR only touches 2 lines within it (the import addition at line 58 and the `decisions-append` variable rename at lines 1830-1831), but the file itself is the textbook definition of complexity debt. Each case is essentially an independent mini-program sharing only the entry-point dispatch. The `render-ready` case alone is ~270 lines (1214-1521) with 4 levels of nesting.
- Fix: This is not blocking for this PR. A future refactor could extract each case into its own module file (e.g., `lib/ops/render-ready.cjs`, `lib/ops/reconcile-manifest.cjs`) and reduce the switch to a dispatch table.

## Suggestions (Lower Confidence)

- **memMap could be a const object rather than inline array** - `src/cli/utils/migrations.ts:294-323` (Confidence: 65%) -- The 26-entry memMap array literal is defined inline within the run function. Extracting it as a module-level constant (like MEMORY_LEGACY_SKIP_FILES) would make the run function shorter and make the mapping discoverable/testable independently.

- **MEMORY_LEGACY_SKIP_FILES entries overlap with moveDirContents targets** - `src/cli/utils/migrations.ts:68-80` (Confidence: 70%) -- The skip list includes `.sidecar` and `decisions` which are handled by explicit `moveDirContents` calls. The comment explains this, but the dual-path handling (explicit moveDirContents + skip from catch-all) adds cognitive load. Consider adding a brief inline comment at the moveDirContents call sites referencing the skip list.

- **withDecisionsFiles has 5 parameters** - `src/cli/utils/legacy-decisions-purge.ts:108-113` (Confidence: 60%) -- The shared helper takes 4 explicit parameters plus uses closures. An options object would improve readability at call sites, though the function is internal and called only twice.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR consolidates directory structures under `.devflow/` with well-structured migration code. The `moveFile` and `moveDirContents` helpers are clean extractions with proper TOCTOU-safe error handling. The `pooled` concurrency limiter is a good pattern. The `MEMORY_LEGACY_SKIP_FILES` being derived from `memMap` keys (line 344-347) eliminates a manual-sync footgun -- good DRY application.

The one blocking HIGH is the consolidation migration's run function length. Each individual phase is simple, but 120+ lines in a single function crosses the maintainability threshold. The fix is mechanical (extract phases into named helpers) and low-risk. The `withDecisionsFiles` extraction in `legacy-decisions-purge.ts` is a good example of the pattern already applied in this PR -- the same approach would work for the migration function.

The pre-existing `json-helper.cjs` complexity is noted for awareness but is firmly not blocking (applies ADR-001 -- this PR's scope is directory consolidation, not hook refactoring).

Test coverage is thorough: 18 test cases for the new consolidation migration covering happy path, idempotency, partial state, empty source, gitignore cleanup, and the D37 edge case. The `reportMigrationResult` tests are well-factored with the `makeLogger` pattern.
