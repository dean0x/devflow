# Testing Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-18

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Missing tests for `consolidate-to-devflow-dir` migration** - `src/cli/utils/migrations.ts:334`
**Confidence**: 95%
- Problem: The `MIGRATION_CONSOLIDATE_TO_DEVFLOW` migration is the core behavioral change of this PR -- it moves `.memory/`, `.features/`, and `.docs/` into `.devflow/` subdirectories. This migration contains non-trivial logic: 30+ explicit file mappings, directory content moves, `.gitignore` cleanup, old directory removal, and cross-device rename fallback. None of this logic has dedicated test coverage. The existing `migrations.test.ts` tests exercise the migration framework (skips, idempotency, failure handling, D37 vacuous truth) but never invoke `consolidate-to-devflow-dir` specifically. The only indirect coverage is the `runMigrations` integration test that runs all registered migrations against empty directories where the migration is a no-op.
- Fix: Add a dedicated test suite for the consolidation migration that validates: (1) files move from old locations to new `.devflow/` locations, (2) `.devflow/.gitignore` is created with correct content, (3) stale `.gitignore` entries are removed from project root, (4) empty old directories are cleaned up, (5) idempotency -- running twice produces the same result, (6) partial state -- some files already migrated. Example:

```typescript
describe('consolidate-to-devflow-dir migration', () => {
  it('moves .memory/WORKING-MEMORY.md to .devflow/memory/', async () => {
    // Create old layout
    await fs.mkdir(path.join(projectRoot, '.memory'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, '.memory', 'WORKING-MEMORY.md'), '## Now\n');
    // Run migration
    await MIGRATION_CONSOLIDATE_TO_DEVFLOW.run({ scope: 'per-project', devflowDir: fakeHome, memoryDir: getMemoryDir(projectRoot), projectRoot });
    // Verify new location
    const content = await fs.readFile(path.join(projectRoot, '.devflow', 'memory', 'WORKING-MEMORY.md'), 'utf-8');
    expect(content).toBe('## Now\n');
    // Verify old location gone
    await expect(fs.access(path.join(projectRoot, '.memory', 'WORKING-MEMORY.md'))).rejects.toThrow();
  });
});
```

**Missing tests for `rename-kb-to-knowledge` migration** - `src/cli/utils/migrations.ts:275`
**Confidence**: 92%
- Problem: The `MIGRATION_RENAME_KB_TO_KNOWLEDGE` migration renames `.features/.kb.lock` to `.features/.knowledge.lock` (and two similar renames) and updates `.gitignore` entries. No test exercises this migration's `run` function directly. The only coverage is indirect through the framework tests.
- Fix: Add tests verifying: (1) old files are renamed to new names, (2) `.gitignore` entries are updated, (3) missing old files are a no-op.

### MEDIUM

**No test for `moveFile` cross-device (EXDEV) fallback** - `src/cli/utils/migrations.ts:15`
**Confidence**: 82%
- Problem: `moveFile` contains a `catch` block that handles `EXDEV` errors by falling back to `cp + rm`. This code path is structurally reachable when source and destination are on different filesystems (e.g., `/tmp` mount vs project directory on some systems). While hard to trigger in CI, the fallback is production-critical and untested.
- Fix: Consider extracting `moveFile` as a testable export and testing the EXDEV path with a mock that throws `EXDEV` on `rename`, or at minimum add a comment acknowledging the coverage gap. Alternatively, test the happy path (same-device rename succeeds).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`project-paths.test.ts` CJS parity table missing `getLearningDir` — not a bug, but an asymmetry worth noting** - `tests/project-paths.test.ts:292`
**Confidence**: 60% (moved to Suggestions)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Shell hook tests spawn `bash` subprocesses for every assertion** - `tests/shell-hooks.test.ts`, `tests/sentinel.test.ts`
**Confidence**: 85%
- Problem: Tests in `shell-hooks.test.ts` and `sentinel.test.ts` rely on `execSync` to spawn real bash subprocesses for each test case. This makes the test suite slower and more fragile (dependent on system `bash` availability and behavior). This is a pre-existing pattern; this PR only updated path strings within existing tests.
- Fix: No action needed in this PR. Future refactoring could extract pure-function logic from hooks into testable CJS modules (like `project-paths.cjs`) to reduce subprocess spawning.

## Suggestions (Lower Confidence)

- **CJS parity test does not cover `getLearningDir`** - `tests/project-paths.test.ts:292` (Confidence: 60%) -- There is no `getLearningDir` function in the project-paths module (learning files are accessed via individual getters), so this is not a gap. However, if a `getLearningDir` is ever added, the parity table should be updated.

- **`ensure-devflow-init` gitignore content is duplicated** - `scripts/hooks/ensure-devflow-init:29`, `src/cli/utils/migrations.ts:57` (Confidence: 75%) -- The `.devflow/.gitignore` content is defined in two places: the shell hook `ensure-devflow-init` (lines 29-76) and the TypeScript migration `DEVFLOW_GITIGNORE_CONTENT` (lines 57-103). If either is updated without the other, they will drift. No test verifies their equivalence. Consider extracting the canonical list to a shared location or adding a parity test.

- **No negative test for `getGitignoreEntries` excluding `.devflow/`** - `tests/project-paths.test.ts:268` (Confidence: 65%) -- The test `does not include old .memory/ entry` validates that `.memory/` was removed, but does not explicitly verify that `.devflow/` is also absent from the entries (since `.devflow/` is no longer gitignored at the project root -- transients are handled by `.devflow/.gitignore`). The current test at line 268 partially covers this intent but could be more explicit.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 6/10

The new `project-paths.test.ts` is excellent -- 356 lines of thorough coverage with CJS parity verification across 40+ functions. All existing tests were correctly updated from `.memory/`/`.features/`/`.docs/` paths to `.devflow/` paths, and all 1447 tests pass. The `ensure-devflow-init` behavioral tests are well-structured with idempotency and guard checks.

However, the two new migrations (`consolidate-to-devflow-dir` and `rename-kb-to-knowledge`) are the most complex and user-impacting code in this PR, and they have zero direct test coverage. The consolidation migration alone has 120 lines of file-moving logic with 30+ explicit mappings, cross-device fallback, gitignore cleanup, and old-directory removal -- all untested. This is the critical path for upgrading users. Applies ADR-001 (clean break philosophy does not eliminate the need to test the one-time migration that performs the break). Avoids PF-001 (no backward-compat layer, but the migration itself needs testing).

**Recommendation**: CHANGES_REQUESTED
