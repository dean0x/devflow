# Regression Review Report

**Branch**: fix/learning-validation-and-debug-logs -> main
**Date**: 2026-03-25
**PR**: #161

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical regression issues found.

### HIGH

No high-severity regression issues found.

### MEDIUM

**Migration purge uses weaker validation than `isLearningObservation` type guard** - `src/cli/utils/post-install.ts:620-624`
**Confidence**: 82%
- Problem: The auto-purge in `migrateMemoryFiles` checks only `obj.id && obj.type && obj.pattern` (JS truthiness), which is significantly less strict than the `isLearningObservation` type guard used by `parseLearningLog`. Entries with invalid `type` values (not `"workflow"` or `"procedural"`), missing `status`/`evidence`/`details` fields, or numeric `id` values would survive the migration purge but still be rejected by `parseLearningLog`. This means `--status` and `--list` would continue showing "invalid entries found" warnings even after a migration has run.
- Fix: Reuse the `isLearningObservation` guard or replicate its full checks:
```typescript
// In migrateMemoryFiles:
const { isLearningObservation } = await import('../commands/learn.js');
const valid = lines.filter(line => {
  try {
    return isLearningObservation(JSON.parse(line));
  } catch { return false; }
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`rotate_log` references shell variable `DEBUG` before it is set when log file pre-exists from a previous run** - `scripts/hooks/background-learning:36`
**Confidence**: 80%
- Problem: The `rotate_log` function reads `${DEBUG:-false}` (line 36). In the new execution order (load_config then rotate_log, lines 618-619), `DEBUG` is correctly set by `load_config` before `rotate_log` runs. However, `rotate_log` also uses a default `${DEBUG:-false}`, so even in the old order it would have been safe. The reordering is correct and this is well-handled. This is informational only -- no action needed; the change is an improvement.

## Pre-existing Issues (Not Blocking)

No pre-existing regression issues found.

## Suggestions (Lower Confidence)

- **Log relocation may cause confusion for existing users checking `.memory/` for debug logs** - `scripts/hooks/background-learning:19-22` (Confidence: 65%) -- Users who previously looked at `.memory/.learning-update.log` will find the file missing with no symlink or redirect hint. The migration handles this for `devflow init` runs, but users who skip re-init would need to find logs at `~/.devflow/logs/`. The CLAUDE.md and README.md docs are updated, which mitigates this.

- **Minimum content threshold (200 chars) in `extract_user_messages` could skip very short but valid sessions** - `scripts/hooks/background-learning:179-182` (Confidence: 62%) -- A user with a few short but intentional commands (e.g., three 50-char messages = 150 chars) would have the session silently skipped. The threshold is reasonable for pattern detection quality but is not configurable.

- **`build_sonnet_prompt` contamination filter uses different fallback paths (jq vs node) that could produce subtly different results on edge cases** - `scripts/hooks/background-learning:253-257` (Confidence: 60%) -- The jq path checks `!= ""` (string comparison) while the node path checks `o.id && o.type && o.pattern` (JS truthiness). A field with value `0` or `false` would be treated differently. In practice, these fields are always strings, so this is unlikely to matter.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Checklist**:
- [x] No exports removed
- [x] No files deleted
- [x] Return types backward compatible (`LearningConfig` gains `debug: boolean` -- additive)
- [x] Default values preserved (`debug` defaults to `false`, all others unchanged)
- [x] Side effects preserved (logging relocated but still functional)
- [x] All consumers of changed interfaces updated (tests updated for new `debug` field)
- [x] CLI options preserved (`--purge` is additive, no options removed)
- [x] Commit message matches implementation (validation + debug logs + log relocation all present)
- [x] All 432 tests pass (20 test files, 0 failures)
- [x] `rotate_log`/`load_config` reordering is correct (DEBUG needs config before use)
- [x] `isLearningObservation` strictness increase (empty id/pattern rejection) is backward-compatible -- previously-accepted corrupt entries were already unusable

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

Condition: The migration purge validation in `post-install.ts` should be aligned with `isLearningObservation` to avoid partial cleanup leaving orphaned invalid entries that still trigger warnings. This is a minor consistency issue that could be addressed in a follow-up.
