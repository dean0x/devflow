# Performance Review Report

**Branch**: feat-learning-wave2-quality -> main
**Date**: 2026-03-25

## Issues in Your Changes (BLOCKING)

### HIGH

**Per-line subprocess spawning in reinforce_loaded_artifacts (PF-006 variant)** - `scripts/hooks/session-end-learning:108-131`
**Confidence**: 92%
- Problem: The `reinforce_loaded_artifacts` function reads `learning-log.jsonl` line-by-line in a `while IFS= read -r line` loop, spawning 2-3 subprocesses per line (`json_field "status"`, `json_field "artifact_path"`, conditionally `json_update_field`). Each `json_field` call spawns either `jq` or `node`. With 50-100 observations, this is 100-300 subprocesses in the synchronous SessionEnd hook path, adding measurable latency (estimated 0.5-2s) to every qualifying session end. This is the same class of issue documented in PF-006 ("per-line jq spawning adds latency").
- Fix: Replace the while-read loop with a single-pass `jq -s` (slurp) operation. The `loaded` slugs list is already computed via grep; pass it as a jq argument and let jq update matching entries in one invocation:
  ```bash
  if [ "$_HAS_JQ" = "true" ]; then
    local slugs_regex
    slugs_regex=$(echo "$loaded" | sed 's|self-learning[:/]||g' | paste -sd '|' -)
    jq -c --arg now "$now_iso" --arg slugs "$slugs_regex" '
      if .status == "created" and .artifact_path != "" then
        (.artifact_path | split("/") | if test("/commands/") then .[-1] | rtrimstr(".md") else .[-2] end) as $slug
        | if ($slug | test($slugs)) then .last_seen = $now else . end
      else . end
    ' "$learning_log" > "$temp_log"
    # compare and swap
  fi
  ```

**Per-line subprocess spawning in extract_batch_messages** - `scripts/hooks/background-learning:166-177`
**Confidence**: 90%
- Problem: For each transcript in the batch, user messages are extracted using `grep | while read -r line; do echo "$line" | json_extract_messages; done`. Each line spawns a jq/node subprocess. With 3 sessions averaging 50 user messages each, that is ~150 subprocess spawns. The batch context (up to 30,000 chars) makes this more expensive than the old single-session extraction (capped at 12,000 chars). This runs in the background process so it does not block the user, but it still wastes CPU and extends the background run time, which holds the learning lock.
- Fix: Replace the per-line pattern with a single-pass jq command:
  ```bash
  session_msgs=$(grep '"type":"user"' "$transcript" 2>/dev/null \
    | jq -rs '[.[] | if .message.content then
        if (.message.content | type) == "string" then .message.content
        else [.message.content[] | select(.type == "text") | .text] | join("\n")
        end
      else "" end] | map(select(. != "")) | join("\n")' 2>/dev/null || true)
  ```

### MEDIUM

**Per-line subprocess spawning in apply_temporal_decay** - `scripts/hooks/background-learning:223-252`
**Confidence**: 88%
- Problem: The `apply_temporal_decay` function iterates every line of `learning-log.jsonl`, calling `json_valid`, `json_field "last_seen"`, `json_field "confidence"`, and conditionally `json_update_field_json` per line -- 3-4 subprocess spawns per observation. At 100 observations, this is 300-400 subprocesses. Runs in background, but extends lock hold time.
- Fix: Use a single `jq -s` pass to compute all decay in one invocation, then output as JSONL. The decay logic (30-day periods, factor table) can be expressed in jq.

**Per-line subprocess spawning in create_artifacts observation status update** - `scripts/hooks/background-learning:651-658`
**Confidence**: 85%
- Problem: After creating each artifact, the entire `learning-log.jsonl` is read line-by-line in a while loop, with each line calling `grep -qF` and two `json_update_field` calls for the matching line. For N artifacts with M observations, this is O(N*M) subprocess spawns. Typically N is small (1-2), so practical impact is low, but the pattern is wasteful.
- Fix: Use `jq` for in-place field update with `grep -v` + single-line jq append, or a single `jq -s` pass.

**Duplicate date epoch computation in process_observations** - `scripts/hooks/background-learning:509-513,522-527`
**Confidence**: 82%
- Problem: The `FIRST_EPOCH` and `NOW_EPOCH` values are computed twice for the same observation -- once in the temporal spread check block (lines 509-517) and again in the status determination block (lines 522-530). Each `date` invocation spawns a subprocess. With multiple observations being updated, this doubles the date parsing overhead unnecessarily.
- Fix: Compute `FIRST_EPOCH` and `NOW_EPOCH` once before both blocks and reuse:
  ```bash
  FIRST_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$FIRST_SEEN" +%s 2>/dev/null \
    || date -d "$FIRST_SEEN" +%s 2>/dev/null || echo "0")
  NOW_EPOCH=$(date +%s)
  # Then use in both temporal spread check and status determination
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Truncation at 30,000 chars may over-feed LLM for marginal benefit** - `scripts/hooks/background-learning:196-198`
**Confidence**: 80%
- Problem: The batch transcript truncation limit was raised from 12,000 to 30,000 chars (2.5x increase) to accommodate multi-session batching. This directly increases the token input to the Sonnet LLM call, increasing both API cost and response latency. The 3-session batch already provides pattern diversity; 30,000 chars may be more data than needed for pattern detection. Each additional 1,000 chars is roughly 250-300 tokens of input.
- Fix: Consider a per-session cap (e.g., 6,000 chars per session for 3 sessions = 18,000 total) rather than a flat 30,000. This preserves cross-session diversity while bounding input size:
  ```bash
  PER_SESSION_CAP=6000
  if [ ${#session_msgs} -gt $PER_SESSION_CAP ]; then
    session_msgs="${session_msgs:0:$PER_SESSION_CAP}... [truncated]"
  fi
  ```

## Pre-existing Issues (Not Blocking)

### HIGH

**Per-line subprocess spawning pattern is systemic across all JSONL processing (PF-006)** - `scripts/hooks/background-learning` (multiple functions)
**Confidence**: 95%
- Problem: PF-006 documents this exact pattern. The PR improves the overall invocation frequency (batching reduces how often the background learner runs) but does not address the per-line subprocess pattern within each run. The `process_observations` function (lines 455-572) also spawns 5-10 subprocesses per observation for field extraction. This is the "god script" problem from PF-004.
- The batching change is a net positive (fewer total runs), but each run is now heavier (more sessions to process). The fundamental fix remains: move JSON-heavy logic to TypeScript as noted in PF-004.

## Suggestions (Lower Confidence)

- **Lock contention with extended background runs** - `scripts/hooks/background-learning:70-79` (Confidence: 70%) -- With batch mode processing multiple sessions, the lock is held longer (more transcript data, more observations to process). The 90-second lock timeout in `acquire_lock` and 5-minute stale threshold may be tight if Sonnet analysis takes a long time on larger prompts. Consider whether the lock needs to cover the entire run or just the JSONL write phases.

- **Adaptive batch size reads learning-log.jsonl on every session end** - `scripts/hooks/session-end-learning:148-149` (Confidence: 65%) -- `wc -l < learning-log.jsonl` is called on every SessionEnd to determine adaptive batch size. This is a fast operation for typical file sizes (<100 lines), but it adds unnecessary I/O for the common case where batch size stays at the default 3.

- **`ls -t` glob fallback for transcript discovery** - `scripts/hooks/session-end-learning:76` (Confidence: 62%) -- `ls -t "$PROJECTS_DIR"/*.jsonl` can be slow if there are many transcript files in the projects directory. This is a fallback path only (used when `session_id` is missing from hook input), so practical impact is low.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 3 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 1 | 0 | 0 |

**Performance Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The PR makes a strong architectural improvement by batching learning runs (3 sessions before triggering), which reduces the frequency of expensive LLM invocations. This is a net positive for system-level performance. However, the new `reinforce_loaded_artifacts` function introduces a per-line subprocess pattern in the synchronous SessionEnd hook path (blocking the user), repeating the exact class of issue documented in PF-006. The background-learning script retains its systemic per-line subprocess pattern across multiple functions. The two HIGH findings (reinforce loop in the synchronous path, and batch extraction in the background path) should be addressed before merge.
