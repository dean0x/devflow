#!/bin/bash

# Ambient Mode: UserPromptSubmit Hook
# Injects a classification preamble before every user prompt so Claude applies
# proportional quality enforcement via the ambient-router skill.
# Zero file I/O beyond stdin — static injection only.

set -euo pipefail

# jq is required to parse hook input JSON — silently no-op if missing
if ! command -v jq &>/dev/null; then exit 0; fi

INPUT=$(cat)

CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
if [ -z "$CWD" ]; then
  exit 0
fi

PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null)

# Skip slash commands — they have their own orchestration
if [[ "$PROMPT" == /* ]]; then
  exit 0
fi

# Skip short confirmations (< 3 words)
WORD_COUNT=$(echo "$PROMPT" | wc -w | tr -d ' ')
if [ "$WORD_COUNT" -lt 3 ]; then
  exit 0
fi

# Inject classification preamble
PREAMBLE="AMBIENT MODE ACTIVE: Before responding, silently classify this prompt:
Intent: BUILD | DEBUG | REVIEW | PLAN | EXPLORE | CHAT
Depth: QUICK (no overhead) | STANDARD (load skills) | ESCALATE (suggest /command)

If STANDARD+: Read the ambient-router skill for classification details and skill selection matrix. For BUILD tasks, also load test-driven-development skill and enforce RED-GREEN-REFACTOR.

If QUICK: Respond normally without stating classification.
Only state classification aloud for STANDARD/ESCALATE."

jq -n --arg ctx "$PREAMBLE" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'
