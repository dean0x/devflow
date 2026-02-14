#!/bin/bash

# Claude Code Status Line Script
# Receives JSON input via stdin with session context
# Displays: directory, git branch, diff stats, model, context usage

# Temp file prefix for parallel git ops; cleaned on exit
_T="/tmp/.sl$$"
trap 'rm -f "${_T}c" "${_T}u" "${_T}d" 2>/dev/null' EXIT

# Read JSON input
INPUT=$(cat)

# Parse all values in a single jq call (4 forks → 1)
if command -v jq &> /dev/null; then
    eval "$(echo "$INPUT" | jq -r '
        @sh "MODEL=\(.model.display_name // .model.id // "claude")",
        @sh "CWD=\(.cwd // "~")",
        @sh "CONTEXT_SIZE=\(.context_window.context_window_size // 0)",
        @sh "USAGE=\(.context_window.current_usage // null | tojson)"
    ' 2>/dev/null)"
else
    MODEL="claude"
    CWD=$(pwd)
    CONTEXT_SIZE=0
    USAGE="null"
fi

DIR_NAME=$(basename "$CWD")
cd "$CWD" 2>/dev/null || true

# Single git call for branch name + dirty state (2 git commands → 1)
GIT_STATUS=$(git status --porcelain -b 2>/dev/null)
GIT_BRANCH=$(echo "$GIT_STATUS" | head -1 | sed 's/^## //' | sed 's/\.\.\..*//')

# Handle detached HEAD, empty repo, initial commit
case "$GIT_BRANCH" in
    ""|"HEAD (no branch)"*|*"No commits yet"*|*"Initial commit"*)
        GIT_BRANCH="" ;;
esac

if [ -z "$GIT_BRANCH" ]; then
    GIT_INFO=""
    DIFF_STATS=""
else
    # Dirty: any output lines beyond the status header
    if [ "$(echo "$GIT_STATUS" | wc -l)" -gt 1 ]; then
        GIT_INFO="  \033[33m$GIT_BRANCH*\033[0m"
    else
        GIT_INFO="  \033[32m$GIT_BRANCH\033[0m"
    fi

    # Detect base branch
    BASE_BRANCH=""
    git rev-parse --verify main &>/dev/null && BASE_BRANCH="main"
    [ -z "$BASE_BRANCH" ] && git rev-parse --verify master &>/dev/null && BASE_BRANCH="master"

    BRANCH_STATS=""
    DIFF_STATS=""
    if [ -n "$BASE_BRANCH" ] && [ "$GIT_BRANCH" != "$BASE_BRANCH" ]; then
        # Three independent git ops in parallel (3 sequential → 1 wall-clock)
        # Triple-dot syntax does merge-base internally, eliminating separate call
        git rev-list --count "$BASE_BRANCH"..HEAD 2>/dev/null > "${_T}c" &
        git rev-list --count '@{upstream}'..HEAD 2>/dev/null > "${_T}u" &
        git diff --shortstat "$BASE_BRANCH"...HEAD 2>/dev/null > "${_T}d" &
        wait

        TOTAL_COMMITS=$(cat "${_T}c" 2>/dev/null || echo "0")
        UNPUSHED=$(cat "${_T}u" 2>/dev/null)
        DIFF_OUTPUT=$(cat "${_T}d" 2>/dev/null)
        rm -f "${_T}c" "${_T}u" "${_T}d"

        [ "$TOTAL_COMMITS" -gt 0 ] 2>/dev/null && BRANCH_STATS=" ${TOTAL_COMMITS}↑"

        if [ -n "$UNPUSHED" ] && [ "$UNPUSHED" -gt 0 ] 2>/dev/null; then
            BRANCH_STATS="$BRANCH_STATS \033[33m${UNPUSHED}⇡\033[0m"
        elif [ -z "$UNPUSHED" ] && [ "$TOTAL_COMMITS" -gt 0 ] 2>/dev/null; then
            # No upstream at all — everything is unpushed
            BRANCH_STATS="$BRANCH_STATS \033[33m${TOTAL_COMMITS}⇡\033[0m"
        fi
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
    fi
fi

# Build status line
STATUS_LINE="\033[34m$DIR_NAME\033[0m$GIT_INFO$BRANCH_STATS$DIFF_STATS"
STATUS_LINE="$STATUS_LINE  \033[36m$MODEL\033[0m"

# Context usage (single jq call instead of 3)
if [ "$USAGE" != "null" ] && [ "$CONTEXT_SIZE" != "0" ] && [ -n "$CONTEXT_SIZE" ]; then
    eval "$(echo "$USAGE" | jq -r '
        @sh "INPUT_TOKENS=\(.input_tokens // 0)",
        @sh "CACHE_CREATE=\(.cache_creation_input_tokens // 0)",
        @sh "CACHE_READ=\(.cache_read_input_tokens // 0)"
    ' 2>/dev/null)"

    CURRENT_TOKENS=$((INPUT_TOKENS + CACHE_CREATE + CACHE_READ))

    if [ "$CURRENT_TOKENS" -gt 0 ]; then
        PERCENT=$((CURRENT_TOKENS * 100 / CONTEXT_SIZE))

        if [ "$PERCENT" -gt 80 ]; then
            STATUS_LINE="$STATUS_LINE  \033[91m${PERCENT}%\033[0m"
        elif [ "$PERCENT" -gt 50 ]; then
            STATUS_LINE="$STATUS_LINE  \033[33m${PERCENT}%\033[0m"
        else
            STATUS_LINE="$STATUS_LINE  \033[32m${PERCENT}%\033[0m"
        fi
    fi
fi

echo -e "$STATUS_LINE"
