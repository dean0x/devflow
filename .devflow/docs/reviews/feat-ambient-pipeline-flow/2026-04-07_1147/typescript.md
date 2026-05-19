# TypeScript Review Report

**Branch**: feat/ambient-pipeline-flow -> main
**Date**: 2026-04-07

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Non-null assertions after expect() do not provide runtime safety** (2 occurrences) -- Confidence: 85%
- `tests/ambient.test.ts:571`, `tests/ambient.test.ts:587`
- Problem: `routerSkills!.includes(skill)` at line 571 and `match![1]` at line 587 use non-null assertions. While line 566 calls `expect(routerSkills).toBeDefined()` and line 586 calls `expect(match).not.toBeNull()` first, vitest `expect` with a custom message string does not throw synchronously via the standard control flow -- if the assertion fails, the non-null assertion on the subsequent line would never execute (test already failed). However, if the expect line is accidentally removed or refactored, the `!` silently suppresses a potential null dereference. The pattern `data as User` over `if (isUser(data))` is an anti-pattern per the TypeScript skill.
- Fix: Use a narrowing guard or vitest's type-narrowing assertion pattern:
  ```typescript
  // Line 566-573: replace expect().toBeDefined() + non-null assertion
  if (!routerSkills) {
    expect.unreachable(`${name}: router has no ${depth} row for ${intent}`);
  }
  // routerSkills is now narrowed to string[]
  for (const skill of testSkills) {
    expect(
      routerSkills.includes(skill),
      `${name}: test asserts '${skill}' but router ${depth} ${intent} row is [${routerSkills.join(', ')}]`,
    ).toBe(true);
  }

  // Line 585-587: replace expect().not.toBeNull() + non-null assertion
  if (!match) {
    expect.unreachable('PREAMBLE="..." pattern not found in preamble hook');
  }
  const shellPreamble = match[1];
  ```

### MEDIUM

**`filterHookEntries` mutates its input parameter** -- Confidence: 82%
- `src/cli/commands/ambient.ts:14-35`
- Problem: `filterHookEntries` directly mutates the `settings` object passed to it (filtering arrays, deleting keys). The CLAUDE.md engineering principles state "Immutable by default -- No mutations, return new objects." While this works correctly because every caller immediately serializes the result, mutation of input parameters is fragile -- a future caller that reuses the settings object after calling this function would observe surprising side effects.
- Fix: This is a pre-existing pattern (the function existed before this PR), but this PR expanded it with the new `eventName` parameter. The current behavior is safe due to serialize-after-call usage. Consider documenting the mutation contract in the JSDoc or, in a future refactor, returning a new object instead.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`hasAmbientHook` only checks UserPromptSubmit, not SessionStart** -- Confidence: 83%
- `src/cli/commands/ambient.ts:138-150`
- Problem: `hasAmbientHook` was not updated to also check for the SessionStart classification hook. After this PR, `addAmbientHook` installs two hooks (UserPromptSubmit preamble + SessionStart classification). But `hasAmbientHook` still only checks UserPromptSubmit. If the preamble hook is somehow removed but the classification hook remains, `--status` would report "disabled" while a SessionStart hook is still active.
- Fix: Consider checking both hooks, or document that UserPromptSubmit is the canonical "enabled" indicator:
  ```typescript
  export function hasAmbientHook(settingsJson: string): boolean {
    const settings: Settings = JSON.parse(settingsJson);
    const hasPreamble = settings.hooks?.UserPromptSubmit?.some((matcher) =>
      matcher.hooks.some((h) =>
        h.command.includes(PREAMBLE_HOOK_MARKER) || h.command.includes(LEGACY_HOOK_MARKER),
      ),
    ) ?? false;
    const hasClassification = settings.hooks?.SessionStart?.some((matcher) =>
      matcher.hooks.some((h) => h.command.includes(CLASSIFICATION_HOOK_MARKER)),
    ) ?? false;
    return hasPreamble || hasClassification;
  }
  ```

## Suggestions (Lower Confidence)

- **`parseRouterTables` skips table header separator rows by coincidence** - `tests/ambient.test.ts:457` (Confidence: 68%) -- The regex `/^\|\s*(\w+)\s*\|\s*(.+?)\s*\|$/` silently skips markdown table separator lines (`|---|---|`) because `---` does not match `\w+`. This works but is fragile -- if a column separator contained a word-like string, it could be misinterpreted. Adding an explicit `line.includes('---')` guard would make intent clearer.

- **`parseClassificationIntents` uses loose section detection** - `tests/ambient.test.ts:478` (Confidence: 65%) -- `line.includes('Intent Signals')` would match a line anywhere containing that substring (e.g., in a sentence). Using `line.startsWith('## Intent Signals')` or a heading-level check would be more precise.

- **Integration test `loadRouterContext` uses sync `readFileSync` at module level** - `tests/integration/helpers.ts:23-26` (Confidence: 62%) -- While acceptable in test infrastructure, synchronous file reads at module import time can mask errors with unhelpful stack traces. This is a minor style concern for test code only.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The TypeScript changes are well-typed and follow project conventions. The shared `hooks.ts` module is properly imported (PF-005 pitfall resolved for ambient.ts). The `filterHookEntries` generalization from hardcoded `UserPromptSubmit` to a dynamic `eventName` parameter is clean and type-safe via the `Record<string, HookMatcher[]>` Settings type. Test coverage for the new SessionStart classification hook is thorough (6 new test cases covering add, idempotency, upgrade path, and removal). The non-null assertion pattern in tests is the primary concern -- replace with narrowing guards per the "Unknown Over Any" / "prefer type guards" principle.
