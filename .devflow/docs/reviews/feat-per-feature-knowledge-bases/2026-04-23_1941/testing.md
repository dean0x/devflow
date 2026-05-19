# Testing Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-23

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing error-path tests for `updateIndex` lock failure** - `scripts/hooks/lib/feature-kb.cjs:227`
**Confidence**: 85%
- Problem: `updateIndex` throws `Error('Failed to acquire .features/.kb.lock within timeout')` when the lock cannot be acquired (line 228), but no test covers this branch. Similarly, `removeEntry` has the same throw at line 291. These are the only `throw` paths in the write functions and represent a real production failure mode (concurrent access, stale locks).
- Fix: Add a test that pre-creates the lock directory and verifies the throw:
```typescript
it('throws when lock cannot be acquired', () => {
  const tmp = makeTmpFeatureWorktree({ version: 1, features: {} });
  const lockPath = path.join(tmp, '.features', '.kb.lock');
  mkdirSync(lockPath); // Pre-acquire the lock
  expect(() => updateIndex(tmp, {
    slug: 'test',
    name: 'Test',
    directories: [],
    referencedFiles: [],
    category: 'architecture',
  })).toThrow(/lock/);
  rmSync(lockPath, { recursive: true }); // Cleanup
});
```
  Note: The default `acquireLock` timeout is 30 seconds, so the test helper would need to either expose a shorter timeout or the test would need to mock timing. Consider adding an optional timeout parameter to `updateIndex`/`removeEntry` for testability, or test `acquireLock` directly.

**Missing test for `checkStaleness` with actual stale data (positive stale case)** - `tests/feature-kb/feature-kb.test.ts:89-103`
**Confidence**: 82%
- Problem: `checkStaleness` has two tests: entry-not-found and non-git-repo. Both return `stale: false`. The critical positive case -- where a KB IS stale because git log shows changes after `lastUpdated` -- is never tested. This is the most important behavior of the function. Without a git repo in the temp directory, the function always short-circuits before reaching the `git log` logic (line 131-141).
- Fix: Create a temp directory with `git init`, make a commit, create an index with a `lastUpdated` in the past, then make another commit touching a referenced file. Assert `stale: true`:
```typescript
it('returns stale: true when referenced files changed after lastUpdated', () => {
  const tmp = makeTmpFeatureWorktree();
  // Initialize git repo
  execSync('git init', { cwd: tmp });
  execSync('git config user.email "test@test.com"', { cwd: tmp });
  execSync('git config user.name "Test"', { cwd: tmp });
  // Create a referenced file and commit
  const refFile = path.join(tmp, 'src', 'cli.ts');
  mkdirSync(path.join(tmp, 'src'), { recursive: true });
  writeFileSync(refFile, 'initial');
  execSync('git add -A && git commit -m "initial"', { cwd: tmp });
  // Set lastUpdated to before the next commit
  const pastDate = new Date(Date.now() - 60000).toISOString();
  const index = {
    version: 1,
    features: {
      'my-feature': {
        name: 'My Feature',
        directories: ['src/'],
        referencedFiles: ['src/cli.ts'],
        category: 'architecture',
        lastUpdated: pastDate,
        createdBy: 'test',
      },
    },
  };
  writeFileSync(path.join(tmp, '.features', 'index.json'), JSON.stringify(index));
  // Modify the referenced file and commit
  writeFileSync(refFile, 'changed');
  execSync('git add -A && git commit -m "change"', { cwd: tmp });
  const result = checkStaleness(tmp, 'my-feature');
  expect(result.stale).toBe(true);
  expect(result.changedFiles).toContain('src/cli.ts');
});
```

### MEDIUM

**`markStale` prefix-matching logic not tested for directory-style overlap** - `tests/feature-kb/feature-kb.test.ts:196-213`
**Confidence**: 83%
- Problem: The `markStale` function uses bidirectional prefix matching: `f.startsWith(ref) || ref.startsWith(f)`. The existing test only covers exact match (`src/cli/cli.ts` matches the referenced file `src/cli/cli.ts`). The prefix-matching branches (e.g., changed file `src/cli/cli.ts` starts with ref `src/cli/` or ref `src/cli/cli.ts` starts with changed `src/`) are untested. This is the novel matching logic in the function.
- Fix: Add tests for prefix matching in both directions:
```typescript
it('detects staleness when changed file is under a referenced directory prefix', () => {
  const index = {
    version: 1,
    features: {
      'area': {
        referencedFiles: ['src/cli/'],
        // ...other fields
      },
    },
  };
  const tmp = makeTmpFeatureWorktree(index);
  const stale = markStale(tmp, ['src/cli/deep/file.ts']);
  expect(stale).toContain('area');
});
```

**No test coverage for `kb.ts` CLI command (TypeScript layer)** - `src/cli/commands/kb.ts`
**Confidence**: 80%
- Problem: The `kb-command.test.ts` tests the CJS CLI interface (`node feature-kb.cjs list ...`), but the TypeScript `kbCommand` in `src/cli/commands/kb.ts` (344 lines) has zero test coverage. This command has its own logic: `getWorktreePath()`, `create` with interactive prompts, `refresh` with staleness-based selection, `remove` with confirmation. While end-to-end testing of interactive CLI commands is harder, the non-interactive paths (list, check) and the `getWorktreePath` helper could be unit tested.
- Fix: Add tests for the TypeScript CLI command, at minimum for the `list` and `check` subcommands which don't require interactive prompts. The project already tests similar Commander.js commands in `tests/init-logic.test.ts`.

**Skill content tests are structural presence checks, not behavioral tests** - `tests/feature-kb/apply-feature-kb-skill.test.ts`
**Confidence**: 80%
- Problem: The `apply-feature-kb-skill.test.ts` and `kb-builder-agent.test.ts` files only assert that certain strings exist in the markdown files (e.g., `expect(content).toContain('## Iron Law')`). While this prevents accidental section deletion, it doesn't validate behavior -- it tests document structure. This pattern is consistent with the existing `skill-references.test.ts` tests in the project, so it follows project conventions, but it represents the weakest form of testing.
- Impact: Low -- this follows established project patterns for skill/agent testing. The structural checks serve as a regression safety net for accidental deletion of required sections.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`createdTmpDirs` is module-level mutable state shared across test files** - `tests/feature-kb/fixtures.ts:59`
**Confidence**: 82%
- Problem: The `createdTmpDirs` array is module-level mutable state. Since vitest can run test files in the same process, and `fixtures.ts` is imported by multiple test files (`feature-kb.test.ts` and `kb-command.test.ts`), the array accumulates directories from all importing files. Each file calls `cleanupTmpFeatureWorktrees()` in `afterAll`, which empties the array. If execution order is: file A creates dirs, file A cleanup runs, file B creates dirs, file B cleanup runs -- this works. But if file A creates dirs, file B creates dirs, file A cleanup runs (clears ALL), file B cleanup runs (array already empty, file B's dirs leaked) -- this fails silently. The existing `tests/knowledge/fixtures.ts` uses the same pattern, so this is consistent with project conventions but carries the same risk.
- Fix: Consider using `beforeEach`/`afterEach` with per-test tracking, or accept the risk as consistent with existing patterns.

## Pre-existing Issues (Not Blocking)

No pre-existing issues found.

## Suggestions (Lower Confidence)

- **Lock timeout makes `acquireLock` effectively untestable without mocking** - `scripts/hooks/lib/feature-kb.cjs:172` (Confidence: 70%) -- The 30-second default timeout means testing lock contention requires either waiting 30 seconds or exposing timeout parameters. Consider adding an optional `lockTimeout` parameter to `updateIndex`/`removeEntry` for testability.

- **`checkStaleness` silently swallows all git errors** - `scripts/hooks/lib/feature-kb.cjs:142-144` (Confidence: 65%) -- Both the `git rev-parse` and `git log` calls catch all errors and return `stale: false`. A test verifying that a corrupt `.git` directory doesn't cause a crash would validate this error-handling path, but the current behavior (graceful fallback) is reasonable.

- **`removeEntry` releases lock in `finally` even when early-return skips lock acquisition** - `scripts/hooks/lib/feature-kb.cjs:293-313` (Confidence: 62%) -- When the index file doesn't exist, `removeEntry` returns at line 300 inside the try block, so `releaseLock` in finally runs correctly. But if `acquireLock` fails (throws), the finally block attempts to release a lock that was never acquired. The `releaseLock` function is a no-op for missing dirs, so this is harmless but untested.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 3 | 0 |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The `feature-kb.cjs` module has solid happy-path coverage (25 tests across 7 functions + 6 CLI tests) and the test structure follows project conventions well. However, the two most important behavioral paths -- lock contention failure and positive staleness detection via git -- have no coverage. The positive staleness test is particularly important because it validates the core value proposition of the feature (detecting when a KB is outdated). The TypeScript CLI command (`kb.ts`, 344 lines) also has zero test coverage, though its lower-level CJS functions are well-tested. The skill/agent content tests are structural presence checks consistent with project norms.
