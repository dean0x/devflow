# Testing Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### HIGH

**No test for `.memory/.sidecar/` directory contents migration (step 2b)** - `tests/migrations.test.ts`
**Confidence**: 85%
- Problem: The `consolidate-to-devflow-dir` migration has a dedicated step (2b) that moves `.memory/.sidecar/` contents to `.devflow/sidecar/`. This is a distinct `moveDirContents` call with its own failure modes, but no test covers it. The only mention of "sidecar" in migration tests is a gitignore content spot-check (line 693). If `moveDirContents` for `.sidecar/` silently fails (e.g., wrong source path, permission issue), users would lose sidecar marker files with no test catching the regression.
- Fix: Add a test that creates files in `.memory/.sidecar/`, runs the migration, and verifies they appear in `.devflow/sidecar/`:
```typescript
it('moves .memory/.sidecar/ contents to .devflow/sidecar/', async () => {
  const sidecarSrc = path.join(projectRoot, '.memory', '.sidecar');
  await fs.mkdir(sidecarSrc, { recursive: true });
  await fs.writeFile(path.join(sidecarSrc, 'config.json'), '{"memory":true}', 'utf-8');

  await getMigration().run(makeCtx());

  const content = await fs.readFile(
    path.join(devflowDir, 'sidecar', 'config.json'), 'utf-8',
  );
  expect(content).toBe('{"memory":true}');
});
```

**No test for `purgeLegacyDecisionsEntries` with `projectRoot` parameter (dual-path PROJECT-PATTERNS.md cleanup)** - `tests/legacy-decisions-purge.test.ts`
**Confidence**: 85%
- Problem: The `purgeLegacyDecisionsEntries` function was modified to check TWO paths for `PROJECT-PATTERNS.md` when `projectRoot` is provided: the old path (`.memory/PROJECT-PATTERNS.md`) and the new path (`.devflow/memory/PROJECT-PATTERNS.md`). All existing tests call `purgeLegacyDecisionsEntries({ memoryDir })` without `projectRoot`, so they only exercise the single-path (`memoryDir/PROJECT-PATTERNS.md`) code. The new dual-path logic at `legacy-decisions-purge.ts:192-206` is entirely untested.
- Fix: Add tests that exercise the `projectRoot` parameter:
```typescript
it('removes PROJECT-PATTERNS.md from old .memory/ path when projectRoot is provided', async () => {
  const projectRoot = path.dirname(memoryDir);
  const oldPath = path.join(projectRoot, '.memory', 'PROJECT-PATTERNS.md');
  await fs.mkdir(path.dirname(oldPath), { recursive: true });
  await fs.writeFile(oldPath, '# Old', 'utf-8');

  const result = await purgeLegacyDecisionsEntries({ memoryDir, projectRoot });
  expect(result.files).toContain(oldPath);
  await expect(fs.access(oldPath)).rejects.toThrow();
});
```

### MEDIUM

**No test for catch-all `moveDirContents` with derived skip set (step 2d)** - `tests/migrations.test.ts`
**Confidence**: 82%
- Problem: The migration refactored `MEMORY_SKIP_FILES` into `MEMORY_LEGACY_SKIP_FILES` + dynamically derived skip set from `memMap`. Step 2d uses `moveDirContents(memSrc, ..., memSkipFiles)` where `memSkipFiles` is computed as the union of legacy skip files and memMap keys. The "leaves non-empty old directories" test (line 760) tests `index.md` being skipped (a legacy skip file), but no test verifies that an unknown/unexpected file in `.memory/` that is NOT in the skip set gets moved to `.devflow/memory/` by the catch-all pass. The DRY refactor claim (memMap keys auto-excluded) has no direct verification.
- Fix: Add a test that places an "unknown" file in `.memory/` and verifies it lands in `.devflow/memory/`:
```typescript
it('catch-all moves unknown .memory/ files to .devflow/memory/', async () => {
  const memorySrc = path.join(projectRoot, '.memory');
  await fs.mkdir(memorySrc, { recursive: true });
  await fs.writeFile(path.join(memorySrc, 'custom-notes.txt'), 'hello', 'utf-8');

  await getMigration().run(makeCtx());

  const content = await fs.readFile(
    path.join(devflowDir, 'memory', 'custom-notes.txt'), 'utf-8',
  );
  expect(content).toBe('hello');
});
```

**`getDevflowGitignoreContent` TS/CJS parity not tested** - `tests/project-paths.test.ts`
**Confidence**: 80%
- Problem: The new `getDevflowGitignoreContent()` function was added to both `project-paths.ts` and `project-paths.cjs`. The CJS parity test suite exercises every other getter function for TS/CJS agreement, but does NOT include `getDevflowGitignoreContent` in its parity loop. This is the single source of truth for `.devflow/.gitignore` content used by migrations.ts. A divergence between TS and CJS would cause hooks and CLI to generate different gitignore files.
- Fix: Add the function to the CJS parity suite:
```typescript
it('getDevflowGitignoreContent - TypeScript and CJS agree', () => {
  expect(cjsPaths.getDevflowGitignoreContent()).toBe(getDevflowGitignoreContent());
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Migration ordering test missing for `rename-kb-to-knowledge` before `consolidate-to-devflow-dir`** - `tests/migrations.test.ts`
**Confidence**: 82%
- Problem: The `rename-kb-to-knowledge` migration renames `.features/.kb.lock` to `.features/.knowledge.lock`. The `consolidate-to-devflow-dir` migration then moves `.features/` into `.devflow/features/`. If the ordering is reversed, the rename would look for `.kb.lock` inside the already-consolidated `.devflow/features/` and silently no-op, leaving the old-named file orphaned. The existing ordering test (line 141) only covers v2-before-v3; no test guards rename-kb before consolidate.
- Fix: Add an ordering assertion:
```typescript
it('rename-kb-to-knowledge runs before consolidate-to-devflow-dir', () => {
  const renameIdx = MIGRATIONS.findIndex(m => m.id === 'rename-kb-to-knowledge');
  const consolidateIdx = MIGRATIONS.findIndex(m => m.id === 'consolidate-to-devflow-dir');
  expect(renameIdx).toBeGreaterThanOrEqual(0);
  expect(consolidateIdx).toBeGreaterThan(renameIdx);
});
```

**MIGRATIONS registry registration tests inconsistent for new migrations** - `tests/migrations.test.ts`
**Confidence**: 80%
- Problem: The `MIGRATIONS` describe block (lines 100-148) contains explicit `it('contains...')` registration tests for `shadow-overrides-v2-names`, `purge-legacy-knowledge-v2`, and `purge-legacy-knowledge-v3`, but NOT for `rename-kb-to-knowledge` or `consolidate-to-devflow-dir`. These two new migrations are implicitly found via `MIGRATIONS.find()` in their own describe blocks, but the convention established by the existing tests is to have explicit registration assertions in the MIGRATIONS describe block.
- Fix: Add registration tests for both new migrations:
```typescript
it('contains rename-kb-to-knowledge with per-project scope', () => {
  const m = MIGRATIONS.find(m => m.id === 'rename-kb-to-knowledge');
  expect(m).toBeDefined();
  expect(m?.scope).toBe('per-project');
});

it('contains consolidate-to-devflow-dir with per-project scope', () => {
  const m = MIGRATIONS.find(m => m.id === 'consolidate-to-devflow-dir');
  expect(m).toBeDefined();
  expect(m?.scope).toBe('per-project');
});
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`rename-kb-to-knowledge` uses access+rename (TOCTOU) while `consolidate-to-devflow-dir` uses atomic rename-only** - `src/cli/utils/migrations.ts:229-234`
**Confidence**: 82%
- Problem: The `rename-kb-to-knowledge` migration (line 229-234) still uses `access(oldPath)` followed by `rename(oldPath, newPath)` wrapped in try/catch. The same PR fixed this exact TOCTOU pattern in `moveFile` by dropping access() calls and handling ENOENT/EEXIST from the rename syscall. The two migration functions within the same file now use inconsistent patterns. While the TOCTOU window is small and the consequence is benign (a silent skip), the inconsistency is worth noting for a future cleanup pass.
- Impact: LOW for production (worst case: a concurrent delete between access and rename causes an unhandled throw, but the migration is idempotent and retries on next init).

## Suggestions (Lower Confidence)

- **No integration test for full migration chain (rename-kb then consolidate) via `runMigrations`** - `tests/migrations.test.ts` (Confidence: 70%) -- The two new migrations are tested in isolation by calling `.run()` directly, but no test runs both through the `runMigrations` runner to verify the full sequential chain produces the expected final state.

- **`consolidate-to-devflow-dir` test for `.memory/decisions/` move does not verify source directory emptied** - `tests/migrations.test.ts:640` (Confidence: 65%) -- The test checks destination files exist but does not verify the source `.memory/decisions/` directory was emptied, which is important for the step 7 empty-directory cleanup.

- **`beforeEach` setup in `consolidate-to-devflow-dir` duplicates HOME override pattern from 3 other suites** - `tests/migrations.test.ts:567-576` (Confidence: 62%) -- Four describe blocks (runMigrations, rename-kb, consolidate, and implicitly reportMigrationResult) repeat the same HOME override + tmpDir + fakeHome + afterEach cleanup. A shared helper would reduce the 20+ lines of duplicated setup, though this is a style/maintenance concern.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | - | 0 | 2 | 0 |
| Pre-existing | - | - | 1 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new tests are well-structured, behavior-focused, and cover the critical paths (idempotency, partial state, no-op, gitignore cleanup). The test suite follows clear AAA structure, uses real filesystem fixtures (not mocks), and tests actual migration functions from the registry. However, two HIGH-severity gaps exist: the `.memory/.sidecar/` directory migration path has zero test coverage, and the new dual-path `PROJECT-PATTERNS.md` cleanup logic in `legacy-decisions-purge.ts` is untested. The `getDevflowGitignoreContent` TS/CJS parity gap is a consistency risk given it is the canonical source of truth for gitignore content. Applies ADR-001 (clean break philosophy reflected in migration approach rather than backward compat). Avoids PF-001 (migrations here are one-time data moves, not rename compat layers).
