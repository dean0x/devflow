---
description: Orchestrate multiple tasks in parallel - spawns Swarm units, manages dependencies, coordinates merging, creates release PR
---

# Swarm Orchestrator - Multi-Task Parallel Execution

Coordinate multiple tasks executed in parallel using isolated worktrees. Spawns Swarm units for each task, manages dependencies between them, and produces a unified release.

## Usage

```
/swarm-orchestrator task1 description, task2 description, task3 description
```

Or with explicit task list:
```
/swarm-orchestrator
- Implement user authentication
- Add rate limiting to API endpoints
- Refactor database connection pooling
```

For single-task execution, use `/swarm` instead.

---

## Input

You receive:
- `TASKS`: Array of task descriptions to implement
- `BASE_BRANCH`: Branch to base work on (default: main)
- `RELEASE_NAME` (optional): Custom release identifier

## Your Mission

Coordinate multiple Swarm units:

```
SETUP → ANALYZE → SPAWN SWARMS → COLLECT → MERGE → RELEASE
```

**Output**: A release PR containing all completed tasks, ready for final merge to main.

---

## Phase 1: Setup

### Parse and Validate Tasks

```bash
# Validate we have tasks to process
if [ ${#TASKS[@]} -eq 0 ]; then
    echo "ERROR: No tasks provided"
    exit 1
fi

NUM_TASKS=${#TASKS[@]}
echo "=== SWARM ORCHESTRATOR ==="
echo "Tasks to process: ${NUM_TASKS}"

for i in "${!TASKS[@]}"; do
    echo "  $((i+1)). ${TASKS[$i]}"
done
```

### Create Release Infrastructure

```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
SWARM_ID="${RELEASE_NAME:-swarm-${TIMESTAMP}}"
RELEASE_BRANCH="release/${SWARM_ID}"

# Determine base branch
BASE_BRANCH="${BASE_BRANCH:-main}"
if ! git show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
    for branch in main master develop; do
        if git show-ref --verify --quiet "refs/heads/${branch}"; then
            BASE_BRANCH="${branch}"
            break
        fi
    done
fi

echo ""
echo "Swarm ID: ${SWARM_ID}"
echo "Release Branch: ${RELEASE_BRANCH}"
echo "Base Branch: ${BASE_BRANCH}"

# Create release branch
git checkout "${BASE_BRANCH}"
git pull origin "${BASE_BRANCH}" 2>/dev/null || true
git checkout -b "${RELEASE_BRANCH}"
git push -u origin "${RELEASE_BRANCH}"

# Setup directories
mkdir -p .docs/swarm/orchestrator
mkdir -p .worktrees

# Ensure worktrees is gitignored
grep -q "^.worktrees/" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore

echo "✅ Release infrastructure created"
```

### Create Worktrees for Each Task

```bash
echo ""
echo "=== CREATING WORKTREES ==="

for i in $(seq 1 ${NUM_TASKS}); do
    TASK_ID="task-${i}"
    WORKTREE_DIR=".worktrees/${TASK_ID}"
    BRANCH_NAME="swarm/${SWARM_ID}/${TASK_ID}"

    git worktree add -b "${BRANCH_NAME}" "${WORKTREE_DIR}" "${RELEASE_BRANCH}"
    echo "✅ ${TASK_ID}: ${WORKTREE_DIR}"
done

git worktree list
```

### Initialize State

Create `.docs/swarm/orchestrator/state.json`:

```json
{
  "swarm_id": "${SWARM_ID}",
  "release_branch": "${RELEASE_BRANCH}",
  "base_branch": "${BASE_BRANCH}",
  "started_at": "$(date -Iseconds)",
  "status": "setup",
  "tasks": [
    {
      "id": "task-1",
      "description": "${TASK_DESCRIPTION}",
      "worktree": ".worktrees/task-1",
      "branch": "swarm/${SWARM_ID}/task-1",
      "status": "pending",
      "pr_number": null,
      "files_touched": [],
      "depends_on": [],
      "swarm_result": null
    }
  ],
  "merge_sequence": [],
  "completed": [],
  "failed": []
}
```

---

## Phase 2: Light Dependency Analysis

Before spawning Swarm units, do a quick analysis to identify potential conflicts.

### Quick Exploration

For each task, do a lightweight scan to predict which areas of the codebase will be touched:

```
For each task (PARALLEL):
    Launch Task tool with subagent_type="Explore" (quick mode):

    "Quick scan: What areas of the codebase would be affected by: ${TASK_DESCRIPTION}

    Just identify:
    - Main directories/modules likely affected
    - Key files that might be modified

    Keep it brief - this is just for conflict prediction."
```

### Build Potential Conflict Matrix

Based on exploration results:

```markdown
## Preliminary Conflict Analysis

| Task | Likely Areas | Potential Conflicts |
|------|--------------|---------------------|
| task-1 | src/auth/* | task-2 (shared utils) |
| task-2 | src/api/*, src/utils/* | task-1 |
| task-3 | src/ui/* | (none) |

## Execution Strategy

**Parallel Group 1** (no predicted conflicts):
- task-1
- task-3

**Sequential After Group 1**:
- task-2 (may conflict with task-1)
```

### User Checkpoint

Present analysis and get approval:

```markdown
## 🚦 SWARM READY TO LAUNCH

### Tasks
| ID | Description | Predicted Areas | Risk |
|----|-------------|-----------------|------|
| task-1 | ${DESC} | src/auth/* | Low |
| task-2 | ${DESC} | src/api/* | Medium (conflict) |
| task-3 | ${DESC} | src/ui/* | Low |

### Execution Plan
- **Parallel**: task-1, task-3
- **After task-1**: task-2

### Estimated Parallel Swarms: 2 initially, 1 after

**Proceed?** (yes/no/modify)
```

**Wait for user approval before spawning Swarm units.**

---

## Phase 3: Spawn Swarm Units

Launch Swarm agents based on conflict analysis.

### Group 1: Independent Tasks (Parallel)

Launch Swarm units for tasks without predicted conflicts in a **single message**:

```
For each independent task (PARALLEL):

Task tool with subagent_type="Swarm":

"Execute single-task lifecycle for: ${TASK_DESCRIPTION}

TASK_ID: task-1
TASK_DESCRIPTION: ${DESCRIPTION}
WORKTREE_DIR: .worktrees/task-1
TASK_BRANCH: swarm/${SWARM_ID}/task-1
TARGET_BRANCH: ${RELEASE_BRANCH}

Complete the full lifecycle: Design → Implement → Review.
Report back with: PR number, files touched, review status, and any blocking issues."
```

### Collect Group 1 Results

Wait for all parallel Swarm units to complete. For each:

```json
{
  "id": "task-1",
  "status": "completed" | "failed",
  "pr_number": 101,
  "files_touched": ["src/auth/handler.ts", "tests/auth.test.ts"],
  "review_status": "approved" | "changes_requested",
  "blocking_issues": []
}
```

### Group 2+: Dependent Tasks

After Group 1 completes:

1. Update conflict analysis with actual files touched
2. Determine if predicted conflicts materialized
3. Launch next group of Swarm units

```
If task-2 conflicts with task-1:
    - Rebase task-2's worktree on updated release branch
    - Then spawn Swarm unit for task-2
```

---

## Phase 4: Collect and Validate Results

After all Swarm units complete:

### Aggregate Results

```markdown
## Swarm Results Summary

| Task | Status | PR | Review | Files |
|------|--------|-----|--------|-------|
| task-1 | ✅ Complete | #101 | Approved | 5 |
| task-2 | ✅ Complete | #102 | Approved | 8 |
| task-3 | ❌ Failed | - | - | - |

### Completed: 2/3
### Failed: 1/3
```

### Determine Merge Order

Based on actual files touched and dependencies:

```markdown
## Merge Order

1. **task-1** (PR #101)
   - Files: src/auth/*
   - No dependencies

2. **task-2** (PR #102)
   - Files: src/api/*, src/utils/*
   - Depends on: task-1 (shared src/utils/validate.ts)

### Conflict Risk: Medium
- task-1 and task-2 both touched src/utils/validate.ts
- Strategy: Merge task-1 first, rebase task-2 if needed
```

---

## Phase 5: Merge (Sequential)

Merge PRs in dependency order.

### For Each PR in Order

```bash
MERGE_ORDER=("task-1" "task-2")

for TASK_ID in "${MERGE_ORDER[@]}"; do
    PR_NUMBER=${PR_NUMBERS[$TASK_ID]}

    echo "=== Merging ${TASK_ID} (PR #${PR_NUMBER}) ==="

    # Merge PR
    gh pr merge "${PR_NUMBER}" --squash --delete-branch

    if [ $? -eq 0 ]; then
        echo "✅ ${TASK_ID} merged"

        # Pull latest release branch
        git checkout "${RELEASE_BRANCH}"
        git pull origin "${RELEASE_BRANCH}"

        # Run integration tests
        npm test || {
            echo "❌ Integration tests failed after merging ${TASK_ID}"
            # Handle failure - potentially revert
            exit 1
        }

        echo "✅ Integration tests pass"
    else
        echo "❌ Failed to merge ${TASK_ID}"
        # Handle merge conflict
    fi
done
```

### Handle Merge Conflicts

If a PR cannot merge cleanly:

```markdown
## ⚠️ MERGE CONFLICT

**Task**: task-2 (PR #102)
**Conflict with**: task-1's changes to src/utils/validate.ts

**Resolution Options**:
1. Rebase task-2 branch on updated release branch
2. Manual conflict resolution
3. Skip task-2, handle separately

**Automated resolution attempt**: Rebasing...
```

```bash
# Attempt automatic rebase
cd ".worktrees/task-2"
git fetch origin "${RELEASE_BRANCH}"
git rebase "origin/${RELEASE_BRANCH}"

if [ $? -eq 0 ]; then
    git push --force-with-lease
    echo "✅ Rebase successful, retrying merge"
else
    echo "❌ Rebase failed, escalating to user"
fi
```

---

## Phase 6: Create Release PR

After all successful merges:

```bash
gh pr create \
    --base "${BASE_BRANCH}" \
    --head "${RELEASE_BRANCH}" \
    --title "Release: ${SWARM_ID}" \
    --body "$(cat <<'EOF'
## 🚀 Swarm Release: ${SWARM_ID}

### Tasks Completed

| Task | PR | Description | Status |
|------|-----|-------------|--------|
| task-1 | #101 | ${TASK_1_DESC} | ✅ Merged |
| task-2 | #102 | ${TASK_2_DESC} | ✅ Merged |
| task-3 | - | ${TASK_3_DESC} | ❌ Failed |

### Summary

- **Tasks Attempted**: ${NUM_TASKS}
- **Tasks Completed**: ${NUM_COMPLETED}
- **Tasks Failed**: ${NUM_FAILED}
- **PRs Merged**: ${NUM_MERGED}
- **Files Changed**: ${TOTAL_FILES}

### Merge Order Used

1. task-1 (independent)
2. task-2 (after task-1)

### Testing

- ✅ All individual PRs passed review
- ✅ Integration tests pass on release branch
- ✅ No merge conflicts

### Failed Tasks (if any)

${FAILED_TASK_DETAILS}

---

🤖 Generated by DevFlow SwarmOrchestrator
EOF
)"

RELEASE_PR=$(gh pr view --json number -q '.number')
echo ""
echo "🚀 Release PR: #${RELEASE_PR}"
```

---

## Phase 7: Cleanup

After release PR is created:

```bash
echo "=== CLEANUP ==="

# Remove worktrees
for worktree in .worktrees/*/; do
    if [ -d "$worktree" ]; then
        git worktree remove "$worktree" --force
    fi
done
git worktree prune

# Delete task branches (already deleted by squash merge)
for branch in $(git branch --list "swarm/${SWARM_ID}/*" | tr -d ' '); do
    git branch -D "$branch" 2>/dev/null
done

# Archive state
mkdir -p .docs/swarm/archive
mv .docs/swarm/orchestrator/state.json ".docs/swarm/archive/${SWARM_ID}-state.json"

echo "✅ Cleanup complete"
```

---

## Final Report

```markdown
## 🎉 SWARM ORCHESTRATION COMPLETE

### Release: ${SWARM_ID}

| Metric | Value |
|--------|-------|
| Tasks Attempted | ${NUM_TASKS} |
| Tasks Completed | ${NUM_COMPLETED} |
| Tasks Failed | ${NUM_FAILED} |
| PRs Created | ${NUM_PRS} |
| PRs Merged | ${NUM_MERGED} |
| Total Files Changed | ${TOTAL_FILES} |
| Duration | ${DURATION} |

### Task Results

| Task | Description | Status | PR |
|------|-------------|--------|-----|
| task-1 | ${DESC} | ✅ Merged | #101 |
| task-2 | ${DESC} | ✅ Merged | #102 |
| task-3 | ${DESC} | ❌ Failed | - |

### Release PR

- **PR Number**: #${RELEASE_PR}
- **Target**: ${BASE_BRANCH}
- **Status**: Ready for final review

### Artifacts

- State archive: `.docs/swarm/archive/${SWARM_ID}-state.json`
- Design docs: `.docs/design/task-*-design.md`

### Next Steps

1. Review release PR #${RELEASE_PR}
2. Merge to ${BASE_BRANCH}
3. Tag release: `git tag v${VERSION}`
4. Handle failed tasks separately (if any)
```

---

## Error Handling

### Partial Completion

If some tasks complete but others fail:

```markdown
## ⚠️ PARTIAL SWARM COMPLETION

### Completed Tasks
- task-1: ✅ Merged (#101)
- task-2: ✅ Merged (#102)

### Failed Tasks
- task-3: ❌ Design phase failed

### Options

1. **Proceed with partial release**
   - Create release PR with completed tasks
   - Handle task-3 as separate follow-up

2. **Retry failed tasks**
   - Attempt to re-run failed Swarm units
   - Then complete release

3. **Abort**
   - Revert all changes
   - Start fresh

**Recommendation**: Proceed with partial release
```

### Full Abort

```bash
echo "=== ABORTING SWARM ==="

# Close all open PRs
for TASK_ID in $(jq -r '.tasks[].id' .docs/swarm/orchestrator/state.json); do
    BRANCH="swarm/${SWARM_ID}/${TASK_ID}"
    PR=$(gh pr list --head "$BRANCH" --json number -q '.[0].number')
    [ -n "$PR" ] && gh pr close "$PR"
done

# Delete release branch
git push origin --delete "${RELEASE_BRANCH}" 2>/dev/null
git branch -D "${RELEASE_BRANCH}" 2>/dev/null

# Cleanup worktrees
for worktree in .worktrees/*/; do
    git worktree remove "$worktree" --force 2>/dev/null
done
git worktree prune

echo '{"status": "aborted"}' > .docs/swarm/orchestrator/state.json

echo "✅ Swarm aborted and cleaned up"
```

---

## Orchestration Principles

1. **Coordinate, don't micromanage** - Let Swarm units handle task details
2. **Parallelize aggressively** - Run independent tasks concurrently
3. **Sequence when needed** - Handle dependencies correctly
4. **Fail gracefully** - One task failure doesn't abort others
5. **User checkpoints** - Get approval before major phases
6. **State tracking** - Always know what's happening
7. **Clean recovery** - Can abort/retry at any point
