# Complexity Review Report

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

_No blocking complexity issues found._

## Issues in Code You Touched (Should Fix)

_No should-fix complexity issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**LEGACY_SKILL_NAMES array exceeds maintainability threshold (188 entries, 224 lines)** - `src/cli/plugins.ts:300-524`
**Confidence**: 85%
- Problem: The `LEGACY_SKILL_NAMES` array has grown to 188 entries spanning 224 lines. While the PR only adds 16 entries, the array is now well past the 200-line critical threshold for a single data structure. Inline comments provide some structure, but scanning for duplicates or understanding the evolution requires reading through all entries sequentially.
- Fix: Consider extracting sub-arrays by era/version and composing them:
```typescript
const V1_LEGACY = ['devflow-core-patterns', ...];
const V2_NAMESPACE_MIGRATION = ['core-patterns', ...];
const V2_AMBIENT_PREFIXED = ['devflow:router', ...];
export const LEGACY_SKILL_NAMES = [
  ...V1_LEGACY,
  ...V2_NAMESPACE_MIGRATION,
  ...V2_AMBIENT_PREFIXED,
];
```

## Suggestions (Lower Confidence)

- **Test setup duplication across describe blocks** - `tests/ambient.test.ts:17-26, 155-165, 316-324` (Confidence: 65%) — Three describe blocks repeat nearly identical `beforeEach`/`afterEach` with `vi.spyOn(fs, ...)`. A shared setup helper or top-level hooks would reduce repetition, though the current approach is explicit and readable.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 9/10
**Recommendation**: APPROVED

The changes in this PR actively reduce complexity:
- Extracting `installCommandsRule()` and `removeCommandsRule()` from inline logic reduces function length and improves reusability.
- The narrowed ENOENT catch in `removeCommandsRule` replaces a bare `catch {}` with explicit error discrimination.
- The `filterHookEntries` null-guard simplification (`Object.keys(settings.hooks)` without the redundant `settings.hooks &&` check) removes dead logic since the early return on line 60 already guarantees `settings.hooks` exists at that point.
- New functions are short (4-6 lines), single-responsibility, and well-documented with JSDoc.
- The `LEGACY_SKILL_NAMES` additions are purely additive data entries following the established append-only pattern.

Overall, the code stays well within complexity thresholds. Functions are short, nesting is shallow (max depth 3), and cyclomatic complexity is low throughout the changed code.
