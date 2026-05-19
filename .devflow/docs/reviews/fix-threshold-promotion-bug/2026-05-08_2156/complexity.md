# Complexity Review Report

**Branch**: feat/pr-description-pipeline -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

No blocking complexity issues found.

## Issues in Code You Touched (Should Fix)

No should-fix complexity issues found.

## Pre-existing Issues (Not Blocking)

### HIGH

**`updateDecisionsStatus` has dual parsing strategies with moderate nesting** - `learn.ts:386-438`
**Confidence**: 82%
- Problem: The function first attempts a regex-based replacement, then falls back to a line-by-line scan with 3 levels of nesting and a mutable `inSection` flag. The regex pattern itself (`anchorPattern`) is dense and hard to reason about at a glance. Cyclomatic complexity is approximately 8 (lock acquisition + file read try/catch + regex miss branch + loop + `inSection` toggle + section boundary + status match + `!changed` guard).
- Fix: Consider splitting into two named strategies (e.g., `replaceViaRegex` and `replaceViaLineWalk`) and composing them with an early return. This would flatten the nesting and make each approach independently testable.

### MEDIUM

**`json-helper.cjs` file length exceeds recommended thresholds** - `json-helper.cjs` (1936 lines)
**Confidence**: 85%
- Problem: At 1936 lines this file is well above the 500-line critical threshold. While it is a shell-script helper with many independent operations, the sheer size makes navigation and maintenance difficult. The `tryImmediatePromotion` refactoring in this PR is a positive step (reducing inline duplication), but the file continues to grow.
- Fix: This is a long-standing structural concern. Consider splitting operations into separate modules (e.g., `learning-ops.cjs`, `decisions-ops.cjs`, `json-ops.cjs`) loaded lazily. Not blocking for this PR.

**`decisions.ts` file length at 1030 lines** - `decisions.ts` (1030 lines)
**Confidence**: 80%
- Problem: At 1030 lines, this file is above the 500-line critical threshold. It combines hook management, capacity review helpers, entry parsing, interactive review UI, background runner, and notification clearing. The PR improves this by extracting `clearCapacityNotifications` and `toDecisionsStatus`, which is the right direction.
- Fix: Future work could separate the capacity review logic into its own module. Not blocking for this PR.

## Suggestions (Lower Confidence)

- **Boolean option flags pattern in `tryImmediatePromotion`** - `json-helper.cjs:519` (Confidence: 70%) -- The `opts` parameter uses two boolean flags (`guardCreated`, `firstSeenFallback`) that create 4 possible call variants. Currently only 2 are used: `{}` (new entries) and `{ guardCreated: true, firstSeenFallback: true }` (existing entries). A simpler API could be a single `isExisting: boolean` flag or two distinct functions (`tryPromoteNewEntry` / `tryPromoteExistingEntry`). The current approach is defensible given the explicit JSDoc and clear naming, but the option-bag pattern for booleans can grow harder to reason about as more flags are added.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 1 | 2 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED

This PR is a net complexity improvement. Key wins:

1. **Inline code replaced with function call** (`json-helper.cjs:1026-1031`): The 8-line inline promotion block was replaced by a single `tryImmediatePromotion(existing, { guardCreated: true, firstSeenFallback: true })` call. This eliminates duplicated logic between the new-entry and existing-entry code paths.

2. **Extracted `clearCapacityNotifications`** (`decisions.ts:203-215`): Notification clearing logic moved from inline in the handler to a named, exported, testable function with a configurable threshold parameter.

3. **Introduced `DecisionsEntryStatus` type** (`decisions.ts:134`): Replaced `status: string` with a union type and `toDecisionsStatus` normalizer, eliminating stringly-typed status comparisons.

4. **Tests now call extracted functions directly** (`cli-subcommands.test.ts:526-557`): Tests that previously replicated inline logic now exercise the actual production function, improving coverage fidelity while reducing test complexity.

5. **`acquireMkdirLock` error discrimination** (`learn.ts:339-341`): The catch block now re-throws non-EEXIST errors instead of silently swallowing them, which is both a correctness and clarity improvement.

All changes reduce complexity or maintain the status quo. No new complexity introduced.
