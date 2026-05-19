# Code Review Summary

**Branch**: fix-threshold-promotion-bug -> main
**Date**: 2026-05-08
**Timestamp**: 2026-05-08_2156

## Merge Recommendation: CHANGES_REQUESTED

Two HIGH-confidence type safety issues in your changes must be addressed before merge. The PR is otherwise well-structured with sound architectural improvements, but the type system gaps undermine the very type tightening the PR introduces.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 2 | 1 | 0 | 3 |
| Should Fix | 0 | 1 | 4 | 0 | 5 |
| Pre-existing | 0 | 0 | 3 | 2 | 5 |

---

## Blocking Issues (Must Fix Before Merge)

### HIGH — `updateDecisionsStatus` Parameter Type Mismatch

**Location**: `src/cli/commands/learn.ts:389`
**Confidence**: 92% (flagged by 3 reviewers)
**Severity**: HIGH

The PR introduces `DecisionsEntryStatus` type union but `updateDecisionsStatus` still accepts `newStatus: string`. This creates a type safety gap — any arbitrary string can be written to markdown, violating the boundary validation principle you're establishing.

**Impact**: The function is called from `decisions.ts:889` with `'Deprecated'` (valid), but the loose typing permits injection of unrecognized status values that would round-trip as `'Unknown'` through `toDecisionsStatus`.

**Fix**:
```typescript
export async function updateDecisionsStatus(
  filePath: string,
  anchorId: string,
  newStatus: DecisionsEntryStatus,
): Promise<boolean>
```

Import `DecisionsEntryStatus` from `decisions.ts` into `learn.ts`. All existing callers already pass valid literals.

---

### HIGH — Test Data Lacks Type Annotation

**Location**: `tests/decisions/cli-subcommands.test.ts:444`
**Confidence**: 95% (flagged by 3 reviewers)
**Severity**: HIGH

The `allEntries` array is constructed without `DecisionsEntry[]` type annotation, allowing string literals to bypass the new type constraints. Sibling tests at lines 468 and 485 use explicit annotations; this inconsistency means the line-444 test won't catch shape changes.

**Impact**: If someone renames a status value or changes the valid `file` values, this test silently passes.

**Fix**:
```typescript
const allEntries: DecisionsEntry[] = [
  { id: 'ADR-001', pattern: 'Use X', file: 'decisions', filePath: '/tmp/decisions.md', status: 'Accepted', createdDate: '2026-01-01' },
  // ... rest of array
];
```

---

### MEDIUM — `VALID_STATUSES` Set Type Allows Silent Drift

**Location**: `src/cli/commands/decisions.ts:136`
**Confidence**: 85%
**Severity**: MEDIUM

The `VALID_STATUSES` set is typed as `Set<string>` instead of `Set<DecisionsEntryStatus>`. If a new status is added to the union but not to the set, the compiler won't flag the drift — `toDecisionsStatus` will silently map it to `'Unknown'`.

**Fix** (choose one approach):

**Option A** — Tighten the set definition:
```typescript
const VALID_STATUSES: Set<DecisionsEntryStatus> = new Set([
  'Accepted', 'Active', 'Deprecated', 'Superseded', 'Unknown',
]);
```

**Option B** — Derive both from a single source:
```typescript
const VALID_STATUSES_ARRAY = ['Accepted', 'Active', 'Deprecated', 'Superseded', 'Unknown'] as const;
export type DecisionsEntryStatus = (typeof VALID_STATUSES_ARRAY)[number];
const VALID_STATUSES: Set<string> = new Set(VALID_STATUSES_ARRAY);
```

---

## Should-Fix Issues (Recommended but not blocking)

### HIGH — No Test Coverage for `toDecisionsStatus` Normalizer

**Location**: `src/cli/commands/decisions.ts:139-141`
**Confidence**: 88%
**Category**: Code you added

The PR introduces `toDecisionsStatus` as a boundary validator with silent `'Unknown'` fallback, but there's no test coverage. If statuses in markdown files diverge from `VALID_STATUSES`, entries will silently become `'Unknown'` without any detection.

**Recommended Test**:
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

Note: You may need to export `toDecisionsStatus` or test it indirectly through the capacity review parser path.

---

### MEDIUM — Incomplete Migration of EEXIST Fix

**Location**: `src/cli/utils/legacy-decisions-purge.ts:54-76`
**Confidence**: 85%
**Category**: Code you touched

The `acquireMkdirLock` EEXIST discrimination fix was applied to `learn.ts:339-341` but not to the duplicated local copy in `legacy-decisions-purge.ts`. The duplicate still swallows all errors as "lock held", causing 30-second hangs on permission errors instead of failing fast.

**Fix**:
```typescript
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
```

---

### MEDIUM — Unsanitized `artifact_path` in Filesystem Write

**Location**: `src/cli/commands/decisions.ts:730-738`
**Confidence**: 82%
**Category**: Code you added

The `obs.artifact_path` (sourced from JSONL) is split on `#` and passed to `updateDecisionsStatus` with no path containment check. While exploitation requires a corrupted local log file (not externally reachable), a defense-in-depth check would prevent writing outside `.memory/decisions/`.

**Fix**:
```typescript
const absPath = path.isAbsolute(decisionsFilePath)
  ? decisionsFilePath
  : path.join(process.cwd(), decisionsFilePath);
const expectedDir = path.join(memoryDir, 'decisions');
if (!absPath.startsWith(expectedDir + path.sep)) {
  p.log.warn(`Skipping out-of-bounds artifact path: ${decisionsFilePath}`);
} else {
  const updated = await updateDecisionsStatus(absPath, anchorId, 'Deprecated');
  // ...
}
```

---

### MEDIUM — No Test Coverage for `acquireMkdirLock` EEXIST Discrimination

**Location**: `src/cli/commands/learn.ts:339-341`
**Confidence**: 82%
**Category**: Code you changed

The PR hardens `acquireMkdirLock` to re-throw unexpected filesystem errors instead of treating them as "lock held". This behavioral change has zero test coverage. Previously, EACCES/EPERM would spin for 30 seconds; now they fail fast.

**Recommended Test**:
```typescript
describe('acquireMkdirLock EEXIST discrimination', () => {
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

---

## Pre-existing Issues (Not Blocking — Fix in Separate PR)

### MEDIUM — Sequential Lock Acquire/Release in Deprecation Loop
**Location**: `src/cli/commands/decisions.ts:885-895`
**Confidence**: 82%

Each deprecation calls `updateDecisionsStatus` individually, acquiring/releasing lock N times. Batching the mutations under one lock would reduce filesystem overhead.

---

### MEDIUM — Duplicated Deprecation Handler Logic
**Location**: `learn.ts:1030-1046` vs `decisions.ts:729-745`
**Confidence**: 82%

Nearly identical deprecation blocks — both parse `artifact_path`, resolve to absolute, call `updateDecisionsStatus`, log. Consider extracting a shared helper in a future PR.

---

### MEDIUM — Lock Release Swallows All `rmdir` Errors
**Location**: `src/cli/commands/learn.ts:436`
**Confidence**: 80%

The `finally` block discards all `rmdir` errors (expected ENOENT + unexpected EPERM). While stale-lock detection handles orphaned locks, permission errors could mask filesystem issues.

---

### LOW — Synchronous Child Process Spawns
**Location**: `src/cli/commands/decisions.ts:923-927`
**Confidence**: 80%

Two `execFileSync` calls block the event loop. Since this is an interactive CLI (user waiting at prompt), blocking is acceptable, but async variants would free the loop for UI updates.

---

## Architectural & Code Quality Assessment

**Strengths** (per Architecture + Complexity reviewers):

1. **DRY Unification**: `tryImmediatePromotion` refactoring is textbook — options-object pattern with safe defaults (backward compatible for new callers, opt-in guards for existing-entry path).

2. **Testability-Driven Extraction**: `clearCapacityNotifications` moved from inline to pure function, enabling direct testing without spawning child processes (follows DIP).

3. **Parse-Boundary Type Narrowing**: `DecisionsEntryStatus` union + `toDecisionsStatus` normalizer at parse site follows ADR-001 principle (clean-break type safety, no migration compat).

4. **Error-Handling Improvement**: `acquireMkdirLock` EEXIST discrimination is a genuine correctness fix — re-throws unexpected filesystem errors instead of silent 30-second retries.

5. **Complexity Net Negative**: Tests now call extracted functions directly instead of replicating logic — this is measurable simplification.

**Concerns** (per Consistency + TypeScript reviewers):

1. The type tightening you introduce is undermined by loose types on functions that consume those types (`updateDecisionsStatus: newStatus: string`).

2. Test coverage gaps on new boundary validators and behavioral changes weaken confidence in the refactoring's correctness.

3. The incomplete migration of EEXIST fix to a duplicate function leaves inconsistency in the codebase.

---

## Action Plan

**Before Merge** (blocking):
1. Tighten `updateDecisionsStatus` parameter to `DecisionsEntryStatus`
2. Add `DecisionsEntry[]` type annotation to test data at line 444
3. Choose and apply one approach to tighten `VALID_STATUSES` typing

**Recommended** (should-fix, improves quality):
4. Add tests for `toDecisionsStatus` behavior
5. Apply EEXIST fix to `legacy-decisions-purge.ts` duplicate
6. Add path containment check for `artifact_path` write
7. Add tests for `acquireMkdirLock` EEXIST discrimination

**Future** (pre-existing, lower priority):
- Batch deprecation loop under single lock
- Extract shared deprecation handler helper
- Improve lock-release error handling
- Consider async variants for `execFileSync` calls

---

## Summary

This PR demonstrates thoughtful architectural improvements and a genuine commitment to type safety. The blocking issues are all solvable 5-line changes that complete the type tightening story the PR starts. Once those are fixed, the should-fix items are lower-priority improvements that strengthen coverage and consistency but don't risk correctness.

**Score**: 7.5/10 (strong foundation, type safety gaps must close)
