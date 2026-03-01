#!/bin/bash

# Working Memory: SessionStart Hook
# Reads .docs/WORKING-MEMORY.md and injects it as additionalContext for the new session.
# Also captures fresh git state so Claude knows what's changed since the memory was written.
# Adds staleness warning if memory is >1 hour old.

set -euo pipefail

# jq is required to parse hook input JSON — silently no-op if missing
if ! command -v jq &>/dev/null; then exit 0; fi

INPUT=$(cat)

CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
if [ -z "$CWD" ]; then
  exit 0
fi

# Only activate in DevFlow-initialized projects
if [ ! -d "$CWD/.docs" ]; then
  exit 0
fi

MEMORY_FILE="$CWD/.docs/WORKING-MEMORY.md"

# No memory file = nothing to restore (fresh project or first session)
if [ ! -f "$MEMORY_FILE" ]; then
  exit 0
fi

MEMORY_CONTENT=$(cat "$MEMORY_FILE")

# Read accumulated patterns if they exist
PATTERNS_FILE="$CWD/.docs/patterns.md"
PATTERNS_CONTENT=""
if [ -f "$PATTERNS_FILE" ]; then
  PATTERNS_CONTENT=$(cat "$PATTERNS_FILE")
fi

# Compute staleness warning
if stat --version &>/dev/null 2>&1; then
  FILE_MTIME=$(stat -c %Y "$MEMORY_FILE")
else
  FILE_MTIME=$(stat -f %m "$MEMORY_FILE")
fi
NOW=$(date +%s)
AGE=$(( NOW - FILE_MTIME ))

# Check for pre-compact memory snapshot (compaction recovery)
BACKUP_FILE="$CWD/.docs/working-memory-backup.json"
COMPACT_NOTE=""
if [ -f "$BACKUP_FILE" ]; then
  BACKUP_MEMORY=$(jq -r '.memory_snapshot // ""' "$BACKUP_FILE" 2>/dev/null)
  if [ -n "$BACKUP_MEMORY" ]; then
    BACKUP_TS=$(jq -r '.timestamp // ""' "$BACKUP_FILE" 2>/dev/null)
    BACKUP_EPOCH=0
    if [ -n "$BACKUP_TS" ]; then
      BACKUP_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$BACKUP_TS" +%s 2>/dev/null \
        || date -d "$BACKUP_TS" +%s 2>/dev/null \
        || echo "0")
    fi
    if [ "$BACKUP_EPOCH" -gt "$FILE_MTIME" ]; then
      COMPACT_NOTE="
--- PRE-COMPACT SNAPSHOT ($BACKUP_TS) ---
Context was compacted. This snapshot may contain decisions or progress not yet in working memory.

$BACKUP_MEMORY
"
    fi
  fi
fi

STALE_WARNING=""
if [ "$AGE" -gt 3600 ]; then
  HOURS=$(( AGE / 3600 ))
  STALE_WARNING="⚠ This working memory is ${HOURS}h old. Verify before relying on it.

"
fi

# Capture fresh git state
GIT_BRANCH=""
GIT_STATUS=""
GIT_LOG=""

if cd "$CWD" 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
  GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
  GIT_STATUS=$(git status --porcelain 2>/dev/null | head -20)
  GIT_LOG=$(git log --oneline -5 2>/dev/null || echo "")
fi

# Build context string
CONTEXT="${STALE_WARNING}--- WORKING MEMORY (from previous session) ---

${MEMORY_CONTENT}"

# Insert accumulated patterns between working memory and git state
if [ -n "$PATTERNS_CONTENT" ]; then
  CONTEXT="${CONTEXT}

--- PROJECT PATTERNS (accumulated) ---

${PATTERNS_CONTENT}"
fi

CONTEXT="${CONTEXT}

--- CURRENT GIT STATE ---
Branch: ${GIT_BRANCH}
Recent commits:
${GIT_LOG}"

if [ -n "$GIT_STATUS" ]; then
  CONTEXT="${CONTEXT}
Uncommitted changes:
${GIT_STATUS}"
fi

if [ -n "$COMPACT_NOTE" ]; then
  CONTEXT="${CONTEXT}
${COMPACT_NOTE}"
fi

# Output as additionalContext JSON envelope (Claude sees it as system context, not user-visible)
jq -n --arg ctx "$CONTEXT" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'
