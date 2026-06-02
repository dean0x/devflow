# TypeScript Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-01_2352

## Scope

TypeScript-specific quality review of the three changed source files:
- `src/cli/commands/ambient.ts` (removed `COMMANDS_RULE_CONTENT` const + `installCommandsRule`/`removeCommandsRule` functions; renamed cleanup helper to `removeLegacyCommandsRule`; repurposed call sites in `addAmbientHook`/`removeAmbientHook`)
- `src/cli/commands/init.ts` (description string + ambient-hook call sites)
- `src/cli/plugins.ts` (plugin description string)

Verification performed:
- `npx tsc --noEmit` — passed clean, no errors
- grep for dangling references to removed symbols (`installCommandsRule`, `removeCommandsRule`, `COMMANDS_RULE_CONTENT`) across `src/` and `tests/` — none found
- grep confirmed all imports in `ambient.ts` remain used (`fs`, `path`, `os`, `p`, `color`, `getClaudeDirectory`/`getDevFlowDirectory`, type-only `HookMatcher`/`Settings`)
- `decisions`/`pitfalls` cross-check (ADR-001, PF-001)

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None at CRITICAL severity. (Per the Iron Law, only CRITICAL pre-existing issues are reported; none found.)

## Suggestions (Lower Confidence)

None.

## Detailed Verification Against Review Brief

The review brief called out specific TS concerns. Each was checked and confirms clean:

1. **Explicit return types** — All three functions carry explicit return types:
   - `removeLegacyCommandsRule(): Promise<void>` (`ambient.ts:63`)
   - `addAmbientHook(settingsJson: string, devflowDir: string): Promise<string>` (`ambient.ts:78`)
   - `removeAmbientHook(settingsJson: string): Promise<string>` (`ambient.ts:117`)

2. **No `any`** — None introduced. The error handling uses `unknown`-style narrowing via typed assertion (see #4).

3. **Error typing / `NodeJS.ErrnoException` narrowing** — `ambient.ts:66-68` narrows the caught error correctly:
   `if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;`
   This swallows only the missing-file case and re-throws everything else (e.g. `EACCES`). The `tests/ambient.test.ts:344` case asserts EACCES propagation, confirming the narrowing behaves as intended. The `err as NodeJS.ErrnoException` assertion is the idiomatic Node pattern for reading `.code` off a caught error and is appropriate here (not an `any` escape hatch — the assertion is to a specific interface, and only the `.code` discriminant is read).

4. **No unused imports** — Confirmed by manual trace. `os` is still consumed by `COMMANDS_RULE_PATH` (`ambient.ts:21`), `fs` by `fs.unlink` (`ambient.ts:65`). Note `tsconfig.json` does not set `noUnusedLocals`, so `tsc` would not have caught a stray import — manual verification was required and passed.

5. **Async/Promise handling** — Both cleanup call sites correctly `await` the now-async cleanup:
   - `ambient.ts:103` — `await removeLegacyCommandsRule();` inside `addAmbientHook`
   - `ambient.ts:124` — `await removeLegacyCommandsRule();` inside `removeAmbientHook`
   - `init.ts:1131-1132` — both `removeAmbientHook` and `addAmbientHook` are awaited:
     `const cleanedForAmbient = await removeAmbientHook(content);`
     `content = ambientEnabled ? await addAmbientHook(cleanedForAmbient, devflowDir) : cleanedForAmbient;`
   No floating promises, no missing `await`.

## Decisions / Pitfalls

- **applies ADR-001** (clean-break, no migration code) and **avoids PF-001** (migration code on a rename refactor): The retained `removeLegacyCommandsRule` + `COMMANDS_RULE_PATH` purge a stale file the tool itself previously installed. This is cleanup of a self-authored install artifact, not transformation/preservation of user data — consistent with the clean-break philosophy and distinct from the PF-001 anti-pattern. No violation.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 10
**Recommendation**: APPROVED

This is a clean deletion-and-rename refactor. Type safety is preserved throughout, error narrowing is correct and test-covered, all promises are awaited, no `any` was introduced, and no dead references or unused imports remain. `tsc --noEmit` passes.
