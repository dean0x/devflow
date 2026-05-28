# Testing Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### HIGH

**No tests for `debug-trace` helper behavior** - `scripts/hooks/debug-trace`
**Confidence**: 90%
- Problem: The `debug-trace` shell helper is a new 48-line file providing `devflow_debug_init` and `devflow_debug_set_cwd` functions. It is sourced by all 7 hooks and drives the entire debug tracing system. The only existing coverage is a syntax check (`bash -n`) in the `HOOK_SCRIPTS` array at `tests/shell-hooks.test.ts:17`. There are no behavioral tests validating: (1) `dbg()` is a no-op when `DEVFLOW_HOOK_DEBUG` is unset, (2) `dbg()` writes to the global log when debug is enabled but CWD is unknown, (3) `devflow_debug_set_cwd` switches the log to the per-project path, (4) log entries contain the hook name and timestamp.
- Fix: Add a `describe('debug-trace behavioral')` block in `tests/shell-hooks.test.ts` that:
  ```typescript
  it('dbg is a no-op when DEVFLOW_HOOK_DEBUG is unset', () => {
    const result = execSync(
      `bash -c 'dbg() { :; }; source "${HOOKS_DIR}/debug-trace"; devflow_debug_init "test"; dbg "should not appear"'`,
      { env: { ...process.env, HOME: homeDir }, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // Verify no log file created
  });

  it('dbg writes to global log when debug enabled', () => {
    execSync(
      `bash -c 'dbg() { :; }; source "${HOOKS_DIR}/debug-trace"; devflow_debug_init "test-hook"; dbg "hello"'`,
      { env: { ...process.env, HOME: homeDir, DEVFLOW_HOOK_DEBUG: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // Verify ~/.devflow/logs/.hook-debug.log contains "test-hook: hello"
  });

  it('devflow_debug_set_cwd switches to per-project log', () => {
    // Set CWD, verify log appears under ~/.devflow/logs/{slug}/.hook-debug.log
  });
  ```

**No tests for `devflow debug` CLI command** - `src/cli/commands/debug.ts`
**Confidence**: 92%
- Problem: The new `debug.ts` CLI command (73 lines) has zero test coverage. It reads/writes `settings.json`, toggles `env.DEVFLOW_HOOK_DEBUG`, and computes log paths. Every other CLI command in the project has a corresponding test file (e.g., `flags.test.ts`, `learn.test.ts`, `ambient.test.ts`, `rules.test.ts`). This is a consistency gap and a risk: the command mutates a shared settings file and a bug could corrupt other settings.
- Fix: Create `tests/debug.test.ts` with tests for:
  ```typescript
  describe('devflow debug CLI', () => {
    it('--enable sets DEVFLOW_HOOK_DEBUG=1 in settings.json env');
    it('--disable removes DEVFLOW_HOOK_DEBUG from settings.json env');
    it('--disable cleans up empty env object');
    it('--status reports enabled/disabled correctly');
    it('--enable preserves existing env vars');
    it('handles missing settings.json gracefully');
  });
  ```

### MEDIUM

**Removed `stop_reason` filter has no negative test proving the old behavior is gone** - `tests/shell-hooks.test.ts:1210`
**Confidence**: 85%
- Problem: The PR removes the `stop_reason` filter from `sidecar-capture` (previously the hook would exit early if `stop_reason !== "end_turn"`). The existing test was renamed from `"stop_reason tool_use -- no queue append"` to `"empty last_assistant_message -- no queue append"`, but this test now verifies a different condition (empty message), not that the `stop_reason` field is ignored. There is no test confirming that providing `stop_reason: "tool_use"` WITH a non-empty `last_assistant_message` now proceeds to capture (the new intended behavior). This gap means a regression re-introducing the `stop_reason` filter would not be caught.
- Fix: Add a test case:
  ```typescript
  it('stop_reason field is ignored — captures when last_assistant_message present', () => {
    fs.mkdirSync(path.join(tmpDir, '.devflow', 'memory'), { recursive: true });
    writeStaleWorkingMemory(tmpDir);
    const input = JSON.stringify({
      cwd: tmpDir,
      session_id: 'test-stop-reason-ignored',
      stop_reason: 'tool_use',  // Previously would have caused early exit
      last_assistant_message: 'response despite tool_use',
    });
    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(true);
  });
  ```

**Normal logging (`log()`) added to 4 hooks but not tested** - `scripts/hooks/pre-compact-memory:44`, `session-start-memory:41`, `session-start-context:50`, `sidecar-dispatch:48`
**Confidence**: 82%
- Problem: Four hooks gained new `log()` functions sourcing `log-paths` and writing to per-project log files (e.g., `.pre-compact-memory.log`, `.session-start-memory.log`). The sidecar-capture hook already had logging and its log output is validated in existing tests (e.g., `sidecar-evaluate` tests check log file contents). The 4 newly-logging hooks have no tests verifying that log files are created or that log messages appear. This is a weaker concern since logging is not business logic, but it breaks the existing test pattern where hooks that log have their log output checked.
- Fix: For at least one of the 4 hooks, add a log-file existence check after hook execution. For example, in the `sidecar-dispatch` test suite:
  ```typescript
  it('writes to per-project log file', () => {
    // ... run hook ...
    const logFile = path.join(homeDir, '.devflow', 'logs', encodeCwd(tmpDir), '.sidecar-dispatch.log');
    expect(fs.existsSync(logFile)).toBe(true);
  });
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Integration test for debug-trace + hooks end-to-end** - `scripts/hooks/sidecar-capture` (Confidence: 65%) -- Running a hook with `DEVFLOW_HOOK_DEBUG=1` and verifying that debug log output appears at the expected path would provide confidence that the debug-trace sourcing pattern works correctly across all 7 hooks, not just in isolation.

- **`debug.ts` does not validate `settings.json` schema before writing** - `src/cli/commands/debug.ts:37` (Confidence: 70%) -- If `settings.json` contains unexpected types (e.g., `env` is a string instead of an object), the command would silently overwrite it. Other CLI commands (like `flags.ts`) face the same risk, so this is a pre-existing pattern, but adding a test that verifies graceful handling of malformed `settings.json` would increase confidence.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The test updates for the `response_text` to `last_assistant_message` field rename are thorough and correct -- all 13 test input objects were updated consistently, test names were updated to reflect the new semantics, and all 155 tests pass. However, two significant new features introduced in this PR have zero behavioral test coverage: the `debug-trace` shell helper (sourced by all 7 hooks) and the `devflow debug` CLI command. Additionally, the removal of the `stop_reason` filter -- a meaningful behavioral change -- lacks a dedicated regression test proving the old filter is truly gone. The test changes that ARE present are well-executed; the gap is in what was NOT added alongside the new code.
