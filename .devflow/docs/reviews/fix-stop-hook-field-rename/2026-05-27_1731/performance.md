# Performance Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Unguarded command substitution in `dbg` arguments forks subprocesses even when debug is disabled (4 occurrences)** - Confidence: 92%
- `scripts/hooks/session-start-context:142`, `scripts/hooks/sidecar-dispatch:149`, `scripts/hooks/sidecar-dispatch:157`, `scripts/hooks/sidecar-evaluate:463`
- Problem: Bash evaluates all arguments to a function before calling it, even when the function body is a no-op (`{ :; }`). Four `dbg` calls contain `$()` command substitutions that fork subprocesses on every hook invocation regardless of whether `DEVFLOW_HOOK_DEBUG=1` is set. For example, `dbg "Learned artifacts: commands=$(echo ... | grep -c ...)"` spawns 4 subprocesses (2x echo, 2x grep) even when debug is off. The `sidecar-capture:33` call correctly guards with `if [ "${DEVFLOW_HOOK_DEBUG:-}" = "1" ]; then` but these four do not.
- Fix: Either guard each `dbg` call containing `$()` with the same `DEVFLOW_HOOK_DEBUG` check used in `sidecar-capture:33`, or pre-compute the value into a variable first:
```bash
# Option A: Guard the entire call (consistent with sidecar-capture:33 pattern)
if [ "${DEVFLOW_HOOK_DEBUG:-}" = "1" ]; then
  dbg "Learned artifacts: commands=$(echo "$LEARNED_COMMANDS" | grep -c , 2>/dev/null || echo 0)"
fi

# Option B: Use variable (less noisy)
_count=$(echo "$STALE_SLUGS" | wc -l | tr -d ' ')
dbg "Knowledge stale_slugs=$_count"
```

### LOW

**`log-paths` sourced earlier in `sidecar-capture`, adding `devflow_log_dir` overhead to every invocation** - `scripts/hooks/sidecar-capture:59-61` - Confidence: 82%
- Problem: `log-paths` was moved from line 87 (inside the memory-gated section) to line 59 (before the decisions scanner gate). `devflow_log_dir()` forks 4 subprocesses (`sed`, `tr`, `mkdir -p`, `chmod`) on first call. Previously, when `memory=false` in sidecar config, the hook exited at the old line 52 before reaching `log-paths`. Now it always sources `log-paths` and calls `devflow_log_dir` even when memory is disabled, adding ~5-10ms overhead to the early-exit path.
- Fix: This is an intentional trade-off (the comment says "source log-paths early so log() is available for all sections below"). The overhead is small and `log-paths` has an internal cache. Acceptable if `log()` is genuinely needed before the memory gate. If not, consider moving it back after the `MEMORY_ENABLED` check at line 97.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Normal logging adds unconditional `date` forks to 4 hooks that previously had none** - Confidence: 85%
- `scripts/hooks/pre-compact-memory:44-45`, `scripts/hooks/session-start-memory:41-42`, `scripts/hooks/session-start-context:50-51`, `scripts/hooks/sidecar-dispatch:48-49`
- Problem: Four hooks gain new unconditional `log()` functions that each call `date -u` (subprocess fork) on every invocation. Each `log()` call also performs a file append. Combined with the new `source log-paths` and `devflow_log_dir` call (which forks `sed + tr + mkdir + chmod`), each of these 4 hooks now pays ~10-15ms additional overhead per execution. These hooks fire on every session start, every user prompt, and every compact -- they are hot-path code.
- Fix: The logging is useful for production diagnostics and the overhead is individually small. However, consider two mitigations: (1) use a single `date` call cached in a variable at the top of the hook rather than forking per `log()` call; (2) for hooks with multiple log calls, the `log-paths` cache already helps. This is a should-fix for awareness, not blocking.

## Pre-existing Issues (Not Blocking)

_No pre-existing performance issues found in the changed files._

## Suggestions (Lower Confidence)

- **Redundant `devflow_debug_set_cwd` calls `sed` and `tr` in same manner as `devflow_log_dir`** - `scripts/hooks/debug-trace:41` (Confidence: 65%) -- When both debug-trace and log-paths are sourced, the CWD-to-slug conversion (`sed 's|^/||' | tr '/' '-'`) runs twice (once in `devflow_debug_set_cwd` and once in `devflow_log_dir`). Could share the slug computation, but only matters when debug is enabled.

- **`debug-trace` sources + `devflow_debug_init` on all 7 hooks adds baseline `source` file-read overhead** - `scripts/hooks/debug-trace` (Confidence: 62%) -- Each hook now reads and parses the 48-line `debug-trace` file. The `source` command itself is fast (no fork), but across 7 hooks firing per session lifecycle, it adds cumulative file I/O. Negligible individually (~1ms).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 1 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The debug tracing system is well-designed with a clean no-op fast path when `DEVFLOW_HOOK_DEBUG` is not set. The `stop_reason` filter removal and `response_text` to `last_assistant_message` rename are performance-neutral (removes one field extraction from the jq/node subprocess). The one condition for approval: fix the 4 unguarded `$()` substitutions inside `dbg` arguments that fork subprocesses unconditionally. The normal logging additions (7 unconditional `log()` calls across 4 hooks) add minor but acceptable overhead for production diagnostics.
