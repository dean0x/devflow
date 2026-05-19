# Resolution Summary

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19_0014
**Review**: .docs/reviews/feat-phase5-devflow-dir/2026-05-19_0014
**Command**: /resolve

## Decisions Citations

- applies ADR-001 — batch-1 (migration code is the consolidation refactor itself, not backward-compat), batch-2 (phase helpers are internal quality, not new compat code)
- avoids PF-001 — batch-1 (no new migration compat layer added), batch-3 (fixes are isolated correctness, not migration scaffolding)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 22 |
| Fixed | 18 |
| False Positive | 0 |
| Deferred | 0 |
| Blocked | 0 |
| Pre-existing (noted) | 4 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| moveFile EEXIST unreachable on POSIX (CRITICAL) | migrations.ts:20-43 | 8faf208 |
| moveFile ENOTEMPTY unhandled (HIGH) | migrations.ts:35 | 8faf208 |
| rename-kb TOCTOU access+rename pattern (MEDIUM) | migrations.ts:235-246 | 8faf208 |
| Stale info message `.features/` → `.devflow/features/` (MEDIUM) | migrations.ts:240 | 8faf208 |
| MEMORY_LEGACY_SKIP_FILES `as const` type safety (MEDIUM) | migrations.ts:77-89 | 8faf208 |
| ensure-devflow-init non-atomic .gitignore write (MEDIUM) | ensure-devflow-init:39-88 | fc17a87 |
| Sequential mkdir in createDocsStructure (MEDIUM) | post-install.ts:509-511 | fc17a87 |
| JSDoc inconsistency in legacy-decisions-purge (MEDIUM) | legacy-decisions-purge.ts:149-173 | fc17a87 |
| Dead gitignore entry `learning/.learning.lock/` (MEDIUM) | project-paths.cjs/ts + ensure-devflow-init | fc17a87 |
| Asymmetric cross-reference comments (MEDIUM) | project-paths.ts:287 + project-paths.cjs:284 | fc17a87 |
| TOCTOU in .gitignore creation (migration step 5) (MEDIUM) | migrations.ts (step 5 helper) | f90251d |
| Non-atomic .gitignore writes (migration step 6) (MEDIUM) | migrations.ts (step 6 helper) | f90251d |
| 120+ line run function — extracted phase helpers (HIGH) | migrations.ts:284-406 | f90251d |
| Missing sidecar migration test (HIGH) | tests/migrations.test.ts | 802e722 |
| Missing projectRoot purge test (HIGH) | tests/legacy-decisions-purge.test.ts | 802e722 |
| Missing catch-all moveDirContents test (MEDIUM) | tests/migrations.test.ts | 802e722 |
| Missing getDevflowGitignoreContent parity test (MEDIUM) | tests/project-paths.test.ts | 802e722 |
| Missing migration ordering + registration tests (MEDIUM) | tests/migrations.test.ts | 802e722 |

## Pre-existing Issues (Not Fixed)
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| `memoryDir` parameter name misleading in new layout | legacy-decisions-purge.ts:153-156 | Fallback path never taken when `projectRoot` provided; interface is confusing but functionally correct |
| json-helper.cjs switch statement 900+ lines | json-helper.cjs:699-1920 | Out of scope for this PR; only 2 lines touched |
| Three-copy gitignore (CJS + TS + shell heredoc) | project-paths.cjs/ts + ensure-devflow-init | Improved from 3 implicit copies to documented mirrors with canonical direction; shell heredoc copy is a pragmatic tradeoff (must work without Node) |
| rename-kb migration ordering vs getFeaturesDir() | migrations.ts:219-246 | Pre-existing: rename runs before consolidation, so getFeaturesDir() returns .devflow/features/ which doesn't exist yet; ENOENT silently no-ops; consolidation moves files as-is |
