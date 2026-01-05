---
name: devflow-worktree
description: Git worktree management for parallel development. Auto-activates during swarm operations when multiple tasks need isolated working directories. Provides patterns for creating, tracking, and cleaning up worktrees.
allowed-tools: Bash, Read, Glob
---

# Worktree Skill - Parallel Development Isolation

**Purpose**: Manage git worktrees for parallel task execution. Enables multiple agents to work on different tasks simultaneously without conflicts.

## Iron Law

> **ONE TASK, ONE WORKTREE**
>
> Each task gets its own isolated directory. Never share worktrees between tasks.
> Never work in the main repo when a worktree exists. Always use explicit paths
> (`git -C`). Cross-contamination between tasks causes merge conflicts and confusion.

## When to Activate

Auto-activates when:
- Parallel implementation needs isolated working directories
- Multiple tasks must be worked on in parallel
- Branch isolation required for clean PRs
- Agent needs to work in a specific worktree context

## Core Concepts

**Worktree**: An independent working directory linked to the same git repository. Each worktree has its own branch and file state, enabling true parallel development.

```
main repo (./)
├── .git/                    # Shared git database
├── src/                     # Main working directory
└── .worktrees/              # Worktree container
    ├── task-1/              # Isolated dir, branch: swarm/task-1
    ├── task-2/              # Isolated dir, branch: swarm/task-2
    └── task-3/              # Isolated dir, branch: swarm/task-3
```

## Worktree Operations

### Create Worktree for Task

```bash
# Variables
TASK_ID="task-1"
BASE_BRANCH="release/2025-12-18-1430"  # or main
WORKTREE_DIR=".worktrees/${TASK_ID}"
BRANCH_NAME="swarm/${TASK_ID}"

# Ensure .worktrees exists and is gitignored
mkdir -p .worktrees
grep -q "^.worktrees/" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore

# Create worktree with new branch from base
git worktree add -b "${BRANCH_NAME}" "${WORKTREE_DIR}" "${BASE_BRANCH}"

echo "Created worktree: ${WORKTREE_DIR} on branch ${BRANCH_NAME}"
```

### List Active Worktrees

```bash
echo "=== Active Worktrees ==="
git worktree list

echo ""
echo "=== Swarm Worktrees ==="
git worktree list | grep ".worktrees" || echo "No swarm worktrees active"
```

### Work in Worktree Context

When executing commands in a worktree, always use explicit paths:

```bash
WORKTREE_DIR=".worktrees/task-1"

# Run commands in worktree context
git -C "${WORKTREE_DIR}" status
git -C "${WORKTREE_DIR}" add .
git -C "${WORKTREE_DIR}" commit -m "feat: implement feature"

# Run tests in worktree
cd "${WORKTREE_DIR}" && npm test && cd -

# Or use subshell
(cd "${WORKTREE_DIR}" && npm test)
```

### Get Worktree Branch

```bash
WORKTREE_DIR=".worktrees/task-1"
BRANCH=$(git -C "${WORKTREE_DIR}" branch --show-current)
echo "Worktree ${WORKTREE_DIR} is on branch: ${BRANCH}"
```

### Push Worktree Branch

```bash
WORKTREE_DIR=".worktrees/task-1"
git -C "${WORKTREE_DIR}" push -u origin "$(git -C "${WORKTREE_DIR}" branch --show-current)"
```

### Remove Single Worktree

```bash
TASK_ID="task-1"
WORKTREE_DIR=".worktrees/${TASK_ID}"
BRANCH_NAME="swarm/${TASK_ID}"

# Remove worktree
git worktree remove "${WORKTREE_DIR}" --force

# Optionally delete branch (if merged)
git branch -d "${BRANCH_NAME}" 2>/dev/null || echo "Branch ${BRANCH_NAME} not deleted (may have unmerged changes)"
```

### Cleanup All Swarm Worktrees

```bash
echo "=== Cleaning up swarm worktrees ==="

# Remove all worktrees in .worktrees/
for worktree in .worktrees/*/; do
    if [ -d "$worktree" ]; then
        echo "Removing: $worktree"
        git worktree remove "$worktree" --force 2>/dev/null || rm -rf "$worktree"
    fi
done

# Prune stale worktree references
git worktree prune

# Delete swarm branches that have been merged
for branch in $(git branch --list "swarm/*" | tr -d ' '); do
    git branch -d "$branch" 2>/dev/null && echo "Deleted merged branch: $branch"
done

echo "=== Remaining swarm branches (unmerged) ==="
git branch --list "swarm/*" || echo "None"
```

## Swarm State Directory

Store swarm state in `.docs/swarm/`:

```bash
mkdir -p .docs/swarm

# State file location
STATE_FILE=".docs/swarm/state.json"
```

### State File Structure

```json
{
  "swarm_id": "2025-12-18-1430",
  "release_branch": "release/2025-12-18-1430",
  "base_branch": "main",
  "started_at": "2025-12-18T14:30:00Z",
  "status": "implementing",
  "tasks": [
    {
      "id": "task-1",
      "description": "Implement user authentication",
      "worktree": ".worktrees/task-1",
      "branch": "swarm/task-1",
      "phase": "implementing",
      "pr_number": null,
      "files_touched": ["src/auth/*", "src/utils/validate.ts"],
      "depends_on": [],
      "merge_order": 1,
      "error": null
    }
  ],
  "merge_sequence": ["task-1", "task-2", "task-3"],
  "conflicts_detected": [
    {
      "tasks": ["task-1", "task-2"],
      "file": "src/utils/validate.ts",
      "resolution": "merge task-1 first"
    }
  ]
}
```

### Read State

```bash
STATE_FILE=".docs/swarm/state.json"
if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
else
    echo "No active swarm state"
fi
```

### Update Task Phase

```bash
STATE_FILE=".docs/swarm/state.json"
TASK_ID="task-1"
NEW_PHASE="reviewing"

# Use jq to update (if available)
if command -v jq &>/dev/null && [ -f "$STATE_FILE" ]; then
    jq --arg id "$TASK_ID" --arg phase "$NEW_PHASE" \
        '(.tasks[] | select(.id == $id)).phase = $phase' \
        "$STATE_FILE" > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi
```

## Worktree Validation

### Check Worktree Health

```bash
WORKTREE_DIR=".worktrees/task-1"

echo "=== Worktree Health Check: ${WORKTREE_DIR} ==="

# Check exists
if [ ! -d "$WORKTREE_DIR" ]; then
    echo "ERROR: Worktree directory does not exist"
    exit 1
fi

# Check git status
echo "Git status:"
git -C "$WORKTREE_DIR" status --short

# Check branch
echo "Branch:"
git -C "$WORKTREE_DIR" branch --show-current

# Check for uncommitted changes
if [ -n "$(git -C "$WORKTREE_DIR" status --porcelain)" ]; then
    echo "WARNING: Uncommitted changes present"
else
    echo "OK: Working directory clean"
fi

# Check if ahead/behind remote
git -C "$WORKTREE_DIR" fetch origin 2>/dev/null
echo "Remote status:"
git -C "$WORKTREE_DIR" status -sb | head -1
```

### Detect File Conflicts Between Tasks

```bash
# Given two plan files, detect overlapping files
PLAN_A=".docs/swarm/plans/task-1.md"
PLAN_B=".docs/swarm/plans/task-2.md"

echo "=== Detecting File Conflicts ==="

# Extract file paths from plans (assumes plans list files to modify)
FILES_A=$(grep -E "^- (src/|lib/|tests/)" "$PLAN_A" 2>/dev/null | sed 's/^- //' | sort)
FILES_B=$(grep -E "^- (src/|lib/|tests/)" "$PLAN_B" 2>/dev/null | sed 's/^- //' | sort)

# Find common files
CONFLICTS=$(comm -12 <(echo "$FILES_A") <(echo "$FILES_B"))

if [ -n "$CONFLICTS" ]; then
    echo "CONFLICT: Both tasks touch these files:"
    echo "$CONFLICTS"
else
    echo "OK: No file conflicts detected"
fi
```

## Integration Patterns

### Create PR from Worktree

```bash
WORKTREE_DIR=".worktrees/task-1"
TARGET_BRANCH="release/2025-12-18-1430"
TASK_DESCRIPTION="Implement user authentication"

# Push branch
git -C "$WORKTREE_DIR" push -u origin "$(git -C "$WORKTREE_DIR" branch --show-current)"

# Create PR (from main repo, referencing the branch)
BRANCH=$(git -C "$WORKTREE_DIR" branch --show-current)
gh pr create \
    --base "$TARGET_BRANCH" \
    --head "$BRANCH" \
    --title "feat: ${TASK_DESCRIPTION}" \
    --body "## Summary

Implements: ${TASK_DESCRIPTION}

## Part of Swarm Release

This PR is part of an automated swarm release. It will be merged into \`${TARGET_BRANCH}\` along with other task PRs.

---
Generated by DevFlow Swarm"
```

### Merge PR and Update State

```bash
PR_NUMBER=101
TASK_ID="task-1"

# Merge PR
gh pr merge "$PR_NUMBER" --squash --delete-branch

# Update state (conceptual - orchestrator handles this)
echo "Task ${TASK_ID} merged via PR #${PR_NUMBER}"
```

## Error Handling

### Recover from Failed Worktree

```bash
TASK_ID="task-1"
WORKTREE_DIR=".worktrees/${TASK_ID}"

# If worktree is corrupted, force remove and recreate
if [ -d "$WORKTREE_DIR" ]; then
    echo "Removing corrupted worktree..."
    git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || rm -rf "$WORKTREE_DIR"
    git worktree prune
fi

# Recreate from base
BASE_BRANCH="release/2025-12-18-1430"
BRANCH_NAME="swarm/${TASK_ID}"

# Delete branch if exists
git branch -D "$BRANCH_NAME" 2>/dev/null

# Recreate
git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" "$BASE_BRANCH"
echo "Worktree recreated: $WORKTREE_DIR"
```

### Lock File Handling

```bash
# Before any git operation in worktree
WORKTREE_DIR=".worktrees/task-1"
LOCK_FILE="${WORKTREE_DIR}/.git/index.lock"

wait_for_lock() {
    local max_wait=10
    local waited=0
    while [ -f "$LOCK_FILE" ]; do
        if [ $waited -ge $max_wait ]; then
            echo "ERROR: Lock file persists after ${max_wait}s"
            rm -f "$LOCK_FILE"  # Force remove stale lock
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
}

wait_for_lock
git -C "$WORKTREE_DIR" status
```

## Key Principles

1. **Isolation** - Each task gets its own worktree, no cross-contamination
2. **Explicit paths** - Always use `git -C` or `cd` subshells, never assume cwd
3. **State tracking** - Keep `.docs/swarm/state.json` updated
4. **Clean PRs** - Each worktree creates one focused PR
5. **Cleanup** - Always clean up worktrees after merge or failure
6. **Gitignore** - `.worktrees/` must be in `.gitignore`

## Quick Reference

| Operation | Command |
|-----------|---------|
| Create worktree | `git worktree add -b swarm/task-1 .worktrees/task-1 main` |
| List worktrees | `git worktree list` |
| Work in worktree | `git -C .worktrees/task-1 <command>` |
| Remove worktree | `git worktree remove .worktrees/task-1 --force` |
| Prune stale | `git worktree prune` |
| Check health | `git -C .worktrees/task-1 status` |
