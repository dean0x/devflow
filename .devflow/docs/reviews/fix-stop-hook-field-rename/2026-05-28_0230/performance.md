# Performance Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### HIGH

**`hook-log-init` uses `wc -c` subprocess for size guard instead of `stat`** - `scripts/hooks/hook-log-init:31`
**Confidence**: 85%
- Problem: The new `hook-log-init` shared helper uses `wc -c < "$LOG_FILE"` for its 2MB size guard check. This forks a subprocess on every invocation of every hook that sources `hook-log-init` (6 hooks: sidecar-capture, sidecar-dispatch, sidecar-evaluate, session-start-context, session-start-memory, pre-compact-memory). The `debug-trace` file in this same PR already established the `stat` pattern with cross-platform fallback (line 29-32: `stat -f%z` / `stat -c%s` / `wc -c` fallback), so the inconsistency is also a consistency concern. The prior review cycle (Cycle 2) already flagged and fixed `wc -c` in the debug-trace size guard — this is the same pattern in a new location.
- Fix: Apply the same `stat` cascade from `_devflow_dbg_size_guard` in `debug-trace`:
```bash
# Replace the wc -c check with stat (avoids subprocess fork)
_log_size=0
if [ -f "$LOG_FILE" ]; then
  _log_size=$(stat -f%z "$LOG_FILE" 2>/dev/null) \
    || _log_size=$(stat -c%s "$LOG_FILE" 2>/dev/null) \
    || _log_size=$(wc -c < "$LOG_FILE" 2>/dev/null) \
    || _log_size=0
fi
if [ "${_log_size:-0}" -gt 2097152 ]; then
  _LTMP="$LOG_FILE.tmp.$$"
  tail -c 1048576 "$LOG_FILE" > "$_LTMP" 2>/dev/null && mv "$_LTMP" "$LOG_FILE" 2>/dev/null || rm -f "$_LTMP" 2>/dev/null || true
fi
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`load_existing_ids` double-jq pipeline** - `scripts/hooks/eval-helpers:49` (Confidence: 65%) -- The `jq -c '.id // empty' "$log_file" | jq -s '.'` pattern spawns two jq processes and pipes between them. A single `jq -s '[.[] | .id // empty]'` would accomplish the same in one process. However, the comment explains the streaming approach avoids slurping the entire file into memory, which is a valid trade-off for very large JSONL files. The observation log files are small in practice (typically <100 entries), so the memory concern is likely premature, but the current approach is not incorrect.

- **`eval-learning` uses `wc -l` for line counting** - `scripts/hooks/eval-learning:33,63,73` (Confidence: 60%) -- Three `wc -l` subprocess forks for line counting in the learning module. These are small files (<50 lines for session counts, <100 for observation logs), so the absolute cost is negligible (~1-2ms each). Not worth optimizing unless profiling shows otherwise.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The overall refactor is performance-neutral to slightly positive. The key improvement is the `sidecar-capture` log-paths deferral (line 95-97) which avoids the `log-paths` subprocess (~15-20ms per the PR description) on memory-disabled invocations. The 5 additional `source` calls in `sidecar-evaluate` (eval-helpers + 4 modules) are shell-internal file reads from warm disk cache with no subprocess forks -- the PR description's "<5ms total increase" estimate is credible. The `debug-trace` size guard extraction to use `stat` instead of `wc -c` (applies ADR-007) is a correct micro-optimization. The single blocking issue is the `hook-log-init` size guard using the old `wc -c` pattern that was already fixed elsewhere in this same PR -- a straightforward consistency fix.
