# TypeScript Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Unsafe `as Record<string, string>` assertion on `rawEnv` bypasses validation of nested values** - `src/cli/commands/debug.ts:39`
**Confidence**: 85%
- Problem: After confirming `rawEnv` is a non-null, non-array object, the code casts it directly to `Record<string, string>` without verifying that all values are actually strings. If `settings.json` contains `"env": { "DEVFLOW_HOOK_DEBUG": 1 }` (number instead of string), the cast silently succeeds and the `=== '1'` comparison on line 64 would fail to detect the enabled state. The `env` object in `settings.json` is a user-editable trust boundary.
- Fix: Either validate individual values or narrow using a type guard. This is consistent with the project's `as Record<string, string>` usage in `flags.ts`, so this is a cross-codebase pattern concern rather than a local deviation. Minimal fix for debug.ts alone:
```typescript
const env: Record<string, string> =
  (typeof rawEnv === 'object' && rawEnv !== null && !Array.isArray(rawEnv))
    ? Object.fromEntries(
        Object.entries(rawEnv as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
    : {};
```
Note: The prior review cycle already addressed the `SyntaxError` vs `ENOENT` differentiation and the env type guard (34c6065), so the object-level check is resolved. This finding targets the *value-level* assertion within the object.

**Mutating the original `rawEnv` reference on enable path** - `src/cli/commands/debug.ts:39-44`
**Confidence**: 82%
- Problem: On line 39, when `rawEnv` passes the type guard, the code assigns `rawEnv as Record<string, string>` to `env` without spreading/cloning. Then on line 43 it mutates `env.DEVFLOW_HOOK_DEBUG = '1'`, which mutates the original `settings.env` object in-place. On line 44 it then reassigns `settings.env = env` (redundant since they already share the same reference). While functionally correct for the current write-back flow, this is mutation of the parsed input object. The test file (line 37) correctly uses `{ ...(rawEnv as Record<string, string>) }` with a spread — the production code should match.
- Fix: Apply the spread operator as the test file already does:
```typescript
const env: Record<string, string> =
  (typeof rawEnv === 'object' && rawEnv !== null && !Array.isArray(rawEnv))
    ? { ...(rawEnv as Record<string, string>) }
    : {};
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Test helper functions duplicate production logic instead of importing it** - `tests/debug.test.ts:24-89`
**Confidence**: 80%
- Problem: The test file re-implements the entire `applyEnable`, `applyDisable`, and `readDebugState` logic in standalone helper functions rather than testing the actual `debugCommand` module. The JSDoc at the top of the file acknowledges this is intentional ("bypasses the commander layer") and the file header mentions "avoid commander singleton bleed-through." However, this means the tests do not exercise the actual production code — they test a parallel copy. If someone changes `debug.ts` without updating the test helpers, the tests pass but production behavior diverges. This is a testing anti-pattern per project CLAUDE.md ("Tests must validate BEHAVIOR, not work around BAD DESIGN").
- Fix: Consider extracting the settings read/write/status logic from `debug.ts` into testable pure functions (e.g., `enableDebugTracing(settingsPath)`, `disableDebugTracing(settingsPath)`, `getDebugState(settingsPath)`) and import those in both the command action handler and the tests. This removes the duplication while still avoiding the commander singleton issue.

## Pre-existing Issues (Not Blocking)

### LOW

**`noUncheckedIndexedAccess` not enabled in tsconfig.json** - `tsconfig.json`
**Confidence**: 85%
- Problem: The TypeScript skill checklist recommends `noUncheckedIndexedAccess` for strict typing. Without it, indexed access on `Record<string, string>` returns `string` rather than `string | undefined`, hiding potential undefined access. This is a project-wide configuration concern, not specific to this PR.
- Fix: Consider adding `"noUncheckedIndexedAccess": true` to `tsconfig.json` `compilerOptions` in a separate PR.

## Suggestions (Lower Confidence)

- **Non-atomic read-modify-write on settings.json** - `src/cli/commands/debug.ts:26-45` (Confidence: 65%) — The read-parse-modify-write cycle is not atomic. If another process (e.g., `devflow flags --enable`) writes settings.json between the read on line 26 and the write on line 45, changes could be lost. The project has `fs-atomic.ts` with `writeFileAtomicExclusive`, but no shared settings.json lock. This is an existing pattern across all CLI commands (flags.ts, ambient.ts), not unique to this PR.

- **Missing `process.exitCode = 1` on malformed settings.json error** - `src/cli/commands/debug.ts:30-31` (Confidence: 70%) — When `SyntaxError` is caught, the command logs an error and returns, but does not set a non-zero exit code. Callers invoking `devflow debug --enable` programmatically would see exit code 0 despite failure. Other commands in the codebase also omit this, so it may be an intentional simplicity choice.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**TypeScript Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new `debug.ts` command is well-structured with proper error differentiation (SyntaxError vs ENOENT, which was addressed in the prior review cycle — applies ADR-001 clean-break philosophy by not over-engineering). The env type guard at the object level is sound. Two blocking MEDIUM issues: (1) the missing spread on `rawEnv` in production code (the test file already does this correctly), and (2) the unchecked `as Record<string, string>` on individual values. The test duplication concern is a should-fix that would improve long-term maintainability. The shell-hooks test changes (`sentinel.test.ts`, `shell-hooks.test.ts`) are clean mechanical renames from `response_text`/`stop_reason` to `last_assistant_message` with no TypeScript-specific concerns.
