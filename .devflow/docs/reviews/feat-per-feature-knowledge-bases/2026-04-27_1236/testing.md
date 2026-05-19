# Testing Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27
**Diff**: `git diff 998f2b2...HEAD` (10 files, +202/-130 lines)

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing test coverage for sidecar pattern (create + refresh flows in kb.ts)** - `src/cli/commands/kb.ts:381-434`, `src/cli/commands/kb.ts:497-544`
**Confidence**: 90%
- Problem: The sidecar pattern (`kb create` writes `.create-result.json`, reads it back, calls `updateIndex`, then cleans up; `kb refresh` does the same with `.refresh-result.json`) is a critical new behavioral contract with no unit or integration test coverage. The sidecar read, parse, fallback-to-defaults, `updateIndex` call, and cleanup-on-error paths are all untested. This is the most significant behavioral change in the PR (moving index updates from the LLM agent to the host process), and a bug here would silently produce KBs with empty `referencedFiles` and default categories.
- Fix: Add tests exercising at minimum: (1) sidecar present with valid JSON results in correct `updateIndex` call, (2) sidecar missing gracefully falls back to defaults, (3) sidecar with malformed JSON falls back to defaults, (4) sidecar cleanup on error path. Since `kb create` and `kb refresh` spawn `claude -p` which cannot run in tests, consider extracting the sidecar-read-then-updateIndex logic into a testable function, or testing the `updateIndex` integration directly using the module import.

**Missing test for `stale-slugs` with empty index** - `tests/feature-kb/kb-command.test.ts` (deleted)
**Confidence**: 85%
- Problem: The deleted test `stale-slugs outputs nothing for empty index` from `kb-command.test.ts` (line 90-94) verified that `stale-slugs` handles an index with zero features (`{ version: 1, features: {} }`) gracefully. This edge case is not covered by any test in `feature-kb.test.ts` -- the existing `CLI stale-slugs` tests cover non-stale index (with entries) and a git-repo-with-changes scenario, but not the empty-features boundary. The "non-stale" test uses `SAMPLE_INDEX` which has one entry; the empty-features case is distinct.
- Fix: Add a test to the `CLI stale-slugs` describe block in `feature-kb.test.ts`:
  ```typescript
  it('outputs nothing for empty features object', () => {
    const tmp = makeTmpFeatureWorktree({ version: 1, features: {} });
    const output = execFileSync('node', [FEATURE_KB_CJS, 'stale-slugs', tmp], { encoding: 'utf8' });
    expect(output.trim()).toBe('');
  });
  ```

### MEDIUM

**Shell hook tests only verify exit code, not behavioral correctness** - `tests/shell-hooks.test.ts:1512-1588`
**Confidence**: 82%
- Problem: All 5 new `session-end-kb-refresh guard clauses` tests verify `not.toThrow()` (clean exit), but none assert that the hook actually skips the background spawn. For instance, the `exits cleanly when .features/.disabled sentinel exists` test confirms exit code 0 but does not verify that `background-kb-refresh` was NOT spawned. A bug that removes the `.disabled` guard would still pass these tests as long as the hook exits 0. This matches the existing shell-hook test pattern in the file, so it is a pre-existing style issue being propagated, but since these are newly written tests, the coverage gap is in your changes.
- Fix: For guard-clause tests where the hook would fail to spawn `background-kb-refresh` (because `claude` is not on PATH in CI), the current tests are arguably sufficient -- they indirectly prove the guard worked because the hook exits 0 before reaching the spawn. However, consider adding an explicit assertion for the throttle case (which is the most fragile guard): verify that stderr/stdout does not contain "background-kb-refresh" or that no `.kb-refresh.log` file is created in the temp directory.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Assertion weakening in refresh-context test** - `tests/feature-kb/feature-kb.test.ts:528`
**Confidence**: 85%
- Problem: The `refresh-context` test assertion for `parts[3]` (changed files JSON) was changed from `expect(JSON.parse(parts[3])).toBeInstanceOf(Array)` to `expect(() => JSON.parse(parts[3])).not.toThrow()`. The new assertion is strictly weaker -- it only verifies the output is valid JSON, not that it is an array. Any valid JSON value (string, number, object, null) would pass. The original assertion verified the behavioral contract that `changedFiles` is always an array.
- Fix: Change to:
  ```typescript
  expect(JSON.parse(parts[3])).toBeInstanceOf(Array);   // changed files JSON
  ```
  Or combine both:
  ```typescript
  const changedFiles = JSON.parse(parts[3]);
  expect(Array.isArray(changedFiles)).toBe(true);
  ```

## Pre-existing Issues (Not Blocking)

(none identified)

## Suggestions (Lower Confidence)

- **No test for PRE_SLUGS passthrough in background-kb-refresh** - `scripts/hooks/background-kb-refresh:89-93` (Confidence: 70%) -- The new `PRE_SLUGS` parameter is passed from `session-end-kb-refresh` to `background-kb-refresh` and used to skip the `stale-slugs` re-computation. This optimization path has no test, but testing background scripts that spawn `claude -p` is inherently difficult.

- **No test for sidecar path injection in background-kb-refresh** - `scripts/hooks/background-kb-refresh:163-168` (Confidence: 65%) -- The inline `node -e` script uses `$SIDECAR` interpolated directly into a JavaScript string (`readFileSync('$SIDECAR','utf8')`). If the sidecar path contains a single quote, the inline JS would break. In practice, the path is constructed from `$CWD/.features/$SLUG/.refresh-result.json` where `$SLUG` is validated, so the risk is low. avoids PF-001 (no Promise resolver renaming is involved here, but the general principle of not changing naming to work around technical issues applies to the inline-JS approach -- worth noting the fragility).

- **`set -e` removal from background scripts reduces fail-fast safety** - `scripts/hooks/background-learning:9`, `scripts/hooks/background-memory-update:9` (Confidence: 62%) -- Removing `set -e` from background scripts means intermediate failures (e.g., `source` failing, `log` function errors) will not halt execution. The scripts already have per-command error handling, so this may be intentional to prevent `set -e` from killing the background process on benign non-zero exits (e.g., `kill` on already-dead PID). But it broadens the blast radius of unexpected failures.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The test refactoring (try/catch to `.toThrow()`) and duplicate removal are good improvements. The new `session-end-kb-refresh` guard-clause tests add meaningful coverage. However, the most significant behavioral change in this PR -- the sidecar pattern that moves index updates from LLM agents to host-side code -- has zero test coverage. This is a critical path (it controls how KB metadata gets persisted) with multiple fallback branches, and should have tests before merge.
