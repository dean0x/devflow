#!/bin/bash

# Claude Code Status Line Script
# Receives JSON input via stdin with session context
# Displays: directory, git branch, diff stats, model, context usage, update badge

# Read JSON input
INPUT=$(cat)

# Derive devflow directory from script location (scripts/ → parent is ~/.devflow/)
SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
DEVFLOW_DIR="$(dirname "$SCRIPT_DIR")"

# Portable mtime helper (works on macOS + Linux)
get_mtime() {
    if stat -f %m "$1" &>/dev/null 2>&1; then
        stat -f %m "$1"  # macOS
    elif stat -c %Y "$1" &>/dev/null 2>&1; then
        stat -c %Y "$1"  # Linux
    else
        echo 0
    fi
}

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

# Get git branch if in a git repo
GIT_BRANCH=$(cd "$CWD" 2>/dev/null && git branch --show-current 2>/dev/null || echo "")
if [ -z "$GIT_BRANCH" ]; then
    GIT_INFO=""
    DIFF_STATS=""
else
    # Dirty indicator based on uncommitted changes
    if [ -n "$(cd "$CWD" 2>/dev/null && git status --porcelain 2>/dev/null)" ]; then
        GIT_INFO="  \033[33m$GIT_BRANCH*\033[0m"
    else
        GIT_INFO="  \033[32m$GIT_BRANCH\033[0m"
    fi

    # Determine base branch via layered detection (most precise → least precise)
    BASE_BRANCH=""
    cd "$CWD" 2>/dev/null && {
        # Layer 1: Branch reflog — explicit "Created from <branch>"
        CREATED_FROM=$(git reflog show "$GIT_BRANCH" --format='%gs' 2>/dev/null \
            | grep -m1 'branch: Created from' \
            | sed 's/branch: Created from //')
        if [ -n "$CREATED_FROM" ] && [ "$CREATED_FROM" != "HEAD" ]; then
            # Strip refs/heads/ prefix if present
            CANDIDATE="${CREATED_FROM#refs/heads/}"
            git rev-parse --verify "$CANDIDATE" &>/dev/null && BASE_BRANCH="$CANDIDATE"
        fi

        # Layer 2: HEAD reflog — "checkout: moving from X to <branch>"
        if [ -z "$BASE_BRANCH" ]; then
            MOVED_FROM=$(git reflog show HEAD --format='%gs' 2>/dev/null \
                | grep -m1 "checkout: moving from .* to $GIT_BRANCH\$" \
                | sed "s/checkout: moving from \(.*\) to $GIT_BRANCH/\1/")
            if [ -n "$MOVED_FROM" ]; then
                git rev-parse --verify "$MOVED_FROM" &>/dev/null && BASE_BRANCH="$MOVED_FROM"
            fi
        fi

        # Layer 3: GitHub PR base branch (cached, 5-min TTL)
        if [ -z "$BASE_BRANCH" ] && command -v gh &>/dev/null; then
            REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)")
            CACHE_FILE="/tmp/devflow-base-${REPO_NAME}-${GIT_BRANCH}"
            if [ -f "$CACHE_FILE" ] && [ $(($(date +%s) - $(get_mtime "$CACHE_FILE"))) -lt 300 ]; then
                BASE_BRANCH=$(cat "$CACHE_FILE")
            else
                PR_BASE=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null)
                if [ -n "$PR_BASE" ]; then
                    echo "$PR_BASE" > "$CACHE_FILE"
                    BASE_BRANCH="$PR_BASE"
                fi
            fi
        fi

        # Layer 4: Fallback to main/master
        if [ -z "$BASE_BRANCH" ]; then
            git rev-parse --verify main &>/dev/null && BASE_BRANCH="main"
            [ -z "$BASE_BRANCH" ] && git rev-parse --verify master &>/dev/null && BASE_BRANCH="master"
        fi
    }

    BRANCH_STATS=""
    if [ -n "$BASE_BRANCH" ] && [ "$GIT_BRANCH" != "$BASE_BRANCH" ]; then
        # Total commits on branch (local + remote, since fork from base)
        TOTAL_COMMITS=$(cd "$CWD" 2>/dev/null && git rev-list --count "$BASE_BRANCH"..HEAD 2>/dev/null || echo "0")
        [ "$TOTAL_COMMITS" -gt 0 ] 2>/dev/null && BRANCH_STATS=" ${TOTAL_COMMITS}↑"

        # Unpushed commits (local-only, ahead of remote tracking branch)
        UPSTREAM=$(cd "$CWD" 2>/dev/null && git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)
        if [ -n "$UPSTREAM" ]; then
            UNPUSHED=$(cd "$CWD" 2>/dev/null && git rev-list --count "$UPSTREAM"..HEAD 2>/dev/null || echo "0")
            [ "$UNPUSHED" -gt 0 ] 2>/dev/null && BRANCH_STATS="$BRANCH_STATS \033[33m${UNPUSHED}⇡\033[0m"
        elif [ "$TOTAL_COMMITS" -gt 0 ] 2>/dev/null; then
            # No upstream at all — everything is unpushed
            BRANCH_STATS="$BRANCH_STATS \033[33m${TOTAL_COMMITS}⇡\033[0m"
        fi

        MERGE_BASE=$(cd "$CWD" 2>/dev/null && git merge-base "$BASE_BRANCH" HEAD 2>/dev/null)
        DIFF_OUTPUT=$(cd "$CWD" 2>/dev/null && git diff --shortstat "$MERGE_BASE" 2>/dev/null)
    else
        DIFF_OUTPUT=$(cd "$CWD" 2>/dev/null && git diff --shortstat HEAD 2>/dev/null)
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

# Version update notification (24h cached check)
VERSION_BADGE=""
MANIFEST_FILE="${DEVFLOW_DIR}/manifest.json"
VERSION_CACHE_DIR="${HOME}/.cache/devflow"
VERSION_CACHE_FILE="${VERSION_CACHE_DIR}/latest-version"

if [ -f "$MANIFEST_FILE" ] && command -v jq &>/dev/null; then
    LOCAL_VERSION=$(jq -r '.version // empty' "$MANIFEST_FILE" 2>/dev/null)

    if [ -n "$LOCAL_VERSION" ]; then
        # Read cached latest version (fast path — no network)
        LATEST_VERSION=""
        if [ -f "$VERSION_CACHE_FILE" ]; then
            LATEST_VERSION=$(cat "$VERSION_CACHE_FILE" 2>/dev/null)
        fi

        # Compare versions if cache exists
        if [ -n "$LATEST_VERSION" ] && [ "$LOCAL_VERSION" != "$LATEST_VERSION" ]; then
            # sort -V: lowest version first. If local sorts before latest, update available.
            LOWEST=$(printf '%s\n%s' "$LOCAL_VERSION" "$LATEST_VERSION" | sort -V | head -n1)
            if [ "$LOWEST" = "$LOCAL_VERSION" ]; then
                VERSION_BADGE="  \033[35m⬆ ${LATEST_VERSION}\033[0m"
            fi
        fi

        # Background refresh if cache is missing or older than 24h
        REFRESH=false
        if [ ! -f "$VERSION_CACHE_FILE" ]; then
            REFRESH=true
        else
            CACHE_AGE=$(($(date +%s) - $(get_mtime "$VERSION_CACHE_FILE")))
            [ "$CACHE_AGE" -ge 86400 ] && REFRESH=true
        fi

        if [ "$REFRESH" = true ] && command -v npm &>/dev/null; then
            (
                mkdir -p "$VERSION_CACHE_DIR" 2>/dev/null
                FETCHED=$(npm view devflow-kit version 2>/dev/null)
                if [ -n "$FETCHED" ]; then
                    echo "$FETCHED" > "$VERSION_CACHE_FILE"
                fi
            ) &
            disown 2>/dev/null
        fi
    fi
fi

STATUS_LINE="${STATUS_LINE}${VERSION_BADGE}"

echo -e "$STATUS_LINE"
