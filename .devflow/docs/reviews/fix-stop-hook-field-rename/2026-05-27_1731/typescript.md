# TypeScript Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Missing error handling for JSON.parse in debug.ts** - `src/cli/commands/debug.ts:27`
**Confidence**: 85%
- Problem: `JSON.parse(raw)` can throw on malformed JSON. The catch block silently falls back to `{}`, which is fine for a missing file, but conflates "file not found" with "corrupted JSON". If settings.json exists but is corrupted, the command will silently overwrite it with a minimal object, destroying existing settings.
- Fix: Differentiate between "file not found" (ENOENT) and "parse error". For ENOENT, fall back to `{}`; for parse errors, warn the user and abort:
```typescript
try {
  const raw = await fs.readFile(settingsPath, 'utf-8');
  settings = JSON.parse(raw) as Record<string, unknown>;
} catch (err: unknown) {
  if (err instanceof SyntaxError) {
    p.log.error(`settings.json is malformed — fix it before modifying env vars`);
    return;
  }
  // ENOENT or other fs error — safe to start fresh
  settings = {};
}
```

Note: This mirrors how `flags.ts` and `post-install.ts` handle the same file in this codebase, though none of them guard against corruption either. The risk is higher here because `--enable`/`--disable` perform unconditional writes. Existing pattern inconsistency lowers confidence slightly.

### MEDIUM

**Unsafe type assertion chain on settings.env** - `src/cli/commands/debug.ts:32`
**Confidence**: 82%
- Problem: `settings.env` is cast to `Record<string, string> | undefined` without runtime validation. If settings.json contains `"env": 42` or `"env": "string"`, the cast silently succeeds and subsequent property access (`env.DEVFLOW_HOOK_DEBUG`, `delete env.DEVFLOW_HOOK_DEBUG`) will produce runtime errors or no-ops.
- Fix: Add a type guard:
```typescript
const rawEnv = settings.env;
const env: Record<string, string> =
  (typeof rawEnv === 'object' && rawEnv !== null && !Array.isArray(rawEnv))
    ? rawEnv as Record<string, string>
    : {};
```

Note: The same unsafe cast exists in `flags.ts:201` and `post-install.ts`, so this is a codebase-wide pattern. Flagging here because this is new code and an opportunity to set a better precedent. (applies ADR-001 -- no need for backward compat complexity, just do it right from the start)

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No unit tests for debug.ts CLI command** - `src/cli/commands/debug.ts:14-73`
**Confidence**: 85%
- Problem: The new `debugCommand` has zero test coverage. Other CLI commands in this codebase (flags, decisions, learn, knowledge) have corresponding test files. The command writes to `settings.json` (a high-value shared config file) and a bug here could corrupt the user's Claude Code configuration.
- Fix: Add a `tests/debug.test.ts` covering at minimum: (1) `--enable` sets `env.DEVFLOW_HOOK_DEBUG` in a temp settings.json, (2) `--disable` removes it and cleans up empty `env`, (3) `--status` reports correct state. Use a temp directory for `CLAUDE_CODE_DIR` override.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing `noUncheckedIndexedAccess` in tsconfig** - `tsconfig.json` (Confidence: 65%) -- The TypeScript skill checklist recommends `noUncheckedIndexedAccess` for strict typing. The project has `strict: true` but not this flag. Would catch potential undefined access on indexed types throughout the codebase.

- **Test field rename is thorough but mechanical** - `tests/shell-hooks.test.ts`, `tests/sentinel.test.ts` (Confidence: 60%) -- The `stop_reason`/`response_text` to `last_assistant_message` rename in tests is consistent and complete, but there is no negative test verifying that the old field names are now explicitly rejected or ignored by sidecar-capture. If a Claude Code version regresses to the old field names, the hook would silently produce empty responses.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The TypeScript footprint of this PR is small (one new 73-line CLI command + test field renames). The new `debug.ts` command is clean and follows existing codebase patterns. The two blocking findings are defensive-programming gaps (JSON parse error handling and type assertion safety) that could cause silent data loss on corrupted settings.json. The shell script changes (bash, not TypeScript) are outside this reviewer's scope but appear consistent. The test field renames are thorough and correctly track the `response_text` -> `last_assistant_message` API change.
