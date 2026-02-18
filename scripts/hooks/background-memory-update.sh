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
if DEVFLOW_BG_UPDATER=1 env -u CLAUDECODE "$CLAUDE_BIN" -p \
  --resume "$SESSION_ID" \
  --model haiku \
  --dangerously-skip-permissions \
  --no-session-persistence \
  --output-format text \
  "$INSTRUCTION" \
  > /dev/null 2>> "$LOG_FILE"; then
  log "Update completed for session $SESSION_ID"
else
  log "Update failed for session $SESSION_ID (exit code $?)"
fi

exit 0
