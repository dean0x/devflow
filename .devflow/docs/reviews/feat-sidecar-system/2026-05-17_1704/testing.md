# Testing Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Test Results**: 218 passed, 1 failed (pre-existing sentinel issue in `pre-compact-memory`)

## Issues in Your Changes (BLOCKING)

### HIGH

**No concurrency/multi-session tests for sidecar hooks** — `tests/shell-hooks.test.ts`
**Confidence**: 92%
- Problem: The sidecar system is explicitly designed for multi-session environments (sidecar-capture writes queue files, sidecar-dispatch reads markers, sidecar-evaluate writes markers — all potentially from concurrent sessions). There are zero tests exercising concurrent access: two sessions writing to the same `.pending-turns.jsonl` simultaneously, two sidecar-dispatch hooks reading markers concurrently, or a sidecar-capture racing with a sidecar-dispatch on the same queue file. The `sidecar-config.ts` `updateFeature` function even documents the race window in its D1 JSDoc comment, yet has no test proving the race does not corrupt the config.
- Fix: Add at minimum:
  1. A test that runs two sidecar-capture invocations in parallel (via `Promise.all` with `exec`) appending to the same queue file, then verifies no lines are corrupted or lost.
  2. A test that runs sidecar-dispatch while sidecar-capture is appending, verifying the `.processing` rename is atomic.
  3. A test for `updateFeature` with two concurrent calls toggling different features, verifying neither write is lost.

**sidecar-dispatch feature-gating behavior untested** — `scripts/hooks/sidecar-dispatch:136-140`
**Confidence**: 95%
- Problem: `sidecar-dispatch` lines 136-140 implement feature-gating logic: when a feature is disabled in config, it deletes the stale marker and skips it. This is a correctness-critical path (prevents dispatching work for disabled features, and cleans up markers that accumulated before the feature was turned off). There are zero tests for this behavior. The only dispatch tests cover stale-marker recovery and directive output, not the feature-gating path.
- Fix: Add tests:
  ```typescript
  it('dispatch skips marker for disabled feature and removes it', () => {
    createSidecarConfig(tmpDir, { learning: false, decisions: true });
    const sidecarDir = path.join(tmpDir, '.memory', '.sidecar');
    fs.writeFileSync(path.join(sidecarDir, 'learning.json'), '{}');
    fs.writeFileSync(path.join(sidecarDir, 'decisions.json'), '{}');

    const result = execSync(`bash "${DISPATCH_HOOK}"`, {
      input: JSON.stringify({ cwd: tmpDir, session_id: 'test', prompt: 'hello' }),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();

    // learning.json should be deleted
    expect(fs.existsSync(path.join(sidecarDir, 'learning.json'))).toBe(false);
    // Only decisions in directive
    const parsed = JSON.parse(result);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('decisions');
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain('learning');
  });
  ```

**No test for sidecar-dispatch marker expiry (>24h markers deleted)** — `scripts/hooks/sidecar-dispatch:142-151`
**Confidence**: 90%
- Problem: `sidecar-dispatch` lines 142-151 implement marker expiry: markers with a timestamp field older than 86400 seconds (24h) are silently deleted. This is a data-integrity safety net (prevents ancient markers from being dispatched indefinitely). There is no test for this behavior. The existing dispatch tests cover stale `.processing` recovery and directive output but not the 24h expiry path.
- Fix: Add a test that writes a marker with `timestamp` set to `Date.now()/1000 - 90000` (>24h ago), runs dispatch, and verifies the marker file was deleted and no directive is output.

### MEDIUM

**Missing edge case: sidecar-capture with empty response_text** — `scripts/hooks/sidecar-capture:56-58`
**Confidence**: 85%
- Problem: `sidecar-capture` exits at line 56 if `RESPONSE_TEXT` is empty. There is no test verifying this guard. If the guard were accidentally removed, empty entries would pollute the queue file.
- Fix: Add a test case:
  ```typescript
  it('sidecar-capture exits cleanly with empty response_text', () => {
    fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
    const input = JSON.stringify({
      cwd: tmpDir, session_id: 'test', stop_reason: 'end_turn', response_text: '',
    });
    execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(fs.existsSync(path.join(tmpDir, '.memory', '.pending-turns.jsonl'))).toBe(false);
  });
  ```

**Missing test: sidecar-evaluate decisions daily cap** — `scripts/hooks/sidecar-evaluate:307-319`
**Confidence**: 88%
- Problem: The learning daily cap has a dedicated test (`learning daily cap blocks marker creation`), but the decisions daily cap (lines 307-319 of `sidecar-evaluate`) has no equivalent test. The decisions cap uses `MAX_DEC_RUNS=3` (different from learning's 5), meaning a cap miscalculation would only be caught in production.
- Fix: Add a `decisions daily cap blocks marker creation` test mirroring the learning cap test, with the `.decisions-runs-today` counter set to 3.

**sidecar-config.test.ts missing concurrent read/write test** — `tests/sidecar-config.test.ts`
**Confidence**: 82%
- Problem: `sidecar-config.ts` uses a non-atomic read-modify-write pattern (`readConfig` then `writeConfig`). The D1 JSDoc comment documents the race window. While the comment justifies the design, there is no test proving that concurrent calls to `updateFeature` for different keys both succeed under normal (fast-filesystem) conditions. This would serve as a regression guard if the implementation changes.
- Fix: Add a test that runs `updateFeature(tmpDir, 'memory', false)` and `updateFeature(tmpDir, 'decisions', false)` concurrently via `Promise.all`, then reads the config and verifies both features are disabled.

**Missing test: sidecar-evaluate with corrupt transcript** — `scripts/hooks/sidecar-evaluate:68-83`
**Confidence**: 80%
- Problem: `sidecar-evaluate` reads transcript files and counts user turns. There is no test for a transcript file containing malformed JSONL (corrupted lines, truncated JSON). The `USER_TURNS` counting code uses `jq -c 'select(.type == "user")'` or `grep -c`, both of which handle malformed lines differently. A corrupt transcript could silently return an incorrect turn count, skipping or over-triggering evaluations.
- Fix: Add a test with a transcript containing a mix of valid JSONL and garbage lines, verifying the hook exits cleanly and the user turn count is based only on valid entries.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**sentinel.test.ts has a failing test for pre-compact-memory** — `tests/sentinel.test.ts:124`
**Confidence**: 95%
- Problem: The test `sentinel guard: pre-compact-memory exits cleanly when .working-memory-disabled exists` fails because the sentinel was changed from file-based (`.working-memory-disabled`) to config-based (`sidecar config memory: false`), but this specific test was not updated. The test writes the old sentinel file and expects `backup.json` to not be written, but the hook no longer checks the old sentinel.
- Fix: Update the test to write a sidecar config with `memory: false` instead of creating the `.working-memory-disabled` sentinel file, consistent with how the other sentinel tests were updated.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Deleted test suites leave minor coverage gaps in observation lifecycle** — Multiple deleted files
**Confidence**: 80%
- Problem: Seven test files were deleted (2,258 lines total): `background-runner.test.ts`, `background-runner-extract.test.ts`, `decisions-agent.test.ts`, `hook-management.test.ts`, `run-background.test.ts`, `knowledge.test.ts`, `learning-agent.test.ts`. The corresponding source files (`background-runner.ts`, `decisions-agent.ts`, `learning-agent.ts`) were also deleted, so the bulk of the coverage loss is appropriate. However, some deleted tests covered observation pipeline semantics (batch extraction, temporal decay application, lock acquisition/release) that are now handled by `json-helper.cjs` and `sidecar-evaluate`. The `json-helper.cjs` operations are well-tested via the existing `shell-hooks.test.ts` tests (process-observations, temporal-decay, create-artifacts, filter-observations). The hook-management tests for decisions/learning were replaced by the updated `memory.test.ts` which now covers the unified sidecar hook install/remove. The net coverage position is healthy.

## Suggestions (Lower Confidence)

- **sidecar-dispatch with no .memory dir and no prompt** — `scripts/hooks/sidecar-dispatch:45` (Confidence: 65%) — When `MEMORY_ENABLED` is true but `.memory/` dir does not exist and `PROMPT` is empty, the hook skips user turn capture entirely (the `ensure-memory-gitignore` source is inside the `MEMORY_ENABLED && PROMPT` guard). This leaves `.memory/` uncreated for the marker-dispatch section. Not necessarily a bug (dispatch checks `[ ! -d "$SIDECAR_DIR" ]`), but the interaction is untested.

- **Property-based testing for queue JSONL format** — `tests/shell-hooks.test.ts:1325` (Confidence: 60%) — The queue JSONL format test at line 1325 manually constructs 3 entries and validates them. A property-based test using fast-check could generate arbitrary user/assistant strings (including embedded newlines, quotes, and null bytes) and verify the JSONL round-trip integrity through the actual hook scripts, catching shell quoting edge cases that manual tests miss.

- **sidecar-evaluate knowledge marker: no test for the actual stale-slug detection path** — `scripts/hooks/sidecar-evaluate:382-406` (Confidence: 70%) — The knowledge evaluation section queries `feature-knowledge.cjs stale-slugs` and writes a marker. Tests cover the throttle and sentinel guards, but not the happy path where stale slugs are actually found and a `knowledge.json` marker is written. This is partially justified because `feature-knowledge.cjs` would need real `.features/` state with stale entries, making the test complex.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 3 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The test suite demonstrates strong fundamentals: behavioral testing approach, proper temp directory isolation, resource cleanup via try/finally and afterEach, clear AAA structure, and comprehensive coverage of the happy paths for all three sidecar hooks. The `sidecar-config.test.ts` is particularly well-structured with good coverage of defaults, partial configs, malformed JSON, and non-object values.

However, three significant gaps reduce the score:
1. **Zero concurrency tests** for a system explicitly designed around multi-session file access (the highest-risk area).
2. **Untested dispatch feature-gating** and **marker expiry** — two correctness-critical paths in `sidecar-dispatch` that silently delete data.
3. **A failing pre-existing sentinel test** that was not updated during the migration.

The deleted test suites are appropriately replaced — the source files they tested were also deleted, and the `json-helper.cjs` and hook-level tests provide equivalent behavioral coverage for the new system.
