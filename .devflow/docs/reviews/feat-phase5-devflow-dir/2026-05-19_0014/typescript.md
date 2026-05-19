# TypeScript Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### CRITICAL

**`moveFile` EEXIST handler is unreachable on POSIX -- rename silently overwrites dest** - `src/cli/utils/migrations.ts:25`
**Confidence**: 95%
- Problem: The refactored `moveFile` removed the pre-rename `access(dest)` guard and now relies on `rename()` returning `EEXIST` to detect an existing destination. On POSIX systems (macOS, Linux), `fs.rename` for regular files **never** returns `EEXIST`; it silently overwrites the destination. This means when both source and destination files exist, the destination is clobbered instead of being preserved. The migration's idempotency and resumability contract ("skipping when dest already exists") is violated. In a partial-migration scenario where a user's newer `.devflow/` file already exists and the stale `.memory/` copy hasn't been cleaned, the stale content will overwrite the newer content.
- Impact: Data loss -- user's working memory or decisions files in `.devflow/` can be silently overwritten by stale `.memory/` copies during a resumed or re-run migration. While the migration tracker normally prevents re-runs, `rm ~/.devflow/migrations.json` (documented recovery step in CLAUDE.md for D37 edge case) forces a re-sweep that would trigger this.
- Fix: Re-add the destination existence check before `rename`, or use `link(src, dest)` which returns `EEXIST` on POSIX:
```typescript
async function moveFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    // link() is atomic and returns EEXIST on POSIX when dest already exists
    await fs.link(src, dest);
    await fs.unlink(src);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;    // src gone -- already moved or never existed
    if (code === 'EEXIST') return;    // dest already present -- idempotent skip
    // Cross-device: fall back to copy+delete (link doesn't work cross-device)
    if (code === 'EXDEV') {
      // For cross-device, check dest first to avoid overwrite
      try { await fs.access(dest); return; } catch { /* dest absent, proceed */ }
      await fs.cp(src, dest, { recursive: true });
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}
```
Alternatively, a simpler fix that preserves the current `rename` approach:
```typescript
async function moveFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  // Check dest first -- rename() silently overwrites on POSIX, so we must guard manually
  try { await fs.lstat(dest); return; } catch { /* dest absent, proceed */ }
  try {
    await fs.rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code === 'EXDEV') {
      await fs.cp(src, dest, { recursive: true });
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}
```
Note: The simpler fix re-introduces a narrow TOCTOU window, but the `link`-based approach is fully atomic. Given this is a one-time migration (not a hot path), the TOCTOU window is negligible and the simpler fix is acceptable.

### HIGH

**`moveFile` does not handle `ENOTEMPTY` for directory-to-directory renames** - `src/cli/utils/migrations.ts:17-34`
**Confidence**: 82%
- Problem: `moveFile` is called by `moveDirContents` which iterates all entries including subdirectories. If a destination directory already exists and is non-empty (e.g., from a partial migration), `fs.rename` returns `ENOTEMPTY` on POSIX -- an error code that is not handled. The error would propagate and crash the migration. The EXDEV fallback uses `fs.cp` with `{ recursive: true }` which would also fail if the dest directory has conflicting content.
- Impact: A partial migration that moved some files into a subdirectory, then failed, could not be resumed because the non-empty dest directory would cause an unhandled error. This would surface as a migration failure in `devflow init`.
- Fix: Add `ENOTEMPTY` handling alongside `EEXIST`:
```typescript
if (code === 'ENOENT') return;
if (code === 'EEXIST' || code === 'ENOTEMPTY') return;
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`MEMORY_LEGACY_SKIP_FILES` typed as `readonly string[]` but consumed by `Set` constructor -- `as const` would be stricter** - `src/cli/utils/migrations.ts:67`
**Confidence**: 80%
- Problem: `MEMORY_LEGACY_SKIP_FILES` is typed as `readonly string[]`. While this prevents mutation, it doesn't narrow the literal types. Using `as const` (a const assertion) would narrow each element to its literal string type, enabling the compiler to catch typos if the values are ever used in type-level comparisons. This is a minor type-safety improvement consistent with the project's "type everything" principle.
- Impact: Low -- no runtime effect, but reduces compile-time safety for future refactors that reference these values.
- Fix:
```typescript
const MEMORY_LEGACY_SKIP_FILES = [
  'knowledge',
  'short',
  'index.md',
  'candidates.json',
  '.knowledge-usage.json',
  '.working-memory-last-trigger',
  '.working-memory-update.log',
  '.gitignore-configured',
  '.sidecar',
  'decisions',
] as const;
```

**JSDoc `@param` for `purgeLegacyDecisionsEntries` references `.devflow/memory/` but actual param is `memoryDir` (generic)** - `src/cli/utils/legacy-decisions-purge.ts:172-173`
**Confidence**: 83%
- Problem: The updated JSDoc says `@param options.memoryDir - absolute path to the '.devflow/memory/' directory` but the parameter name is `memoryDir` which is a generic name used as a legacy fallback. The comment on line 179 says "When provided, uses canonical project-paths for decisions dir and lock (new .devflow/ layout)" for `projectRoot`. The JSDoc should clarify that `memoryDir` is the legacy path when `projectRoot` is not provided, and the `.devflow/memory/` path when it is.
- Impact: Developer confusion when reading the API -- the JSDoc suggests `memoryDir` always points to `.devflow/memory/` but callers may pass the old `.memory/` path.
- Fix: Update the JSDoc:
```typescript
* @param options.memoryDir - absolute path to the memory directory
*   (`.devflow/memory/` when projectRoot is provided; legacy `.memory/` otherwise)
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`MIGRATION_RENAME_KB_TO_KNOWLEDGE` uses `access()+rename()` TOCTOU pattern** - `src/cli/utils/migrations.ts:230-231`
**Confidence**: 85%
- Problem: The rename-kb-to-knowledge migration still uses the `access(oldPath); rename(oldPath, newPath)` pattern that was explicitly identified as a TOCTOU race in the commit message for the `moveFile` refactor. While the race window is negligible for a one-time migration, it's inconsistent with the PR's stated goal of eliminating TOCTOU races.
- Impact: Inconsistency -- the same PR that fixes TOCTOU in `moveFile` leaves the identical pattern in a sibling migration. The `moveFile` function could be reused here for consistency.

## Suggestions (Lower Confidence)

- **`createDocsStructure` sequential `mkdir` calls could be parallelized** - `src/cli/utils/post-install.ts:509-511` (Confidence: 65%) -- Three independent `mkdir` calls are awaited sequentially. `Promise.all` would be consistent with the parallelization pattern applied in the consolidation migration.

- **`purgeLegacyDecisionsEntries` PROJECT-PATTERNS.md loop iterates nullable array** - `src/cli/utils/legacy-decisions-purge.ts:212` (Confidence: 70%) -- The loop iterates `[oldProjectPatternsPath, newProjectPatternsPath]` where `oldProjectPatternsPath` can be `null`, requiring a `continue` guard. A `filter(Boolean)` would be more idiomatic: `for (const candidatePath of [oldProjectPatternsPath, newProjectPatternsPath].filter((p): p is string => p !== null))`.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 1 | 1 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 0 |

**TypeScript Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The critical finding is that `moveFile`'s TOCTOU refactor inadvertently broke the idempotency guarantee: POSIX `rename()` silently overwrites existing destinations rather than returning `EEXIST`. This is a data-loss risk during migration re-runs (e.g., after `rm ~/.devflow/migrations.json` recovery). The fix is straightforward -- either re-add a destination check or switch to `link()+unlink()` which correctly returns `EEXIST` on POSIX. The `ENOTEMPTY` gap for directory entries is a secondary concern. The remaining findings are documentation and type-safety improvements.

Decisions context: ADR-001 (clean break philosophy) and PF-001 (migration code without verifying clean-break) were reviewed. The consolidation migration is a deliberate, user-approved migration (not a backward-compat shim), so it does not conflict with ADR-001. PF-001's warning about unauthorized migration code does not apply here -- this is an intentional directory restructure, not a rename-triggered compat layer.
