# Architecture Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Inconsistent error suppression in sidecar-capture `log()` vs other hooks** - `scripts/hooks/sidecar-capture:61`
**Confidence**: 82%
- Problem: The `log()` function in sidecar-capture was moved from line 89 to line 61 (earlier in the file, before the memory-gated section) but retains its original form without `2>/dev/null || true`. All four newly introduced `log()` definitions in this PR (pre-compact-memory:44, session-start-context:50, session-start-memory:41, sidecar-dispatch:48) consistently use `2>/dev/null || true` for resilient logging. The moved sidecar-capture definition does not, creating an inconsistency introduced by this PR's restructuring.
- Fix: Add error suppression to match the pattern established by the other hooks in this same PR:
```bash
log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [sidecar-capture] $1" >> "$LOG_FILE" 2>/dev/null || true; }
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Duplicate slug computation in debug-trace vs log-paths** - `scripts/hooks/debug-trace:41` (Confidence: 65%) -- The slug computation (`sed 's|^/||' | tr '/' '-'`) is duplicated between `debug-trace` and `log-paths`. Both create directories under `~/.devflow/logs/{slug}/`. If the slug algorithm ever changes, it must be updated in both places. Consider extracting to a shared helper, or having debug-trace source log-paths for the path computation.

- **debug-trace mkdir skips chmod 700** - `scripts/hooks/debug-trace:43` (Confidence: 62%) -- `debug-trace` creates `~/.devflow/logs/{slug}/` with `mkdir -p` but does not `chmod 700` the directory, while `log-paths` (the canonical log directory creator) does both. In practice, whichever runs first sets the permissions, but the divergence could matter if debug-trace runs in isolation before any hook that sources log-paths.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Architecture Assessment

This PR makes two well-separated changes:

**1. Field rename (`response_text` -> `last_assistant_message`, removal of `stop_reason` filter)**: Clean, thorough rename across all consumers (sidecar-capture hook, both test files). No remaining references to the old field names anywhere in the codebase. The removal of the `stop_reason === "end_turn"` filter simplifies the hook by removing a gate that is no longer needed (the upstream API now only delivers `last_assistant_message` on end-of-turn). The field count extracted by `cut` was reduced from 3 to 2, correctly adjusted. The jq and node extraction expressions both produce the right SOH-delimited output.

**2. Debug tracing system**: The `debug-trace` shared helper follows a clean two-phase architecture (global log before CWD is known, per-project log after CWD). The design correctly uses a safe no-op fallback (`dbg() { :; }`) declared before `set -e` in every hook, and `source "$SCRIPT_DIR/debug-trace" || true` for graceful degradation. The `devflow_debug_init` function redefines `dbg()` as either a real logger or a no-op based on the env var, avoiding runtime branching on every call. The CLI command (`debug.ts`) follows existing patterns (flags.ts, ambient.ts) for settings.json manipulation. The env-var toggle (`DEVFLOW_HOOK_DEBUG=1`) is the right mechanism for hooks that run in a subprocess context where sidecar config cannot be reliably read before CWD is known.

**Separation of concerns** is well maintained: debug tracing is a cross-cutting concern extracted into a single shared helper, not duplicated across hooks. Normal logging and debug logging are kept as independent channels with different purposes (debug for troubleshooting hook behavior, normal logging for operational events). The `sidecar-capture` log() was correctly moved earlier in the file so it is available for the decisions scanner section that runs before the memory gate -- this is a legitimate architectural improvement (applies ADR-001 clean break philosophy: the log placement was a historical artifact of the memory-only era).

No SOLID violations, no circular dependencies, no layering issues. The one condition is the `log()` consistency fix noted above.
