# Security Review Report

**Branch**: feat/pr-description-pipeline -> main
**Date**: 2026-05-08
**PR**: #206

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Unsanitized `artifact_path` used as filesystem write target** - `src/cli/commands/decisions.ts:730-738`
**Confidence**: 82%
- Problem: The `obs.artifact_path` field (sourced from JSONL log entries on disk) is split on `#` and the left portion is passed to `updateDecisionsStatus` which reads, modifies, and overwrites the file at that path. If a corrupted or adversarially crafted log entry contains a path pointing outside `.memory/decisions/` (e.g., `../../.claude/settings.json#ADR-001`), the function would overwrite arbitrary markdown-like content in that file. The path is resolved via `path.join(process.cwd(), ...)` with no containment check.
- Impact: A corrupted or poisoned `decisions-log.jsonl` could cause the `--review` deprecation handler to overwrite files outside the expected decisions directory. Risk is mitigated by the fact that (a) `updateDecisionsStatus` only replaces a line matching `- **Status**: <word>` inside a section matching the anchor ID pattern, so arbitrary file corruption is unlikely, and (b) the log file is locally written, not externally sourced. However, the same pattern exists in `learn.ts:1032-1039` (pre-existing, not changed in this PR) and now also in `decisions.ts:730-738` (new code in this PR).
- Fix: Add a path containment check before calling `updateDecisionsStatus`. For example:
  ```typescript
  const absPath = path.isAbsolute(decisionsFilePath)
    ? decisionsFilePath
    : path.join(process.cwd(), decisionsFilePath);
  const expectedDir = path.join(memoryDir, 'decisions');
  if (!absPath.startsWith(expectedDir + path.sep)) {
    p.log.warn(`Skipping out-of-bounds artifact path: ${decisionsFilePath}`);
  } else {
    const updated = await updateDecisionsStatus(absPath, anchorId, 'Deprecated');
    // ...
  }
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Lock release in `updateDecisionsStatus` swallows all errors on rmdir** - `src/cli/commands/learn.ts:436`
**Confidence**: 80%
- Problem: The `finally` block catches and discards all `rmdir` errors. While the comment says "already cleaned", an `ENOENT` is expected but other errors (e.g., `EPERM`) would be silently lost, potentially leaving a stale lock directory.
- Impact: Low practical impact since mkdir-lock stale detection handles orphaned locks, but it masks permission errors that could indicate a deeper filesystem issue.

## Suggestions (Lower Confidence)

- **`newStatus` parameter in `updateDecisionsStatus` is untyped string** - `src/cli/commands/learn.ts:389` (Confidence: 65%) -- The function accepts `newStatus: string` while callers always pass `'Deprecated'`. Restricting the parameter to the `DecisionsEntryStatus` union type (now exported from `decisions.ts`) would prevent accidental injection of unexpected status values into the markdown.

- **`anchorId` from `artifact_path` fragment is not validated** - `src/cli/commands/decisions.ts:734` (Confidence: 62%) -- The anchor ID extracted from the `#` fragment of `artifact_path` is passed directly into a regex pattern via `escapeRegExp`, which is properly escaped. However, there is no format validation that it matches the expected `ADR-NNN` or `PF-NNN` pattern before use.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | 1 | - |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changes are a well-structured refactoring that improves code quality (extracting `clearCapacityNotifications` for testability, hardening `acquireMkdirLock` to only catch `EEXIST`, and generalizing `tryImmediatePromotion` with explicit options). The `acquireMkdirLock` fix in `learn.ts:339-341` is a genuine security improvement -- previously, unexpected filesystem errors (EACCES, EIO) were silently swallowed and treated as "lock held", which could cause infinite retry loops or mask real problems.

The one should-fix item is the unsanitized `artifact_path` used as a filesystem write target. While exploitation requires a corrupted local JSONL file (not externally reachable), adding a path containment check is a low-effort defense-in-depth measure that follows the principle of validating at boundaries.
