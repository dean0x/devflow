# Testing Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Missing test for ensure-features-init empty argument guard** - `scripts/hooks/ensure-features-init:6`, `tests/shell-hooks.test.ts:1571`
**Confidence**: 90%
- Problem: The production code adds `[ -z "$1" ] && return 1` (line 6 of `ensure-features-init`) as a security guard against empty arguments that could cause `mkdir -p /.features` at filesystem root. The 5 ensure-features-init tests cover create, no-overwrite, gitignore-with-git, skip-gitignore-no-git, and idempotency -- but none test this guard. This is a SEC-3 fix (per the commit message) with no corresponding test proving the defense works.
- Fix: Add a test that sources `ensure-features-init` with an empty string and asserts the return code is 1 and no `.features/` directory is created:
```typescript
it('returns 1 when called with empty argument', () => {
  const result = execSync(
    `bash -c 'source "${ENSURE_FEATURES}" "" && echo OK || echo FAIL'`,
    { stdio: 'pipe' },
  ).toString().trim();
  expect(result).toBe('FAIL');
  // Verify no .features/ created at filesystem root or cwd
  expect(fs.existsSync(path.join(tmpDir, '.features'))).toBe(false);
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Auto-clean tests do not cover queue with only assistant entries (no user entries)** - `tests/shell-hooks.test.ts:1351-1430`
**Confidence**: 82%
- Problem: The 4 auto-clean tests cover: orphan user-only queue (5 entries), empty queue, single orphan user entry, and healthy mixed queue. All user-only scenarios are covered. However, the auto-clean grep checks for the absence of `"role"..."assistant"` -- a queue with only assistant entries (e.g., from a crash that lost user captures) would pass the grep check and not be cleaned. While this is arguably correct behavior (assistant entries are not orphans), it is an undocumented assumption. This is a borderline case -- the current auto-clean logic deliberately only targets user-only queues, so the missing test is more about documenting the design decision than catching a bug.
- Fix: Consider adding a test that confirms a queue with only assistant entries is preserved (not truncated), with a comment explaining the design rationale:
```typescript
it('auto-clean preserves assistant-only queue (not considered orphan)', () => {
  // ... setup with assistant-only entries ...
  // Auto-clean only targets user-only queues; assistant-only is not an orphan condition
  expect(lines).toHaveLength(existingCount + 1);
});
```

## Pre-existing Issues (Not Blocking)

_No pre-existing CRITICAL issues found._

## Suggestions (Lower Confidence)

- **Overflow test first-entry assertion is fragile to implementation changes** - `tests/shell-hooks.test.ts:1490-1491` (Confidence: 65%) -- The new assertion `expect(firstEntry.content).toBe('entry 102')` hardcodes the expected content based on the exact `tail -100` truncation behavior of the shell script. If the overflow threshold (200/100) changes, or the implementation switches to a different truncation strategy (e.g., keeping the first N entries instead of last N), this assertion will break. The existing assertion on line count (100) and last entry content already validates the overflow contract. The new assertion is not wrong, but it couples the test to the truncation direction rather than the behavioral contract.

- **Test descriptions accurately reflect behavior** - All 3 new auto-clean test descriptions (`auto-clean with empty queue file`, `auto-clean with single orphan user entry`, `auto-clean does not truncate queue that already has assistant entries`) are accurate and clearly describe what they test. The overflow test's added assertion also has an accurate inline comment explaining the math. No description accuracy issues found.

- **Removed test "content array: joins text blocks, excludes tool_use" does not exist in this diff** - (Confidence: 60%) -- This test was mentioned in the branch context as a question, but it does not appear in the diff, at the base commit, or in any file touched by this branch. The question is moot for this review.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Conditions

1. Add a test for the `ensure-features-init` empty argument guard (`[ -z "$1" ] && return 1`). This is a security fix (SEC-3) that lacks test coverage.

### Assessment of Branch Context Questions

1. **Auto-clean tests (4 new)**: Good edge case coverage. The empty queue, single orphan, and multi-orphan cases exercise the boundary conditions of the grep-based detection. Missing case (assistant-only queue) is noted as a should-fix suggestion but is not blocking.

2. **ensure-features-init tests (5 tests)**: Cover create, no-overwrite, gitignore-with-git, skip-gitignore-no-git, and idempotency well. Missing: test for the empty argument guard (BLOCKING MEDIUM). Missing: test for `mkdir -p` failure is acceptable -- simulating filesystem permission errors in CI is unreliable and low-value.

3. **Removed test "content array: joins text blocks, excludes tool_use"**: This test does not exist in the diff or at the base commit. Not applicable to this branch.

4. **Overflow test changed to mixed roles**: The overflow test already used mixed roles at the base commit (`64993af`). This branch only adds a content assertion for the first preserved entry. The mixed-role approach is a valid design choice -- it prevents the auto-clean from firing and interfering with the overflow test, which is testing a different code path. Not a test smell.

5. **Test descriptions**: All new and modified test descriptions accurately describe the tested behavior.

### Additional Observations

- **Indentation fixes** (learning-agent.test.ts:271,285 and decisions-agent.test.ts:423): Pure style fixes correcting misaligned `logFile` property. No behavioral impact. Appropriate housekeeping.
- **Unused parameter prefix** (learning-agent.test.ts:41): `args` renamed to `_args` in `mockExecFile`. Correct practice to suppress linter warnings for unused parameters.
- **All 140 tests pass** (93 shell-hooks + 47 learning/decisions agent tests) with zero failures.
