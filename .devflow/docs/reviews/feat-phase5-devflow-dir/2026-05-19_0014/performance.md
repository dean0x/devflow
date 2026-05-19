# Performance Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Sequential `mkdir` calls in `createDocsStructure`** - `src/cli/utils/post-install.ts:509-511`
**Confidence**: 85%
- Problem: Three independent `fs.mkdir` calls are awaited sequentially. The migration code (`migrations.ts:284-291`) was parallelized with `Promise.all` in this same PR, but `createDocsStructure` was not. Each `mkdir -p` is an independent I/O operation that can run concurrently. On network-mounted home directories or high-latency filesystems this serialization adds measurable wall-clock time.
- Fix:
```typescript
await Promise.all([
  fs.mkdir(path.join(docsDir, 'status', 'compact'), { recursive: true }),
  fs.mkdir(path.join(docsDir, 'reviews'), { recursive: true }),
  fs.mkdir(path.join(docsDir, 'releases'), { recursive: true }),
]);
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`moveFile` calls `mkdir` on every invocation even when batched** - `src/cli/utils/migrations.ts:20` (Confidence: 65%) -- When `Promise.all` fires 26 parallel `moveFile` calls, many share the same parent directory (e.g. all `decisions/*` files create `.devflow/decisions/`). Each call independently runs `fs.mkdir(path.dirname(dest), { recursive: true })`. On local SSD this is negligible; on high-latency storage (NFS, network mounts) the redundant syscalls could add up. Could be mitigated by pre-creating known target directories (which is already done in step 1) and removing the mkdir from moveFile, but the current approach is correct and safe -- just slightly wasteful.

- **`getDevflowGitignoreContent` returns a new string on every call** - `src/cli/utils/project-paths.ts:289` (Confidence: 60%) -- The function constructs a multi-line template literal each time it is called. In practice it is called at most once per migration run so the overhead is negligible, but if future code paths call it in a loop, a module-level constant would be cheaper. Not actionable today.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Performance Assessment

This PR is net-positive for performance. Key improvements introduced:

1. **Fast-path guard in `ensure-devflow-init`** (`scripts/hooks/ensure-devflow-init:12-18`): Short-circuits the entire init function when all 6 subdirectories and the `.gitignore-configured` marker already exist. This eliminates 6 `mkdir -p` no-ops and the gitignore heredoc write on every `sidecar-capture`, `sidecar-dispatch`, and `pre-compact-memory` invocation -- a hot path that fires on every assistant turn. Good use of `-d` and `-f` tests as a fast-path guard.

2. **Parallel `mkdir` creation** (`src/cli/utils/migrations.ts:284-291`): Six sequential `await fs.mkdir()` calls replaced with `Promise.all`. All directories are independent -- correct parallelization.

3. **Parallel `memMap` moves** (`src/cli/utils/migrations.ts:325`): 26 independent `moveFile` calls batched into a single `Promise.all`. Significant wall-clock improvement on projects with many files to migrate.

4. **Parallel `moveDirContents`** (`src/cli/utils/migrations.ts:51-55`): The for-loop with sequential `await moveFile` replaced with `Promise.all` over filtered entries. Correct -- entries within a source directory are independent.

5. **TOCTOU fix in `moveFile`** (`src/cli/utils/migrations.ts:18-35`): Eliminates two `access()` calls before `rename()`, reducing total syscalls from 3+ to 1 in the common case. Also closes a race condition where the file could appear/disappear between `access` and `rename`.

6. **DRY gitignore content** (`getDevflowGitignoreContent()`): Eliminates a duplicated 46-line constant in `migrations.ts` by importing from `project-paths`. No performance impact but eliminates a maintenance hazard that could lead to gitignore drift.

7. **Derived skip set** (`src/cli/utils/migrations.ts:344-347`): `memSkipFiles` is computed from `memMap` keys, so adding new mapped entries no longer requires manually duplicating them in the skip set. Set construction cost is O(n) for n~30 entries -- negligible.

The single blocking MEDIUM is a consistency issue: the same PR parallelized `mkdir` in migrations but missed the identical pattern in `createDocsStructure`. Worth fixing for consistency, though the practical impact is small.
