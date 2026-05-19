# Complexity Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Per-line json_field subprocess spawning in while-read loop** - `scripts/hooks/background-memory-update:148-181`
**Confidence**: 95%
- Problem: The turn-parsing while-read loop (lines 148-181) calls `json_field` twice per JSONL line via `echo "$line" | json_field "role" ""` and `echo "$line" | json_field "content" ""`. Each `json_field` invocation spawns either a `jq` or `node` subprocess. With the 20-line cap (MAX_LINES=20), this means up to 40 subprocess spawns in a tight loop. This is the exact same pattern documented in **PF-006** (per-line jq spawning adds latency), now reintroduced in a new location.
- Impact: Adds measurable latency to every background memory update. While this runs in a background process (not blocking the user's session), it increases CPU/process churn and extends the time the lock is held, which can delay concurrent memory updates.
- Fix: Replace the while-read loop with a single-pass `jq -s` (slurp) operation that parses all entries at once and outputs structured turn text:
```bash
if [ "$_HAS_JQ" = "true" ]; then
  TURNS_TEXT=$(echo "$ENTRIES" | jq -rs '
    [.[] | select(.role == "user" or .role == "assistant")]
    | to_entries
    | reduce .[] as $e (""; 
      . + "\nTurn \($e.key + 1):\n\(
        if $e.value.role == "user" then "User: \($e.value.content)"
        else "Assistant: \($e.value.content)" end
      )\n")
  ')
  TURN_COUNT=$(echo "$ENTRIES" | jq -s 'length')
fi
```

### MEDIUM

**Duplicated queue overflow logic across two files** - `scripts/hooks/stop-update-memory:82-89`, `scripts/hooks/background-memory-update:107-111`
**Confidence**: 85%
- Problem: The queue overflow safety pattern (check line count > 200, truncate to last 100 via tail/mv) appears in both `stop-update-memory` (lines 82-89, for the queue file) and `background-memory-update` (lines 107-111, for the processing file). Both use the same threshold (200) and cap (100), same `wc -l | tr -d ' '` idiom, same `tail > .tmp && mv` pattern. If thresholds need tuning, two locations must be updated in sync.
- Impact: DRY violation that risks threshold drift. Minor but worth noting given the project already tracks PF-003 and PF-005 for similar duplication patterns.
- Fix: Extract a shared `cap_file_lines` function into a sourced helper (e.g., add to `json-parse` or a new `queue-utils` helper):
```bash
# In a shared helper
cap_file_lines() {
  local file="$1" max="${2:-200}" keep="${3:-100}"
  [ ! -f "$file" ] && return
  local count=$(wc -l < "$file" | tr -d ' ')
  if [ "$count" -gt "$max" ]; then
    tail -"$keep" "$file" > "$file.tmp" && mv "$file.tmp" "$file"
    echo "$count"  # Return original count for logging
  fi
}
```

**Duplicated stat-based mtime logic across two files** - `scripts/hooks/stop-update-memory:96-100`, `scripts/hooks/background-memory-update:41-47`
**Confidence**: 82%
- Problem: The platform-conditional `stat` mtime extraction (GNU `stat -c %Y` vs BSD `stat -f %m`) is duplicated in `stop-update-memory` (lines 96-100, inline) and `background-memory-update` (lines 41-47, as `get_mtime` function). The stop hook does not reuse the `get_mtime` function defined in the background updater.
- Impact: If the stat detection logic needs a fix (e.g., to handle a third platform), it must be applied in two places. The background-memory-update version is already a named function; the stop-update-memory version is inline.
- Fix: Move `get_mtime` to a shared helper sourced by both scripts, or source background-memory-update's function definitions (less ideal given they are in the same directory).

## Issues in Code You Touched (Should Fix)

_None identified._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**background-memory-update is 289 lines with 7+ responsibilities (PF-004 overlap)**
**Confidence**: 90%
- Problem: The script handles locking, stale lock recovery, crash recovery, queue processing, turn parsing, git state gathering, prompt construction, LLM invocation, result validation, and watchdog timeout management. This is the same god-script anti-pattern already documented in PF-004 for `background-learning`. The refactoring in this PR improved the script (removed transcript extraction, simplified args) but it remains a monolith.
- Impact: Cannot unit test individual responsibilities (crash recovery logic, turn parsing, prompt construction) in isolation. The new tests in `shell-hooks.test.ts` test the queue capture behavior but cannot reach the background updater's internal logic.
- Note: This is a known issue (PF-004 pattern). The current PR actually reduces complexity vs. the previous version by removing transcript extraction. Flagging for awareness, not blocking.

## Suggestions (Lower Confidence)

- **Magic numbers in turn parsing** - `scripts/hooks/background-memory-update:136-139` (Confidence: 65%) -- `MAX_TURNS=10`, `MAX_LINES` computed as `MAX_TURNS * 2` assumes strict user/assistant alternation. Orphan turns break this 2:1 ratio, so the actual number of turns processed may exceed MAX_TURNS. Consider counting actual turns in the loop and breaking when limit is reached.

- **Nested conditional blocks in crash recovery** - `scripts/hooks/background-memory-update:98-119` (Confidence: 62%) -- The crash recovery section has an if/else with nested if blocks and mixed concerns (file merging, overflow capping, normal path). Could be clearer as early-return guard clauses, though the current structure is readable enough for a shell script.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The refactoring significantly simplifies the memory update pipeline by replacing transcript parsing with a queue-based approach, reducing argument passing, and adding crash recovery. The main complexity concern is the per-line subprocess spawning in the turn-parsing loop (reintroducing the PF-006 pattern in a new location). The two duplication findings are minor but align with existing pitfall patterns the project already tracks. Overall complexity is well-managed for shell scripts of this nature.
