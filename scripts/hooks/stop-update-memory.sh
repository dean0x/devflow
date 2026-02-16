#!/bin/bash

# Working Memory: Stop Hook
# Spawns a background process to update .docs/WORKING-MEMORY.md asynchronously.
# The session ends immediately — no visible edit in the TUI.
# On failure: does nothing (stale memory is better than fake data).

set -euo pipefail

# jq is required to parse hook input JSON — silently no-op if missing
if ! command -v jq &>/dev/null; then exit 0; fi

INPUT=$(cat)

# Only activate in projects with .docs/ directory (DevFlow-initialized projects)
CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
if [ -z "$CWD" ] || [ ! -d "$CWD/.docs" ]; then
  exit 0
fi

# Throttle: skip if WORKING-MEMORY.md was updated within the last 2 minutes
MEMORY_FILE="$CWD/.docs/WORKING-MEMORY.md"
if [ -f "$MEMORY_FILE" ]; then
  if stat --version &>/dev/null 2>&1; then
    FILE_MTIME=$(stat -c %Y "$MEMORY_FILE")
  else
    FILE_MTIME=$(stat -f %m "$MEMORY_FILE")
  fi
  NOW=$(date +%s)
  AGE=$(( NOW - FILE_MTIME ))
  if [ "$AGE" -lt 120 ]; then
    exit 0  # Fresh enough, skip update
  fi
fi

# Resolve claude binary — if not found, skip (graceful degradation)
CLAUDE_BIN=$(command -v claude 2>/dev/null || true)
if [ -z "$CLAUDE_BIN" ]; then
  exit 0
fi

# Extract session ID from hook input
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null)
if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Resolve the background updater script (same directory as this hook)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPDATER="$SCRIPT_DIR/background-memory-update.sh"
if [ ! -x "$UPDATER" ]; then
  exit 0
fi

# Spawn background updater — detached, no effect on session exit
nohup "$UPDATER" "$CWD" "$SESSION_ID" "$MEMORY_FILE" "$CLAUDE_BIN" \
  </dev/null >/dev/null 2>&1 &
disown

# Allow stop immediately (no JSON output = proceed)
exit 0
