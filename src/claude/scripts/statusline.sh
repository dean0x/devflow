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

# Get container or system CPU and memory usage
get_cpu_usage() {
    # Try container metrics first (cgroup v2, then v1)
    if [ -f /sys/fs/cgroup/cpu.stat ]; then
        # cgroup v2 (Docker/Kubernetes)
        # Read CPU usage twice with 100ms delay to calculate percentage
        local usage1=$(cat /sys/fs/cgroup/cpu.stat 2>/dev/null | grep "^usage_usec" | awk '{print $2}')
        local nproc=$(nproc 2>/dev/null || echo "1")
        sleep 0.1
        local usage2=$(cat /sys/fs/cgroup/cpu.stat 2>/dev/null | grep "^usage_usec" | awk '{print $2}')

        if [ -n "$usage1" ] && [ -n "$usage2" ] && [ "$usage2" -gt "$usage1" ]; then
            # Calculate CPU % over 100ms: (delta_usec / 100000) / num_cpus * 100
            local delta=$((usage2 - usage1))
            awk "BEGIN {printf \"%.0f\", ($delta / 100000.0 / $nproc * 100)}"
            return
        fi
    elif [ -f /sys/fs/cgroup/cpuacct/cpuacct.usage ]; then
        # cgroup v1 (older Docker)
        local usage1=$(cat /sys/fs/cgroup/cpuacct/cpuacct.usage 2>/dev/null)
        local nproc=$(nproc 2>/dev/null || echo "1")
        sleep 0.1
        local usage2=$(cat /sys/fs/cgroup/cpuacct/cpuacct.usage 2>/dev/null)

        if [ -n "$usage1" ] && [ -n "$usage2" ] && [ "$usage2" -gt "$usage1" ]; then
            # Calculate CPU % over 100ms: (delta_ns / 100000000) / num_cpus * 100
            local delta=$((usage2 - usage1))
            awk "BEGIN {printf \"%.0f\", ($delta / 100000000.0 / $nproc * 100)}"
            return
        fi
    fi

    # Fallback to system-wide metrics
    if command -v top &> /dev/null; then
        # Linux/macOS with top
        top -bn1 2>/dev/null | grep -i "cpu" | head -1 | awk '{print $2}' | sed 's/%us,//' | sed 's/id,//' || echo "0"
    elif command -v ps &> /dev/null; then
        # Fallback: average CPU of all processes
        ps -A -o %cpu | awk '{s+=$1} END {printf "%.0f", s}'
    else
        echo "0"
    fi
}

get_memory_usage() {
    # Try container metrics first (cgroup v2, then v1)
    if [ -f /sys/fs/cgroup/memory.current ] && [ -f /sys/fs/cgroup/memory.max ]; then
        # cgroup v2 (Docker/Kubernetes)
        local current=$(cat /sys/fs/cgroup/memory.current 2>/dev/null)
        local max=$(cat /sys/fs/cgroup/memory.max 2>/dev/null)

        if [ -n "$current" ] && [ -n "$max" ] && [ "$max" != "max" ]; then
            awk "BEGIN {printf \"%.0f\", ($current / $max * 100)}"
            return
        fi
    elif [ -f /sys/fs/cgroup/memory/memory.usage_in_bytes ] && [ -f /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
        # cgroup v1 (older Docker)
        local usage=$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null)
        local limit=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null)

        if [ -n "$usage" ] && [ -n "$limit" ]; then
            awk "BEGIN {printf \"%.0f\", ($usage / $limit * 100)}"
            return
        fi
    fi

    # Fallback to system-wide metrics
    if command -v free &> /dev/null; then
        # Linux with free
        free | grep Mem | awk '{printf "%.0f", ($3/$2)*100}'
    elif command -v vm_stat &> /dev/null; then
        # macOS with vm_stat
        vm_stat | awk '/Pages active/ {active=$3} /Pages wired/ {wired=$4} /Pages free/ {free=$3} END {printf "%.0f", ((active+wired)/(active+wired+free))*100}' | sed 's/\.//'
    else
        echo "0"
    fi
}

CPU_USAGE=$(get_cpu_usage)
MEMORY_USAGE=$(get_memory_usage)

# Build status line with colors
STATUS_LINE="\033[1;34m$DIR_NAME\033[0m$GIT_INFO"

# Add model name
STATUS_LINE="$STATUS_LINE  \033[1;36m$MODEL\033[0m"

# Add CPU usage
STATUS_LINE="$STATUS_LINE  \033[1;35mcpu:${CPU_USAGE}%\033[0m"

# Add memory usage
STATUS_LINE="$STATUS_LINE  \033[1;33mmem:${MEMORY_USAGE}%\033[0m"

# Add large context warning if needed
if [ "$EXCEEDS_200K" = "true" ]; then
    STATUS_LINE="$STATUS_LINE  \033[1;91m⚠️large\033[0m"
fi

echo -e "$STATUS_LINE"