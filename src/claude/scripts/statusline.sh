#!/bin/bash

# Claude Code Status Line Script
# Receives JSON input via stdin with session context

# Read JSON input
INPUT=$(cat)

# Parse values using jq (with fallbacks if jq is not available or fields are missing)
if command -v jq &> /dev/null; then
    MODEL=$(echo "$INPUT" | jq -r '.model.display_name // .model.id // "claude"' 2>/dev/null)
    CWD=$(echo "$INPUT" | jq -r '.cwd // "~"' 2>/dev/null)
    TOTAL_COST=$(echo "$INPUT" | jq -r '.cost.total_cost_usd // 0' 2>/dev/null)
    LINES_ADDED=$(echo "$INPUT" | jq -r '.cost.total_lines_added // 0' 2>/dev/null)
    LINES_REMOVED=$(echo "$INPUT" | jq -r '.cost.total_lines_removed // 0' 2>/dev/null)
    TOTAL_DURATION_MS=$(echo "$INPUT" | jq -r '.cost.total_duration_ms // 0' 2>/dev/null)
    API_DURATION_MS=$(echo "$INPUT" | jq -r '.cost.total_api_duration_ms // 0' 2>/dev/null)
    EXCEEDS_200K=$(echo "$INPUT" | jq -r '.exceeds_200k_tokens // false' 2>/dev/null)
    VERSION=$(echo "$INPUT" | jq -r '.version // ""' 2>/dev/null)
    OUTPUT_STYLE=$(echo "$INPUT" | jq -r '.output_style.name // ""' 2>/dev/null)
else
    MODEL="claude"
    CWD=$(pwd)
    TOTAL_COST="0.00"
    LINES_ADDED="0"
    LINES_REMOVED="0"
    TOTAL_DURATION_MS="0"
    API_DURATION_MS="0"
    EXCEEDS_200K="false"
    VERSION=""
    OUTPUT_STYLE=""
fi

# Get current directory name
DIR_NAME=$(basename "$CWD")

# Get git branch and last commit if in a git repo
GIT_BRANCH=$(cd "$CWD" 2>/dev/null && git branch --show-current 2>/dev/null || echo "")
if [ -z "$GIT_BRANCH" ]; then
    GIT_INFO=""
else
    # Get last commit message (first line, truncated to 50 chars)
    LAST_COMMIT_MSG=$(cd "$CWD" 2>/dev/null && git log -1 --pretty=format:"%s" 2>/dev/null | cut -c1-50 || echo "")

    # Check if there are uncommitted changes
    if [ -n "$(cd "$CWD" 2>/dev/null && git status --porcelain 2>/dev/null)" ]; then
        GIT_INFO=" / \033[1;33m$GIT_BRANCH*\033[0m"
    else
        GIT_INFO=" / \033[1;32m$GIT_BRANCH\033[0m"
    fi

    # Add commit message if available
    if [ -n "$LAST_COMMIT_MSG" ]; then
        GIT_INFO="$GIT_INFO \033[1;90m($LAST_COMMIT_MSG)\033[0m"
    fi
fi

# Format cost with 2 decimal places
COST_FORMATTED=$(printf "%.2f" "$TOTAL_COST" 2>/dev/null || echo "0.00")

# Format session duration from milliseconds to human readable
format_duration() {
    local ms=$1
    local seconds=$((ms / 1000))
    local minutes=$((seconds / 60))
    local hours=$((minutes / 60))
    local remaining_minutes=$((minutes % 60))

    if [ "$hours" -gt 0 ]; then
        echo "${hours}h${remaining_minutes}m"
    elif [ "$minutes" -gt 0 ]; then
        echo "${minutes}m"
    else
        echo "${seconds}s"
    fi
}

SESSION_DURATION=$(format_duration "$TOTAL_DURATION_MS")
API_DURATION=$(format_duration "$API_DURATION_MS")

# Calculate API efficiency percentage
if [ "$TOTAL_DURATION_MS" -gt 0 ]; then
    API_EFFICIENCY=$(echo "$API_DURATION_MS $TOTAL_DURATION_MS" | awk '{printf "%.0f", ($1/$2)*100}')
else
    API_EFFICIENCY="0"
fi

# Build status line with colors - show components conditionally
STATUS_LINE="\033[1;34m$DIR_NAME\033[0m$GIT_INFO"

# Add session duration if meaningful
# if [ "$TOTAL_DURATION_MS" -gt 60000 ]; then  # > 1 minute
#     STATUS_LINE="$STATUS_LINE \033[1;33m$SESSION_DURATION\033[0m"
# fi

# Add API efficiency if session is long enough and efficiency is notable
if [ "$TOTAL_DURATION_MS" -gt 300000 ] && [ "$API_EFFICIENCY" -gt 10 ]; then  # > 5 min and >10% API time
    STATUS_LINE="$STATUS_LINE \033[1;91mapi:${API_EFFICIENCY}%\033[0m"
fi

# Add large context warning
if [ "$EXCEEDS_200K" = "true" ]; then
    STATUS_LINE="$STATUS_LINE \033[1;93m⚠️large\033[0m"
fi

# Add cost if non-zero and meaningful (> $0.01)
COST_CENTS=$(echo "$TOTAL_COST" | awk '{printf "%.0f", $1*100}')
if [ "$COST_CENTS" -gt 1 ]; then
    STATUS_LINE="$STATUS_LINE \033[1;32m\$$COST_FORMATTED\033[0m"
fi

# Add model at the end
# STATUS_LINE="$STATUS_LINE \033[1;36m$MODEL\033[0m"

echo -e "$STATUS_LINE"