# TypeScript Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Timer leak in `runClaudeStreaming` grace window** - `tests/integration/helpers.ts:113-116`
**Confidence**: 90%
- Problem: When skills are detected, an 8-second grace timer is started via `setTimeout`, but this timer is never cleared if the process closes or errors before the 8 seconds elapse. The `settled` guard prevents double-resolution, but the timer reference itself leaks (keeps the Node.js event loop alive and the timer object in memory until it fires). In integration tests that create many streaming processes, this could cause tests to hang longer than expected or prevent Node from exiting promptly.
- Fix: Capture the grace timer reference and clear it in the `close` and `error` handlers:
```typescript
let graceTimer: ReturnType<typeof setTimeout> | null = null;

// Inside the skills detection block:
if (skills.length > 0 && !graceTimer) {
  graceTimer = setTimeout(() => {
    clearTimeout(timer);
    finish(true);
  }, 8000);
}

// In close/error handlers, add:
if (graceTimer) clearTimeout(graceTimer);
```

**Dead code: `isFirstToolASkill` exported but never used** - `tests/integration/helpers.ts:188-192`
**Confidence**: 95%
- Problem: The function `isFirstToolASkill` is defined and exported but never imported or called anywhere in the codebase. Its implementation is also identical to `hasSkillInvocations` (both just check `result.skills.length > 0`), making it a redundant duplicate. Despite the JSDoc claiming it checks the "first tool_use event," it actually checks the same condition as `hasSkillInvocations`.
- Fix: Remove the dead function entirely:
```typescript
// Delete lines 184-192
```

### LOW

**`hasRequiredSkills` uses overly loose substring matching** - `tests/integration/helpers.ts:220-223`
**Confidence**: 82%
- Problem: `hasRequiredSkills` uses `s.includes(name)` to match skills, which means `hasRequiredSkills(result, ['test'])` would match skills like `'test-driven-development'`, `'testing'`, or `'software-design-test'`. The JSDoc says "Matches flexibly: 'patterns' matches both the prefixed and unprefixed form," which suggests the intent is prefix/suffix matching for the `devflow:` namespace, but `includes` is broader than needed.
- Fix: Use a more targeted match that accounts for the `devflow:` prefix:
```typescript
export function hasRequiredSkills(result: StreamResult, required: string[]): boolean {
  return required.every((name) =>
    result.skills.some((s) => s === name || s === `devflow:${name}` || s.endsWith(`:${name}`)),
  );
}
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No issues found._

## Suggestions (Lower Confidence)

- **Redundant double-parse in `addAmbientHook`** - `src/cli/commands/ambient.ts:50-51` (Confidence: 65%) -- `addAmbientHook` calls `removeLegacyAmbientHook(settingsJson)` which parses and re-serializes the JSON, then immediately parses the result again with `JSON.parse(cleaned)`. When called from init.ts (line 921), the input has already been through `removeAmbientHook` which removes both legacy and preamble hooks, making the internal `removeLegacyAmbientHook` call a no-op. The design is intentionally defensive (idempotent from any call site), but it does triple-parse the settings JSON when called from init.ts.

- **`execSync` import retained but only used in one place** - `tests/integration/helpers.ts:1` (Confidence: 60%) -- `execSync` is imported alongside `spawn` and `ChildProcess` but is only used in the `isClaudeAvailable` check. This is fine, but the import could be consolidated if `isClaudeAvailable` were rewritten to use `spawnSync` for consistency with the rest of the module's async-first approach.

- **Multiple grace timers can stack** - `tests/integration/helpers.ts:112-116` (Confidence: 70%) -- Each assistant message event that finds `skills.length > 0` schedules a new 8-second grace timer. If multiple assistant messages arrive (which is likely in streaming), multiple overlapping timers are created. While `settled` prevents multiple resolutions, it would be cleaner to schedule only one grace timer using a guard variable.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 1 |
| Should Fix | - | 0 | 0 | 0 |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The TypeScript changes are well-structured overall. The rename from `ambient-prompt` to `preamble` and from old orchestration skill names to short names is consistently applied across source, tests, and plugin manifests. Type safety is maintained throughout -- `StreamResult` replaces the old `ClaudeResult` interface cleanly, helper functions use proper typing, and `import type` is correctly used for type-only imports. The `removeLegacyAmbientHook` function follows the same idempotent/defensive pattern as the existing hook management functions.

The timer leak (stacking grace timers without cleanup) and the dead `isFirstToolASkill` function are the actionable items. The loose `includes` matching in `hasRequiredSkills` is worth tightening but is currently acceptable given the narrow set of skill names used in practice.
