# Tests Review Report

**Branch**: feat/pre-v2-cleanup -> main
**Date**: 2026-03-30

## Issues in Your Changes (BLOCKING)

### HIGH

**Integration tests duplicate source logic instead of calling it** - `tests/skill-namespace.test.ts:115-134`, `tests/skill-namespace.test.ts:150-177`
**Confidence**: 90%
- Problem: The "cleanup removes both prefixed and unprefixed dirs" test (lines 115-134) manually calls `fs.rm` to simulate cleanup, and the "shadowed skill copies shadow to prefixed path instead of source" test (lines 150-177) manually reimplements the shadow-check-then-copy logic with inline `try/catch` and `if/else`. Both tests duplicate the installer's internal logic rather than calling the actual function under test. If the installer's cleanup or shadow logic changes (e.g., adds a third legacy format, changes the stat-check to use `fs.access`), these tests will continue to pass while the real code is broken. They test a copy of the algorithm, not the algorithm itself.
- Fix: Extract the cleanup loop and the shadow-aware install step from `installViaFileCopy` into standalone exported functions (e.g., `cleanupSkillDirs(claudeDir, skills)` and `installSkill(skillSource, skillName, claudeDir, devflowDir)`). Then test those directly. Alternatively, if extracting is too invasive for this PR, add a comment acknowledging the duplication:
```typescript
// NOTE: This duplicates installer.ts cleanup logic. If that logic changes,
// update this test to match. Tracked for extraction in a future PR.
```

### MEDIUM

**Empty-string edge case tests assert degenerate behavior with no real-world caller** - `tests/skill-namespace.test.ts:33-35`, `tests/skill-namespace.test.ts:49-51`, `tests/skill-namespace.test.ts:53-55`
**Confidence**: 85%
- Problem: Three tests verify behavior for empty strings (`prefixSkillName('')` -> `'devflow:'`, `unprefixSkillName('')` -> `''`, `unprefixSkillName('devflow:')` -> `''`). No caller in the codebase ever passes an empty string or bare prefix to these functions. The `'devflow:'` result from `prefixSkillName('')` would create an invalid skill directory name `~/.claude/skills/devflow:` -- asserting this behavior codifies a bug as correct. These tests add noise without protecting against real regressions.
- Fix: Either remove the empty-string tests entirely, or change `prefixSkillName` to throw on empty input and test for that:
```typescript
it('rejects empty string', () => {
  expect(() => prefixSkillName('')).toThrow();
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**hasShadow normalization tests overlap with existing `tests/skills.test.ts`** - `tests/skill-namespace.test.ts:74-99` vs `tests/skills.test.ts:7-35`
**Confidence**: 82%
- Problem: `tests/skills.test.ts` already tests `hasShadow` with bare names (lines 18-27) and the false case (lines 29-34). The new `hasShadow normalizes prefixed names` describe block in `skill-namespace.test.ts` re-tests "bare name" (line 86-88) and "false when no shadow exists" (line 95-98) -- both already covered. Only the "prefixed name" test (line 90-93) is genuinely new and validates the normalization fix. The duplication means two test files must be maintained for the same function.
- Fix: Keep only the prefixed-name normalization test in `skill-namespace.test.ts`. Remove the bare-name and false-when-missing tests since they are already in `skills.test.ts`. Alternatively, move the normalization test into `skills.test.ts` where the rest of `hasShadow` coverage lives:
```typescript
// In tests/skills.test.ts, add to the existing hasShadow describe block:
it('normalizes prefixed name to bare name for lookup', async () => {
  await fs.mkdir(path.join(tmpDir, 'skills', 'core-patterns'), { recursive: true });
  const result = await hasShadow('devflow:core-patterns', tmpDir);
  expect(result).toBe(true);
});
```

## Pre-existing Issues (Not Blocking)

No pre-existing issues identified.

## Suggestions (Lower Confidence)

- **Missing test: `prefixSkillName` with non-devflow namespace prefix** - `tests/skill-namespace.test.ts:21-31` (Confidence: 65%) -- A string like `'other:core-patterns'` would get double-prefixed to `'devflow:other:core-patterns'`. If another plugin ecosystem uses colons, this could cause collisions. Whether this matters depends on whether non-devflow-prefixed strings can ever reach this function.

- **Missing test: LEGACY_SKILL_NAMES should not contain current prefixed names** - `tests/skill-namespace.test.ts:65-72` (Confidence: 70%) -- The test verifies that every current bare skill name is in `LEGACY_SKILL_NAMES`, but does not verify the inverse: that `LEGACY_SKILL_NAMES` doesn't accidentally contain a `devflow:`-prefixed entry, which would cause cleanup to look for `~/.claude/skills/devflow:devflow:foo`.

- **Non-shadowed install test only validates `copyDirectory`, not namespace behavior** - `tests/skill-namespace.test.ts:136-148` (Confidence: 72%) -- This test creates a source dir, copies it to a prefixed target, and reads it back. It validates that `copyDirectory` works (already tested implicitly elsewhere) but does not test any namespace-specific logic. The only namespace involvement is the target path string, which is constructed in the test itself.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Tests Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The committed tests (pure function coverage for prefix/unprefix, roundtrip property, and LEGACY_SKILL_NAMES migration guard) are solid and well-structured. The `hasShadow` normalization test for prefixed names (line 90-93) directly proves the namespace fix works. However, the uncommitted integration tests have a fundamental design issue: they duplicate installer source logic inline rather than calling the actual functions, meaning they can silently drift from production behavior. The empty-string edge cases codify degenerate behavior that no real caller exercises. Consolidating the `hasShadow` overlap with the existing `skills.test.ts` would reduce maintenance surface.
