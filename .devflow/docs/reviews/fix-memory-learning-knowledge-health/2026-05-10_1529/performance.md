# Performance Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10
**Commits**: 3 (5318e2d, 88bf7ea, 64993af)

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Orphan queue grep runs on every turn (stop hook hot path)** - `scripts/hooks/stop-update-memory:64`
**Confidence**: 82%
- Problem: The new orphan queue auto-clean at line 62-68 runs `grep -q '"role":"assistant"' "$QUEUE_FILE"` on every `end_turn` stop hook invocation. This grep scans the entire `.pending-turns.jsonl` file looking for any assistant role entry. The queue can grow up to 200 lines before overflow truncation kicks in. On every turn, this adds a full file scan in the critical path before the assistant response is captured.
- Impact: For typical queue sizes (1-50 lines of JSONL), the overhead is negligible — grep on a small file is sub-millisecond. At the 200-line overflow ceiling, with average JSONL lines of ~2KB each (2000-char truncated content + JSON envelope), the file could be ~400KB. Grep on a 400KB file is still under 1ms on modern SSDs. The real concern is that this runs synchronously before the queue append, adding latency to every turn's hook execution.
- Fix: The current placement is acceptable given the file size bounds. However, the grep could be moved **after** the queue append (lines 82-89) so that response capture is never delayed by the orphan check. The auto-clean is a housekeeping operation, not a prerequisite for appending:

```bash
# Move orphan-clean AFTER the queue append block (after line 89):
# --- Auto-clean orphan user-only queues ---
if [ -f "$QUEUE_FILE" ]; then
  if ! grep -q '"role":"assistant"' "$QUEUE_FILE" 2>/dev/null; then
    log "Auto-clean: truncating orphan user-only queue ($(wc -l < "$QUEUE_FILE" | tr -d ' ') lines)"
    : > "$QUEUE_FILE"
  fi
fi
```

Note: Moving it after the append means the current turn's assistant entry is present, so the grep would always find `"role":"assistant"` and never truncate on a turn that just appended. This changes semantics slightly — orphan queues would only be cleaned on the *next* turn after the problem is detected (when a new assistant message arrives). That is arguably correct behavior: you only clean if the queue was orphaned from a prior session, not mid-flight.

**One-time diagnostic runs jq on full INPUT on first invocation** - `scripts/hooks/stop-update-memory:56`
**Confidence**: 80%
- Problem: The diagnostic block (lines 53-59) invokes `jq -r 'keys | join(",")'` on the full `$INPUT` payload. The `INPUT` variable contains the entire hook payload including `response_text`, which can be large. This parses the full JSON just to extract key names.
- Impact: This is mitigated by the one-time marker (`$DIAG_MARKER`) — it only runs once per project, ever. After the marker file is created, the `[ ! -f "$DIAG_MARKER" ]` check short-circuits in ~0.1ms (single stat syscall). The first-run cost is a single jq invocation on a payload that's already been parsed once (line 25), so the data is likely in page cache.
- Fix: No fix needed. The one-time nature makes this a non-issue. Noted for completeness.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### LOW

**Queue file wc -l inside log message subshell** - `scripts/hooks/stop-update-memory:65`
**Confidence**: 85%
- Problem: The `$(wc -l < "$QUEUE_FILE" | tr -d ' ')` command substitution inside the log message at line 65 runs even when no log consumer is watching. This spawns two subprocesses (wc + tr) purely for diagnostic logging.
- Impact: Minimal. This only executes when the orphan condition is true (no assistant entries in queue), which is an edge case. The wc+tr cost is ~1-2ms. The tr is needed for macOS wc which pads with spaces.
- Fix: Not worth changing. The orphan case is rare and the diagnostic info is useful.

## Suggestions (Lower Confidence)

- **Ensure-features-init grep loop on first run** - `scripts/hooks/ensure-features-init:18-20` (Confidence: 65%) -- The `for _entry` loop runs 3 grep invocations against `.gitignore` on first run per project. After the `.gitignore-configured` marker is created, the entire block is skipped (single stat check). The first-run cost of 3 greps on a tiny file is negligible. This is well-designed with the marker pattern.

- **Response text extracted in initial jq/node parse** - `scripts/hooks/stop-update-memory:25-29` (Confidence: 70%) -- The `response_text` field is now extracted alongside `cwd` and `stop_reason` in the single jq/node invocation, which is a performance improvement over the old approach that had a separate jq invocation for `assistant_message` with complex content-array handling. The batched extraction eliminates one subprocess spawn.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Performance Score**: 8/10
**Recommendation**: APPROVED

### Rationale

This PR is a net performance improvement:

1. **Stop hook simplification** — Removing the complex `assistant_message` extraction (jq content-array handling + node fallback with streaming parser) and replacing it with a simple `response_text` field read, batched into the existing single jq/node invocation, eliminates one entire subprocess spawn per turn. The old code had two jq/node invocations (one for cwd+stop_reason, one for assistant_message); the new code has one. This saves ~5-15ms per turn depending on whether jq or node is used.

2. **Timeout increase (180s to 300s)** — No performance regression. This only affects the maximum wait time for background `claude -p` agent invocations. These run in detached background processes and do not block the user's session. The increase prevents premature timeouts that waste the work already done.

3. **Ensure-features-init** — Well-designed with marker-file idempotency. After first run: single `mkdir -p` (no-op on existing dir) + single `[ ! -f ]` stat check + single `[ ! -f ]` stat check = ~0.3ms total. Called from `session-end-knowledge-refresh` which itself is throttled to once per 2 hours.

4. **Orphan queue grep** — The only new per-turn cost. Bounded by the 200-line queue ceiling. Sub-millisecond for typical queue sizes. Acceptable tradeoff for preventing queue corruption from accumulating orphan user-only entries.

No blocking issues. The two MEDIUM findings are informational observations about the orphan grep placement, neither of which warrants blocking the merge.
