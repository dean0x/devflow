# Testing Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-30

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Committed `sidecar-ops.cjs` drops string field support (regression from refactor)** - `scripts/hooks/lib/sidecar-ops.cjs:26`
**Confidence**: 95%
- Problem: The original `json-helper.cjs` `read-sidecar` case handled both array and string field values. When refactored into `sidecar-ops.cjs`, the committed version only handles arrays: `console.log(Array.isArray(value) ? JSON.stringify(value.filter(v => typeof v === 'string')) : '[]')`. This silently drops string field support. The `background-kb-refresh` hook calls `read-sidecar` with the `description` field (line 179: `DESCRIPTION=$(node "$SCRIPT_DIR/json-helper.cjs" read-sidecar "$SIDECAR" description ...)`), which would get `[]` instead of the actual description string. The test was weakened to match: committed test says `'returns [] when field value is not an array'` instead of the original `'returns [] when field value is not an array or string'`, and the string-specific test was removed. An unstaged fix exists in the working tree that restores string handling, but it is not committed.
- Fix: Commit the unstaged `sidecar-ops.cjs` fix that restores the `else if (typeof value === 'string')` branch, and add back the `'returns string value as-is for string fields'` test and the `'returns [] when field value is not an array or string'` test assertion.

### MEDIUM

**`parseGitLogWithDates` has no unit tests despite complex parsing logic** - `scripts/hooks/lib/feature-kb.cjs:50-65`
**Confidence**: 85%
- Problem: The new `parseGitLogWithDates` function parses multi-format git log output (dates interspersed with filenames), uses regex matching on dates, and has a "first occurrence = latest" Map dedup strategy. This function is the core of the new `checkAllStaleness` optimization but has zero direct unit tests. The only coverage is via the integration-style `checkAllStaleness` false-positive test, which creates a real git repo and exercises a single scenario. Edge cases (empty output, consecutive dates, malformed dates, filenames matching date regex) are untested.
- Fix: Export `parseGitLogWithDates` from `feature-kb.cjs` and add unit tests for: empty string input, output with no files (just dates), output with consecutive dates and no files between them, typical multi-commit output, and a file whose name starts with a date-like string (e.g., `2024-01-01_changelog.md`) to verify the regex does not misclassify it (current regex requires `T` after date, so `_` would not match -- but worth asserting).

**`cachedIndex` parameter path untested in `listKBs` and `checkAllStaleness`** - `scripts/hooks/lib/feature-kb.cjs:204,460`
**Confidence**: 82%
- Problem: Both `listKBs` and `checkAllStaleness` accept a new optional `cachedIndex` parameter to avoid double file reads. The type annotations in the test file were updated to reflect the new signatures, but no test actually passes a cached index. The existing tests only exercise the `undefined` (default) path where the index is loaded from disk. If the `cachedIndex !== undefined` check or the pass-through had a bug (e.g., wrong truthiness check for `null` vs `undefined`), no test would catch it.
- Fix: Add tests that pass a pre-loaded index to `listKBs(tmp, index)` and `checkAllStaleness(tmp, index)` and verify they return correct results without reading from disk (e.g., by passing a modified index that differs from the on-disk version).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No tests for new TypeScript modules: `kb-agent.ts`, `sidecar.ts`, subcommand handlers** - `src/cli/utils/kb-agent.ts`, `src/cli/utils/sidecar.ts`, `src/cli/commands/kb/*.ts`
**Confidence**: 80%
- Problem: Seven new TypeScript modules were added in this PR (`kb-agent.ts`, `sidecar.ts`, `check.ts`, `create.ts`, `list.ts`, `refresh.ts`, `remove.ts`, `shared.ts`, `toggle.ts`). Of these, `sidecar.ts` has behavioral test coverage through the `readSidecar` test suite (imported via `../../src/cli/commands/kb.js` shim), and `toggle.ts` hook functions (`addKbHook`, `removeKbHook`, `hasKbHook`) have tests in `tests/kb.test.ts`. However, `kb-agent.ts` (which spawns `claude -p`), `shared.ts` (the `featureKb` module resolution and `exitOnInvalidSlug`), and the subcommand handler functions (`handleCheck`, `handleCreate`, `handleList`, `handleRefresh`, `handleRemove`) have no tests. The `runKbAgent` function is hard to unit test (external process dependency), but `loadKnowledgeContext`, `exitOnInvalidSlug`, and the handlers' logic branches could be tested with filesystem fixtures.
- Fix: Add unit tests for `loadKnowledgeContext` (missing script path, successful index load, script error). Consider extracting testable logic from handler functions or adding integration tests for `exitOnInvalidSlug`.

**`readSidecar` test uses inconsistent cleanup pattern** - `tests/feature-kb/feature-kb.test.ts:716-725`
**Confidence**: 80%
- Problem: The new `'returns {} when JSON parses to a non-object (primitive)'` test (line 716-725) uses a manual `try/finally` with inline `rmSync` cleanup, while all other tests in the same `readSidecar` describe block use the `writeTmp()` helper with `afterEach` cleanup. This inconsistency means: (1) the file naming pattern differs (`sidecar-primitive-` vs `test-read-sidecar-`), (2) if the test throws before `finally`, it still cleans up, but the pattern is different from siblings, and (3) the `afterAll` cleanup for tracked files is bypassed.
- Fix: Use the existing `writeTmp()` helper: `const f = writeTmp('42');` then assert.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Potential false-positive for filenames matching ISO date regex** - `scripts/hooks/lib/feature-kb.cjs:56` (Confidence: 65%) -- The regex `/^\d{4}-\d{2}-\d{2}T/` matches any line starting with an ISO-8601-like prefix. While git file paths rarely start this way, a file named `2024-01-01T00_migration.sql` would be misinterpreted as a date line. The `--name-only` flag in git log separates dates and names with blank lines, which provides structural safety, but no test asserts this boundary.

- **Test timing sensitivity in `checkAllStaleness` false-positive test** - `tests/feature-kb/feature-kb.test.ts:416,424` (Confidence: 70%) -- The test uses `Date.now() - 10000` and `Date.now() + 10000` for timestamps, relying on real clock time. If the git commit operation takes longer than 10 seconds (slow CI, disk I/O), the timestamps could drift and cause a false failure or false pass. Using a much larger offset (e.g., 60000ms) or controlling timestamps via `GIT_AUTHOR_DATE` env var would make this more robust.

- **`safePath` function has no dedicated tests** - `scripts/hooks/lib/safe-path.cjs` (Confidence: 65%) -- After extraction from `json-helper.cjs`, the `safePath` function is now a shared module but has no direct unit tests. It is indirectly tested via slug validation and sidecar operations.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The branch adds a significant false-positive staleness fix with good test coverage for the specific scenario, and the `readSidecar` TypeScript helper has solid edge-case coverage. However, the committed code contains a behavior regression in `sidecar-ops.cjs` (string field support dropped during refactoring, with tests weakened to match), the core parsing function `parseGitLogWithDates` lacks direct unit tests, the `cachedIndex` optimization path is untested, and several new modules have no test coverage at all. The unstaged working tree fix for `sidecar-ops.cjs` should be committed to resolve the HIGH issue. `avoids PF-001` -- no Promise resolver renaming issues observed in test code.
