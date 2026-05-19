# Complexity Review Report

**Branch**: fix/ambient-skill-loading -> main
**Date**: 2026-03-20
**Commits**: 3 (7630bad, 8800f7b, e7aa588)

## Issues in Your Changes (BLOCKING)

No blocking complexity issues found.

### Assessment

The new code introduced in this branch is consistently low-complexity:

- **`formatDryRunPlan`** (uninstall.ts:58-79, 22 lines): Clean pure function with early return, linear conditional structure, nesting depth of 2. Well within all thresholds.
- **`extractLoadedSkills`** (helpers.ts:92-96, 5 lines): Single-expression function with early return. Trivially simple.
- **`hasSkillLoading`** (helpers.ts:85-87, 3 lines): One-liner boolean return. No complexity.
- **Dry-run block** in uninstall action (uninstall.ts:193-218, 26 lines): Linear flow with one conditional branch and an early return. Nesting depth of 3 (action callback > if dryRun > if !isSelectiveUninstall), which is within the "Good" threshold.
- **Test files** (ambient.test.ts, uninstall-logic.test.ts, ambient-activation.test.ts): All flat assertion-per-test style with zero branching logic. No complexity concerns.
- **Shell hook change** (ambient-prompt:42): Single line addition to a string literal. No control flow change.
- **SKILL.md changes**: Documentation/metadata only.

## Issues in Code You Touched (Should Fix)

No should-fix complexity issues found.

Note: The `uninstall.ts` `.action()` handler (lines 113-508) is a pre-existing long function (~395 lines) with high cyclomatic complexity (nesting depth reaching 5 levels in places, multiple sequential try/catch blocks, and 7+ sequential cleanup phases). This PR adds 27 lines to that handler (the dry-run early-return block) but does NOT increase the maximum nesting depth or cyclomatic complexity -- the new block exits early before the complex section begins. The pre-existing complexity of this handler is noted below.

## Pre-existing Issues (Not Blocking)

### HIGH

**Long action handler with high cyclomatic complexity** - `src/cli/commands/uninstall.ts:113-508`
**Confidence**: 95%
- Problem: The `.action()` callback is approximately 395 lines long with 7 sequential cleanup phases, 5 levels of nesting in several places, and an estimated cyclomatic complexity > 15. Each cleanup phase (docs, memory, claudeignore, settings, managed settings, safe-delete, shadowed skills) follows a near-identical pattern of check-existence > prompt-user > execute-or-skip, but this repetition is inline rather than extracted.
- Impact: Difficult to understand in 5 minutes (violates Iron Law). Hard to test individual cleanup phases in isolation. Changes risk unintended side-effects in other phases.
- Fix: Extract each cleanup phase into a named function (e.g., `cleanupDocs()`, `cleanupMemory()`, `cleanupClaudeignore()`, etc.) and compose them sequentially in the action handler. This is a refactoring task for a separate PR since the code is pre-existing and not introduced by this branch.

## Suggestions (Lower Confidence)

- **Duplicated integration test prompts** - `tests/integration/ambient-activation.test.ts:48,74` and `tests/integration/ambient-activation.test.ts:63-65,83-85` (Confidence: 65%) -- Two pairs of tests use identical prompts and timeout options; extracting these as named constants would reduce duplication and make test intent clearer.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | 1 | 0 | 0 |

**Complexity Score**: 9/10
**Recommendation**: APPROVED

All newly introduced code is well-structured with low cyclomatic complexity, shallow nesting, short functions, and clear naming. The `formatDryRunPlan` function is a good example of extracting pure logic out of the action handler. The dry-run block itself uses an early-return pattern that avoids adding to the pre-existing handler complexity. Test code is flat and readable. No blocking or should-fix complexity issues.
