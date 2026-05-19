# Testing Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05

## Issues in Your Changes (BLOCKING)

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**Integration test helper `runClaudeStreaming` has potential resource leak on timeout** - `tests/integration/helpers.ts:113-116`
**Confidence**: 82%
- Problem: When skills are detected, a secondary `setTimeout` is created (8s grace window) that calls `clearTimeout(timer)` and `finish(true)`. However, if the process completes naturally (`close` event on line 130) before the 8s grace window fires, the grace timer is never cleared. This leaves an orphaned timer that will fire after the test resolves, calling `finish(true)` on an already-settled promise (the `if (settled) return` guard prevents damage, but the timer stays alive and can delay Node process exit).
- Fix: Store the grace timer reference and clear it in the `close`/`error` handlers:
```typescript
let graceTimer: ReturnType<typeof setTimeout> | null = null;

// In the skills detection block:
if (skills.length > 0 && !graceTimer) {
  graceTimer = setTimeout(() => {
    clearTimeout(timer);
    finish(true);
  }, 8000);
}

// In close/error handlers:
proc.on('close', () => {
  clearTimeout(timer);
  if (graceTimer) clearTimeout(graceTimer);
  finish(false);
});

proc.on('error', () => {
  clearTimeout(timer);
  if (graceTimer) clearTimeout(graceTimer);
  finish(true);
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Integration test `isFirstToolASkill` is functionally identical to `hasSkillInvocations`** - `tests/integration/helpers.ts:188-192`
**Confidence**: 85%
- Problem: The `isFirstToolASkill` function (lines 188-192) has an identical implementation to `hasSkillInvocations` (line 176-178) -- both just check `result.skills.length > 0`. The function name implies it checks ordering (whether the *first* tool call was a Skill invocation), but it does not actually verify ordering. It is exported but unused in any test file in this PR.
- Fix: Either remove this dead function or implement the ordering check it claims to perform. Since no test uses it, removal is cleanest:
```typescript
// Delete lines 184-192 (isFirstToolASkill and its JSDoc comment)
```

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **`textResult` factory used in ambient.test.ts could be shared** - `tests/ambient.test.ts:15-17` (Confidence: 65%) -- The `textResult` helper creates `StreamResult` fixtures for unit tests. If future test files also need to construct `StreamResult` values for the classification helpers, this factory would need to be duplicated. Consider exporting it from `tests/integration/helpers.ts` alongside the `StreamResult` type.

- **DEVFLOW_PREAMBLE duplicated between helpers.ts and preamble hook** - `tests/integration/helpers.ts:18-23` (Confidence: 70%) -- The preamble text is duplicated verbatim between `tests/integration/helpers.ts` (DEVFLOW_PREAMBLE constant) and `scripts/hooks/preamble` (PREAMBLE variable). The existing `DEVFLOW_PREAMBLE skill refs in tests/integration/helpers.ts exist in actual hook preamble` test in `skill-references.test.ts:690-711` guards against skill reference drift, but does not guard against wording drift in the classification rules themselves. The `SYNC:` comments mitigate this, but structural verification would be stronger.

- **GUIDED integration tests only assert `router` skill load (hard gate) -- specific skill expectations are soft-logged** - `tests/integration/ambient-activation.test.ts:47-110` (Confidence: 62%) -- The GUIDED tests intentionally use two-tier assertions where only `router` loading is a hard assertion and specific skill expectations are just logged. This is a reasonable design choice for non-deterministic LLM output, but it means regressions in skill mapping quality are invisible to CI. Consider adding a separate non-blocking quality report that tracks soft assertion pass rates over time.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Score Rationale

**Strengths**:
- Comprehensive test coverage for the hook rename (ambient-prompt -> preamble): all CRUD operations (add, remove, has) are tested with the new naming, plus dedicated tests for legacy migration (`removeLegacyAmbientHook` has 3 tests, `removeAmbientHook` gains 2 legacy-handling tests, `hasAmbientHook` gains a legacy detection test, `addAmbientHook` gains 2 legacy replacement tests).
- Test data across 6 other test files (`learn.test.ts`, `memory.test.ts`, `shell-hooks.test.ts`, `uninstall-logic.test.ts`, `hud-components.test.ts`, `plugins.test.ts`) is updated consistently to use new skill names (`patterns` instead of `implementation-patterns`, `router` instead of `ambient-router`, etc.).
- Preamble drift detection test updated to reference the new `preamble` hook script and verify structural elements (intent names, depth tiers, router skill reference, classification output format).
- Integration test infrastructure rewritten from synchronous `execFileSync` to streaming `spawn` with early termination -- tests skill *invocation* (tool_use events) rather than permission *denials*, which is a more reliable detection mechanism.
- Two-tier assertion strategy (hard: router loaded; soft: specific skills logged) is a pragmatic approach to LLM non-determinism -- avoids flaky tests while still capturing quality signal.
- All 590 tests pass with zero failures.
- `skill-references.test.ts` updated to handle skill names that are now both skill names and command references (`plan`, `review`, `pipeline`) -- prevents false positives in the reference integrity scanner.

**Deductions**:
- -1: Orphaned timer in `runClaudeStreaming` grace window (resource leak risk)
- -1: Dead `isFirstToolASkill` function exported but unused

### Conditions for Approval

1. Clear the orphaned grace timer in `runClaudeStreaming` close/error handlers to prevent delayed Node process exit during integration test runs.
