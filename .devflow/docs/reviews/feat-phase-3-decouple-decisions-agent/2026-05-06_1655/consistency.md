# Consistency Review Report

**Branch**: feat-phase-3-decouple-decisions-agent -> main
**Date**: 2026-05-06

## Issues in Your Changes (BLOCKING)

### HIGH

**Notification file path mismatch between learn.ts capacity review and the actual write path** - `src/cli/commands/learn.ts:847,1258,1293,1310`
**Confidence**: 95%
- Problem: The `learn.ts` capacity review and `--dismiss-capacity` subcommands now read/write `.learning-notifications.json`, but no code path ever creates this file. The learning pipeline's `render-ready` call (line 577) does NOT pass `--notifications-path`, so `json-helper.cjs render-ready` defaults to writing `.notifications.json`. The split migration renames `.notifications.json` to `.decisions-notifications.json`, not `.learning-notifications.json`. Result: after migration, `devflow learn --review` (capacity mode) and `devflow learn --dismiss-capacity` read from a file that does not exist and will never see learning-generated capacity notifications.
- Fix: Either (a) pass `--notifications-path` to the learning pipeline's `render-ready` call pointing to `.learning-notifications.json`, or (b) change the learn.ts references back to `.notifications.json` since the learning pipeline still uses that default. Option (a) is cleaner and fully separates the two systems.

**`decisions-append` op writes capacity notifications to wrong file** - `scripts/hooks/json-helper.cjs:1841`
**Confidence**: 92%
- Problem: The `decisions-append` CLI op (standalone decision file append) calls `updateCapacityNotification(memoryDir, notifKey, previousCount, newActiveCount)` without a `notifFilePath` argument. This causes it to default to `.notifications.json` instead of `.decisions-notifications.json`. The `render-ready` path was updated to pass `--notifications-path` for the decisions pipeline, but `decisions-append` was not updated to match.
- Fix: Add a `notifFilePath` parameter to the `decisions-append` handler that points to `.decisions-notifications.json`, consistent with the decisions pipeline's `render-ready` invocation:
  ```javascript
  // line ~1841 in decisions-append handler
  const notifFilePath = path.join(memoryDir, '.decisions-notifications.json');
  updateCapacityNotification(memoryDir, notifKey, previousCount, newActiveCount, notifFilePath);
  ```

**HUD notification text directs users to wrong command after decoupling** - `src/cli/hud/notifications.ts:88`
**Confidence**: 95%
- Problem: The HUD notification text reads `run devflow learn --review` but decisions/pitfall capacity notifications are now owned by the separate `devflow decisions` system. Users seeing this notification for a decisions capacity issue would be directed to the wrong command. The decisions command has its own `--review` subcommand at `decisions.ts:143`.
- Fix: Since the notification data comes from `.decisions-notifications.json` (decisions pipeline), the text should reference the correct command:
  ```typescript
  text: `⚠ Decisions: ${fileType} at ${count}/${ceiling} — run devflow decisions --review`,
  ```

### MEDIUM

**Missing `background-learning` in LEGACY_HOOK_FILES cleanup list** - `src/cli/commands/init.ts:940-947`
**Confidence**: 88%
- Problem: The `background-learning` bash script was deleted from git (replaced by `devflow learn --run-background`), but it is not listed in the `LEGACY_HOOK_FILES` array in `init.ts`. Existing installs will retain the stale 563-line file at `~/.devflow/scripts/hooks/background-learning` indefinitely. This follows the precedent set by `ambient-prompt`, `session-end-kb-refresh`, `background-kb-refresh`, and `lib/feature-kb.cjs` which are all in the cleanup list. avoids PF-001 (this is a cleanup item, not migration code -- consistent with ADR-001 clean-break philosophy which explicitly allows "one-time cleanup items").
- Fix: Add `'background-learning'` to the `LEGACY_HOOK_FILES` array:
  ```typescript
  const LEGACY_HOOK_FILES = [
    'ambient-prompt',
    'background-learning',
    // kb -> knowledge rename...
  ```

**Inconsistent config loading API between `loadLearningConfig` and `loadDecisionsConfig`** - `src/cli/utils/decisions-config.ts:98`, `src/cli/commands/learn.ts:300`
**Confidence**: 82%
- Problem: `loadLearningConfig(globalJson: string | null, projectJson: string | null)` accepts pre-read JSON strings as parameters (caller manages I/O), while `loadDecisionsConfig(cwd: string)` reads config files internally (self-contained I/O). These are sibling pipelines performing the same concern (config loading with global/project layering), but their APIs diverge. The decisions version's doc comment even says it "Mirrors the shape of LearningConfig in learn.ts". The `learn.ts --run-background` handler (lines 541-551) manually reads the files then passes them in, adding boilerplate that `loadDecisionsConfig` avoids by reading internally.
- Fix: Either refactor `loadLearningConfig` to match `loadDecisionsConfig`'s self-contained style, or vice versa. The self-contained `loadDecisionsConfig(cwd)` pattern is cleaner (fewer callsite concerns).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**HUD notifications.ts reads from `.notifications.json` as legacy fallback but learn.ts no longer writes to it** - `src/cli/hud/notifications.ts:52`
**Confidence**: 80%
- Problem: The HUD's `getActiveNotification` reads both `.decisions-notifications.json` (primary) and `.notifications.json` (fallback). After the split migration renames `.notifications.json` to `.decisions-notifications.json`, the fallback path becomes dead code. Meanwhile, the learning pipeline's `render-ready` (called without `--notifications-path`) still writes to `.notifications.json` by default. This creates a confusing state: the legacy path is simultaneously dead (post-migration) and still-in-use (by the learning pipeline's render-ready). The HUD fallback should either be removed (if the learning pipeline is updated to use a separate path) or the architecture should be clarified.
- Fix: Clarify the notification file ownership: decisions system owns `.decisions-notifications.json`, learning system should own `.learning-notifications.json` (but needs the write path updated), and the `.notifications.json` fallback in the HUD can be removed once the learning write path is fixed.

## Pre-existing Issues (Not Blocking)

No pre-existing issues identified.

## Suggestions (Lower Confidence)

- **`devflow learn --reset` references `.learning-notifications.json` but not `.notifications.json`** - `src/cli/commands/learn.ts:847` (Confidence: 70%) — The reset command cleans `.learning-notifications.json` (which never exists post-migration) but not `.notifications.json` (which may contain stale learning-originated capacity notifications written by the default `render-ready` path).

- **`DecisionsConfig.batch_size` field is unused in `decisions --run-background`** - `src/cli/utils/decisions-config.ts:21`, `src/cli/commands/decisions.ts:170-233` (Confidence: 65%) — The `DecisionsConfig` interface includes `batch_size` and the `--configure` wizard writes it to config, but the `--run-background` handler never reads or uses it (the hook always writes exactly one session ID to `.decisions-batch-ids`).

- **`session-end-decisions` hook disabledSentinel path inconsistency** - `scripts/hooks/session-end-decisions:37` vs `src/cli/commands/decisions.ts:702,720` (Confidence: 65%) — The hook checks `decisions/.disabled` but the CLI enable/disable writes to `decisions/.disabled` under `.memory/`. Both resolve correctly because the hook prefixes with `$MEMORY_DIR`, but the CLAUDE.md documentation does not mention the disabled sentinel for the decisions system.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | - | 3 | 1 | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | - | - |

**Consistency Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The core decoupling architecture is well-structured and follows the existing codebase patterns for hook management, config loading, and CLI subcommands. The new `decisions.ts` command correctly mirrors the structure of `learn.ts`. The shared `background-runner.ts` extraction avoids duplication effectively. However, the notification file path split was not carried through consistently across all three systems that interact with these files (json-helper.cjs `decisions-append`, learn.ts capacity review, and HUD notifications). The three HIGH findings represent functional breakage where capacity notifications written by one path cannot be read by another due to mismatched file names.
