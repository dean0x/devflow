# Reliability Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: sidecar-capture, sidecar-dispatch, sidecar-evaluate, sidecar-config.ts

## Issues in Your Changes (BLOCKING)

### HIGH

**Unsanitized `LAST_REFRESH` value used in arithmetic** - `sidecar-evaluate:376`
**Confidence**: 95%
- Problem: `LAST_REFRESH` is read from `.features/.knowledge-last-refresh` via `cat` without sanitization. If this file contains non-numeric content (corrupted write, partial flush, or trailing newline with whitespace), the arithmetic expression `AGE=$(( NOW - LAST_REFRESH ))` will fail under `set -e` and kill the entire hook, preventing learning and decisions evaluation that already succeeded from persisting their markers.
- Fix: Sanitize through `tr -dc '0-9'` with a fallback, matching the pattern already used for `MAX_DAILY`, `BATCH_SIZE`, and `MAX_DEC_RUNS`:
```bash
LAST_REFRESH=$(cat "$KNOWLEDGE_MARKER" 2>/dev/null | tr -dc '0-9' || true)
LAST_REFRESH="${LAST_REFRESH:-0}"
```

**Entire `learning-log.jsonl` captured into shell variable during reinforcement** - `sidecar-evaluate:144`
**Confidence**: 85%
- Problem: `UPDATED=$(jq -c ... "$LEARNING_LOG")` reads the entire learning log into a shell variable. The log has no growth bound and grows by one line per observation per session. After hundreds of sessions, this variable could hold megabytes of data, then gets piped again through `echo "$UPDATED" | grep` and `echo "$UPDATED" | jq -c`. Each pipe duplicates the data. The node fallback (line 165) uses `readFileSync` into memory too, but at least does the write in one pass. Under the jq path, a sufficiently large log will cause shell argument-length limits to be exceeded (`ARG_MAX`, typically 256KB-2MB).
- Fix: Use a temp file instead of a shell variable for the jq path:
```bash
TEMP_LOG="${LEARNING_LOG}.tmp"
rm -f "$TEMP_LOG" 2>/dev/null || true
jq -c --arg now "$NOW_ISO" --arg slugs "$SLUGS_PATTERN" '...' "$LEARNING_LOG" > "$TEMP_LOG" 2>/dev/null
if grep -qF '"_reinforced":true' "$TEMP_LOG" 2>/dev/null; then
  jq -c 'del(._reinforced)' "$TEMP_LOG" > "${TEMP_LOG}.2" && mv "${TEMP_LOG}.2" "$LEARNING_LOG"
  log "Reinforced artifacts for slugs: $SLUGS_PATTERN"
fi
rm -f "$TEMP_LOG" "${TEMP_LOG}.2" 2>/dev/null || true
```

**`.failed` marker files accumulate indefinitely** - `sidecar-dispatch:111`
**Confidence**: 90%
- Problem: When a `.processing` file exceeds `MAX_RETRIES` (3) stale recoveries, it is renamed to `.failed` (line 111). No code path in any sidecar hook, the sidecar skill, or the CLI ever cleans up `.failed` files. Over time, these accumulate in `.memory/.sidecar/`. While each is small, they represent permanently orphaned state with no visibility or cleanup mechanism. More critically, if a transient issue caused the failure (e.g., network timeout during knowledge refresh), the task is permanently abandoned with no path to retry.
- Fix: Add a cleanup sweep for `.failed` files older than 7 days in the stale-retry section of sidecar-dispatch:
```bash
# Cleanup .failed files older than 7 days
if compgen -G "$SIDECAR_DIR/*.failed" > /dev/null 2>&1; then
  FAILED_COUNT=0
  for FAILED_FILE in "$SIDECAR_DIR"/*.failed; do
    [ -f "$FAILED_FILE" ] || continue
    FAILED_COUNT=$(( FAILED_COUNT + 1 ))
    [ "$FAILED_COUNT" -gt 10 ] && break
    FAILED_MTIME=$(get_mtime "$FAILED_FILE")
    FAILED_MTIME="${FAILED_MTIME:-0}"
    FAILED_AGE=$(( NOW - FAILED_MTIME ))
    if [ "$FAILED_AGE" -gt 604800 ]; then
      rm -f "$FAILED_FILE" 2>/dev/null || true
    fi
  done
fi
```

### MEDIUM

**No log file rotation** - `sidecar-capture:87`, `sidecar-evaluate:44`
**Confidence**: 85%
- Problem: The `log()` function in sidecar-capture appends to `~/.devflow/logs/{slug}/.working-memory-update.log` on every assistant turn. The `log()` in sidecar-evaluate appends to `.sidecar-evaluate.log` on every session end. Neither log file has rotation or size bounds. These hooks fire on every Claude Code interaction, so over months the log files will grow unbounded. While the logs are stored in `~/.devflow/logs/` (not in the project), they still consume disk indefinitely.
- Fix: Add a simple size check before logging. If the log exceeds a threshold (e.g., 1MB), truncate to the last 500 lines:
```bash
log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [sidecar-capture] $1" >> "$LOG_FILE"
  # Rotate if >1MB
  if [ -f "$LOG_FILE" ]; then
    local size
    size=$(wc -c < "$LOG_FILE" 2>/dev/null | tr -d ' ')
    if [ "${size:-0}" -gt 1048576 ]; then
      tail -500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
    fi
  fi
}
```
Note: the size check on every log call adds overhead. An alternative is to check only once per hook invocation by adding a one-time rotation check after the `LOG_FILE` assignment.

**Non-atomic marker writes can produce corrupt JSON on kill** - `sidecar-capture:150`, `sidecar-evaluate:267,332,390`
**Confidence**: 82%
- Problem: Marker files (memory.json, learning.json, decisions.json, knowledge.json) are written directly to their final path via `> "$SIDECAR_DIR/{type}.json"`. If the process is killed (SIGKILL, OOM, or system crash) mid-write, the file will contain partial/corrupt JSON. The next sidecar-dispatch will try to `jq` this corrupt file for the timestamp expiry check (line 143), which will fail silently (the `|| true` handles it), but the marker will then be collected into `PENDING_TASKS` with corrupt content. The sidecar skill will then rename it to `.processing` and the background agent will read corrupt JSON.
- Fix: Use tmp+rename pattern for marker writes:
```bash
jq -n ... > "$SIDECAR_DIR/memory.json.tmp" && mv "$SIDECAR_DIR/memory.json.tmp" "$SIDECAR_DIR/memory.json"
```

**`learning-log.jsonl` and `decisions-log.jsonl` have no growth bounds** - `sidecar-evaluate:263,329`
**Confidence**: 80%
- Problem: The `load_existing_ids` function reads the entire JSONL log file to extract observation IDs. The learning-log and decisions-log files grow by one or more lines per batch/session and are never truncated or archived. The `load_existing_ids` function's jq path (`jq -c '.id // empty' | jq -s '.'`) streams line-by-line then collects, which is memory-efficient for jq, but the node fallback reads the entire file with `readFileSync` then parses every line. Over years of use, these files could grow to thousands of lines. Additionally, the resulting JSON array of all IDs is passed as a command-line argument to `jq -n --argjson existingObservationIds "$EXISTING_IDS"` (line 269), which is subject to `ARG_MAX` limits.
- Fix: Consider capping the ID list to the most recent N observations (e.g., 200), since deduplication only matters against recent observations:
```bash
load_existing_ids() {
  local log_file="$1"
  if [ ! -f "$log_file" ]; then echo "[]"; return; fi
  if [ "$_HAS_JQ" = "true" ]; then
    tail -200 "$log_file" | jq -c '.id // empty' 2>/dev/null | jq -s '.' 2>/dev/null || echo "[]"
  else
    # Similar bound for node path
  fi
}
```

**`.learning-sessions` file can grow unbounded if session-end fires repeatedly without batch threshold** - `sidecar-evaluate:245`
**Confidence**: 80%
- Problem: Each deep session appends a session ID to `.learning-sessions`. This file is only cleared when the batch threshold is met and the learning marker is successfully written (line 287). If user signals are consistently empty (e.g., user only runs slash commands), or the transcript filter fails, the batch threshold will be met but no marker written, and the file will never be cleared. The `CURRENT_COUNT` is read via `wc -l` but the file grows by one line per deep session. Over many sessions with empty user signals, this file grows indefinitely.
- Fix: Add a cap on `.learning-sessions` to prevent unbounded growth. If it exceeds a limit (e.g., 50 lines), keep only the most recent entries:
```bash
if [ -f "$SESSION_COUNT_FILE" ]; then
  CURRENT_COUNT=$(wc -l < "$SESSION_COUNT_FILE" | tr -d ' ')
  if [ "$CURRENT_COUNT" -gt 50 ]; then
    tail -"$BATCH_SIZE" "$SESSION_COUNT_FILE" > "$SESSION_COUNT_FILE.tmp" && mv "$SESSION_COUNT_FILE.tmp" "$SESSION_COUNT_FILE"
    CURRENT_COUNT=$(wc -l < "$SESSION_COUNT_FILE" | tr -d ' ')
  fi
fi
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`get_mtime` returns empty string on missing/unreadable file, causing arithmetic failure** - `sidecar-capture:137`, `sidecar-dispatch:95`
**Confidence**: 85%
- Problem: In `get-mtime`, if `stat` fails (file was deleted between the `-f` check and `stat` call — a TOCTOU race), it returns empty string via `2>/dev/null`. In sidecar-capture line 137, this is assigned to `LAST_UPDATE` without a fallback. The subsequent `AGE=$(( NOW - LAST_UPDATE ))` would fail under `set -e` because arithmetic expansion with an empty variable evaluates to `$(( NOW - ))` which is a syntax error. The sidecar-dispatch stale-retry loop (line 96) does apply a fallback `PROC_MTIME="${PROC_MTIME:-0}"` correctly, but sidecar-capture does not.
- Fix: Add fallback in sidecar-capture after `get_mtime`:
```bash
if [ -f "$WORKING_MEMORY" ]; then
  LAST_UPDATE=$(get_mtime "$WORKING_MEMORY")
  LAST_UPDATE="${LAST_UPDATE:-0}"
fi
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`ls -t *.jsonl` glob expansion in transcript discovery** - `sidecar-evaluate:60`
**Confidence**: 80%
- Problem: The fallback transcript discovery uses `ls -t "$PROJECTS_DIR"/*.jsonl`. If the projects directory contains a very large number of JSONL files (e.g., hundreds of long-running sessions), the glob expansion and sort-by-time happens in memory. This is not introduced by this branch (it mirrors the existing pattern in other hooks), but it runs on every session end.

## Suggestions (Lower Confidence)

- **No signal trap for temp file cleanup** - `sidecar-evaluate:142` (Confidence: 65%) -- The artifact reinforcement section creates `${LEARNING_LOG}.tmp` but has no `trap` to clean it up on SIGTERM/SIGINT. The `rm -f "$TEMP_LOG"` on line 163 only runs on the happy path and when the `grep` check fails, but not if the process is killed between lines 144-162.

- **`writeConfig` in sidecar-config.ts is not atomic** - `sidecar-config.ts:51` (Confidence: 70%) -- `fs.writeFile` is not atomic. If the process crashes mid-write, `config.json` could be left in a corrupt state. The D1 JSDoc comment acknowledges the non-atomic read-modify-write, but the corruption risk during the write itself is a separate concern. A tmp+rename pattern (`writeFile` to `.tmp`, then `rename`) would protect against partial writes. The impact is low because the shell hooks fall back to defaults when config is unreadable.

- **Marker collection loop in sidecar-dispatch has no upper bound** - `sidecar-dispatch:129` (Confidence: 60%) -- The `for MARKER_FILE in "$SIDECAR_DIR"/*.json` loop has no explicit cap (unlike the `.processing` loop which caps at 10). In practice, only 4 marker types exist (memory, learning, decisions, knowledge), so the loop is naturally bounded. But if a bug or external process creates many `.json` files in the sidecar dir, the loop would process all of them.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 4 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Reliability Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The sidecar system demonstrates strong reliability patterns overall: bounded loops on `.processing` files, input sanitization on config values, throttling/daily caps, deduplication, crash recovery via stale-retry with max-retry escalation to `.failed`, and queue overflow protection on `.pending-turns.jsonl`. The architecture of marker files as a coordination mechanism between hooks and the main session is sound and naturally crash-recoverable.

The main reliability gaps are: (1) unsanitized `LAST_REFRESH` that can kill the entire evaluate hook under `set -e`; (2) shell variable capture of unbounded file content during artifact reinforcement; and (3) missing cleanup for `.failed` files and log files. None of these are data-loss risks, but they represent slow degradation paths (disk accumulation) and a latent crash bug (the arithmetic failure). The non-atomic marker writes are a theoretical concern given the short write window and the crash-recovery mechanism already in place. Applies ADR-001 (no migration concerns in this review). Avoids PF-001 (no backward-compat code needed for new hooks).
