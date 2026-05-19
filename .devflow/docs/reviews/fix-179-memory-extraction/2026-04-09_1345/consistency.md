# Consistency Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### MEDIUM

**`addMemoryHooks` idempotency behavior differs from `removeMemoryHooks` and peer functions** - `src/cli/commands/memory.ts:24-61`
**Confidence**: 85%
- Problem: `addMemoryHooks` removed the `changed` tracking variable and now always re-serializes via `JSON.stringify(settings, null, 2) + '\n'` when hooks are partially present (1-3 of 4). In contrast, `removeMemoryHooks` (same file, line 76) still uses `changed` tracking and returns the original `settingsJson` string when nothing changed. The peer functions `addAmbientHook` and `removeLearningHook` also retain `changed`-based short-circuiting.
- Impact: When `addMemoryHooks` is called on settings that already have 3 of 4 hooks but only need to add 1, it returns a re-serialized string. The caller at line 194 compares `updated === settingsContent` to detect "already enabled". If the original JSON had non-standard formatting (extra whitespace, trailing comma), the re-serialization produces a different string even when nothing meaningful changed, triggering a spurious "enabled" message and unnecessary file write. The `hasMemoryHooks` early return at line 27 only catches the all-4-present case, not the partial-add case.
- Fix: Restore the `changed` tracking to match `removeMemoryHooks` pattern:
  ```typescript
  let changed = false;
  for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
    // ...existing logic...
    if (!alreadyPresent) {
      // ...add entry...
      changed = true;
    }
  }
  if (!changed) {
    return settingsJson;
  }
  return JSON.stringify(settings, null, 2) + '\n';
  ```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No issues found._

## Suggestions (Lower Confidence)

- **`get_mtime` helper duplicated in two scripts** - `scripts/hooks/stop-update-memory:29`, `scripts/hooks/background-memory-update:47` (Confidence: 70%) -- The portable mtime function is now copy-pasted identically in both hook scripts. Other shared logic is already sourced from `json-parse` and `ensure-memory-gitignore`. Consider extracting `get_mtime` to a shared helper sourced by both scripts.

- **Queue overflow threshold comments could reference a single constant** - `scripts/hooks/stop-update-memory:95`, `scripts/hooks/background-memory-update` (Confidence: 65%) -- Both scripts have `# NOTE: same 200/100 threshold in {other-script}` comments. This cross-reference pattern works for two locations but is fragile if a third consumer appears. Not blocking since the comment itself is the improvement this PR introduces.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates strong consistency overall:
- New `prompt-capture-memory` hook matches the structural pattern of existing hooks (feedback-loop guard, `set -e`, `SCRIPT_DIR` resolution, `json-parse` sourcing, `ensure-memory-gitignore`, exit 0 on error).
- `node -e` fallback paths now consistently use `--` separator before arguments in both `stop-update-memory` and `prompt-capture-memory`.
- CLAUDE.md, file-organization.md, and memory.ts doc comments are all consistently updated from "3 hooks" to "4 hooks".
- `hasMemoryHooks` now uses `Object.keys(MEMORY_HOOK_CONFIG).length` instead of hardcoded `3`, preventing future drift.
- Test descriptions and assertions are consistently updated across `memory.test.ts` and `shell-hooks.test.ts`.
- The CWD validation pattern (`[ -z "$CWD" ] || [ ! -d "$CWD" ]`) is consistently applied across `preamble`, `stop-update-memory`, `prompt-capture-memory`, and `background-memory-update`.

The single blocking item is a minor behavioral inconsistency in `addMemoryHooks` where the `changed`-guard removal creates a pattern deviation from all peer hook-management functions.
