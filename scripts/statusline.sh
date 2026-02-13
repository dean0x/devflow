#!/bin/bash

# Claude Code Status Line Script
# Receives JSON input via stdin with session context
# Displays: directory, git branch, diff stats, model, context usage

# Read JSON input
INPUT=$(cat)

# Parse values using jq (with fallbacks if jq is not available or fields are missing)
if command -v jq &> /dev/null; then
    MODEL=$(echo "$INPUT" | jq -r '.model.display_name // .model.id // "claude"' 2>/dev/null)
    CWD=$(echo "$INPUT" | jq -r '.cwd // "~"' 2>/dev/null)

    # Context window info
    CONTEXT_SIZE=$(echo "$INPUT" | jq -r '.context_window.context_window_size // 0' 2>/dev/null)
    USAGE=$(echo "$INPUT" | jq '.context_window.current_usage // null' 2>/dev/null)
else
    MODEL="claude"
    CWD=$(pwd)
    CONTEXT_SIZE=0
    USAGE="null"
fi

# Get current directory name
DIR_NAME=$(basename "$CWD")

# Change to working directory once for all git commands
cd "$CWD" 2>/dev/null || true

# Get git branch if in a git repo
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ -z "$GIT_BRANCH" ]; then
    GIT_INFO=""
    DIFF_STATS=""
else
    # Dirty indicator based on uncommitted changes
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        GIT_INFO="  \033[33m$GIT_BRANCH*\033[0m"
    else
        GIT_INFO="  \033[32m$GIT_BRANCH\033[0m"
    fi

    # Determine base branch and compute branch-level stats
    BASE_BRANCH=""
    git rev-parse --verify main &>/dev/null && BASE_BRANCH="main"
    [ -z "$BASE_BRANCH" ] && git rev-parse --verify master &>/dev/null && BASE_BRANCH="master"

    BRANCH_STATS=""
    if [ -n "$BASE_BRANCH" ] && [ "$GIT_BRANCH" != "$BASE_BRANCH" ]; then
        # Total commits on branch (local + remote, since fork from base)
        TOTAL_COMMITS=$(git rev-list --count "$BASE_BRANCH"..HEAD 2>/dev/null || echo "0")
        [ "$TOTAL_COMMITS" -gt 0 ] 2>/dev/null && BRANCH_STATS=" ${TOTAL_COMMITS}↑"

        # Unpushed commits (local-only, ahead of remote tracking branch)
        UPSTREAM=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)
        if [ -n "$UPSTREAM" ]; then
            UNPUSHED=$(git rev-list --count "$UPSTREAM"..HEAD 2>/dev/null || echo "0")
            [ "$UNPUSHED" -gt 0 ] 2>/dev/null && BRANCH_STATS="$BRANCH_STATS \033[33m${UNPUSHED}⇡\033[0m"
        elif [ "$TOTAL_COMMITS" -gt 0 ] 2>/dev/null; then
            # No upstream at all — everything is unpushed
            BRANCH_STATS="$BRANCH_STATS \033[33m${TOTAL_COMMITS}⇡\033[0m"
        fi

        MERGE_BASE=$(git merge-base "$BASE_BRANCH" HEAD 2>/dev/null)
        DIFF_OUTPUT=$(git diff --shortstat "$MERGE_BASE" 2>/dev/null)
    else
        DIFF_OUTPUT=$(git diff --shortstat HEAD 2>/dev/null)
    fi

    if [ -n "$DIFF_OUTPUT" ]; then
        FILES_CHANGED=$(echo "$DIFF_OUTPUT" | grep -oE '[0-9]+ file' | grep -oE '[0-9]+' || echo "0")
        ADDITIONS=$(echo "$DIFF_OUTPUT" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
        DELETIONS=$(echo "$DIFF_OUTPUT" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")
        [ -z "$FILES_CHANGED" ] && FILES_CHANGED=0
        [ -z "$ADDITIONS" ] && ADDITIONS=0
        [ -z "$DELETIONS" ] && DELETIONS=0
        DIFF_STATS="  ${FILES_CHANGED} \033[32m+$ADDITIONS\033[0m \033[31m-$DELETIONS\033[0m"
    else
        DIFF_STATS=""
    fi
fi

# Build status line with colors (regular, not bold)
STATUS_LINE="\033[34m$DIR_NAME\033[0m$GIT_INFO$BRANCH_STATS$DIFF_STATS"

# Add model name
STATUS_LINE="$STATUS_LINE  \033[36m$MODEL\033[0m"

# Calculate and display context usage
if [ "$USAGE" != "null" ] && [ "$CONTEXT_SIZE" != "0" ] && [ -n "$CONTEXT_SIZE" ]; then
    # Calculate total tokens used (input + cache tokens)
    INPUT_TOKENS=$(echo "$USAGE" | jq -r '.input_tokens // 0' 2>/dev/null)
    CACHE_CREATE=$(echo "$USAGE" | jq -r '.cache_creation_input_tokens // 0' 2>/dev/null)
    CACHE_READ=$(echo "$USAGE" | jq -r '.cache_read_input_tokens // 0' 2>/dev/null)

    # Handle null values
    [ "$INPUT_TOKENS" = "null" ] && INPUT_TOKENS=0
    [ "$CACHE_CREATE" = "null" ] && CACHE_CREATE=0
    [ "$CACHE_READ" = "null" ] && CACHE_READ=0

    CURRENT_TOKENS=$((INPUT_TOKENS + CACHE_CREATE + CACHE_READ))

    if [ "$CURRENT_TOKENS" -gt 0 ]; then
        PERCENT=$((CURRENT_TOKENS * 100 / CONTEXT_SIZE))

        # Color based on usage: green < 50%, yellow 50-80%, red > 80%
        if [ "$PERCENT" -gt 80 ]; then
            # Red - high usage
            STATUS_LINE="$STATUS_LINE  \033[91m${PERCENT}%\033[0m"
        elif [ "$PERCENT" -gt 50 ]; then
            # Yellow - moderate usage
            STATUS_LINE="$STATUS_LINE  \033[33m${PERCENT}%\033[0m"
        else
            # Green - low usage
            STATUS_LINE="$STATUS_LINE  \033[32m${PERCENT}%\033[0m"
        fi
    fi
fi

echo -e "$STATUS_LINE"
