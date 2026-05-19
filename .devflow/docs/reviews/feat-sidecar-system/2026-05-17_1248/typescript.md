# TypeScript Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental review (7 new commits + uncommitted changes)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**`any` type in test helper defeats TypeScript narrowing** - `tests/shell-hooks.test.ts:1821`
**Confidence**: 82%
- Problem: `catch (e: any)` in the `runHook` helper accesses `e.stdout`, `e.stderr`, and `e.status` without type narrowing. While this works at runtime because `execSync` throws an enriched error object, it bypasses TypeScript's type system. If the error shape changes in a future Node.js version, this would silently produce undefined values.
- Fix: Use `unknown` with a type guard or the existing `NodeJS.ErrnoException` pattern used elsewhere:
  ```typescript
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      exitCode: err.status ?? 1,
    };
  }
  ```
  Note: Since `execSync` error objects are not formally typed by Node.js, a structural cast after `unknown` is the pragmatic choice here. The `as` cast documents the expected shape while still participating in TypeScript checking for the rest of the function.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale JSDoc in `removeMemoryHooks` lists 4 hooks, config has 5** - `src/cli/commands/memory.ts:69`
**Confidence**: 95%
- Problem: The JSDoc says "Remove all memory hooks (UserPromptSubmit, Stop, SessionStart, PreCompact)" but `MEMORY_HOOK_CONFIG` (which the function iterates) now has 5 entries — it includes `SessionEnd: 'sidecar-evaluate'`. The function behavior is correct (it iterates the config), but the documentation is misleading and will confuse future readers.
- Fix:
  ```typescript
  /**
   * Remove all memory hooks (UserPromptSubmit, Stop, SessionEnd, SessionStart, PreCompact) from settings JSON.
   ```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Non-atomic `writeFile` in `writeConfig` could produce truncated config on process kill** - `src/cli/utils/sidecar-config.ts:51` (Confidence: 65%) — If the process is killed mid-write (e.g., `kill -9` during `devflow init`), the config file may be left truncated. A write-to-temp-then-rename pattern (`fs.writeFile(tmp, ...)` + `fs.rename(tmp, configPath)`) would make this atomic on POSIX. The D1 JSDoc on `updateFeature` acknowledges the non-atomic nature for concurrent access but does not address crash-safety. Low practical risk since the file is small and `readConfig` already handles corrupt JSON gracefully by returning defaults.

- **`writeConfig` sets `mode: 0o600` on every write but does not preserve original file mode** - `src/cli/utils/sidecar-config.ts:51` (Confidence: 60%) — If a user manually changes the file permissions (e.g., for a shared CI environment), `writeConfig` will reset them to 0o600 on every call. This is likely intentional for security but undocumented.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Assessment

The TypeScript code in this changeset is well-written and type-safe:

- `sidecar-config.ts` handles all edge cases correctly: missing file, corrupt JSON, partial config, arrays, non-objects, wrong types for fields. The return type is always a complete `SidecarConfig` — no partial objects can escape.
- The `readConfig` function uses `unknown` for the parsed JSON and manually narrows with explicit typeof checks before constructing the result — textbook defensive parsing.
- `updateFeature` documents its non-atomic read-modify-write trade-off in a D1 JSDoc comment.
- `init.ts` correctly switched from 4 sequential `updateFeature` calls to a single `writeConfig` — eliminating unnecessary I/O and a theoretical interleaving window.
- `memory.ts --status` correctly combines hook-presence AND sidecar-config checks, with a sensible `true` fallback when git root is unavailable.
- All 52 tests pass (17 sidecar-config + 35 sentinel).
- `npx tsc --noEmit` produces zero errors.

The only real issue is the `any` type in test code — functional but violates the project's type safety standards.
