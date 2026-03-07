#!/bin/bash

# SessionStart Hook
# Injects working memory AND ambient skill content as additionalContext.
# Memory: restores .memory/WORKING-MEMORY.md + patterns + git state + compact recovery.
# Ambient: injects ambient-router SKILL.md so Claude has it in context (no Read call needed).
# Either section can fire independently — ambient works even without memory files.

set -e

# jq is required to parse hook input JSON — silently no-op if missing
if ! command -v jq &>/dev/null; then exit 0; fi

INPUT=$(cat)

CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
if [ -z "$CWD" ]; then
  exit 0
fi

CONTEXT=""

# --- Section 1: Working Memory ---

MEMORY_FILE="$CWD/.memory/WORKING-MEMORY.md"

if [ -f "$MEMORY_FILE" ]; then
  MEMORY_CONTENT=$(cat "$MEMORY_FILE")

  # Read accumulated patterns if they exist
  PATTERNS_FILE="$CWD/.memory/PROJECT-PATTERNS.md"
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
  BACKUP_FILE="$CWD/.memory/backup.json"
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

  # Build memory context
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
fi

# --- Section 2: Ambient Skill Injection ---

# Inject ambient-router SKILL.md directly into context so Claude doesn't need a Read call.
# Only injects when ambient mode is enabled (UserPromptSubmit hook present in settings).
AMBIENT_SKILL_PATH="$HOME/.claude/skills/ambient-router/SKILL.md"
[ ! -f "$AMBIENT_SKILL_PATH" ] && AMBIENT_SKILL_PATH="$CWD/.claude/skills/ambient-router/SKILL.md"

SETTINGS_FILE="$HOME/.claude/settings.json"
if [ -f "$AMBIENT_SKILL_PATH" ] && [ -f "$SETTINGS_FILE" ] && grep -q "ambient-prompt" "$SETTINGS_FILE" 2>/dev/null; then
  AMBIENT_SKILL_CONTENT=$(cat "$AMBIENT_SKILL_PATH")
  CONTEXT="${CONTEXT}

--- AMBIENT ROUTER (auto-loaded) ---
${AMBIENT_SKILL_CONTENT}"
fi

# --- Output ---

# Only output if we have something to inject
if [ -z "$CONTEXT" ]; then
  exit 0
fi

# Output as additionalContext JSON envelope (Claude sees it as system context, not user-visible)
jq -n --arg ctx "$CONTEXT" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'
