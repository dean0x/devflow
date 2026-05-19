# Testing Review Report

**Branch**: refactor/rename-knowledge-to-decisions -> main
**Date**: 2026-05-03

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Missing test for both-directories-exist conflict scenario** - `tests/learning/rename-migration.test.ts`
**Confidence**: 82%
- Problem: The migration at `src/cli/utils/migrations.ts:162-175` handles the case where both `.memory/knowledge/` and `.memory/decisions/` exist simultaneously (emits a warning, skips directory rename, but still updates manifest/log paths). The test at line 156 ("handles partial state") only tests the case where `decisions/` exists without `knowledge/`. There is no test that verifies behavior when BOTH directories coexist with content -- specifically that the warning is emitted AND the old `knowledge/` directory is left untouched AND manifest/log paths are still updated.
- Fix: Add a test case covering the both-directories-exist scenario:
```typescript
it('warns when both .memory/knowledge/ and .memory/decisions/ exist', async () => {
  const projectRoot = path.join(tmpDir, 'both-dirs-project');
  const memoryDir = path.join(projectRoot, '.memory');
  await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });
  await fs.mkdir(path.join(memoryDir, 'decisions'), { recursive: true });
  await fs.writeFile(path.join(memoryDir, 'knowledge', 'decisions.md'), 'old', 'utf-8');
  await fs.writeFile(path.join(memoryDir, 'decisions', 'decisions.md'), 'new', 'utf-8');

  const result = await renameMigration.run(makeCtx(projectRoot));

  expect(result!.warnings).toContain('.memory/decisions/ already exists — skipping directory rename');
  // Old directory should still exist (not deleted)
  const oldContent = await fs.readFile(path.join(memoryDir, 'knowledge', 'decisions.md'), 'utf-8');
  expect(oldContent).toBe('old');
});
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Notification key names still use "knowledge-capacity-" prefix** - `scripts/hooks/json-helper.cjs:1290` (Confidence: 65%) -- The notification keys `knowledge-capacity-decisions` and `knowledge-capacity-pitfalls` in `.notifications.json` were intentionally not renamed (they are internal storage keys, not user-facing), but this creates an inconsistency with the rest of the rename. Tests at `tests/learning/capacity-thresholds.test.ts`, `tests/learning/hud-notifications.test.ts`, and `tests/learning/render-decision.test.ts` consistently use the old key names, matching the source. This is coherent but could cause confusion for future contributors.

- **`decisions-usage-scan.test.ts` uses sequential `spawnSync` for concurrency test** - `tests/learning/decisions-usage-scan.test.ts:180-192` (Confidence: 62%) -- The "lock serialises concurrent invocations" test uses two sequential `spawnSync` calls, which means the processes do not actually overlap. True concurrency testing would require `spawn` with parallel execution. The test still validates that the final count is 2, but it does not exercise the lock contention path it claims to test.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Assessment

This PR is a comprehensive rename refactor from "knowledge" to "decisions" across the entire codebase (84 files, ~1200 lines changed). From a testing perspective, the changes are well-executed:

**Strengths:**
- **New migration test** (`tests/learning/rename-migration.test.ts`): 11 thorough test cases covering the new `rename-knowledge-to-decisions` migration, including fresh project no-op, directory rename, lock rename, usage file rename, manifest path updates, log path updates, idempotency, partial state, empty manifest, and mixed-artifact-path preservation.
- **Consistent renames across all 24 test files**: Every fixture path, variable name, function import, and assertion string has been updated to use the new "decisions" naming. No stale `updateKnowledgeStatus`, `apply-knowledge`, or `knowledge-persistence` references remain.
- **Test suite passes completely**: All 1183 tests across 52 files pass with zero failures.
- **Behavioral coverage preserved**: The renamed tests continue to validate the same behaviors -- the test logic and assertions are identical; only names and paths changed.
- **Fixtures updated correctly**: `tests/decisions/fixtures.ts` and `tests/decisions/helpers.ts` properly reference `.memory/decisions/` paths.
- **Migration ordering test**: `tests/migrations.test.ts` verifies the new migration is registered after `purge-legacy-knowledge-v3` in the MIGRATIONS array.

**One gap identified:** The both-directories-exist conflict scenario in the migration is untested (MEDIUM severity blocking finding above). The migration handles this case with a warning, but the test suite does not exercise this branch.
