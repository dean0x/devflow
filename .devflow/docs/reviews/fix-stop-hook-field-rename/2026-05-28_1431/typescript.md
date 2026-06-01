# TypeScript Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28
**Cycle**: 4 (prior cycle: 11 issues, 10 fixed, 0 FP, 1 deferred)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Unsafe `as Record<string, string>` cast on `settings.env` in `applyDebugTrace`** - `src/cli/commands/debug.ts:24`
**Confidence**: 85%
- Problem: Line 22 parses the input as `Record<string, unknown>`, then line 23 uses `??=` to default `settings.env` to `{}`. Line 24 casts `settings.env` directly to `Record<string, string>` and writes to it. If the existing `settings.env` contains non-string values (e.g., numbers, booleans, nested objects), this cast silently lies to the type system and no runtime validation catches it. While `readDebugStatus` (line 53) correctly guards against non-object `env`, `applyDebugTrace` does not -- it trusts the cast and proceeds. The sister function `stripDebugTrace` uses `Record<string, unknown>` for the same field (line 36), which is the safer approach.
- Fix: Use `Record<string, unknown>` consistently, matching `stripDebugTrace`:
```typescript
export function applyDebugTrace(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  settings.env ??= {};
  (settings.env as Record<string, unknown>).DEVFLOW_HOOK_DEBUG = '1';
  return JSON.stringify(settings, null, 2) + '\n';
}
```
  This aligns with the Iron Law: prefer `unknown` over `any`, and avoid narrowing casts that skip validation. The `as Record<string, string>` is unnecessary since JSON.stringify handles any value type, and the function only needs to set one key.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing `noUncheckedIndexedAccess` in tsconfig** - `tsconfig.json` (Confidence: 65%) -- The tsconfig has `strict: true` but does not enable `noUncheckedIndexedAccess`. The TypeScript skill checklist recommends this for safer indexed access. This is a project-wide concern rather than specific to this PR.

- **`debugCommand` action handler returns `void` on error paths instead of using process exit codes** - `src/cli/commands/debug.ts:109-110` (Confidence: 70%) -- When `applyDebugTrace` or `stripDebugTrace` throws on malformed JSON, the command logs an error and returns (lines 109, 123). The Commander action completes successfully (exit code 0) despite the error. Other devflow commands may follow the same pattern, but if programmatic callers check exit codes, this could mask failures. Leaving as a suggestion since this matches the existing codebase convention.

- **Test assertion casts repeat `as Record<string, string>` pattern** - `tests/debug.test.ts:19,26,33,39,46` (Confidence: 62%) -- Multiple test assertions cast `result.env as Record<string, string>` inline. A small typed helper (e.g., `envOf(result)`) could reduce repetition and keep tests DRY. Minor ergonomic improvement only.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new `debug.ts` command is well-structured: pure functions separated from I/O, comprehensive test coverage, proper error handling with try/catch around parse boundaries, and correct use of `Record<string, unknown>` in two of three functions (applies ADR-007 -- single global toggle pattern). The `sessionInput` helper updates in `sentinel.test.ts` and `shell-hooks.test.ts` correctly migrate from `stop_reason`/`response_text` to `last_assistant_message` (avoids PF-006 -- Stop hook field rename). The one blocking finding is a minor type-safety inconsistency (`Record<string, string>` vs `Record<string, unknown>`) that should be aligned for consistency with the function's own sibling.
