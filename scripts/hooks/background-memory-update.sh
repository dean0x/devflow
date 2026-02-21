#!/bin/bash

# Background Working Memory Updater
# Called by stop-update-memory.sh as a detached background process.
# Resumes the parent session headlessly to update .docs/WORKING-MEMORY.md.
# On failure: logs error, does nothing (no fallback).

set -euo pipefail

CWD="$1"
SESSION_ID="$2"
MEMORY_FILE="$3"
CLAUDE_BIN="$4"

LOG_FILE="$CWD/.docs/.working-memory-update.log"
LOCK_DIR="$CWD/.docs/.working-memory.lock"

# --- Logging ---

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1" >> "$LOG_FILE"
}

rotate_log() {
  if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 100 ]; then
    tail -50 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
}

# --- Stale Lock Recovery ---

# Portable mtime in epoch seconds (same pattern as stop-update-memory.sh:35-39)
get_mtime() {
  if stat --version &>/dev/null 2>&1; then
    stat -c %Y "$1"
  else
    stat -f %m "$1"
  fi
}

STALE_THRESHOLD=300  # 5 min — generous vs 30-60s normal runtime

break_stale_lock() {
  if [ ! -d "$LOCK_DIR" ]; then return; fi
  local lock_mtime now age
  lock_mtime=$(get_mtime "$LOCK_DIR")
  now=$(date +%s)
  age=$(( now - lock_mtime ))
  if [ "$age" -gt "$STALE_THRESHOLD" ]; then
    log "Breaking stale lock (age: ${age}s, threshold: ${STALE_THRESHOLD}s)"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

# --- Locking (mkdir-based, POSIX-atomic) ---

acquire_lock() {
  local timeout=90
  local waited=0
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    if [ "$waited" -ge "$timeout" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 0
}

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# --- Main ---

# Wait for parent session to flush transcript.
# 3s provides ~6-10x margin over typical flush times.
# If --resume shows stale transcripts, bump to 5s.
sleep 3

log "Starting update for session $SESSION_ID"

# Break stale locks from previous zombie processes
break_stale_lock

# Acquire lock (other sessions may be updating concurrently)
if ! acquire_lock; then
  log "Lock timeout after 90s — skipping update for session $SESSION_ID"
  # Don't clean up lock we don't own
  trap - EXIT
  exit 0
fi

rotate_log

# Read existing memory for merge context
EXISTING_MEMORY=""
if [ -f "$MEMORY_FILE" ]; then
  EXISTING_MEMORY=$(cat "$MEMORY_FILE")
fi

# Build instruction
if [ -n "$EXISTING_MEMORY" ]; then
  INSTRUCTION="Update the file $MEMORY_FILE with working memory from this session. The file already has content — possibly from a concurrent session that just wrote it moments ago. Merge this session's context with the existing content to produce a single unified working memory snapshot. Both this session and the existing content represent fresh, concurrent work — integrate both fully. Working memory captures what's active now, not a changelog. Deduplicate overlapping information. Keep under 100 lines total. Use the same structure: ## Now, ## Decisions, ## Modified Files, ## Context, ## Session Log.

Existing content:
$EXISTING_MEMORY"
else
  INSTRUCTION="Create the file $MEMORY_FILE with working memory from this session. Keep under 100 lines. Use this structure:

# Working Memory

## Now
<!-- Current focus, status, blockers (1-3 bullets) -->

## Decisions
<!-- Key decisions made this session with brief rationale -->

## Modified Files
<!-- File paths only, most recent first -->

## Context
<!-- Branch, PR, architectural context, open questions -->

## Session Log

### Today
<!-- Chronological summary of work done today (2-5 bullets) -->

### This Week
<!-- Broader multi-day context if relevant -->"
fi

# Resume session headlessly to perform the update
TIMEOUT=120  # Normal runtime 30-60s; 2x margin

DEVFLOW_BG_UPDATER=1 env -u CLAUDECODE "$CLAUDE_BIN" -p \
  --resume "$SESSION_ID" \
  --model haiku \
  --dangerously-skip-permissions \
  --no-session-persistence \
  --output-format text \
  "$INSTRUCTION" \
  > /dev/null 2>> "$LOG_FILE" &
CLAUDE_PID=$!

# Watchdog: kill claude if it exceeds timeout
( sleep "$TIMEOUT" && kill "$CLAUDE_PID" 2>/dev/null ) &
WATCHDOG_PID=$!

if wait "$CLAUDE_PID" 2>/dev/null; then
  log "Update completed for session $SESSION_ID"
else
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -gt 128 ]; then
    log "Update timed out (killed after ${TIMEOUT}s) for session $SESSION_ID"
  else
    log "Update failed for session $SESSION_ID (exit code $EXIT_CODE)"
  fi
fi

# Clean up watchdog
kill "$WATCHDOG_PID" 2>/dev/null || true
wait "$WATCHDOG_PID" 2>/dev/null || true

exit 0
