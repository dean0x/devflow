# TypeScript Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09T13:45

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical issues found.

### HIGH

**`addMemoryHooks` re-serializes JSON unconditionally on partial state** - `src/cli/commands/memory.ts:61`
**Confidence**: 82%
- Problem: The `changed` variable was removed from `addMemoryHooks`. The function now always calls `JSON.stringify` even when `hasMemoryHooks` returns false but the loop adds nothing (an unreachable path in practice, since hasMemoryHooks==false guarantees at least one hook is missing). However, this means a JSON round-trip happens for the partial-but-no-change edge case, which could silently reformat whitespace or key ordering in the caller's settings file. The callers in `init.ts:772` and `memory.ts:193` compare `updated === settingsContent` to detect no-ops. A whitespace-only change would cause a spurious write.
- Fix: The `hasMemoryHooks` guard at line 27 short-circuits the all-present case, and the loop body guarantees at least one addition when hasMemoryHooks is false. The unreachable path is harmless in practice. If you want to be defensive, keep the early return but no action is strictly required. Marking HIGH because the no-op detection pattern (`updated === settingsContent`) is fragile against JSON re-serialization, even though the current code paths avoid triggering it.

### MEDIUM

**Queue cleanup uses `process.cwd()` -- not guaranteed to be project root** - `src/cli/commands/memory.ts:213` and `src/cli/commands/init.ts:956`
**Confidence**: 85%
- Problem: Both the `memory --disable` handler (line 213) and the `init` handler (line 956) resolve the `.memory/` directory via `path.join(process.cwd(), '.memory')`. If the user runs `devflow memory --disable` from a subdirectory (e.g., `src/`), the cleanup targets the wrong path and silently fails to delete queue files.
- Fix: Use git root detection (already available via `getGitRoot()` in init.ts or could be added to memory.ts) or a dedicated `getMemoryDir()` utility to resolve the project-level `.memory/` directory reliably:
  ```typescript
  // In memory.ts disable handler:
  const gitRoot = await getGitRoot();
  const memoryDir = gitRoot
    ? path.join(gitRoot, '.memory')
    : path.join(process.cwd(), '.memory');
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Double-parse of `settingsJson` in `addMemoryHooks`** - `src/cli/commands/memory.ts:25-27`
**Confidence**: 80%
- Problem: `addMemoryHooks` calls `JSON.parse(settingsJson)` on line 25, then immediately calls `hasMemoryHooks(settingsJson)` on line 27, which internally calls `countMemoryHooks`, which calls `JSON.parse(settingsJson)` again (line 119). The settings JSON is parsed twice on every call.
- Fix: Extract the parsed object and pass it to the count logic, or inline the check:
  ```typescript
  export function addMemoryHooks(settingsJson: string, devflowDir: string): string {
    const settings: Settings = JSON.parse(settingsJson);
    const hookCount = countFromParsed(settings); // internal helper
    if (hookCount === Object.keys(MEMORY_HOOK_CONFIG).length) {
      return settingsJson;
    }
    // ...
  }
  ```
  This also applies to the test suite where `addMemoryHooks` is called inside idempotency checks.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`HookEntry.type` is `string` instead of a string literal union** - `src/cli/utils/hooks.ts:10-11`
**Confidence**: 82%
- Problem: `HookEntry.type` is typed as `string`, but the codebase only uses `'command'`. A discriminated union or literal type would catch typos at compile time and align with the TypeScript skill's guidance on discriminated unions (Iron Law: unknown over any; prefer narrow types).
- Fix: `type: 'command' | 'url'` or a more complete union of valid hook types.

### LOW

**`Settings` interface uses index signature `[key: string]: unknown`** - `src/cli/utils/hooks.ts:21`
**Confidence**: 80%
- Problem: The catch-all index signature weakens type checking on the `Settings` object -- any misspelled property access silently returns `unknown` instead of being a compile error. This is a common TypeScript anti-pattern when the full shape is known.
- Fix: Define known properties explicitly (e.g., `statusLine?`, `env?`) or use a separate `Record<string, unknown>` intersection only where needed.

## Suggestions (Lower Confidence)

- **Test cleanup logic duplicated inline** - `tests/memory.test.ts:599-600` (Confidence: 70%) -- The queue cleanup test duplicates the `fs.unlink(...).then(...).catch(...)` pattern from the production code instead of importing a shared helper. If the cleanup logic changes, the test will silently diverge.

- **`exec` import unused in memory.test.ts** - `tests/memory.test.ts:5` (Confidence: 75%) -- `import { exec } from 'child_process'` is imported but not used in the test file. TypeScript strict mode with `noUnusedLocals` would catch this.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**TypeScript Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. Verify the `process.cwd()` usage for queue cleanup is intentional (MEDIUM blocking) -- if the CLI is always invoked from project root, document this assumption; otherwise use git root detection.
2. The re-serialization behavior change in `addMemoryHooks` is safe in practice but worth noting for future maintainers.

Overall the TypeScript changes are well-structured: proper use of `Record` types, data-driven hook configuration via `MEMORY_HOOK_CONFIG`, and the shift from magic number `3` to `Object.keys(MEMORY_HOOK_CONFIG).length` is a clear improvement. Test coverage for the new hook type is thorough, including upgrade paths, toggle cycles, and disambiguation between ambient preamble and prompt-capture-memory.
