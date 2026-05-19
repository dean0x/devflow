# Testing Review Report

**Branch**: feat/pr-description-pipeline -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Test entries in `excludes deprecated and superseded entries` lack `DecisionsEntry` type annotation** - `tests/decisions/cli-subcommands.test.ts:444-449`
**Confidence**: 85%
- Problem: The `allEntries` array at line 444 is constructed with plain object literals without a `DecisionsEntry[]` type annotation. Since the PR tightened `DecisionsEntry.status` from `string` to `DecisionsEntryStatus` and `file` from `string` to `'decisions' | 'pitfalls'`, these test objects bypass the new type constraints via inference from string literals. TypeScript widens the literal types in the absence of an explicit annotation, meaning any typo in `status` or `file` values would not be caught at compile time. The other two tests in this describe block (`excludes entries created within 7-day protection window` at line 468 and `sorts entries by least-used` at line 485) correctly annotate their arrays as `DecisionsEntry[]`.
- Fix: Add `DecisionsEntry[]` type annotation to the `allEntries` variable:
```typescript
const allEntries: DecisionsEntry[] = [
  { id: 'ADR-001', pattern: 'Use X', file: 'decisions', filePath: '/tmp/decisions.md', status: 'Accepted', createdDate: '2026-01-01' },
  // ...
];
```

## Issues in Code You Touched (Should Fix)

### HIGH

**No tests for `toDecisionsStatus` normalizer function** - `src/cli/commands/decisions.ts:139-141`
**Confidence**: 88%
- Problem: The PR introduces a new `toDecisionsStatus` function that normalizes raw markdown status strings into the `DecisionsEntryStatus` union. This function is a boundary validator (parse-don't-validate pattern) that silently maps unrecognized strings to `'Unknown'`. There are no unit tests verifying this behavior. If the set of valid statuses diverges from what markdown files actually contain (e.g., a future status like `'Archived'` gets added to files but not to `VALID_STATUSES`), the silent `'Unknown'` fallback could cause downstream logic to misclassify entries without any test catching the regression.
- Fix: Add tests for `toDecisionsStatus` (export it or test via `DecisionsEntry` construction). At minimum:
```typescript
describe('toDecisionsStatus normalizer', () => {
  it('passes through valid statuses', () => {
    for (const s of ['Accepted', 'Active', 'Deprecated', 'Superseded', 'Unknown']) {
      expect(toDecisionsStatus(s)).toBe(s);
    }
  });
  it('maps unrecognized strings to Unknown', () => {
    expect(toDecisionsStatus('Archived')).toBe('Unknown');
    expect(toDecisionsStatus('')).toBe('Unknown');
  });
});
```
Note: `toDecisionsStatus` is currently not exported. Either export it for direct testing or test indirectly through the capacity review parser path.

### MEDIUM

**No tests for `acquireMkdirLock` EEXIST discrimination** - `src/cli/commands/learn.ts:339-341`
**Confidence**: 82%
- Problem: The PR hardens `acquireMkdirLock` to re-throw unexpected filesystem errors (e.g., `EACCES`, `EPERM`) instead of swallowing them as if the lock were held. This is a meaningful behavioral change — previously, any `mkdir` failure would be treated as "lock held, retry", potentially spinning for 30 seconds on a permissions error. However, this new behavior has no test coverage. The function is not tested at all in the test suite (`grep` found zero references to `acquireMkdirLock` in tests).
- Fix: Add a focused test for the EEXIST discrimination:
```typescript
describe('acquireMkdirLock', () => {
  it('re-throws non-EEXIST errors from mkdir', async () => {
    // Mock fs.mkdir to throw EACCES
    await expect(acquireMkdirLock('/root/forbidden-lock')).rejects.toThrow();
  });
  it('returns true when lock directory is created successfully', async () => {
    const lockDir = path.join(tmpDir, 'test-lock');
    const result = await acquireMkdirLock(lockDir);
    expect(result).toBe(true);
    await fs.rmdir(lockDir);
  });
});
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Test at line 437 replicates production logic inline instead of calling the extracted function** - `tests/decisions/cli-subcommands.test.ts:437-460`
**Confidence**: 80%
- Problem: The `excludes deprecated and superseded entries from eligible list` test manually replicates the Deprecated/Superseded filter logic inline (line 452-454) rather than calling the production code path. The comment at line 438-443 explains this is intentional (mirrors a `continue` skip in the parser). While the rationale is valid, this pattern means the test can pass even if the production filter logic diverges — the test validates the inline filter, not the actual code path. This is a pre-existing design choice, not introduced by this PR.

## Suggestions (Lower Confidence)

- **D28 notification tests could verify the `threshold` parameter** - `tests/decisions/cli-subcommands.test.ts:511-561` (Confidence: 70%) — The `clearCapacityNotifications` function accepts a configurable `threshold` parameter (default 50), but all three tests use the default. A test with a custom threshold would verify the parameter is actually wired through.

- **`clearCapacityNotifications` tests use untyped object literals for notifications** - `tests/decisions/cli-subcommands.test.ts:515-517` (Confidence: 65%) — After changing the type annotation from `Record<string, { active: boolean; dismissed_at_threshold: number | null }>` to the inferred type (removing the explicit annotation), the test objects are no longer checked against `NotificationFileEntry`. This is fine if TypeScript inference is sufficient, but the explicit annotation provided documentation value.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 1 | 1 | - |
| Pre-existing | - | - | 1 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The PR demonstrates good testing instincts by extracting `clearCapacityNotifications` specifically for testability and migrating D28 tests from inline logic replication to calling the real function. However, two new behaviors lack test coverage: the `toDecisionsStatus` normalizer (boundary validator with silent fallback) and the `acquireMkdirLock` EEXIST discrimination (behavioral change from swallow-all to re-throw). The type annotation gap in one test block weakens the compile-time safety that the PR's type tightening was designed to provide.
