# Performance Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### HIGH

**sidecar-capture: hook-bootstrap sourced BEFORE feedback-loop guards** - `scripts/hooks/sidecar-capture:16-21`
**Confidence**: 92%
- Problem: `sidecar-capture` sources `hook-bootstrap` (which sources `debug-trace` and calls `devflow_debug_init`) at line 16, but the feedback-loop guards (`DEVFLOW_BG_UPDATER`, `DEVFLOW_BG_LEARNER`, `DEVFLOW_BG_KNOWLEDGE_REFRESH`) are at lines 19-21 -- after the bootstrap. In contrast, `sidecar-dispatch` (line 14-16 vs 20) and `sidecar-evaluate` (line 17-19 vs 23) correctly place guards BEFORE `hook-bootstrap`. Background sidecar sessions pay ~5-10ms of unnecessary `source` + `devflow_debug_init` overhead on every stop-hook invocation before exiting. The Stop hook fires on every assistant turn, making this the hottest code path. This is an inconsistency the PR's own pattern establishes but fails to follow in one of the three sidecar hooks.
- Fix: Move the three feedback-loop guards above `source "$SCRIPT_DIR/hook-bootstrap"`, matching the pattern used in `sidecar-dispatch` and `sidecar-evaluate`:
```bash
# Before hook-bootstrap:
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then exit 0; fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-bootstrap" "sidecar-capture"
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`load_existing_ids` Node fallback reads entire JSONL file into memory via `readFileSync`** - `scripts/hooks/eval-helpers:52-57`
**Confidence**: 82%
- Problem: The Node fallback path in `load_existing_ids` calls `fs.readFileSync(process.argv[1],'utf8').trim().split('\n')`, which slurps the entire `learning-log.jsonl` or `decisions-log.jsonl` into a single string, then splits it into an array. The jq path at line 49-50 explicitly avoids this pattern with a streaming approach (`jq -c '.id // empty' | jq -s '.'`). While these JSONL files are typically small (tens to hundreds of entries), the Node path has no upper bound check, and the file can grow over months of use. The comment on line 49 even acknowledges the issue: "Stream line-by-line then collect -- avoids slurping entire file into memory".
- Fix: This is pre-existing logic (moved from sidecar-evaluate), and the jq path is the primary path on most systems. No immediate fix required, but a streaming Node approach or a line-count guard would align the Node fallback with the jq path's intent. Low urgency since learning-log files rarely exceed a few hundred KB.

## Pre-existing Issues (Not Blocking)

_None at CRITICAL severity._

## Suggestions (Lower Confidence)

- **Redundant `date` subprocess in `dbg()` definition** - `scripts/hooks/debug-trace:57,73` (Confidence: 65%) -- When debug is ON, every `dbg` call forks a `date -u` subprocess for the ISO timestamp. With 20+ `dbg` calls per hook run (sidecar-capture has 23), this is ~23 subprocess forks. A cached timestamp approach (compute once at init, reuse) would reduce this. However, debug mode is explicitly opt-in and rare, so the overhead is acceptable.

- **`hook-log-init` stat cascade runs on every hook invocation** - `scripts/hooks/hook-log-init:32-35` (Confidence: 70%) -- The stat-size-guard runs `stat` (or `wc -c`) on every hook invocation to check if the log exceeds 2MB. This is cheap (~2ms) and only triggers truncation when needed, but the check itself is unconditional. A frequency-based approach (check every Nth invocation) could save ~2ms per call, but the current approach is simple and correct.

- **`devflow_debug_set_cwd` calls `sed` + `tr` for slug computation** - `scripts/hooks/debug-trace:66` (Confidence: 62%) -- When debug is ON, `devflow_debug_set_cwd` forks `sed` and `tr` to compute the project slug, duplicating the same computation that `log-paths`/`devflow_log_dir` does with caching. Since both run in the same process, the slug could be computed once and shared. However, debug mode is rare and the cost is ~5ms.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces a well-designed zero-overhead debug tracing system (applies ADR-007). The `dbg() { :; }` no-op fallback ensures zero cost when debug is disabled -- the dominant case. The `hook-bootstrap` / `hook-log-init` extraction reduces duplication. The `sidecar-capture` deferred `hook-log-init` sourcing (line 97, after the memory gate) is a smart optimization that avoids `log-paths` subprocess overhead (~15-20ms) on the non-memory path.

The one blocking issue is the inconsistent feedback-loop guard placement in `sidecar-capture`: `hook-bootstrap` is sourced before the guards exit, unlike the other two sidecar hooks. Since the Stop hook fires on every assistant turn, this is the highest-frequency hook and should follow the same early-exit pattern.

The `load_existing_ids` Node fallback unbounded read is pre-existing (moved from sidecar-evaluate, not newly introduced) and is gated behind the `_HAS_JQ=false` fallback path. It should be fixed opportunistically but does not block this PR.
