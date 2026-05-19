# Testing Review Report

**Branch**: fix-suppress-quick-classification -> main
**Date**: 2026-04-19

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Inconsistent `hasClassification` assertion coverage across QUICK-tier tests** - `tests/integration/ambient-activation.test.ts:57-61`
**Confidence**: 82%
- Problem: Three of the four QUICK-tier tests (lines 38, 45, 53) now assert `expect(hasClassification(result)).toBe(false)`, validating the preamble change suppresses visible classification output. However, the fourth QUICK-tier test ("preamble filter -- slash command prefix skipped before classification", line 57-61) does not include this assertion, despite testing the same behavioral expectation: QUICK prompts should not produce a classification announcement.
- Fix: If the preamble does not fire for slash-command prompts (it exits early at line 25-27 of `preamble`), then the model also receives no classification instruction and should not emit a classification tag. Add the assertion for consistency:
```typescript
it('preamble filter -- slash command prefix skipped before classification', async () => {
  const result = await runClaudeStreaming('/help with something', { timeout: 20000 });
  expect(hasSkillInvocations(result)).toBe(false);
  expect(hasClassification(result)).toBe(false);  // <-- add this
  console.log(`preamble filter (slash command): no skills (${result.durationMs}ms)`);
});
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`hasDevFlowBranding` is a dead-code duplicate of `hasClassification`** - `tests/integration/helpers.ts:221-224`
**Confidence**: 85%
- Problem: The JSDoc on `hasDevFlowBranding` (line 214-220) explicitly states it is "functionally identical" to `hasClassification`. No callers use `hasDevFlowBranding` in any test file (confirmed by searching the codebase). This is dead code that adds maintenance burden.
- Fix: Remove `hasDevFlowBranding` and its JSDoc in a follow-up cleanup. Not blocking since this existed before this PR.

### LOW

**QUICK tests rely on textFragment capture to verify suppression -- fragile if output format changes** - `tests/integration/helpers.ts:196-198`
**Confidence**: 80%
- Problem: `hasClassification` searches `textFragments` for a regex matching `devflow: INTENT/DEPTH`. This works today because the classification announcement is emitted as a text block in the assistant message. If the model started emitting classifications in a different format (e.g., inside a tool call, or with different casing beyond the `i` flag), the regex would miss it. The approach is adequate but coupled to the current output format.
- Fix: No immediate action needed. The `i` flag and the broad `CLASSIFICATION_PATTERN` regex provide reasonable coverage. Document the coupling as a comment near the regex if it becomes a maintenance issue.

## Suggestions (Lower Confidence)

- **Missing `hasClassification(result).toBe(true)` assertions for GUIDED/ORCHESTRATED tier tests** - `tests/integration/ambient-activation.test.ts:66-222` (Confidence: 65%) -- The GUIDED and ORCHESTRATED tests verify skill loading but do not assert that a classification announcement IS present. Adding positive `hasClassification` assertions for these tiers would provide symmetric coverage (QUICK = no classification, GUIDED/ORCHESTRATED = yes classification). However, this depends on whether the model reliably emits the classification tag as a text block, which may vary.

## Pitfall Check

**PF-001** (Renaming Promise resolver param from `resolve`): Verified. The `resolve` param in `new Promise((resolve) => {...})` at `tests/integration/helpers.ts:62` and `:249` remains correctly named `resolve` -- the project convention is preserved. No violation.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The test changes are well-targeted: path updates correctly track the file rename (`classification-rules.md` moved from `references/` to parent), the preamble text update matches the production hook, and the new `hasClassification` assertions validate the PR's core behavioral change (QUICK classification suppression). The one blocking MEDIUM is a consistency gap in the fourth QUICK-tier test that should be easy to address.
