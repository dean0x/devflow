# Complexity Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### HIGH

**Deep nesting in eval-learning (6+ levels)** - `scripts/hooks/eval-learning:91-129`
**Confidence**: 85%
- Problem: The batch-trigger code path reaches nesting depth 6-9 (feature-enabled > daily-cap > batch-count > lock-acquired > re-check > user-signals > jq/node branch). While this was ported from the original monolithic `sidecar-evaluate` (the decomposition itself is a net positive), the inner logic within this module still exceeds the 4-level nesting threshold. The deepest hot path is `if LEARNING_ENABLED > if daily-cap ok > if batch >= threshold > if lock acquired > if re-check ok > if user signals exist > if _HAS_JQ` (7 levels of conditional nesting).
- Fix: Extract the inner batch-trigger logic (lines 88-129) into a helper function `_learn_write_marker()` that takes the already-validated state as parameters. This would bring the main flow to 4 levels and the helper to 3-4 levels:
```bash
_learn_write_marker() {
  local filter_lib="$1" transcript="$2" learning_dir="$3" ...
  _LEARN_USER_SIGNALS=""
  if [ -f "$filter_lib" ] && [ -n "$transcript" ] && [ -f "$transcript" ]; then
    _LEARN_USER_SIGNALS=$(node "$filter_lib" user-signals "$transcript" 2>/dev/null || true)
  fi
  [ -z "$_LEARN_USER_SIGNALS" ] && return 1
  _LEARN_EXISTING_IDS=$(load_existing_ids "$learning_dir/learning-log.jsonl")
  # ... marker write logic ...
}
```

**Deep nesting in eval-reinforce (5-7 levels)** - `scripts/hooks/eval-reinforce:28-51`
**Confidence**: 82%
- Problem: The jq/node dual-path reinforcement logic reaches depth 7 (learning-enabled > transcript exists > log exists > slugs found > lock acquired > jq branch > cmp check). The inline node -e block at lines 53-77 compounds this with embedded JavaScript that itself has 4 levels of nesting within a bash heredoc, making the combined cognitive load high.
- Fix: Extract the jq-path and node-path into separate helper functions:
```bash
_reinforce_via_jq() { ... }
_reinforce_via_node() { ... }

if [ "$_HAS_JQ" = "true" ]; then
  _reinforce_via_jq "$_REINF_LEARNING_LOG" "$_REINF_SLUGS_PATTERN" "$_REINF_NOW_ISO" "$_REINF_TEMP_LOG"
else
  _reinforce_via_node "$_REINF_LEARNING_LOG" "$_REINF_SLUGS_PATTERN" "$_REINF_NOW_ISO"
fi
```

### MEDIUM

**(none)**

## Issues in Code You Touched (Should Fix)

### MEDIUM

**session-start-context Section 1.75 nesting depth** - `scripts/hooks/session-start-context:110-179`
**Confidence**: 80%
- Problem: The learned behaviors section (1.75) has a 70-line block with 4-5 levels of nesting (learning enabled > log exists > learned_json extraction > jq/node branch > commands/skills formatting). While each individual condition is simple, the aggregate makes the section difficult to follow. This was pre-existing structure but the branch added debug tracing annotations that touched this code.
- Fix: Extract the learned behaviors injection into a sourced helper (matching the `eval-*` module pattern used elsewhere in this PR), or at minimum extract the jq/node formatting into a helper function.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**sidecar-dispatch marker collection loop** - `scripts/hooks/sidecar-dispatch:163-200`
**Confidence**: 80%
- Problem: The marker collection loop (38 lines) handles 6 concerns in a single `for` loop: basename extraction, config-file skip, feature-gate deletion, timestamp expiry, retry-file cleanup, and task accumulation. While nesting stays at 3-4 levels, the cyclomatic complexity within the loop body is high (~8 decision points). This code predates this branch.
- Fix: Consider breaking the loop body into a `_process_marker()` function that returns skip/include, keeping the for-loop itself as a simple collector.

## Suggestions (Lower Confidence)

- **Dual jq/node code paths add structural complexity** - `scripts/hooks/eval-learning:101-116`, `eval-decisions:54-69`, `eval-knowledge:48-61` (Confidence: 70%) -- Every eval-* module duplicates marker-writing logic for jq and node fallback paths. A shared `write_json_marker` helper in eval-helpers could consolidate this pattern (accepts field names/values, writes temp+mv atomically, handles jq/node branching once).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Conditions

1. The two HIGH nesting issues in eval-learning and eval-reinforce should be addressed before merge -- both exceed the 5-level nesting threshold established in the complexity skill.

### Positive Notes

- The decomposition of the 465-line monolithic `sidecar-evaluate` into an orchestrator (120 lines) + 4 focused modules (68-138 lines each) is a significant complexity reduction and directly addresses the "god script" concern documented in PF-006. Each module now has a single responsibility (avoids PF-006 pattern accumulation).
- New files (`debug-trace`, `hook-bootstrap`, `hook-log-init`) are well-sized (25-75 lines) and follow the single-responsibility principle -- each does exactly one thing.
- The `debug.ts` CLI command cleanly separates pure functions from I/O (133 lines, no function exceeds 25 lines, nesting stays at 2-3 levels). Applies ADR-007 (single global debug toggle).
- The `eval-helpers` shared utility (68 lines) properly extracts common functions (`read_daily_cap`, `atomic_increment_daily`, `load_existing_ids`, `_eval_release_lock`) reducing duplication across modules.
- Test file coverage is thorough with behavioral tests for all new components.

### Cross-Cycle Note

Prior resolution cycle 3 addressed 10 complexity issues. The two HIGH findings in this report target nesting that was ported verbatim from the old monolithic script into the new modules -- the decomposition was the priority fix; flattening the inner logic is the natural follow-up.
