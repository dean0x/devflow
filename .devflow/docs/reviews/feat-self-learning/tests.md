# Tests Review Report

**Branch**: feat/self-learning -> main
**Date**: 2026-03-23

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing test coverage for `parseLearningLog` validation — JSON objects missing required fields are silently accepted** - `tests/learn.test.ts`
**Confidence**: 85%
- Problem: `parseLearningLog` in `learn.ts:154` validates that parsed objects have `id`, `type`, and `pattern` fields before accepting them. However, no test verifies this filtering behavior. A JSON line like `{"foo":"bar"}` (valid JSON, missing required fields) should be skipped, but this path is untested. This means the validation guard could be removed without any test failing.
- Fix: Add a test case:
```typescript
it('skips JSON objects missing required fields', () => {
  const log = [
    '{"foo":"bar"}',
    '{"id":"obs_1","type":"workflow","pattern":"valid","confidence":0.5,"observations":1,"first_seen":"t","last_seen":"t","status":"observing","evidence":[],"details":"d"}',
    '{"id":"obs_2","type":"procedural"}',  // missing pattern
  ].join('\n');
  const result = parseLearningLog(log);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('obs_1');
});
```

**Missing test coverage for `loadLearningConfig` resilience — invalid JSON and wrong-typed fields** - `tests/learn.test.ts`
**Confidence**: 85%
- Problem: `applyConfigLayer` (called by `loadLearningConfig`) explicitly handles invalid JSON (catch block at `learn.ts:201`) and wrong field types (type guards at `learn.ts:198-200`). Neither path is tested. The `catch` block silently swallows parse errors, and the type guards skip non-number/non-string fields. These are defensive behaviors that protect against corrupt config files — critical for a feature that reads user-controlled JSON from disk.
- Fix: Add two test cases:
```typescript
it('ignores invalid JSON gracefully', () => {
  const config = loadLearningConfig('not valid json', null);
  expect(config.max_daily_runs).toBe(10); // defaults preserved
  expect(config.model).toBe('sonnet');
});

it('ignores fields with wrong types', () => {
  const badTypes = JSON.stringify({ max_daily_runs: "twenty", throttle_minutes: true, model: 42 });
  const config = loadLearningConfig(badTypes, null);
  expect(config.max_daily_runs).toBe(10); // default preserved
  expect(config.throttle_minutes).toBe(5);
  expect(config.model).toBe('sonnet');
});
```

### MEDIUM

**No integration tests for init.ts learning hook wiring** - `tests/init-logic.test.ts`
**Confidence**: 82%
- Problem: The `init.ts` diff adds the learning hook integration (`addLearningHook`/`removeLearningHook` called at lines 720-721, `--learn`/`--no-learn` CLI options, manifest features field). Neither `init-logic.test.ts` nor `uninstall-logic.test.ts` contain any assertions about learning. By contrast, the analogous `memory` and `ambient` features have dedicated tests in those files. This means the init-time hook registration/removal for learning could silently break during refactoring.
- Fix: Add at least re-export verification and settings manipulation tests for learning in `init-logic.test.ts`, following the pattern used for ambient and memory hooks. At minimum, verify that `addLearningHook` and `removeLearningHook` are re-exported from init.ts (as the diff shows they are at line 36).

**No tests for `formatLearningStatus` with "ready" status observations** - `tests/learn.test.ts`
**Confidence**: 80%
- Problem: The `formatLearningStatus` tests cover `observing`, `created`, and empty cases, but never provide a set of observations where `ready` count is non-zero and visible in output. The source code computes `ready.length` at line 181 and displays it, but no test verifies the `ready` count is correctly rendered. The existing "shows observation counts" test has a `ready` observation but only asserts on `3 total`, `Workflows: 2`, and `Procedural: 1` — never checking that `1 ready` appears.
- Fix: Add an assertion to the existing "shows observation counts" test:
```typescript
expect(result).toContain('1 ready');
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**560-line shell script (`background-learning`) has zero automated test coverage** - `scripts/hooks/background-learning`
**Confidence**: 85%
- Problem: The `background-learning` script is the core engine of the self-learning feature (560 lines of bash). It handles locking, config loading, daily caps, temporal decay, transcript extraction, LLM invocation, observation merge/update, artifact creation, and path traversal sanitization. None of these behaviors are tested. The existing `memory.test.ts` file includes `session-start-memory hook integration` tests that invoke the shell hook via `exec` — the same pattern could apply here for at least the deterministic parts (config loading, decay math, lock acquisition, observation merge logic).
- Impact: The most complex and error-prone part of the feature is entirely untested. Edge cases like stale lock recovery, daily cap enforcement, temporal decay calculations, and path traversal sanitization in artifact names are all trust-based.
- Fix: Extract testable pure-function helpers into a separate sourced file (e.g., `scripts/hooks/learning-lib`) and test them via shell invocation, or write integration tests that feed controlled JSON into the script's deterministic sections. At minimum, add tests for the `decay_factor` function, daily cap logic, and artifact name sanitization.

**95-line `stop-update-learning` hook has no test coverage** - `scripts/hooks/stop-update-learning`
**Confidence**: 82%
- Problem: The stop hook contains throttle logic, feedback loop guards (`DEVFLOW_BG_LEARNER`/`DEVFLOW_BG_UPDATER` checks), session ID extraction, and learner script resolution. These are all testable without invoking the full LLM. The memory feature's `stop-update-memory` has analogous complexity and the project has an established pattern for shell hook testing.
- Fix: Add basic integration tests (similar to `session-start-memory hook integration` in `memory.test.ts`) that verify: (1) the hook exits cleanly with `DEVFLOW_BG_LEARNER=1`, (2) throttle marker prevents re-triggering within the window, (3) missing `session_id` in input causes graceful exit.

**Session-start-memory learning section (113 lines added) lacks dedicated tests** - `scripts/hooks/session-start-memory`
**Confidence**: 80%
- Problem: 113 lines of new shell code were added to `session-start-memory` (the "Learned Behaviors" section, lines 131-240). This code reads `learning-log.jsonl`, builds lists of promoted commands/skills, detects new artifacts since last notification, and injects context. The existing `session-start-memory hook integration` tests in `memory.test.ts` don't cover this new section. A test that creates a `.memory/learning-log.jsonl` with `status: "created"` entries and verifies the hook output contains `LEARNED BEHAVIORS` would catch regressions.
- Fix: Add a test to the existing `session-start-memory hook integration` describe block:
```typescript
it('injects LEARNED BEHAVIORS section when learning-log has created artifacts', async () => {
  const logEntry = JSON.stringify({
    id: 'obs_test1', type: 'workflow', pattern: 'test-flow',
    confidence: 0.95, observations: 3, first_seen: '2026-03-20T00:00:00Z',
    last_seen: '2026-03-22T00:00:00Z', status: 'created',
    evidence: ['test'], details: 'steps', artifact_path: '/path/to/test-cmd.md'
  });
  await fs.writeFile(path.join(tmpDir, '.memory', 'learning-log.jsonl'), logEntry + '\n');

  const output = await runHook(tmpDir);
  const json = JSON.parse(output);
  const ctx = json.hookSpecificOutput.additionalContext;
  expect(ctx).toContain('LEARNED BEHAVIORS');
});
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Manifest validation does not check `learn` field** - `src/cli/utils/manifest.ts:31-43`
**Confidence**: 80%
- Problem: The `readManifest` function validates `teams`, `ambient`, and `memory` as required booleans, but `learn` is typed as `learn?: boolean` (optional). The manifest validation at line 36-38 does not check for `learn`. While this is intentional for backward compatibility (existing manifests lack `learn`), there is no test in `manifest.test.ts` that exercises manifests with or without the `learn` field, confirming the schema is loose by design.

## Suggestions (Lower Confidence)

- **Consider testing `addLearningHook`/`removeLearningHook` round-trip with memory and ambient hooks combined** - `tests/learn.test.ts` (Confidence: 70%) -- The init.ts code runs `removeLearningHook` then `addLearningHook` after memory hooks. Testing the three-hook interaction (memory + ambient + learning in same settings JSON) would catch ordering bugs.

- **`loadLearningConfig` does not validate numeric bounds** - `src/cli/commands/learn.ts:195-203` (Confidence: 65%) -- The `--configure` wizard validates `max_daily_runs` between 1-50 and `throttle_minutes` between 1-60, but `applyConfigLayer` accepts any number (including negatives, zero, or extremely large values). A hand-edited config could set `max_daily_runs: -1`. This is a boundary validation gap rather than a test gap, but tests documenting the expected behavior would be valuable.

- **Shell hook tests depend on `jq` being installed** - `scripts/hooks/background-learning`, `scripts/hooks/session-start-memory` (Confidence: 62%) -- Both shell scripts require `jq` and silently no-op if it is missing. The test environment may not match production environments where `jq` is unavailable. No test verifies the graceful `jq`-missing fallback.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 3 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Tests Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The pure-function tests in `tests/learn.test.ts` are well-structured and follow project conventions (behavior-focused, simple setup, AAA pattern). They cover the core hook management, JSONL parsing, status formatting, and config loading functions thoroughly. However, there are two notable gaps: (1) important defensive code paths (invalid JSON resilience, field validation filtering) lack test coverage despite being explicitly implemented, and (2) the 560-line `background-learning` shell script -- the most complex and risk-prone component of this feature -- has zero automated tests. The project has established patterns for shell hook testing (see `memory.test.ts`), making this a practical gap to close.
