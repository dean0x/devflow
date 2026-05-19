# Testing Review Report

**Branch**: feat-phase-3-decouple-decisions-agent -> main
**Date**: 2026-05-06

## Issues in Your Changes (BLOCKING)

### HIGH

**Tests re-implement inline logic instead of calling actual code** - `tests/decisions/cli-subcommands.test.ts:116-158,164-209`
**Confidence**: 85%
- Problem: The `decisions --list filtering logic` and `decisions --status count logic` test blocks re-implement the filtering logic inline (`all.filter(o => o.type === 'decision' || o.type === 'pitfall')`) rather than importing and calling the actual command handler's filtering. This means the tests validate that `Array.filter` works, not that the production code filters correctly. If the production filtering logic changed (e.g., adding a new type), these tests would still pass while behavior drifted.
- Fix: Either (a) extract the filtering logic into a named, exported helper function in `decisions.ts` and test that directly, or (b) use Commander integration tests that exercise `decisionsCommand.parseAsync(['--list'])` with a seeded log file and assert on the `@clack/prompts` mock output. The `run-background.test.ts` file already demonstrates the Commander integration pattern well.

**No unit test for `extractBatchMessages` — only mocked in pipeline tests** - `src/cli/utils/background-runner.ts:225-276`
**Confidence**: 82%
- Problem: `extractBatchMessages` is a critical pipeline function (reads batch IDs, locates transcripts, calls `transcript-filter.cjs`, merges results) but has zero direct unit tests. It is only tested indirectly via mocked calls in `run-background.test.ts` and the integration E2E test. The function has meaningful logic: path encoding, session ID iteration, error swallowing for missing transcripts, JSON parsing of channel output. A bug in any of these would not be caught by the mocked pipeline tests.
- Fix: Add a dedicated test block in `background-runner.test.ts` that creates temp batch-ids files and transcript files, provides a real or shimmed `transcript-filter.cjs`, and asserts the merged output. At minimum, test: (1) file-not-found batch IDs graceful handling, (2) missing transcript skip, (3) correct merging of multi-session results.

**No unit test for `loadExistingObservations` — only exercised via mocked `execFile`** - `src/cli/utils/background-runner.ts:366-386`
**Confidence**: 80%
- Problem: `loadExistingObservations` has non-trivial fallback logic (try `json-helper.cjs filter-observations` first, fall back to direct log parsing). The fallback path (`_loadObservationsFromLog`) filters by type AND status `=== 'observing'`, which is a semantic constraint not documented in the function's JSDoc. Neither the primary nor fallback path has a direct unit test. The mock in `learning-agent.test.ts` and `decisions-agent.test.ts` returns canned `'[]'` for the `node` execFile call, which only validates that the caller passes the result to the prompt.
- Fix: Add tests for `loadExistingObservations` with: (1) a fake json-helper that returns filtered data, (2) the fallback path where json-helper is absent, (3) verifying the type filter works, (4) verifying only `observing` status entries are returned in the fallback. If the function is not exported, consider exporting it (it already is) or testing `_loadObservationsFromLog` directly.

### MEDIUM

**`decisions --dismiss-capacity` test re-implements logic instead of calling the command** - `tests/decisions/cli-subcommands.test.ts:350-423`
**Confidence**: 85%
- Problem: The `--dismiss-capacity notification logic` tests manually read/write the notifications file and apply the dismiss logic inline, duplicating what the actual `--dismiss-capacity` handler does. They validate the concept of dismissal but not the actual code path. If the handler had a bug (e.g., wrong file path, missing error handling), these tests would still pass.
- Fix: Use `decisionsCommand.parseAsync(['--dismiss-capacity'])` with a temp cwd and seeded `.decisions-notifications.json`, then assert the file was updated correctly. Mock `getClaudeDirectory` and `process.cwd()` as needed.

**`decisions --reset target files` test validates a static list, not the actual reset behavior** - `tests/decisions/cli-subcommands.test.ts:311-344`
**Confidence**: 83%
- Problem: The test hardcodes a list of file names and asserts they contain "decision" or "decisions". This is a meta-test that validates naming conventions, not that the `--reset` handler actually removes those files. If a new file were added to the reset handler but not to the test list, the test would still pass.
- Fix: Create a temp directory with all expected state files, run `decisionsCommand.parseAsync(['--reset'])` with appropriate mocks, and verify that the files were actually deleted.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`capEntries (alias test)` describe block is redundant** - `tests/background-runner.test.ts:341-360`
**Confidence**: 88%
- Problem: The `capEntries (alias test)` describe block at line 341 contains a single test identical to what is already covered by the `caps 150-line file to 100 lines` test at line 321. The describe block name says "alias test" but it is testing the same function with the same parameters, not an alias.
- Fix: Remove the duplicate describe block. If it was meant to test a different entrypoint or import alias, update it to actually test that path.

**Temp file cleanup in `runDecisionsAgent` and `runLearningAgent` tests relies on manual `fs.unlinkSync`** - `tests/decisions/decisions-agent.test.ts:352,384` and `tests/learning/learning-agent.test.ts:239,256`
**Confidence**: 80%
- Problem: Several tests call `fs.unlinkSync(resultPath)` inline after assertions. If an assertion fails before the unlink, the temp file leaks. The tests already have `afterEach` with `fs.rmSync(tmpDir, ...)`, but the temp files created by the agent are written to `os.tmpdir()`, not inside `tmpDir`.
- Fix: Either (a) ensure the agent writes temp files inside the test's `tmpDir` (if the API supports it), or (b) collect temp file paths in the test and clean them in `afterEach` using a cleanup array pattern, or (c) accept the leak since OS cleans `/tmp` periodically (low severity).

## Pre-existing Issues (Not Blocking)

(none found at CRITICAL severity in unchanged code)

## Suggestions (Lower Confidence)

- **Missing error path test for `claude` process exit failure in `runDecisionsAgent`** - `src/cli/utils/decisions-agent.ts` (Confidence: 70%) -- The test at line 423 covers invalid JSON but does not test what happens when `claude` exits with non-zero status code (the `execFileAsync` rejection path that is not a JSON parse error).

- **No test for `learn --run-background` pipeline ordering** (Confidence: 65%) -- The `decisions --run-background` pipeline has explicit ordering tests (e.g., `acquires lock before extractBatchMessages`, `applies temporal decay before running agent`), but the equivalent `learn --run-background` path in `learn.ts` has no such pipeline ordering tests (only tested via the E2E integration test which has a different granularity).

- **`session-end-decisions` shell hook has no dedicated shell-level test** - `scripts/hooks/session-end-decisions` (Confidence: 62%) -- The hook is listed in `HOOK_SCRIPTS` for existence/syntax checks in `shell-hooks.test.ts`, but its guard clauses (disabled sentinel, session depth, daily cap, session ID validation) are not directly tested. The `session-end-learning` hook similarly lacks shell-level guard clause tests, so this is consistent with the existing pattern.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The test suite is comprehensive in breadth -- 392 tests all passing, covering the new `background-runner`, `decisions-agent`, `learning-agent`, `decisions-config`, hook management, HUD counts/notifications, split-migration, and type-filter functionality. Test quality is strong for the direct unit tests (proper AAA structure, good edge cases, adversarial inputs for type guards, cleanup in afterEach, proper use of temp directories). The main concerns are: (1) several `cli-subcommands.test.ts` tests re-implement production logic inline rather than exercising the actual command handlers, which means they validate the concept but not the code; (2) `extractBatchMessages` and `loadExistingObservations` are critical pipeline functions with non-trivial logic that have no direct unit tests, only mocked invocations. The pipeline integration tests (`run-background.test.ts`) properly verify ordering and argument passing, and the split-migration tests properly exercise the CJS script via `execSync`, which is good design.
