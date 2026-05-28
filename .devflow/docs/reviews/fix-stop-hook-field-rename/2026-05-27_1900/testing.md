# Testing Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### HIGH

**debug.test.ts tests replicate logic instead of exercising production code** - `tests/debug.test.ts:24-89`
**Confidence**: 85%
- Problem: The test file defines local helper functions (`applyEnable`, `applyDisable`, `readDebugState`) that re-implement the settings.json read/write logic from `src/cli/commands/debug.ts` rather than importing and invoking the production `debugCommand`. This means the tests validate the test helpers, not the actual CLI command. If someone changes `debug.ts` behavior (e.g., changes the env key name, adds validation), the tests will continue to pass because they test their own copy of the logic. The test file header even acknowledges this: "These tests bypass the commander layer." While bypassing commander is a valid strategy, the helpers should ideally call shared functions extracted from `debug.ts`, not duplicate them. There is also a subtle difference: the test helpers spread `rawEnv` into a new object (`{ ...(rawEnv as Record<string, string>) }`) while production takes a direct reference (`rawEnv as Record<string, string>`), which could mask mutation-related bugs.
- Fix: Extract the settings read/write logic from `debug.ts` into pure, testable functions (e.g., `enableDebug(settingsPath)`, `disableDebug(settingsPath)`, `getDebugStatus(settingsPath)`). Import and test those directly. This removes duplication, ensures production code is exercised, and follows the project's dependency injection principle.

```typescript
// In src/cli/utils/debug-settings.ts (new, pure functions):
export async function enableDebug(settingsPath: string): Promise<void> { /* extracted logic */ }
export async function disableDebug(settingsPath: string): Promise<void> { /* extracted logic */ }
export async function isDebugEnabled(settingsPath: string): Promise<boolean> { /* extracted logic */ }

// In tests/debug.test.ts:
import { enableDebug, disableDebug, isDebugEnabled } from '../src/cli/utils/debug-settings.js';
// Tests now exercise the real code
```

### MEDIUM

**Missing malformed settings.json test for disable path** - `tests/debug.test.ts:269-292`
**Confidence**: 85%
- Problem: The `devflow debug malformed settings.json` describe block only tests `applyEnable` with malformed JSON. The `applyDisable` function has the same SyntaxError guard (line 56), but there is no test confirming that `applyDisable` also preserves malformed files. This is an asymmetric test gap.
- Fix: Add a parallel test for the disable path:

```typescript
it('disable does not overwrite malformed settings.json', async () => {
  const settingsPath = path.join(tmpDir, 'settings.json');
  const malformed = 'this is not json';
  await fs.writeFile(settingsPath, malformed, 'utf-8');

  await expect(applyDisable(settingsPath)).resolves.not.toThrow();
  const content = await fs.readFile(settingsPath, 'utf-8');
  expect(content).toBe(malformed);
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**debug-trace 5MB size guard has no test coverage** - `scripts/hooks/debug-trace:33-40`
**Confidence**: 82%
- Problem: The `devflow_debug_init` function includes a size guard that truncates the global debug log when it exceeds 5MB (keeping the tail 2.5MB). This is important reliability behavior (avoids PF-004 god-script unbounded growth pattern), but the shell-hooks tests for debug-trace (`tests/shell-hooks.test.ts:49-139`) do not exercise this path. The four debug-trace tests cover: no-op when debug disabled, writes to global log, switches to per-project log, and set_cwd is no-op when disabled. None create a >5MB log file to verify truncation.
- Fix: Add a test that creates a log file exceeding 5MB and verifies truncation occurs. Since creating a real 5MB file in tests is slow, a smaller threshold test (e.g., verify the truncation logic pattern) or a test with a smaller but still-oversize file would suffice:

```typescript
it('truncates global log when it exceeds 5MB', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-debug-trunc-'));
  try {
    const logDir = path.join(tmpDir, '.devflow', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, '.hook-debug.log');
    // Create a 6MB file
    const chunk = 'x'.repeat(1024) + '\n';
    const fd = fs.openSync(logFile, 'w');
    for (let i = 0; i < 6144; i++) fs.writeSync(fd, chunk);
    fs.closeSync(fd);
    const sizeBefore = fs.statSync(logFile).size;
    expect(sizeBefore).toBeGreaterThan(5242880);

    const script = `bash -c '
      HOME="${tmpDir}"
      DEVFLOW_HOOK_DEBUG=1
      export HOME DEVFLOW_HOOK_DEBUG
      source "${DEBUG_TRACE}" || true
      devflow_debug_init "test-hook"
      dbg "after truncation"
    '`;
    execSync(script, { stdio: 'pipe' });
    const sizeAfter = fs.statSync(logFile).size;
    // Should be roughly 2.5MB (tail kept) + the new log line
    expect(sizeAfter).toBeLessThan(sizeBefore);
    expect(sizeAfter).toBeLessThan(3 * 1024 * 1024);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

**No negative test for debug-trace with empty hook name** - `scripts/hooks/debug-trace:22`
**Confidence**: 80%
- Problem: `devflow_debug_init` defaults to `"hook"` when no argument is passed (`${1:-hook}`). No test verifies this fallback behavior or that the log format is correct when the hook name is empty. While minor, this is a completeness gap for a new utility function.
- Fix: Add a test that calls `devflow_debug_init` without arguments and verifies the log line contains the default `"hook:"` prefix.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Sentinel test for sidecar-capture log file creation uses `os.tmpdir()` concatenation without path.join** - `tests/sentinel.test.ts:137` (Confidence: 65%) -- `fs.mkdtempSync(os.tmpdir() + '/devflow-log-home-')` should use `path.join(os.tmpdir(), 'devflow-log-home-')` for consistency with the rest of the test file.

- **debug.test.ts `readDebugState` catches all errors silently** - `tests/debug.test.ts:86-88` (Confidence: 65%) -- The bare `catch` block returns `false` for any error (permission denied, disk full, etc.), which could mask test infrastructure failures. Consider narrowing to only catch ENOENT.

- **Shell test setup boilerplate for stale WORKING-MEMORY.md is repeated 8+ times** - `tests/shell-hooks.test.ts` and `tests/sentinel.test.ts` (Confidence: 70%) -- The pattern `writeFileSync(memFile, '## Now\n- testing'); utimesSync(memFile, tenMinutesAgo, tenMinutesAgo)` appears in many tests. A shared helper like `writeStaleWorkingMemory()` (which already exists in `sentinel.test.ts:290-295`) should be extracted to a test utilities module and reused in `shell-hooks.test.ts`.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The test suite achieves good breadth: all 175 tests pass, the stop_reason-to-last_assistant_message field rename is consistently updated across all test inputs, a valuable regression test for stop_reason=tool_use capture is added, and the new debug-trace behavioral tests cover the primary happy/sad paths. However, the `debug.test.ts` tests re-implement production logic locally rather than importing the real code, creating a drift risk that undermines test confidence. The 5MB size guard in debug-trace -- a reliability-critical path -- has no test coverage. These gaps should be addressed before merge.
