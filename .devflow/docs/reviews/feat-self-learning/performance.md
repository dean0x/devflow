# Performance Review Report

**Branch**: feat/self-learning -> main
**Date**: 2026-03-23

## Issues in Your Changes (BLOCKING)

### HIGH

**Repeated jq process spawns inside while-read loops (O(n * k) subprocesses)** - `scripts/hooks/background-learning:203-236`, `scripts/hooks/background-learning:545-551`
**Confidence**: 95%
- Problem: The temporal decay loop (lines 203-236) reads the JSONL file line-by-line and spawns 3-6 `jq` subprocesses per line (validity check, field extraction for `last_seen`, `confidence`, then update). For 100 entries (the configured cap), this means 300-600 forked processes. The same pattern repeats in the artifact-creation loop (lines 363-453) with `grep -F` + `jq` per observation, and again in the artifact status-update loop (lines 545-551) which iterates the entire file per artifact to `grep -qF` and `jq -c`.
- Impact: Each `jq` invocation forks a process, parses JSON from scratch, and exits. At 100 entries this adds measurable latency (estimated 2-5 seconds on macOS for the decay pass alone). The script already invokes a claude model call that dominates wall-clock time, but the pre-processing and post-processing loops are unnecessarily slow and will degrade further as the log approaches 100 lines.
- Fix: Replace per-line jq invocations with a single `jq -s` (slurp) pass that processes all entries at once. For temporal decay:
  ```bash
  # Single-pass decay using jq slurp
  NOW_EPOCH=$(date +%s)
  jq -c --argjson now "$NOW_EPOCH" '
    (.last_seen // "" | if . != "" then
      (now - (. | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime)) / 86400 / 30 | floor
    else 0 end) as $periods |
    if $periods > 0 then
      .confidence *= (pow(0.9; $periods)) |
      if .confidence < 0.1 then empty else . end
    else . end
  ' "$LEARNING_LOG" > "$TEMP_FILE"
  mv "$TEMP_FILE" "$LEARNING_LOG"
  ```
  Similarly for the observation-update loop: slurp once, update matching IDs in a single jq expression, write once.

---

**Session-start hook reads JSONL file twice with per-line jq subprocesses** - `scripts/hooks/session-start-memory:142-175`, `scripts/hooks/session-start-memory:196-219`
**Confidence**: 92%
- Problem: The learned-behaviors section reads `learning-log.jsonl` in two separate while-read loops, each spawning 4-6 `jq` subprocesses per line. The first loop (lines 142-175) extracts created artifacts, and the second loop (lines 196-219) checks for new artifacts since last notification. These loops process the same file with nearly identical filtering logic.
- Impact: This runs synchronously during session startup (the `SessionStart` hook), directly adding latency to the user's interactive session launch. With 100 observations, this could add 1-3 seconds to every session start.
- Fix: Merge both loops into a single `jq -s` slurp pass that extracts all needed data at once:
  ```bash
  LAST_NOTIFIED=0
  if [ -f "$NOTIFIED_MARKER" ]; then
    LAST_NOTIFIED=$(cat "$NOTIFIED_MARKER" 2>/dev/null || echo "0")
  fi

  PARSED=$(jq -s --argjson cutoff "$LAST_NOTIFIED" '
    [.[] | select(.status == "created" and .artifact_path != null and .artifact_path != "")] |
    {
      commands: [.[] | select(.type == "workflow") | {name: (.artifact_path | split("/") | last | rtrimstr(".md")), conf: .confidence}],
      skills: [.[] | select(.type != "workflow") | {name: (.artifact_path | capture("learned-(?<n>[^/]*)") // {n:""} | .n), conf: .confidence}],
      new: [.[] | select(.last_seen != null) | select((.last_seen | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) > $cutoff)]
    }
  ' "$LEARNING_LOG" 2>/dev/null)
  ```
  This eliminates all per-line subprocess spawning and replaces two full-file scans with one.

---

### MEDIUM

**JSONL cap enforcement uses double slurp-and-re-serialize** - `scripts/hooks/background-learning:240-244`
**Confidence**: 85%
- Problem: Lines 240-244 check line count, then slurp the entire file with `jq -c '.'` piped into `jq -s 'sort_by(.confidence) | reverse | .[0:100][]'`. This parses the file twice in sequence (once to normalize, once to sort/truncate). This runs after the decay loop which already rewrites the file.
- Fix: Combine cap enforcement into the decay pass. After the single-pass decay jq expression, append `| sort_by(.confidence) | reverse | .[0:100]` before writing, handling both operations in one pass.

---

**Observation update loop uses grep-then-rewrite for each observation** - `scripts/hooks/background-learning:363-474`
**Confidence**: 82%
- Problem: For each observation returned by the model, the script does `grep -F "\"id\":\"$OBS_ID\"" "$LEARNING_LOG"` to find existing entries, then later does `grep -vF` to remove the old line and appends the updated one. With N observations and M log entries, this is O(N * M) I/O operations (reading the full file for each observation). The same file is also read/written multiple times for artifact status updates (lines 545-551).
- Impact: With 10 observations from a single session and 100 log entries, this means ~20 full file reads plus ~10 file rewrites. Each rewrite forces a full `mv` atomic replace.
- Fix: Accumulate all updates in memory (e.g., build a jq filter that handles all observation IDs at once), then write the file once at the end.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`extract_user_messages` pipes grep into jq per-line then re-greps** - `scripts/hooks/background-learning:146-149`
**Confidence**: 80%
- Problem: The transcript extraction (line 146) uses `grep '"type":"user"'` piped to `jq -r` piped to `grep -v '^$'`. For large session transcripts (which can be thousands of lines), this spawns 3 long-running subprocesses. The jq invocation in the middle processes all matching lines, which is fine, but the pre-filter `grep` + post-filter `grep -v '^$'` could be absorbed into jq.
- Fix: Use a single jq invocation with `select` to filter type and non-empty text:
  ```bash
  USER_MESSAGES=$(jq -r 'select(.message.content and .type == "user") |
    [.message.content[] | select(.type == "text") | .text] | join("\n") |
    select(length > 0)' "$transcript" 2>/dev/null)
  ```

## Pre-existing Issues (Not Blocking)

_No CRITICAL pre-existing performance issues identified in the touched files._

## Suggestions (Lower Confidence)

- **Lock contention with 1-second sleep polling** - `scripts/hooks/background-learning:60-68` (Confidence: 65%) -- The lock acquisition loop sleeps 1 second per iteration up to 90 seconds. If two concurrent sessions end simultaneously, one waits idle. A shorter sleep (0.2s) with proportionally higher iteration count would reduce tail latency without changing timeout behavior.

- **Watchdog subprocess leak on normal exit** - `scripts/hooks/background-learning:319-320` (Confidence: 70%) -- The watchdog `( sleep 180 && kill ... ) &` spawns a sleep subprocess that persists for 3 minutes even when the claude process completes quickly. The `kill` + `wait` cleanup runs, but the sleep subprocess itself may have already forked. This is a minor resource concern (one lingering sleep process per learning run).

- **Temporal decay recalculates on every run** - `scripts/hooks/background-learning:203-236` (Confidence: 60%) -- Decay is applied on every background-learning invocation, even when no observations have actually aged past a 30-day period boundary. A last-decay-at marker file could skip the decay pass when less than 24 hours have elapsed since the last decay application.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The primary concern is excessive subprocess spawning in shell loops. Both `background-learning` and `session-start-memory` iterate JSONL files line-by-line, forking multiple `jq` processes per line. The background-learning script is less user-facing (runs detached after session stop), but the session-start-memory additions run synchronously during session startup and directly impact perceived latency. Replacing per-line jq invocations with single-pass `jq -s` (slurp) operations would eliminate hundreds of subprocess forks and reduce I/O from O(n * k) file reads to O(1). The data structures are already bounded (100-entry cap), so the slurp approach is safe for memory.
