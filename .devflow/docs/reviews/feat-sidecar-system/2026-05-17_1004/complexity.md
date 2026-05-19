# Complexity Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Deep nesting in sidecar-evaluate learning section (6 levels)** - `scripts/hooks/sidecar-evaluate:88-194`
**Confidence**: 92%
- Problem: The learning evaluation section nests 6 levels deep (feature-enabled > daily-cap-else > batch-threshold > user-signals-present > log-file-exists > jq-available). At this depth, the reader must maintain 6 simultaneous conditions in their head to understand which path executes. This exceeds the 4-level warning threshold significantly.
- Fix: Extract inner logic into shell functions. The batch-ready logic (lines 142-193) should be a function like `write_learning_marker()` and the ID-extraction logic (lines 153-164) should be `extract_existing_ids()`:
```bash
extract_existing_ids() {
  local log_file="$1"
  if [ ! -f "$log_file" ]; then echo "[]"; return; fi
  if [ "$_HAS_JQ" = "true" ]; then
    jq -s '[.[].id // empty]' "$log_file" 2>/dev/null || echo "[]"
  else
    node -e "..." 2>/dev/null || echo "[]"
  fi
}
```

**sidecar-evaluate is a 328-line monolithic script with 3 repeated structural patterns** - `scripts/hooks/sidecar-evaluate:1-328`
**Confidence**: 88%
- Problem: The script evaluates 3 features (learning, decisions, knowledge) with near-identical structure: check-enabled > check-sentinel > daily-cap > extract-data > check-jq-fallback > write-marker. This repetition multiplies cognitive load because the reader must diff the three blocks mentally to understand what varies. The file exceeds the 300-line critical threshold.
- Fix: Extract a common `write_marker_json()` helper and a `check_daily_cap()` function that the three sections share. Each evaluation section would shrink to ~30 lines of feature-specific logic:
```bash
check_daily_cap() {
  local runs_file="$1" max="$2"
  local today=$(date '+%Y-%m-%d')
  local runs_today=0
  if [ -f "$runs_file" ]; then
    local runs_date=$(cut -f1 "$runs_file" 2>/dev/null || true)
    [ "$runs_date" = "$today" ] && runs_today=$(cut -f2 "$runs_file" 2>/dev/null || echo "0")
  fi
  [ "$runs_today" -ge "$max" ] && return 1
  echo "$runs_today"
}
```

### MEDIUM

**Duplicated jq/node fallback pattern (6 occurrences across 3 hook scripts)** - `scripts/hooks/sidecar-evaluate:154-163`, `scripts/hooks/sidecar-evaluate:167-180`, `scripts/hooks/sidecar-evaluate:237-248`, `scripts/hooks/sidecar-evaluate:250-263`, `scripts/hooks/sidecar-capture:92-98`, `scripts/hooks/sidecar-dispatch:54-59`
**Confidence**: 85%
- Problem: The `if [ "$_HAS_JQ" = "true" ]; then ... else node -e "..." fi` pattern appears 6 times across the 3 new hooks, with each instance being 6-12 lines. This is a maintainability issue -- if the JSON serialization approach changes, 6 locations must be updated.
- Fix: Add a `json_build` helper to the sourced `json-parse` library that accepts field/value pairs and outputs JSON using whichever tool is available:
```bash
# In json-parse:
json_build() {
  # Accept pairs: key1 type1 val1 key2 type2 val2 ...
  # Types: s=string, n=number, j=raw-json
  if [ "$_HAS_JQ" = "true" ]; then
    # build jq invocation dynamically
  else
    # build node invocation dynamically
  fi
}
```

**Stale retry loop in sidecar-dispatch has 4 nesting levels with platform-specific branching** - `scripts/hooks/sidecar-dispatch:71-87`
**Confidence**: 82%
- Problem: The stale retry logic nests: `for > if command -v > if GNU-stat > if age`. The platform detection for `stat` adds incidental complexity that obscures the actual intent (rename stale files). This is borderline (4 levels) but the platform branching makes it harder to follow than typical 4-deep nesting.
- Fix: The `get-mtime` script already exists and is sourced by `sidecar-capture`. Source it here too to eliminate the inline platform detection:
```bash
source "$SCRIPT_DIR/get-mtime" || exit 0
for PROC_FILE in "$SIDECAR_DIR"/*.processing; do
  [ -f "$PROC_FILE" ] || continue
  PROC_MTIME=$(get_mtime "$PROC_FILE")
  PROC_AGE=$(( NOW - PROC_MTIME ))
  if [ "$PROC_AGE" -gt 300 ]; then
    mv "$PROC_FILE" "${PROC_FILE%.processing}.json" 2>/dev/null || true
  fi
done
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **sidecar-capture duplicates queue-write pattern from sidecar-dispatch** - `scripts/hooks/sidecar-capture:76-98` vs `scripts/hooks/sidecar-dispatch:38-61` (Confidence: 68%) -- Both hooks write to `.pending-turns.jsonl` with the same permission setup, jq/node branching, and truncation logic. A shared `append_to_queue()` function would deduplicate this.

- **Magic number 2000 for truncation length** - `scripts/hooks/sidecar-capture:71`, `scripts/hooks/sidecar-dispatch:42` (Confidence: 62%) -- The truncation threshold is hardcoded in two places. A shared constant at script top or in the sourced library would make intent clearer and changes single-point.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Complexity Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The overall PR is a net complexity *reduction* (removing 4,041 lines, adding 1,251 -- the deleted `background-runner.ts` alone was 448 lines of high-complexity async orchestration). The new TypeScript (`sidecar-config.ts`) is exemplary in simplicity. However, `sidecar-evaluate` consolidates 3 previously separate shell scripts into a single 328-line monolith with 6-level nesting that violates the project's own reliability rule ("Every loop, retry, and resource has an explicit bound" -- here, the structural complexity makes reasoning about bounds harder). Extracting shared helpers would bring the script under control without increasing file count significantly. The `applies ADR-001` clean-break philosophy is honored well -- old hook management code is removed entirely rather than shimmed.
