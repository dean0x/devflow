# Regression Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Gitignore entry `learning/.learning.lock/` targets a non-existent path** - `scripts/hooks/lib/project-paths.cjs:298`, `src/cli/utils/project-paths.ts:301`, `scripts/hooks/ensure-devflow-init:52`
**Confidence**: 82%
- Problem: The `.devflow/.gitignore` contains the entry `learning/.learning.lock/` which would match `.devflow/learning/.learning.lock/`. However, the actual learning lock directory is at `.devflow/memory/.learning.lock` (as defined by `getLearningLockDir()`). The learning lock is already covered by the `memory/` gitignore entry, making `learning/.learning.lock/` a dead entry. This pre-dates this PR (present in the base branch) and has no functional impact because the `memory/` wildcard already covers the lock directory.
- Fix: Remove `learning/.learning.lock/` from the gitignore content in all three copies (CJS, TS, shell heredoc) since it targets a path that does not exist. The lock at `.devflow/memory/.learning.lock` is already covered by the `memory/` entry.

## Suggestions (Lower Confidence)

- **Test comment references old constant name** - `tests/migrations.test.ts:768` (Confidence: 65%) -- Comment says `MEMORY_SKIP_FILES` but the constant was renamed to `MEMORY_LEGACY_SKIP_FILES`. Non-functional but may confuse future readers.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Analysis

This PR consolidates runtime and documentation directories under a unified `.devflow/` root. The regression analysis covered all four regression categories:

### 1. Lost Functionality
No exports were removed. No CLI options were removed. The `MEMORY_SKIP_FILES` constant was renamed to `MEMORY_LEGACY_SKIP_FILES` and narrowed in scope (8 truly-legacy entries only), with the full skip set now derived from `memMap` keys at the call site. This is an improvement -- adding a new `memMap` entry automatically excludes it from the catch-all pass. No consumers were broken by this rename since it was a module-private constant.

### 2. Broken Behavior
- `moveFile` TOCTOU fix: The old pattern (`access(src)` + `access(dest)` + `rename`) was replaced with direct `rename()` handling ENOENT/EEXIST from the syscall. This is strictly better -- same semantics, no race window.
- `moveDirContents` parallelization: Sequential `for` loop replaced with `Promise.all`. Since entries are independent and `moveFile` is idempotent, this is safe.
- `memMap` moves parallelized: Same analysis -- all independent targets, idempotent moves.
- `mkdir` calls parallelized: Six independent `mkdir -p` calls. Safe.
- `ensure_docs_dir()` fix: The `$1` parameter was restored (dropped in an earlier commit, fixed in follow-up commit d8aa459). Verified correct.
- `decisions-append` path derivation: Changed from `memoryDir = path.dirname(decisionsDir)` to `devflowDir = path.dirname(decisionsDir)` with `projectRoot = path.dirname(devflowDir)`. Given the new path structure (`.devflow/decisions/decisions.md`), this correctly derives the project root as two levels up from the decisions dir. The `getDecisionsLockDir(projectRoot)` call then resolves to `.devflow/decisions/.decisions.lock`. Correct.

### 3. Intent vs Reality
The PR description states "Consolidates Devflow runtime and documentation directories under a unified `.devflow/` root directory." The implementation matches -- all path changes consistently move from `.memory/`, `.features/`, `.docs/` to `.devflow/memory/`, `.devflow/features/`, `.devflow/docs/`. The gitignore DRY violation fix (extracting `getDevflowGitignoreContent()`) is a bonus improvement. All three copies (CJS, TS, shell heredoc) are verified to be in sync. Applies ADR-001 (clean break philosophy -- migration code moves data, no backward-compat shims).

### 4. Incomplete Migrations
- `getLearningLockDir()`: Centralized getter added to both CJS and TS modules. All call sites in `learn.ts` and `json-helper.cjs` now use the getter instead of inline `path.join(getMemoryDir(cwd), '.learning.lock')`. Verified no remaining inline constructions.
- `getDevflowGitignoreContent()`: Extracted to both CJS and TS modules. `migrations.ts` now imports and calls this function. Shell heredoc carries a canonical-source comment. No inline copy remains.
- CJS/TS parity tests updated to include `getLearningLockDir`.
- New migration tests (rename-kb + consolidate-to-devflow) provide comprehensive coverage of the migration logic including idempotency, partial state, no-op cases, and .gitignore cleanup.
- `legacy-decisions-purge.ts` correctly handles both old (`.memory/PROJECT-PATTERNS.md`) and new (`.devflow/memory/PROJECT-PATTERNS.md`) paths for the orphan cleanup.
- Comment and JSDoc updates throughout are consistent with the new directory structure.

No regressions detected. The changes are well-tested, idempotent, and maintain all existing functionality while consolidating paths under `.devflow/`. Avoids PF-001 (no unnecessary backward-compat layer -- uses clean migration approach).
