# Performance Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-18

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Sequential `await` for independent `mkdir` calls in migration** - `src/cli/utils/migrations.ts:348-353`
**Confidence**: 85%
- Problem: Six sequential `await fs.mkdir()` calls create directories that have no dependency on each other. Each `mkdir` with `{ recursive: true }` is an independent I/O operation. This runs once per project during migration (with up to 16 projects in parallel via `pooled`), so the total sequential overhead across all projects is `6 * await-overhead * project-count`.
- Fix: Use `Promise.all()` for the independent directory creations:
```typescript
// 1. Create target subdirectories
await Promise.all([
  fs.mkdir(path.join(devflowDir, 'memory'),    { recursive: true }),
  fs.mkdir(path.join(devflowDir, 'sidecar'),   { recursive: true }),
  fs.mkdir(path.join(devflowDir, 'decisions'), { recursive: true }),
  fs.mkdir(path.join(devflowDir, 'learning'),  { recursive: true }),
  fs.mkdir(path.join(devflowDir, 'features'),  { recursive: true }),
  fs.mkdir(path.join(devflowDir, 'docs'),      { recursive: true }),
]);
```

**Sequential `moveFile` for 26 independent file moves in migration** - `src/cli/utils/migrations.ts:387-389`
**Confidence**: 82%
- Problem: The `memMap` loop moves 26 files sequentially (`for ... await moveFile()`). Each `moveFile` performs up to 4 awaited I/O operations (2x `fs.access`, `fs.mkdir`, `fs.rename`). These files are independent and can be moved in parallel. At ~26 files * 4 awaits each = ~104 sequential I/O round-trips that could collapse to ~4 parallel rounds.
- Fix: Batch the file moves with `Promise.all()`:
```typescript
await Promise.all(
  memMap.map(([name, dest]) => moveFile(path.join(memSrc, name), dest))
);
```
- Note: This is a one-time migration, so the impact is bounded. Still, with `pooled(projects, 16, ...)` already parallelizing across projects, within-project parallelism would complete the migration significantly faster for projects with many files. Applies ADR-001 (clean break, so this migration only runs once per project).

**`moveDirContents` sequentially moves entries one at a time** - `src/cli/utils/migrations.ts:48-53`
**Confidence**: 82%
- Problem: `moveDirContents` iterates directory entries and calls `await moveFile()` sequentially for each. Called 4 times in the migration (sidecar, decisions, catch-all memory, features, docs). Directory contents are independent.
- Fix: Parallelize the inner loop:
```typescript
async function moveDirContents(
  srcDir: string,
  destDir: string,
  skipNames: Set<string>,
): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true }) as import('fs').Dirent[];
  } catch { return; }

  await Promise.all(
    entries
      .filter(entry => !skipNames.has(entry.name))
      .map(entry => moveFile(path.join(srcDir, entry.name), path.join(destDir, entry.name)))
  );
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`ensure-devflow-init` creates 6 directories on every hook invocation before marker check** - `scripts/hooks/ensure-devflow-init:13-20`
**Confidence**: 85%
- Problem: The script creates 6 directories via `mkdir -p` on every invocation from `sidecar-capture`, `sidecar-dispatch`, and `pre-compact-memory`. The `mkdir -p` call is idempotent but still performs a syscall per directory. The old `ensure-memory-gitignore` only created 1 directory (`mkdir -p .memory/decisions`). The `.gitignore-configured` marker check (line 28) short-circuits the gitignore write, but the 6 `mkdir -p` calls always execute. For hot-path hooks (sidecar-capture fires every assistant turn, sidecar-dispatch every user prompt), this is 6 syscalls per turn that are no-ops after first run.
- Fix: Add an early-return guard for the common case where the directory already exists:
```bash
# Fast path: all dirs exist after first run
if [ -d "$_DEVFLOW_DIR/memory" ] && [ -d "$_DEVFLOW_DIR/docs" ]; then
  return 0
fi

# Create all subdirectories (first run only)
mkdir -p \
  "$_DEVFLOW_DIR/memory" \
  ...
```
- Note: The old `ensure-memory-gitignore` had the same pattern (mkdir every time) for 1 directory. With 6 directories the overhead is 6x, making the fast-path guard more valuable.

## Pre-existing Issues (Not Blocking)

No pre-existing CRITICAL performance issues found in unchanged code.

## Suggestions (Lower Confidence)

- **Repeated `path.join` with identical base segments** - `scripts/hooks/lib/project-paths.cjs` (Confidence: 65%) -- Every getter function independently calls `path.join(projectRoot, '.devflow', ...)`, repeating the `.devflow` segment join. A cached intermediate (e.g., `const devflowDir = path.join(projectRoot, '.devflow')`) could reduce string allocations, but since Node's `require()` caching means the module loads once and each function is called at most once per code path, the practical impact is negligible. Not actionable unless profiling shows hot-path pressure.

- **`moveFile` performs `fs.mkdir` for parent dir even when parent was already created in step 1** - `src/cli/utils/migrations.ts:21` (Confidence: 62%) -- The migration creates all 6 target directories upfront (step 1), then `moveFile` calls `fs.mkdir(path.dirname(dest), { recursive: true })` for every file move. Since the parents already exist, these are all no-op syscalls. Removing the `mkdir` from `moveFile` and relying on step 1 would eliminate ~26 redundant `mkdir` calls, but this trades robustness (standalone `moveFile` safety) for micro-optimization in a one-time migration.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 3 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The refactoring is fundamentally a path-rename operation (`.memory/` -> `.devflow/memory/`, etc.) with no algorithmic changes. The new centralized `project-paths` module is a clean design that makes future path changes O(1). The migration is one-time and already parallelized across projects. The main performance observations are: (1) sequential I/O in the migration that could be parallelized for faster execution, and (2) the `ensure-devflow-init` hook creating 6 directories per turn instead of 1, which adds overhead on the hot path. None of these are blocking -- the migration runs once and the `mkdir -p` overhead is small in absolute terms -- but the `ensure-devflow-init` fast-path guard is worth adding since it fires on every user/assistant turn.
