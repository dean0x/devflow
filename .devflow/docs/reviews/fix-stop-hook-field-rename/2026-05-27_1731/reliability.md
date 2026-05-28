# Reliability Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Debug log files grow unbounded with no rotation or size cap** - `scripts/hooks/debug-trace:31-33,45-47`
**Confidence**: 85%
- Problem: The `debug-trace` helper appends to `.hook-debug.log` on every `dbg()` call with no size limit, rotation, or cleanup mechanism. When `DEVFLOW_HOOK_DEBUG=1` is active, 7 hooks fire per user turn, each writing multiple debug lines. Over a multi-hour debugging session this log can grow to megabytes. The `devflow debug --enable` command warns to disable afterward but provides no `--clean` subcommand, and there is no auto-truncation.
- Fix: Add a size check at the start of `devflow_debug_init()` that truncates the log when it exceeds a threshold (e.g., 5MB), keeping the tail:
```bash
devflow_debug_init() {
  _DEVFLOW_DBG_HOOK="${1:-hook}"
  if [ "${DEVFLOW_HOOK_DEBUG:-}" != "1" ]; then
    dbg() { :; }
    return
  fi
  local global_log_dir="$HOME/.devflow/logs"
  mkdir -p "$global_log_dir" 2>/dev/null || true
  _DEVFLOW_DBG_LOG="$global_log_dir/.hook-debug.log"
  # Rotate if >5MB (5242880 bytes)
  if [ -f "$_DEVFLOW_DBG_LOG" ]; then
    local sz
    sz=$(wc -c < "$_DEVFLOW_DBG_LOG" 2>/dev/null | tr -d ' ')
    if [ "${sz:-0}" -gt 5242880 ]; then
      tail -c 2621440 "$_DEVFLOW_DBG_LOG" > "$_DEVFLOW_DBG_LOG.tmp" && mv "$_DEVFLOW_DBG_LOG.tmp" "$_DEVFLOW_DBG_LOG" || rm -f "$_DEVFLOW_DBG_LOG.tmp"
    fi
  fi
  dbg() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $_DEVFLOW_DBG_HOOK: $1" >> "$_DEVFLOW_DBG_LOG" 2>/dev/null || true
  }
}
```
Alternatively, add `devflow debug --clean` to the CLI command.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Inconsistent error suppression in sidecar-capture log() vs other hooks** - `scripts/hooks/sidecar-capture:61`
**Confidence**: 82%
- Problem: The `log()` function in `sidecar-capture` uses bare `>> "$LOG_FILE"` without `2>/dev/null || true`, while all four newly-added `log()` definitions in `pre-compact-memory:44`, `session-start-context:50`, `session-start-memory:41`, and `sidecar-dispatch:48` consistently use `2>/dev/null || true`. Under `set -e` (active in sidecar-capture), a write failure (e.g., disk full, missing directory) would abort the hook. The hook's design principle is "on failure: does nothing" (line 6), so aborting on a log write failure contradicts its own stated contract.
- Fix: Align `sidecar-capture`'s `log()` with the pattern used by the new hooks:
```bash
log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [sidecar-capture] $1" >> "$LOG_FILE" 2>/dev/null || true; }
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Normal log files also grow unbounded** - `scripts/hooks/sidecar-capture:60`, `scripts/hooks/session-start-memory:40`, `scripts/hooks/session-start-context:49`, `scripts/hooks/pre-compact-memory:43`, `scripts/hooks/sidecar-dispatch:47` (Confidence: 65%) -- The newly-added normal logging (`log()`) in 4 hooks writes to per-hook log files with no rotation. This mirrors the pre-existing pattern in `sidecar-evaluate` and `sidecar-capture`, so it is consistent, but the total number of append-only log files per project is now 7+. Consider a shared rotation check in `log-paths`.

- **debug.ts settings write is non-atomic** - `src/cli/commands/debug.ts:37,50` (Confidence: 62%) -- `fs.writeFile` is not atomic; a crash mid-write would corrupt `settings.json`. The shell hooks use temp+mv for atomic writes. However, this matches the existing CLI pattern (all other commands use `fs.writeFile` the same way), so this is a codebase-wide concern, not specific to this PR.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The core behavioral change (response_text to last_assistant_message, stop_reason filter removal) is correct and well-tested. The debug-trace system is properly gated behind an opt-in flag with graceful degradation (no-op `dbg()` fallback). Error handling on jq/node failures in `sidecar-capture` was improved with `|| { dbg "EXIT: ..."; exit 0; }` guards. The two findings are: (1) unbounded debug log growth under sustained debugging, and (2) a minor inconsistency in error suppression on the moved `log()` definition. Neither is blocking for merge, but the log rotation should be addressed before the debug feature sees heavy use.
