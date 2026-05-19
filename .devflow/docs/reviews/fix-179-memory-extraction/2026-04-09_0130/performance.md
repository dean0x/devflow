# Performance Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Per-line jq/node subprocess spawning in while-read loop** - `scripts/hooks/background-memory-update:148-152`
**Confidence**: 95%
- Problem: The turn-building loop at lines 148-181 calls `json_field` twice per JSONL line (`role` and `content`). Each `json_field` invocation spawns a `jq` subprocess (or `node` subprocess on fallback). With a cap of 20 lines (10 turns x 2 lines), this creates up to 40 subprocess spawns in sequence. This is the same class of issue documented in **PF-006** (per-line jq spawning in session-start hooks), which was flagged in a prior review as adding 1-3s latency.
- Impact: Adds measurable latency (100-500ms at 20 lines with jq, 2-4s with node fallback) to the background updater. While this runs in a background process and does not block the user's session, it unnecessarily prolongs lock hold time, increasing the chance of lock contention between concurrent sessions. It also increases CPU cost on every update cycle.
- Fix: Use a single-pass `jq -s` (slurp) operation to extract all roles and contents at once, then iterate over the results in pure bash:
```bash
# Replace the while-read loop with single-pass extraction
if [ "$_HAS_JQ" = "true" ]; then
  PARSED=$(echo "$ENTRIES" | jq -r '[.role, .content] | @tsv')
else
  PARSED=$(echo "$ENTRIES" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      d.trim().split('\n').filter(Boolean).forEach(l=>{
        try{const o=JSON.parse(l);console.log(o.role+'\t'+o.content)}catch(e){}
      })
    })")
fi

CURRENT_USER=""
while IFS=$'\t' read -r ROLE CONTENT; do
  # ... same pairing logic, but ROLE/CONTENT are already extracted
done <<< "$PARSED"
```

### MEDIUM

**Redundant queue overflow check on every stop hook invocation** - `scripts/hooks/stop-update-memory:83-89`
**Confidence**: 82%
- Problem: After every assistant turn append, the stop hook reads the entire queue file with `wc -l` and conditionally tail-truncates it. At normal usage rates (1 turn every few seconds to minutes), the queue will rarely exceed 200 lines. The `wc -l` itself is cheap, but `tail + mv` for truncation reads and rewrites the whole file. Combined with the queue being a shared file under concurrent append, this creates a brief window where a concurrent preamble hook could lose an append during the `tail > tmp && mv tmp queue` operation.
- Impact: Minor latency addition per stop hook call (~1-5ms for wc, negligible). The real concern is the race condition window during truncation, though it would only manifest under extreme concurrent usage patterns.
- Fix: Move the overflow check into the background updater (which already holds the lock), or only run the check every Nth invocation using a simple counter:
```bash
# Only check overflow periodically (every ~50 appends)
APPEND_COUNT=$(($(wc -l < "$QUEUE_FILE" 2>/dev/null || echo 0) % 50))
if [ "$APPEND_COUNT" -eq 0 ] && [ "$(wc -l < "$QUEUE_FILE")" -gt 200 ]; then
  ...
fi
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`cat "$PROCESSING_FILE"` loads entire file into shell variable** - `scripts/hooks/background-memory-update:144`
**Confidence**: 80%
- Problem: `ENTRIES=$(cat "$PROCESSING_FILE")` reads the entire processing file into a single shell variable. With the 200-line cap, this is bounded, but bash variable assignment involves string copying and can be slow for large payloads (each line can be up to ~2KB due to content truncation = up to 400KB total in extreme cases).
- Impact: Low under normal conditions due to the 200-line cap. Would only matter if the cap logic failed or was raised.
- Fix: No immediate action needed given the existing cap. The single-pass jq fix above would also eliminate this variable entirely by processing the file directly.

## Pre-existing Issues (Not Blocking)

None identified at CRITICAL severity.

## Suggestions (Lower Confidence)

- **Node fallback in preamble hook adds ~100-200ms latency** - `scripts/hooks/preamble:35-37` (Confidence: 65%) -- When jq is unavailable, the node fallback spawns a full Node.js process to serialize a single JSON line. On cold start, Node.js initialization alone takes ~100-200ms. This runs on the user-facing prompt path (UserPromptSubmit), so it adds perceptible latency. Consider a pure-bash printf fallback for simple JSON construction when jq is absent.

- **`sleep 3` removed but no replacement flush guarantee** - `scripts/hooks/background-memory-update` (Confidence: 70%) -- The old script had `sleep 3` to wait for transcript flush. The new queue-based design eliminates this by design (turns are queued before the updater runs). However, there is no explicit ordering guarantee that the stop hook's queue append completes before the background updater's `mv` handoff. In practice, the `nohup` + process spawn delay provides implicit ordering, but this is fragile.

- **Duplicate stat version detection in stop hook** - `scripts/hooks/stop-update-memory:96-100` (Confidence: 72%) -- The `stat --version` check for GNU vs BSD stat is inlined in the throttle section rather than reusing the `get_mtime` helper from background-memory-update. Minor duplication that could drift.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The primary concern is the per-line subprocess spawning in the while-read loop (HIGH), which reintroduces the exact pattern documented in PF-006. The queue-based architecture itself is a net performance improvement over the old transcript-parsing approach -- it eliminates the `sleep 3` delay, removes expensive transcript grep+tail pipelines, and batches multiple turns. The subprocess-per-line pattern in the turn builder is the one area where the old pattern persists and should be addressed before merge.
