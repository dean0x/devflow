# Performance Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27
**PR**: #228

## Cross-Cycle Awareness

Prior resolution cycle addressed the primary performance concerns: subshell calls in `dbg` arguments were guarded behind `DEVFLOW_HOOK_DEBUG=1` checks to eliminate subprocess forks when debug is OFF. Normal logging `date` forks (~10-15ms) were confirmed acceptable as FP. `log-paths` sourcing order was confirmed intentional. This review focuses on residual issues not covered by prior cycle.

## Issues in Your Changes (BLOCKING)

### HIGH

**`devflow_log_dir` subprocesses run on early-exit paths in sidecar-capture** - `scripts/hooks/sidecar-capture:59-62`
**Confidence**: 85%
- Problem: In the old code, `log-paths` was sourced at line 87, AFTER the `MEMORY_ENABLED=false` gate (line 76). This PR moved it to line 59, BEFORE the gate. When `memory:false` is set in sidecar config, the hook now calls `devflow_log_dir` (which spawns `sed`, `tr`, `mkdir -p`, `chmod` -- 4 subprocess forks) before exiting at line 98-101, whereas previously it would have exited without ever sourcing `log-paths`. The only `log()` call between old-exit and new-exit is inside the decisions scanner block (line 92), which only fires when `ADR-NNN|PF-NNN` patterns are present in the response text -- a rare condition.
- Impact: ~15-20ms added to every stop-hook invocation on projects with `memory:false` in sidecar config. The `devflow_log_dir` cache helps on subsequent calls within the same process, but the first call always forks subprocesses.
- Fix: Move `log-paths` sourcing and `log()` definition to just before it is first needed (after the `MEMORY_ENABLED` gate), or use a lazy-init pattern:
```bash
_log_initialized=false
log() {
  if [ "$_log_initialized" = "false" ]; then
    source "$SCRIPT_DIR/log-paths" || true
    LOG_DIR=$(devflow_log_dir "$CWD" 2>/dev/null || echo "/tmp")
    LOG_FILE="$LOG_DIR/.working-memory-update.log"
    _log_initialized=true
  fi
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [sidecar-capture] $1" >> "$LOG_FILE" 2>/dev/null || true
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Size guard `wc -c` subshell runs on every debug-enabled hook invocation** - `scripts/hooks/debug-trace:33`
**Confidence**: 82%
- Problem: When `DEVFLOW_HOOK_DEBUG=1`, `devflow_debug_init` runs `wc -c < "$_DEVFLOW_DBG_LOG"` to check if the log exceeds 5MB. This spawns a subprocess on every hook invocation across all 7 hooks. With 7 hooks firing per prompt cycle, that is 7 extra `wc` forks purely for size checking during debug mode.
- Impact: ~7 x 5ms = ~35ms aggregate overhead per prompt cycle when debug is active. Acceptable for a debug-only path, but avoidable.
- Fix: Use bash built-in `stat` or check file size less frequently (e.g., only on `devflow_debug_set_cwd` which runs once per hook, or use a modular approach checking every Nth invocation):
```bash
# Use stat -f%z (macOS) or stat -c%s (Linux) to avoid forking wc
local fsize
fsize=$(stat -f%z "$_DEVFLOW_DBG_LOG" 2>/dev/null || stat -c%s "$_DEVFLOW_DBG_LOG" 2>/dev/null || echo 0)
if [ "$fsize" -gt 5242880 ]; then
```

### MEDIUM

**New `log-paths` sourcing added to 4 hooks that previously had no logging overhead** - `session-start-memory:38`, `session-start-context:47`, `pre-compact-memory:41`, `sidecar-dispatch:45`
**Confidence**: 80%
- Problem: Four hooks that previously had zero logging overhead now source `log-paths` and call `devflow_log_dir` on every invocation (4 subprocess forks for sed+tr+mkdir+chmod on first call). The `log()` function is only called 1-3 times per hook in the happy path, so the cost is dominated by the `devflow_log_dir` initialization.
- Impact: ~15-20ms added per hook per invocation (4 hooks x ~15ms = ~60ms aggregate per prompt cycle). For `session-start-memory` and `session-start-context` which fire on every session start, this is acceptable. For `sidecar-dispatch` which fires on every user prompt, this adds latency to the interactive path.
- Fix: This is a conscious design trade-off (logging is valuable for debugging production issues). The `devflow_log_dir` cache mitigates repeated calls within the same process. Consider deferring `devflow_log_dir` until the first `log()` call using a lazy pattern, or accept the trade-off given that these hooks already source `json-parse` and other helpers with comparable overhead.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`echo "$cwd" | sed ... | tr ...` pipeline in `devflow_debug_set_cwd`** - `scripts/hooks/debug-trace:51` (Confidence: 65%) -- The slug computation forks `echo`, `sed`, and `tr` as 3 subprocesses. This could use bash parameter expansion (`${cwd#/}` + `${var//\//-}`) to avoid all forks, but this only runs when debug is ON so the savings are marginal.

- **`date` fork inside every `dbg()` call** - `scripts/hooks/debug-trace:42` (Confidence: 62%) -- Each `dbg()` invocation spawns a `date` subprocess for the timestamp. When debug is ON and a hook has 5-10 dbg calls, this is 5-10 forks per hook. Could batch timestamp at init and reuse, but debug mode is explicitly opt-in and transient, so this is acceptable.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR's primary performance claim -- "zero overhead in normal operation" -- is well-supported. The `devflow_debug_init` function short-circuits immediately when `DEVFLOW_HOOK_DEBUG!=1`, and all expensive `dbg` argument subshells are guarded behind `DEVFLOW_HOOK_DEBUG=1` checks (applies ADR-001 clean break philosophy -- no backward compat overhead). The `jq INPUT keys` subshell is properly guarded. The one actionable concern is the `sidecar-capture` log-paths sourcing regression on the `memory:false` path, which adds unnecessary subprocess forks to an early-exit codepath. The newly added logging across 4 hooks is a conscious overhead trade-off that provides operational observability.
