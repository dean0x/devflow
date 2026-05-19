# Testing Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24

## Issues in Your Changes (BLOCKING)

### HIGH

**`removeEntry` behavior change removes early-return on corrupt index -- no test coverage** - `scripts/hooks/lib/feature-kb.cjs:355` and `tests/feature-kb/feature-kb.test.ts`
**Confidence**: 90%
- Problem: The old `removeEntry` returned early when `index.json` could not be parsed (`} catch { return; }`). The new code catches the parse error silently (`} catch { /* no index to modify */ }`) and falls through, which writes `{ version: 1, features: {} }` to disk. This means a corrupt but recoverable `index.json` will be silently overwritten with an empty index. There is no test covering the case where `index.json` contains corrupt JSON and `removeEntry` is called -- the behavior has changed and the new behavior (overwriting corrupt data) is untested.
- Fix: Either restore the early-return on parse failure (preserving the old behavior), or add a test that explicitly validates the new behavior. If the intent is to overwrite corrupt indexes, a test should document that decision:
```typescript
it('overwrites corrupt index.json with empty index on remove', () => {
  const tmp = makeTmpFeatureWorktree();
  writeFileSync(path.join(tmp, '.features', 'index.json'), 'not-valid-json');
  removeEntry(tmp, 'nonexistent');
  const index = loadIndex(tmp);
  expect(index).toEqual({ version: 1, features: {} });
});
```

### MEDIUM

**Lock failure test takes 515ms -- slow test risk** - `tests/feature-kb/feature-kb.test.ts:221-239`
**Confidence**: 82%
- Problem: The T1 lock failure test uses a 500ms `lockTimeoutMs` which results in a ~515ms wall-clock time (visible in test output). While acceptable as a single test, this is the slowest test in the suite by 3x. If more lock-failure tests are added at similar timeouts, the suite will degrade. The test validates behavior correctly but the timeout could be lower since the lock retry loop sleeps 100ms per iteration -- a 200ms timeout would still give 2 retry cycles, sufficient to prove the lock cannot be acquired.
- Fix: Reduce the timeout to 200ms:
```typescript
}, 200)).toThrow(/lock/i);
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`checkAllStaleness` refactored to avoid N+1 but positive-staleness path is untested** - `scripts/hooks/lib/feature-kb.cjs:166-199` and `tests/feature-kb/feature-kb.test.ts:382-395`
**Confidence**: 85%
- Problem: `checkAllStaleness` was significantly refactored (inlined staleness logic, single git-dir check). The existing tests only cover missing-index and non-git-repo paths. The new inlined git-log path (lines 186-194) has no direct test in a real git repo. The `checkStaleness` single-slug function has a positive git-repo test (T2), but `checkAllStaleness` does not. Since `checkAllStaleness` no longer delegates to `checkStaleness`, the two code paths have diverged and should each have positive-path coverage.
- Fix: Add a positive-staleness test for `checkAllStaleness` using the same git-repo fixture pattern as T2:
```typescript
describe('checkAllStaleness (positive -- git repo)', () => {
  it('detects staleness across multiple KBs', () => {
    const tmp = makeTmpFeatureWorktree();
    rmSync(path.join(tmp, '.features'), { recursive: true, force: true });
    execSync('git init', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmp, stdio: 'pipe' });
    const srcDir = path.join(tmp, 'src', 'cli');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(path.join(srcDir, 'cli.ts'), 'export const v = 1;');
    execSync('git add .', { cwd: tmp, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: tmp, stdio: 'pipe' });
    const lastUpdated = new Date(Date.now() - 5000).toISOString();
    const featuresDir = path.join(tmp, '.features');
    mkdirSync(featuresDir, { recursive: true });
    writeFileSync(path.join(featuresDir, 'index.json'), JSON.stringify({
      version: 1,
      features: {
        'my-feature': {
          name: 'My Feature', description: '', directories: ['src/cli/'],
          referencedFiles: ['src/cli/cli.ts'], category: 'test', lastUpdated, createdBy: 'test',
        },
      },
    }, null, 2));
    writeFileSync(path.join(srcDir, 'cli.ts'), 'export const v = 2;');
    execSync('git add .', { cwd: tmp, stdio: 'pipe' });
    execSync('git commit -m "update"', { cwd: tmp, stdio: 'pipe' });
    const result = checkAllStaleness(tmp);
    expect(result['my-feature'].stale).toBe(true);
    expect(result['my-feature'].changedFiles).toContain('src/cli/cli.ts');
  });
});
```

**`tryBreakStaleLock` extracted but not directly tested** - `scripts/hooks/lib/feature-kb.cjs:210-221`
**Confidence**: 80%
- Problem: `tryBreakStaleLock` was extracted as a new named function from the inline lock-retry logic. It is not exported and has no direct unit test. It is only exercised indirectly through the lock-failure test (T1), which only hits the `return false` path (lock is fresh/not stale). The `return true` paths (lock disappeared, lock is stale and removed) are not tested.
- Fix: Either export `tryBreakStaleLock` for direct testing, or add an integration test that exercises the stale-lock-breaking path through `updateIndex`:
```typescript
it('breaks stale lock and proceeds with update', () => {
  const tmp = makeTmpFeatureWorktree({ version: 1, features: {} });
  const lockPath = path.join(tmp, '.features', '.kb.lock');
  mkdirSync(lockPath);
  // Backdate the lock mtime to make it stale
  const past = new Date(Date.now() - 120000);
  require('fs').utimesSync(lockPath, past, past);
  // Should succeed because the stale lock gets broken
  expect(() => updateIndex(tmp, {
    slug: 'test', name: 'Test', directories: [], referencedFiles: [], category: 'test',
  }, 1000)).not.toThrow();
});
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`checkStaleness` positive test (T2) creates a real git repo in tmpdir without cleanup of `.git` config** - `tests/feature-kb/feature-kb.test.ts:112-161`
**Confidence**: 82%
- Problem: The T2 test creates a real git repo (git init + commits) in a temp directory. The `afterAll` cleanup handles directory removal, which is sufficient. However, each run of this test leaves git config in the tmpdir (user.email, user.name). If tests are interrupted before cleanup, orphan git repos accumulate. The test also uses `execSync('git add .', ...)` which adds all files including `.features/` content -- this is correct for the test but could be surprising if the fixture evolves to include files that shouldn't be tracked.
- Impact: Low risk of test pollution. The shared `cleanupTmpFeatureWorktrees()` in `afterAll` handles cleanup.

## Suggestions (Lower Confidence)

- **Missing test for `parseGitChangedFiles` edge cases** - `scripts/hooks/lib/feature-kb.cjs:39-41` (Confidence: 70%) -- The new `parseGitChangedFiles` helper deduplicates and trims, but there is no direct test for edge cases like empty string input, strings with only whitespace lines, or duplicate entries. It is indirectly tested through `checkStaleness` T2, but edge cases are not covered.

- **CLI dispatch tests use `execSync` with shell interpolation** - `tests/feature-kb/kb-command.test.ts:15,45` (Confidence: 65%) -- CLI tests pass `tmp` paths via string interpolation into `execSync` shell commands. If a tmpdir path contained spaces or special characters, these tests would break. The `os.tmpdir()` return typically has no spaces, so this is unlikely in practice.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The test suite is well-structured with good use of shared fixtures, proper cleanup via `afterAll`, clear AAA structure, and meaningful test names. The new tests (T1-T6) add valuable coverage for lock failure, staleness detection in real git repos, directory boundary matching, and CLI edge cases. The primary concern is the untested behavioral change in `removeEntry` where corrupt `index.json` files are now silently overwritten rather than preserved (HIGH). The refactored `checkAllStaleness` positive path also lacks coverage despite diverging from `checkStaleness`. PF-001 (Promise resolver naming) was reviewed but does not apply -- these tests use no Promise callbacks where the `resolve`/`path.resolve` shadow would be relevant.
