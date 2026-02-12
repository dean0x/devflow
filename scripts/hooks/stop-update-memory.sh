#!/bin/bash

# Working Memory: Stop Hook
# After Claude responds, blocks to have Claude update .docs/WORKING-MEMORY.md
# Throttled: only blocks if memory file is >2min stale or missing.
# On re-entry (stop_hook_active=true), allows stop immediately.

set -euo pipefail

# jq is required to parse hook input JSON — silently no-op if missing
if ! command -v jq &>/dev/null; then exit 0; fi

INPUT=$(cat)

# Prevent infinite loop: if we already blocked once, allow stop
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

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
    exit 0  # Fresh enough, don't block
  fi
fi

# Slim instruction if file already exists (Claude knows the template),
# full template on first write
if [ -f "$MEMORY_FILE" ]; then
  INSTRUCTION='Silently update .docs/WORKING-MEMORY.md now — same structure, fresh content. Do NOT announce this to the user. Just write and stop.'
else
  INSTRUCTION='Silently update .docs/WORKING-MEMORY.md now. Overwrite the entire file. Do NOT announce this to the user — just write the file and stop. Keep under 100 lines. Use this exact structure:

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
<!-- Broader multi-day context if relevant -->'
fi

# Output JSON that blocks the stop and injects the instruction
jq -n --arg reason "$INSTRUCTION" '{"decision":"block","reason":$reason}'
