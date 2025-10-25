#!/bin/bash

# Claude Code Status Line Script
# Receives JSON input via stdin with session context

# Read JSON input
INPUT=$(cat)

# Parse values using jq (with fallbacks if jq is not available or fields are missing)
if command -v jq &> /dev/null; then
    MODEL=$(echo "$INPUT" | jq -r '.model.display_name // .model.id // "claude"' 2>/dev/null)
    CWD=$(echo "$INPUT" | jq -r '.cwd // "~"' 2>/dev/null)
    EXCEEDS_200K=$(echo "$INPUT" | jq -r '.exceeds_200k_tokens // false' 2>/dev/null)
else
    MODEL="claude"
    CWD=$(pwd)
    EXCEEDS_200K="false"
fi

# Get current directory name
DIR_NAME=$(basename "$CWD")

# Get git branch if in a git repo
GIT_BRANCH=$(cd "$CWD" 2>/dev/null && git branch --show-current 2>/dev/null || echo "")
if [ -z "$GIT_BRANCH" ]; then
    GIT_INFO=""
else
    # Check if there are uncommitted changes
    if [ -n "$(cd "$CWD" 2>/dev/null && git status --porcelain 2>/dev/null)" ]; then
        GIT_INFO="  \033[1;33m$GIT_BRANCH*\033[0m"
    else
        GIT_INFO="  \033[1;32m$GIT_BRANCH\033[0m"
    fi
fi

# Build status line with colors
STATUS_LINE="\033[1;34m$DIR_NAME\033[0m$GIT_INFO"

# Add model name
STATUS_LINE="$STATUS_LINE  \033[1;36m$MODEL\033[0m"

# Add large context warning if needed
if [ "$EXCEEDS_200K" = "true" ]; then
    STATUS_LINE="$STATUS_LINE  \033[1;91m⚠️large\033[0m"
fi

echo -e "$STATUS_LINE"