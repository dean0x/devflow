# Regression Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none)

## Regression Analysis Detail

### 1. Field Rename: response_text -> last_assistant_message

**Migration completeness**: COMPLETE

Searched the entire codebase for `response_text` and `stop_reason` — zero occurrences remain outside of review artifacts. All consumers have been updated:

- `scripts/hooks/sidecar-capture` — jq and node paths both use `last_assistant_message`
- `tests/sentinel.test.ts` — all `sessionInput()` calls updated to `last_assistant_message`
- `tests/shell-hooks.test.ts` — all test inputs updated; no residual `response_text` or `stop_reason`

The `cut` field extraction was correctly adjusted from 3-field (cwd/stop_reason/response_text) to 2-field (cwd/last_assistant_message), with `cut -d$'\001' -f2-` replacing the old `-f3-`.

### 2. stop_reason Filter Removal

**Behavioral change**: The old `sidecar-capture` filtered on `stop_reason == "end_turn"`, silently dropping tool_use stops even when they contained valid assistant messages. The new code removes this filter entirely — capture is gated only by `last_assistant_message` being non-empty.

**Regression risk**: LOW. The new field `last_assistant_message` is only populated by Claude Code on real assistant turns, making the `stop_reason` filter redundant. A dedicated regression test (`sentinel.test.ts` line 111-127) explicitly verifies that `stop_reason: 'tool_use'` with a valid `last_assistant_message` now produces a capture.

### 3. No Removed Exports or Files

- `git diff main...HEAD --name-status | grep "^D"` — zero deleted files
- `git diff main...HEAD | grep "^-export"` — zero removed exports
- No removed CLI options, no removed API endpoints

### 4. Debug Tracing System (New Feature)

The new `debug-trace` helper is purely additive. All hooks follow the same safe pattern:

1. `dbg() { :; }` — safe no-op before `set -e`
2. `source "$SCRIPT_DIR/debug-trace" || true` — soft-fail source
3. `devflow_debug_init "hook-name"` — when `DEVFLOW_HOOK_DEBUG != 1`, redefines `dbg` to no-op and returns immediately

**Regression risk from debug additions**: NONE. When `DEVFLOW_HOOK_DEBUG` is unset (default), the entire debug system reduces to a single function call that redefines a no-op function. No filesystem operations, no subshells, no overhead.

### 5. Log-paths Hardening (sidecar-capture, sidecar-evaluate)

Both hooks changed `log-paths` sourcing from hard-fail (`|| exit 1`) to soft-fail (`|| true`) with `/tmp` fallback. The `log()` function gained `2>/dev/null || true` error suppression. `sidecar-evaluate` also removed a redundant `mkdir -p` that was already handled by `devflow_log_dir`.

**Regression risk**: NONE. This strictly improves resilience — hooks no longer abort when the log directory is inaccessible. Behavior under normal conditions is unchanged.

### 6. Feedback Loop Guard Ordering

`sidecar-capture` moved its background-session exit guards (BG_UPDATER, BG_LEARNER, BG_KNOWLEDGE_REFRESH) from before debug-trace to after, so background exits get debug logging. `sidecar-dispatch` and `sidecar-evaluate` kept guards before debug-trace. The inconsistency is intentional — `sidecar-capture` is the stop hook that fires most frequently from background sessions and benefits from exit tracing.

### 7. Intent vs Reality Check

The PR description states two changes: (1) stop hook field rename, (2) debug tracing system. Both are fully implemented. The field rename is complete with no stale references. The debug tracing system is consistently applied to all 7 hooks plus a new CLI command. Tests cover both features comprehensively (292 new lines in debug.test.ts, plus regression tests in sentinel.test.ts and shell-hooks.test.ts). Applies ADR-001 — clean break with no backward compatibility layer for the field rename.

### 8. Cross-Cycle Awareness

Prior resolution cycle addressed 10 issues, identified 6 false positives, and deferred 2. All field renames were verified and tests updated. No re-raised issues from this review — all prior findings remain resolved.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 10/10
**Recommendation**: APPROVED

The field rename migration is complete — zero stale references remain. The stop_reason filter removal is covered by a dedicated regression test. The debug tracing system is purely additive with zero overhead when disabled. No exports removed, no files deleted, no behavioral regressions detected. Log-paths hardening strictly improves resilience.
