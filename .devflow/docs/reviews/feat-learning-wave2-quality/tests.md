# Tests Review Report

**Branch**: feat-learning-wave2-quality -> main
**Date**: 2026-03-25
**PR**: #162

## Issues in Your Changes (BLOCKING)

### HIGH

**No test for `loadAndCountObservations` helper** - `src/cli/commands/learn.ts:175-182`
**Confidence**: 85%
- Problem: The new `loadAndCountObservations()` function is exported and used by `--status`, `--list`, and `--purge` code paths, but has zero direct test coverage. It encapsulates the raw-line-count + parse pattern and computes `invalidCount`, which is user-facing (shown in warnings). A bug in the `invalidCount` calculation (e.g., off-by-one between `rawLines` and `observations.length`) would go undetected.
- Fix: Add a `describe('loadAndCountObservations')` block covering:
  ```typescript
  it('returns correct counts for mixed valid/invalid lines', () => {
    const log = [
      '{"id":"obs_1","type":"workflow","pattern":"p","confidence":0.5,"observations":1,"first_seen":"t","last_seen":"t","status":"observing","evidence":[],"details":"d"}',
      'invalid json',
      '',
      '{"id":"obs_2","type":"procedural","pattern":"p2","confidence":0.3,"observations":1,"first_seen":"t","last_seen":"t","status":"observing","evidence":[],"details":"d"}',
    ].join('\n');
    const { observations, invalidCount } = loadAndCountObservations(log);
    expect(observations).toHaveLength(2);
    expect(invalidCount).toBe(1); // 3 non-empty lines - 2 valid = 1
  });

  it('returns zero invalid for all-valid input', () => {
    const log = '{"id":"obs_1","type":"workflow","pattern":"p","confidence":0.5,"observations":1,"first_seen":"t","last_seen":"t","status":"observing","evidence":[],"details":"d"}';
    const { observations, invalidCount } = loadAndCountObservations(log);
    expect(observations).toHaveLength(1);
    expect(invalidCount).toBe(0);
  });

  it('handles empty input', () => {
    const { observations, invalidCount } = loadAndCountObservations('');
    expect(observations).toHaveLength(0);
    expect(invalidCount).toBe(0);
  });
  ```

### MEDIUM

**No test for `extract-text-messages` string content path** - `scripts/hooks/json-helper.cjs:179-182`
**Confidence**: 85%
- Problem: The diff adds a new code path in `json-helper.cjs` where `content` is a string rather than an array (lines 179-182). The existing test at `shell-hooks.test.ts:179` only covers the array case. The new string-type branch is completely untested. If the string check were accidentally removed or inverted, no test would catch the regression.
- Fix: Add a test case alongside the existing `extract-text-messages` test:
  ```typescript
  it('extract-text-messages handles string content', () => {
    const input = JSON.stringify({
      message: { content: 'Plain text message' },
    });
    const result = execSync(
      `echo '${input.replace(/'/g, "'\\''")}' | node "${JSON_HELPER}" extract-text-messages`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(result).toBe('Plain text message');
  });
  ```

**No test for `learning-new` operation name changes** - `scripts/hooks/json-helper.cjs:309-315`
**Confidence**: 80%
- Problem: The `learning-new` operation in `json-helper.cjs` was refactored to use the `artifactName()` helper and changed output format from `/learned/{name}` to `/self-learning/{name}`. The `learning-created` operation has a test (`shell-hooks.test.ts:277`), but `learning-new` has zero test coverage. The naming change (`/learned/` to `/self-learning/`) is user-facing (shown in session-start notifications) and would silently regress without tests.
- Fix: Add a test for `learning-new`:
  ```typescript
  it('learning-new formats artifact messages with self-learning prefix', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    const file = path.join(tmpDir, 'learning.jsonl');
    try {
      fs.writeFileSync(file, [
        JSON.stringify({ id: 'obs_1', type: 'workflow', status: 'created',
          artifact_path: '/path/self-learning/deploy-flow.md', confidence: 0.95,
          last_seen: '2026-03-22T00:00:00Z' }),
      ].join('\n'));
      const result = execSync(
        `node "${JSON_HELPER}" learning-new "${file}" 0`,
        { stdio: 'pipe' },
      ).toString().trim();
      expect(result).toContain('/self-learning/deploy-flow');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`learning-created` test uses path that does not match actual artifact path convention** - `tests/shell-hooks.test.ts:283-284`
**Confidence**: 82%
- Problem: The test fixture uses `artifact_path: '/path/self-learning/deploy-flow.md'` for a workflow and `'/path/debug-hooks/SKILL.md'` for a procedural skill. However, the actual `create_artifacts()` function in `background-learning` creates commands at `.claude/commands/self-learning/{name}.md` and skills at `.claude/skills/{name}/SKILL.md`. The test fixture paths differ from production paths (no `.claude/commands/` or `.claude/skills/` prefix). While the `artifactName()` helper currently works with these simplified paths (it splits on `/` and takes the right segments), the test does not validate against realistic paths and could mask bugs in path parsing if the extraction logic changes.
- Fix: Use production-realistic paths in the test fixture:
  ```typescript
  JSON.stringify({ id: 'obs_1', type: 'workflow', status: 'created',
    artifact_path: '/project/.claude/commands/self-learning/deploy-flow.md', confidence: 0.95 }),
  JSON.stringify({ id: 'obs_2', type: 'procedural', status: 'created',
    artifact_path: '/project/.claude/skills/debug-hooks/SKILL.md', confidence: 0.8 }),
  ```

**No test for `session-end-learning` script beyond syntax check** - `scripts/hooks/session-end-learning`
**Confidence**: 80%
- Problem: The new 203-line `session-end-learning` shell script is the primary hook for the learning system (replacing `stop-update-learning`). It implements session depth checks, 3-session batching, adaptive batch sizing, daily cap enforcement, and reinforcement logic. The only test coverage is the `bash -n` syntax check at `shell-hooks.test.ts:24-35`. By contrast, `background-learning` has dedicated pure-function tests for `decay_factor`, `check_daily_cap`, and `increment_daily_counter`. The session-end-learning script's batching counter logic and adaptive batch sizing are equally testable as extracted functions but have no tests.
- Fix: Extract and test the key pure functions (similar to the existing `background-learning` pure function tests):
  - Batch counting logic (accumulate session IDs, check batch-full condition)
  - Adaptive batch sizing (5 when >= 15 observations)
  - Daily cap check (tab-separated counter format)

  This is a lower-priority structural improvement since the script is largely orchestration glue, but the batching logic in particular is complex enough to warrant direct testing.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Shell pure-function tests re-implement logic instead of sourcing it** - `tests/shell-hooks.test.ts:39-139`
**Confidence**: 85%
- Problem: The `background-learning pure functions` tests (lines 39-139) copy-paste function bodies from the shell scripts into inline bash strings rather than sourcing the actual script. If the function implementations in `background-learning` diverge from these test copies, the tests will pass while the actual production functions are broken. This is a pre-existing pattern (not introduced in this PR) but is worth noting as an architectural concern since `session-end-learning` would inherit the same pattern.
- Impact: False confidence in test coverage -- tests validate the test copy, not the production code.

## Suggestions (Lower Confidence)

- **Test `removeLearningHook` with both SessionEnd and Stop hooks where SessionEnd marker is in Stop array** - `tests/learn.test.ts:163` (Confidence: 65%) -- The `removeFromEvent` function uses different markers for SessionEnd vs Stop. A test where a `session-end-learning` entry accidentally appears in the Stop array (user misconfiguration) would verify the removal logic handles marker-to-event binding correctly.

- **`hasLearningHook` returns false for legacy Stop hook -- migration path untested** - `tests/learn.test.ts:215` (Confidence: 70%) -- The test at line 215 verifies `hasLearningHook` returns false for a legacy `stop-update-learning` in the Stop array, which is correct behavior. However, there is no end-to-end migration test that demonstrates the full upgrade flow: disable (removes legacy Stop) then enable (adds new SessionEnd). A test combining `removeLearningHook` on legacy input followed by `addLearningHook` would validate the migration path.

- **`check_daily_cap` test hardcodes `MAX_DAILY_RUNS=10` but default changed to 5** - `tests/shell-hooks.test.ts:73` (Confidence: 72%) -- The shell pure-function test for `check_daily_cap` uses `MAX_DAILY_RUNS=10` while the production default was changed to 5 in this PR. Since the test copy-pastes the function (pre-existing issue), this is not a correctness bug, but it represents a value drift between test assumptions and production defaults.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Tests Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The test updates correctly track the Stop-to-SessionEnd migration and the naming/threshold changes, and all 78 tests pass. However, the PR introduces a new exported function (`loadAndCountObservations`) with zero tests, a new code path in `extract-text-messages` (string content) with no coverage, and the entirely new `session-end-learning` script has only a syntax check. The `learning-new` operation's name change is also untested. The most impactful gap is the missing `loadAndCountObservations` test, as it directly affects user-facing output (invalid entry counts). Adding tests for that function and the string content path would bring coverage to an acceptable level.
