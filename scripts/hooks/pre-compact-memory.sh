#!/bin/bash

# Working Memory: PreCompact Hook
# Safety net that captures git state to a backup JSON file before context compaction.
# Also bootstraps a minimal WORKING-MEMORY.md if none exists yet, so SessionStart
# has something to inject after compaction.
# PreCompact hooks cannot block compaction — this is informational only.

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

BACKUP_FILE="$CWD/.docs/working-memory-backup.json"

# Capture git state
GIT_BRANCH=""
GIT_STATUS=""
GIT_LOG=""
GIT_DIFF_STAT=""
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if cd "$CWD" 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1; then
  GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
  GIT_STATUS=$(git status --porcelain 2>/dev/null | head -30 || echo "")
  GIT_LOG=$(git log --oneline -10 2>/dev/null || echo "")
  GIT_DIFF_STAT=$(git diff --stat HEAD 2>/dev/null || echo "")
fi

# Snapshot current WORKING-MEMORY.md (preserves session context through compaction)
MEMORY_SNAPSHOT=""
if [ -f "$CWD/.docs/WORKING-MEMORY.md" ]; then
  MEMORY_SNAPSHOT=$(cat "$CWD/.docs/WORKING-MEMORY.md")
fi

# Write backup JSON
jq -n \
  --arg ts "$TIMESTAMP" \
  --arg branch "$GIT_BRANCH" \
  --arg status "$GIT_STATUS" \
  --arg log "$GIT_LOG" \
  --arg diff "$GIT_DIFF_STAT" \
  --arg memory "$MEMORY_SNAPSHOT" \
  '{
    timestamp: $ts,
    trigger: "pre-compact",
    memory_snapshot: $memory,
    git: {
      branch: $branch,
      status: $status,
      log: $log,
      diff_stat: $diff
    }
  }' > "$BACKUP_FILE"

# Bootstrap minimal WORKING-MEMORY.md if none exists yet
# This ensures SessionStart has context to inject after compaction
MEMORY_FILE="$CWD/.docs/WORKING-MEMORY.md"
if [ ! -f "$MEMORY_FILE" ] && [ -n "$GIT_BRANCH" ]; then
  {
    echo "# Working Memory"
    echo ""
    echo "## Now"
    echo "- Session compacted before working memory was established"
    echo ""
    echo "## Context"
    echo "- Branch: $GIT_BRANCH"
    echo "$GIT_LOG" | head -3 | while IFS= read -r line; do
      [ -n "$line" ] && echo "- $line"
    done
    echo ""
    echo "## Modified Files"
    echo "$GIT_STATUS" | head -10 | while IFS= read -r line; do
      [ -n "$line" ] && echo "- $(echo "$line" | awk '{print $2}')"
    done
  } > "$MEMORY_FILE"
fi
