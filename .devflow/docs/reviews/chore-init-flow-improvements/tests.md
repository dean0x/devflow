# Tests Review Report

**Branch**: chore/init-flow-improvements -> main
**Date**: 2026-03-22
**PR**: #157

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical issues found.

### HIGH

No high-severity issues found.

### MEDIUM

**`discoverProjectGitRoots` tests mutate `process.env.HOME` without isolation guard** - `tests/init-logic.test.ts:473`
**Confidence**: 82%
- Problem: The `discoverProjectGitRoots` test suite overrides `process.env.HOME` in `beforeEach` and restores it in `afterEach`. If any test in this describe block throws before `afterEach` runs (e.g., a failed assertion in a later async chain), or if Vitest runs in a mode where `afterEach` is skipped on hard failure, `HOME` stays corrupted for subsequent tests in the same process. Since `discoverProjectGitRoots` calls `os.homedir()` which caches on some Node.js versions, the mutation could also silently persist beyond the restore. This is a known flaky test pattern.
- Fix: Use `vi.stubEnv('HOME', tmpDir)` which integrates with Vitest's own cleanup, or wrap the entire describe block with a `try/finally` in a helper. Also consider calling `os.homedir` spy instead of mutating the real environment:
  ```typescript
  vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  ```
  This avoids global environment mutation entirely and is automatically restored by `vi.restoreAllMocks()`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Removed tests for re-exported functions without replacement coverage** - `tests/init-logic.test.ts` (lines removed)
**Confidence**: 80%
- Problem: The PR removes two describe blocks: `ambient hook re-exports from init` (3 tests for `addAmbientHook`, `removeAmbientHook`, `hasAmbientHook`) and `memory hook re-exports from init` (3 tests for `addMemoryHooks`, `removeMemoryHooks`, `hasMemoryHooks`). While these were admittedly low-value "typeof === function" checks, the re-exports still exist at `init.ts:34-36`. The removed tests verified the import path worked. If the re-export is ever broken (e.g., a typo in the export statement), nothing catches it.
- Fix: These re-exports are used by the test file itself (the imports at the top used to reference them). Since the imports are also removed, this is internally consistent. However, if any external consumer relies on importing from `init.js` rather than the canonical module, coverage is lost. Consider adding a single smoke test that validates the re-exports still resolve, or remove the re-exports entirely since they are no longer needed by tests. The re-exports at `init.ts:34-36` (`addAmbientHook`, `removeAmbientHook`, `hasAmbientHook`, `addMemoryHooks`, `removeMemoryHooks`, `hasMemoryHooks`, `addHudStatusLine`, `removeHudStatusLine`, `hasHudStatusLine`) may be dead code now.

**Removed `buildExtrasOptions` tests alongside function removal -- no regression coverage for new logic** - `tests/init-logic.test.ts` (lines removed)
**Confidence**: 83%
- Problem: The `buildExtrasOptions` function and its 5 tests are removed. The replacement logic -- individual feature prompts for claudeignore, HUD, memory, ambient, safe-delete -- now lives directly in the `initCommand.action()` handler. This handler is a 700+ line Commander action callback that is not unit-testable without mocking `@clack/prompts`, `process.stdin.isTTY`, and the filesystem. The new flow logic (e.g., the `discoveredProjects` batch install path, the `claudeignoreEnabled` branching, the `managedSettingsConfirmed` flow) has zero test coverage.
- Fix: Extract the decision-making logic into pure, testable functions. For example:
  ```typescript
  export function resolveClaudeignoreTargets(
    scope: 'user' | 'local',
    gitRoot: string | null,
    discoveredProjects: string[],
    userChoice: boolean,
  ): string[] { ... }
  ```
  This would allow testing the branching logic (user scope with discovered projects, user scope without, local scope, disabled) without mocking the interactive prompts.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`installManagedSettings` tests use `vi.spyOn(await import(...))` pattern** - `tests/init-logic.test.ts:319-394`
**Confidence**: 85%
- Problem: Each test in the `installManagedSettings` describe block calls `vi.spyOn(await import('../src/cli/utils/paths.js'), 'getManagedSettingsPath')`. Dynamic imports inside test bodies are re-evaluated each time, creating multiple module instances. This works in Vitest because of its module caching, but is fragile -- it depends on import caching behavior and could break with ESM module changes. Six tests repeat this exact same dynamic import pattern.
- Fix: Move the spy setup to `beforeEach` with a single top-level import, or use `vi.mock` at the module level.

## Suggestions (Lower Confidence)

- **`discoverProjectGitRoots` tests could verify `os.homedir()` interaction directly** - `tests/init-logic.test.ts:467-582` (Confidence: 70%) -- The function under test calls `os.homedir()` internally. Testing through `process.env.HOME` mutation is indirect. Mocking `os.homedir` would make the dependency explicit and avoid environment mutation.

- **New `installClaudeignore` tests could cover the error/verbose path** - `tests/init-logic.test.ts:584-626` (Confidence: 65%) -- The two new tests cover happy path (created) and skip path (exists). The function also has a verbose logging path and a catch branch for non-EEXIST errors. These edge cases are untested.

- **Missing test for `discoverProjectGitRoots` with lines missing `project` key** - `tests/init-logic.test.ts:467-582` (Confidence: 62%) -- Tests cover malformed JSON but not valid JSON objects that lack a `project` field (e.g., `{ "foo": "bar" }`). The implementation checks `typeof entry.project === 'string'` which handles this, but no test verifies it.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Tests Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new tests for `discoverProjectGitRoots` (7 tests) and `installClaudeignore` return value (2 tests) are well-structured, follow AAA pattern, use proper filesystem isolation with temp directories, and cover important edge cases (malformed JSON, missing files, deduplication, sorting). The removal of `buildExtrasOptions` tests is justified since the function itself was deleted.

The main concern is the growing gap between tested pure functions and the untested 700+ line interactive handler. The new prompt flow (project discovery, batch claudeignore install, managed settings confirmation) has significant branching logic that is only exercisable through end-to-end testing. Extracting decision logic into pure functions would maintain the project's strong test quality as the init flow grows.

Conditions for approval:
1. Consider replacing `process.env.HOME` mutation with `vi.spyOn(os, 'homedir')` to eliminate the global state mutation risk in the `discoverProjectGitRoots` tests.
