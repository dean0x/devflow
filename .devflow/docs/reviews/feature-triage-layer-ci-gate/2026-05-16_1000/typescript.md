# TypeScript Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Unvalidated JSON.parse returns in test assertions** - `tests/sentinel.test.ts:164`, `tests/sentinel.test.ts:308`, `tests/sentinel.test.ts:335`, `tests/sentinel.test.ts:352`, `tests/sentinel.test.ts:368`, `tests/sentinel.test.ts:381`, `tests/sentinel.test.ts:394`
**Confidence**: 82%
- Problem: Multiple `JSON.parse(output)` calls in new test code access deeply nested properties (e.g., `parsed.hookSpecificOutput.additionalContext`) without any runtime type narrowing. While this is test code and TypeScript strict mode is on (so `parsed` is inferred as `any` from `JSON.parse`), the pattern allows tests to pass silently if the hook output structure changes — the test would throw a runtime error on a missing property rather than a clear assertion failure. This is consistent with the existing test code in `tests/memory.test.ts` (lines 618-634), but the PR adds 7+ new instances.
- Fix: Consider extracting a typed helper or adding a structural assertion before property access:
```typescript
// Option A: Assertion guard
const parsed: unknown = JSON.parse(output);
expect(parsed).toHaveProperty('hookSpecificOutput.additionalContext');
const ctx = (parsed as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;

// Option B: Typed helper (reduces repetition across 7+ call sites)
function parseHookOutput(output: string): { additionalContext: string } {
  const parsed = JSON.parse(output);
  return parsed.hookSpecificOutput;
}
```

## Issues in Code You Touched (Should Fix)

### HIGH

(none)

### MEDIUM

**Variable name shadows imported function** - `tests/sentinel.test.ts:383`, `tests/sentinel.test.ts:395`
**Confidence**: 85%
- Problem: In the `context hook registration` test block, the local variable `const hasContextHook = settings.hooks.SessionStart.some(...)` shadows the imported `hasContextHook` function from `init.js` (imported via dynamic `await import`). While this works because the shadowed name is only used as a boolean assertion target and the import is already captured in a different binding, it reduces readability — a reader must trace whether `hasContextHook` refers to the utility function or the local boolean.
- Fix: Rename the local variable to avoid ambiguity:
```typescript
const hookPresent = settings.hooks.SessionStart.some(
  (m: { hooks: { command: string }[] }) =>
    m.hooks.some((h: { command: string }) => h.command.includes('session-start-context')),
);
expect(hookPresent).toBe(true);
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`JSON.parse` with type assertion instead of runtime validation in hook utilities** - `src/cli/commands/init.ts:119`, `src/cli/commands/init.ts:151`, `src/cli/commands/init.ts:182`
**Confidence**: 80%
- Problem: The new `addContextHook`, `removeContextHook`, and `hasContextHook` functions use `const settings: Settings = JSON.parse(settingsJson)` which is a type assertion on the `any` return of `JSON.parse`. Malformed JSON or structurally unexpected input would cause runtime errors at property access sites (e.g., `settings.hooks?.SessionStart`). This is consistent with the existing pattern used by `addMemoryHooks` (`memory.ts:26`), `addLearningHook`, and other hook utilities throughout the codebase, so it is not a regression — the new code correctly follows established convention. The broader pattern of unvalidated `JSON.parse` at trust boundaries is a pre-existing concern across all hook utilities.
- Note: Follows the established `add/remove/has` hook utility pattern documented in the cli-rules feature knowledge base. Changing this would require updating all hook utilities simultaneously for consistency.

## Suggestions (Lower Confidence)

- **Inline type annotations on dynamic import assertions** - `tests/sentinel.test.ts:378-432` (Confidence: 65%) — The `context hook registration` tests use `await import('../src/cli/commands/init.js')` with destructured names but rely on TypeScript's inference from the dynamic import. If the module shape changes, errors would only surface at runtime. Consider typing the destructured result.

- **Duplicated sentinel path construction** - `src/cli/commands/learn.ts:936`, `src/cli/commands/memory.ts:335` (Confidence: 68%) — The sentinel path construction pattern (`path.join(gitRoot, '.memory', '.learning-disabled')` and `path.join(gitRoot, '.memory', '.working-memory-disabled')`) is repeated across enable/disable/status branches in both files. A small utility like `sentinelPath(gitRoot, feature)` would centralize this. Low priority given the current scale.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The TypeScript changes are well-structured and follow established codebase patterns (applies ADR-001 — no migration cruft, clean additions only). The new `addContextHook`/`removeContextHook`/`hasContextHook` utilities in `init.ts` correctly implement the `add/remove/has` triple documented in the cli-rules knowledge base, with proper `Settings` and `HookMatcher` type usage, idempotency, and cleanup of empty containers. The early-exit refactoring in `learn.ts` and `memory.ts` properly handles the if/else branches so sentinel management runs unconditionally (both when hooks were already enabled and when they are newly enabled). Strict mode passes with zero errors. No `any` types introduced. The sentinel test suite (`sentinel.test.ts`, 434 lines) provides thorough coverage. Minor issues are the unguarded `JSON.parse` in tests and a variable shadowing a function name — neither blocks merge.
