# Tests Review Report

**Branch**: fix/learning-validation-and-debug-logs -> main
**Date**: 2026-03-25

## Issues in Your Changes (BLOCKING)

### HIGH

**Migration test writes to real `~/.devflow/logs/` directory** - `tests/memory.test.ts:350-372`
**Confidence**: 90%
- Problem: The test "migrates debug logs from .memory/ to ~/.devflow/logs/" calls `migrateMemoryFiles(false, tmpDir)` which internally calls `getDevFlowDirectory()` to resolve the real `~/.devflow/` path. This means the test writes files to the actual user home directory (`~/.devflow/logs/{slug}/`) rather than a sandboxed temp directory. While the test does clean up after itself (line 371: `await fs.rm(logsDir, { recursive: true, force: true })`), this creates several problems: (1) if the test crashes before cleanup, orphaned files remain in the real filesystem; (2) the test depends on write access to `~/.devflow/`; (3) in CI environments, the home directory may have different permissions or constraints; (4) parallel test runs could collide on the same path.
- Fix: Inject the devflow directory path or mock `getDevFlowDirectory()` to return a temp directory. Alternatively, refactor `migrateMemoryFiles` to accept a `devflowDir` parameter for testability:
  ```typescript
  // In post-install.ts, add optional parameter:
  export async function migrateMemoryFiles(
    verbose: boolean, cwd?: string, devflowDir?: string
  ): Promise<number> {
    // ...
    const logsDir = path.join(devflowDir ?? getDevFlowDirectory(), 'logs', slug);
    // ...
  }

  // In test:
  const testDevflowDir = path.join(tmpDir, '.devflow-test');
  const count = await migrateMemoryFiles(false, tmpDir, testDevflowDir);
  ```

### MEDIUM

**Purge validation in `migrateMemoryFiles` is weaker than `isLearningObservation` type guard** - `tests/memory.test.ts:374-393` and `src/cli/utils/post-install.ts:615-629`
**Confidence**: 85%
- Problem: The auto-purge logic in `migrateMemoryFiles` (lines 620-624) uses a simple truthy check (`obj.id && obj.type && obj.pattern`) to validate observations, while the rest of the codebase uses the strict `isLearningObservation` type guard (which also validates field types, required fields like `confidence`, `observations`, `status`, `evidence`, `details`, and now non-empty strings). This means an entry like `{"id":"x","type":"invalid","pattern":"y"}` would survive the migration purge but fail `parseLearningLog`/`isLearningObservation`. The test at line 374 only covers the cases that both validators agree on (empty id, empty pattern, malformed JSON), so it does not reveal this divergence.
- Fix: Reuse `parseLearningLog` (which uses `isLearningObservation`) in the migration purge logic for consistency:
  ```typescript
  // In post-install.ts, import and reuse:
  import { parseLearningLog } from '../commands/learn.js';

  // Replace the manual filter with:
  const content = await fs.readFile(logPath, 'utf-8');
  const rawLines = content.split('\n').filter(l => l.trim());
  const valid = parseLearningLog(content);
  if (valid.length < rawLines.length) {
    const validLines = valid.map(o => JSON.stringify(o));
    await fs.writeFile(logPath, validLines.join('\n') + (validLines.length ? '\n' : ''), 'utf-8');
  }
  ```
  Then add a test case that verifies entries with wrong types (e.g., `confidence: "high"`) are also purged during migration.

**No test for `--purge` CLI behavior** - `src/cli/commands/learn.ts:444-470`
**Confidence**: 82%
- Problem: The new `--purge` option adds 26 lines of CLI logic (file reading, counting invalid entries, rewriting the file) but has no dedicated test. The unit tests for `parseLearningLog` and `isLearningObservation` cover the underlying validation, but the `--purge` integration behavior (reading from disk, computing invalid count, writing purged content, handling missing file) is untested. This is the same pattern used for `--status`, `--list`, `--clear`, and `--configure` which also lack unit tests, so this is consistent with existing conventions. However, the purge operation is destructive (rewrites the file) and novel, making it higher risk.
- Fix: Either add an integration test for `--purge` that creates a temp learning log with mixed valid/invalid entries and verifies the output, or at minimum document this as a known gap. Given the existing test patterns in the project, this is a should-fix rather than blocking.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Shell script validation logic in `background-learning` is not testable (consolidation of PF-004)** - `scripts/hooks/background-learning:395-414`
**Confidence**: 85%
- Problem: The PR adds 20 lines of observation validation logic (empty field check, type validation, id format validation) and 13 lines of existing-observation filtering at lines 252-257 directly in the shell script. This is core business logic (data validation) embedded in an untestable bash script. The known pitfall PF-004 identifies exactly this pattern: "Background hook scripts become untestable god scripts." While the TypeScript side has corresponding tests for `isLearningObservation`, the shell script validation could diverge silently (e.g., the shell version checks `obs_*` prefix format but `isLearningObservation` does not).
- Fix: Per PF-004's resolution, move JSON-heavy validation logic to TypeScript. In the interim, consider adding a simple shell integration test (a `.bats` file or a test that invokes the validation functions with known inputs).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Test for `loadLearningConfig` does not assert `debug` field in override scenarios** - `tests/learn.test.ts:269-291`
**Confidence**: 80%
- Problem: The existing tests for "loads global config", "project config overrides global", and "handles partial override" do not assert the `debug` field in their scenarios. Only the defaults test (line 266) checks `config.debug`. Since `debug` is a new config field, it would be valuable to verify that global config can set `debug: true` and project config can override it.

## Suggestions (Lower Confidence)

- **Shell and TypeScript validation divergence risk** - `scripts/hooks/background-learning:395-414` vs `src/cli/commands/learn.ts:39-52` (Confidence: 70%) -- The shell script validates `obs_*` id prefix format but the TypeScript `isLearningObservation` type guard does not. Entries with non-`obs_` prefixed ids will be accepted by TypeScript but rejected by the shell script. Consider aligning the two validators.

- **`loadLearningConfig` debug override test gap** - `tests/learn.test.ts:269-291` (Confidence: 65%) -- The "project config overrides global" test could set `debug: true` in global and `debug: false` in project to verify the override cascade for the new field.

- **Migration test cleanup fragility** - `tests/memory.test.ts:371` (Confidence: 60%) -- The `fs.rm(logsDir, ...)` cleanup at end of test relies on the test reaching that line. Using `afterEach` for cleanup would be more robust against mid-test failures.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Tests Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new tests are well-structured, follow AAA pattern, and cover the core validation changes effectively. The primary concern is the migration test writing to the real filesystem outside the temp directory, which should be fixed before merge for CI reliability. The validation divergence between the shell script and TypeScript validators is a design debt item that should be tracked. Overall, the test additions appropriately cover the new `debug` config field, empty-field rejection in `isLearningObservation`, and the migration/purge flows.
