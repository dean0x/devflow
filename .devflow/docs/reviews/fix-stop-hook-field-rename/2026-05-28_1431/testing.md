# Testing Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

No CRITICAL or HIGH issues found.

### MEDIUM

**Incomplete regression test for field rename: only `last_assistant_message` presence is tested, not absence of the old field** - `tests/sentinel.test.ts:111-127`
**Confidence**: 82%
- Problem: The new regression test at line 111 ("captures when stop_reason is 'tool_use' and last_assistant_message is present") correctly validates the new behavior, but no test asserts what happens when input contains the OLD field name `response_text` (without `last_assistant_message`). Given that PF-006 documents a silent field rename that went undetected for weeks, a regression test verifying that the hook ignores the old field name (avoids PF-006) would prevent future regressions if someone accidentally re-introduces the old field parsing.
- Fix: Add a test case that sends `{ response_text: 'hello' }` (without `last_assistant_message`) and asserts the queue file is NOT created, confirming the hook no longer reads the old field.

```typescript
it('ignores legacy response_text field (avoids PF-006)', () => {
  mkMemoryDir(tmpDir);
  const memFile = path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
  fs.writeFileSync(memFile, '## Now\n- testing');
  const tenMinutesAgo = new Date(Date.now() - 600 * 1000);
  fs.utimesSync(memFile, tenMinutesAgo, tenMinutesAgo);
  const input = sessionInput(tmpDir, {
    stop_reason: 'end_turn',
    response_text: 'this should be ignored',
  });
  execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
  expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**debug-trace size guard test only validates truncation, not the 2.5MB tail retention** - `tests/shell-hooks.test.ts:147-176`
**Confidence**: 80%
- Problem: The test at line 147 writes 6MB, then asserts the result is under 5MB and contains the post-truncation message. It does not assert that the file retained approximately 2.5MB of old content. The `_devflow_dbg_size_guard` function keeps `tail -c 2621440` (2.5MB), so the final size should be approximately 2.5MB + the new log line. Without asserting a minimum size, this test would still pass if the function erroneously truncated to 0 bytes and only wrote the new line.
- Fix: Add a lower-bound assertion:

```typescript
// After truncation the log should retain approximately 2.5MB of tail + the new line
expect(size).toBeGreaterThan(2 * 1024 * 1024); // at least 2MB
expect(size).toBeLessThan(5 * 1024 * 1024);
```

## Pre-existing Issues (Not Blocking)

No pre-existing issues above the confidence threshold.

## Suggestions (Lower Confidence)

- **eval-reinforce has no behavioral test coverage** - `scripts/hooks/eval-reinforce` (Confidence: 70%) -- The reinforcement module (89 lines) with jq and node fallback branches has no dedicated behavioral tests. Only the syntax check (`bash -n`) covers it. Given it mutates `learning-log.jsonl` under a lock, a behavioral test for slug-based `last_seen` update would provide regression safety.

- **No negative test for `_eval_release_lock` with non-directory path** - `tests/shell-hooks.test.ts:325-359` (Confidence: 65%) -- The `_eval_release_lock` tests cover the happy path (dir exists) and absence path (dir missing), but do not test what happens when the path is a regular file instead of a directory. The underlying `sidecar_lock_release` uses `rmdir`, which would fail silently on a regular file -- this may or may not be intentional.

- **debug.test.ts I/O tests use async fs but pure function tests use sync patterns** - `tests/debug.test.ts:137-216` (Confidence: 62%) -- The I/O integration tests use `async/await` with `fs.promises`, while the pure function tests above use synchronous patterns. This is not a bug, but the mix of sync/async within the same test file could cause confusion. The I/O tests could be simplified to sync since they are small and sequential.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Strengths

- **Excellent coverage of the field rename**: All 15+ sidecar-capture test inputs correctly updated from `response_text` to `last_assistant_message` (applies ADR-007, avoids PF-006).
- **New regression test for tool_use stop_reason** (sentinel.test.ts:111-127): Directly validates the behavioral fix documented in PF-006 -- that `stop_reason` is no longer used as a gate.
- **Comprehensive debug-trace behavioral tests**: 5 tests covering no-op when disabled, global log when enabled, CWD-switch to per-project log, CWD no-op when disabled, and size guard truncation -- matching all branches in the 75-line `debug-trace` script.
- **eval-helpers fully covered**: `read_daily_cap` (3 cases), `atomic_increment_daily` (2 cases), `load_existing_ids` (3 cases), `_eval_release_lock` (2 cases) -- all 10 tests exercise the extracted helper functions directly.
- **debug.test.ts is a model pure-function test file**: 23 tests covering `applyDebugTrace`, `stripDebugTrace`, `readDebugStatus`, roundtrip, I/O integration, and malformed JSON -- all behavior-focused with clear AAA structure (applies ADR-007).
- **Syntax checks extended**: `HOOK_SCRIPTS` array correctly expanded with all 8 new scripts (`debug-trace`, `hook-bootstrap`, `hook-log-init`, `eval-helpers`, `eval-reinforce`, `eval-learning`, `eval-decisions`, `eval-knowledge`).
- **Consistent test cleanup**: All new tests use `try/finally` with `fs.rmSync` for temp directory cleanup, preventing test pollution.

### Condition

Add a regression test asserting the hook ignores the old `response_text` field name (the MEDIUM blocking issue above), since PF-006 documents this exact class of silent failure.
