---
description: Orchestrate parallel task implementation using worktrees - explore, plan, implement, review, and release multiple tasks concurrently
---

# Swarm Command - Parallel Task Orchestration

Execute multiple tasks in parallel using isolated git worktrees, with intelligent dependency detection and coordinated merging.

## Usage

```
/swarm task1 description, task2 description, task3 description
```

Or with explicit task list:
```
/swarm
- Implement user authentication
- Add rate limiting to API endpoints
- Refactor database connection pooling
```

---

## Your Task

Orchestrate the complete swarm workflow:

```
SETUP → EXPLORE → PLAN → ANALYZE → IMPLEMENT → REVIEW → MERGE → RELEASE
```

---

## Phase 1: Parse Input & Setup

### Parse Tasks

Extract task descriptions from user input:

```bash
# Tasks should be provided as input
# Parse into array
TASKS=(
    "Task 1 description"
    "Task 2 description"
    "Task 3 description"
)
NUM_TASKS=${#TASKS[@]}

echo "=== SWARM: ${NUM_TASKS} TASKS ==="
for i in "${!TASKS[@]}"; do
    echo "  $((i+1)). ${TASKS[$i]}"
done
```

### Create Release Infrastructure

```bash
# Generate identifiers
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
SWARM_ID="swarm-${TIMESTAMP}"
RELEASE_BRANCH="release/${SWARM_ID}"

# Determine base branch
BASE_BRANCH=""
for branch in main master develop; do
    if git show-ref --verify --quiet "refs/heads/${branch}"; then
        BASE_BRANCH="${branch}"
        break
    fi
done

echo ""
echo "📋 Swarm ID: ${SWARM_ID}"
echo "🌿 Release Branch: ${RELEASE_BRANCH}"
echo "🏠 Base Branch: ${BASE_BRANCH}"

# Create release branch
git checkout "${BASE_BRANCH}"
git pull origin "${BASE_BRANCH}" 2>/dev/null || true
git checkout -b "${RELEASE_BRANCH}"
git push -u origin "${RELEASE_BRANCH}"

# Setup directories
mkdir -p .docs/swarm/plans
mkdir -p .docs/swarm/explore
mkdir -p .docs/swarm/archive
mkdir -p .worktrees

# Ensure worktrees is gitignored
grep -q "^.worktrees/" .gitignore 2>/dev/null || echo ".worktrees/" >> .gitignore

echo "✅ Infrastructure created"
```

### Create Worktrees

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

echo ""
git worktree list | grep ".worktrees"
```

### Initialize State File

Create `.docs/swarm/state.json` with all task metadata.

---

## Phase 2: Explore (Parallel)

Launch Explore agents for ALL tasks in a **single message** using multiple Task tool calls.

**IMPORTANT:** Launch these in PARALLEL (one message, multiple Task calls).

For each task:

```
Task tool with subagent_type="Explore":

"Explore the codebase to understand how to implement: ${TASK_DESCRIPTION}

Working context: This exploration is for worktree ${WORKTREE_DIR}.

Find and document:
1. Which files need to be modified
2. Which files need to be created
3. Existing patterns to follow
4. Integration points with existing code
5. Potential complications or dependencies

Be thorough - this informs the implementation plan."
```

**Collect exploration results** - each Explore agent returns:
- Files to modify/create
- Patterns identified
- Concerns raised

---

## Phase 3: Plan (Parallel)

After ALL explorations complete, launch Plan agents for ALL tasks in a **single message**.

For each task:

```
Task tool with subagent_type="Plan":

"Create implementation plan for: ${TASK_DESCRIPTION}

Exploration findings:
${EXPLORATION_RESULTS}

Create a detailed plan and save to: .docs/swarm/plans/task-${N}.md

Plan must include:
## Files to Modify
- path/to/file.ts

## Files to Create
- path/to/new-file.ts

## Implementation Steps
1. Step one
2. Step two

## Testing Strategy
- How to test this

## Dependencies
- Other tasks this depends on (if any)
- Tasks that depend on this (if any)

## Complexity
- Low/Medium/High"
```

---

## Phase 4: Analyze Dependencies

**CRITICAL CHECKPOINT** - Analyze all plans before implementing.

### Read All Plans

```bash
echo "=== ANALYZING PLANS ==="

for plan in .docs/swarm/plans/task-*.md; do
    TASK_ID=$(basename "$plan" .md)
    echo ""
    echo "--- ${TASK_ID} ---"
    cat "$plan"
done
```

### Build Dependency Matrix

Analyze plans to determine:

1. **File Conflicts**: Which tasks touch the same files?
2. **Dependencies**: Which tasks depend on others?
3. **Parallel Groups**: Which tasks can run simultaneously?
4. **Merge Order**: What order should PRs be merged?

### Present Analysis to User

```markdown
## 🔍 DEPENDENCY ANALYSIS

### Tasks Overview

| ID | Description | Complexity | Files Touched |
|----|-------------|------------|---------------|
| task-1 | ${DESC} | Medium | src/auth/*, src/utils/* |
| task-2 | ${DESC} | High | src/api/*, src/utils/* |
| task-3 | ${DESC} | Low | src/ui/* |

### Conflict Detection

| Task A | Task B | Shared Files | Resolution |
|--------|--------|--------------|------------|
| task-1 | task-2 | src/utils/validate.ts | Merge task-1 first |

### Execution Plan

**Parallel Group 1** (no conflicts):
- task-1
- task-3

**Sequential After Group 1**:
- task-2 (depends on task-1 changes)

### Proposed Merge Order

1. task-3 (independent, low risk)
2. task-1 (foundational changes)
3. task-2 (builds on task-1)

---

**Proceed with implementation?**
```

**WAIT for user confirmation before Phase 5.**

---

## Phase 5: Implement (Parallel where safe)

Based on dependency analysis, launch Coder agents.

### Group 1: Independent Tasks (Parallel)

Launch Coder agents for all tasks without dependencies in a **single message**:

```
Task tool with subagent_type="Coder":

"Implement task in isolated worktree.

TASK_ID: task-1
TASK_DESCRIPTION: ${DESCRIPTION}
WORKTREE_DIR: .worktrees/task-1
TARGET_BRANCH: ${RELEASE_BRANCH}
PLAN_FILE: .docs/swarm/plans/task-1.md

Complete the full cycle:
1. Implement according to plan
2. Run tests
3. Create atomic commits
4. Push branch
5. Create PR against ${RELEASE_BRANCH}

Report back with:
- PR number
- Files changed
- Test results
- Any issues encountered"
```

### Group 2+: Dependent Tasks

After Group 1 completes, launch next group of Coder agents.

**Track Progress:**

```markdown
## 📊 IMPLEMENTATION PROGRESS

| Task | Status | PR | Tests |
|------|--------|-----|-------|
| task-1 | 🔄 Implementing | - | - |
| task-2 | ⏳ Waiting | - | - |
| task-3 | 🔄 Implementing | - | - |
```

Update as coders report back.

---

## Phase 6: Review (Parallel)

After ALL implementations complete, launch code reviews for each PR in **parallel**.

For each task with a PR:

```
Task tool with subagent_type="CodeReview":

"Review PR #${PR_NUMBER} for task-${N}.

This is part of swarm release ${SWARM_ID}.

Focus on:
- Security issues
- Test coverage
- Architecture alignment
- Code quality

Provide:
- Approval or changes requested
- Specific issues with file:line references
- Suggested fixes"
```

### Handle Review Results

If any PR needs changes:
1. Report issues to user
2. Optionally launch Coder agent to address feedback
3. Re-review after fixes

---

## Phase 7: Merge (Sequential)

Merge PRs in dependency order:

```bash
MERGE_ORDER=("task-3" "task-1" "task-2")

for TASK_ID in "${MERGE_ORDER[@]}"; do
    PR_NUMBER=${PR_NUMBERS[$TASK_ID]}

    echo "Merging ${TASK_ID} (PR #${PR_NUMBER})..."

    # Merge PR
    gh pr merge "${PR_NUMBER}" --squash --delete-branch

    # Pull latest release branch
    git checkout "${RELEASE_BRANCH}"
    git pull origin "${RELEASE_BRANCH}"

    # Run integration tests
    echo "Running integration tests..."
    npm test || {
        echo "❌ Tests failed after merging ${TASK_ID}"
        # Handle failure
    }

    echo "✅ ${TASK_ID} merged and verified"
done
```

---

## Phase 8: Final Release PR

Create PR from release branch to main:

```bash
gh pr create \
    --base "${BASE_BRANCH}" \
    --head "${RELEASE_BRANCH}" \
    --title "🚀 Release: ${SWARM_ID}" \
    --body "$(cat <<'EOF'
## Swarm Release

### Tasks Completed

| Task | PR | Description |
|------|-----|-------------|
| task-1 | #101 | ${TASK_1_DESC} |
| task-2 | #102 | ${TASK_2_DESC} |
| task-3 | #103 | ${TASK_3_DESC} |

### Summary

- **Tasks**: ${NUM_TASKS}
- **PRs Merged**: ${NUM_TASKS}
- **All Tests**: ✅ Passing

### Merge Order Used

1. task-3 (independent)
2. task-1 (foundational)
3. task-2 (dependent)

---

🤖 Generated by DevFlow Swarm
EOF
)"

RELEASE_PR_NUMBER=$(gh pr view --json number -q '.number')
echo ""
echo "🚀 Release PR: #${RELEASE_PR_NUMBER}"
```

---

## Phase 9: Cleanup

After release PR is created (or merged):

```bash
echo "=== CLEANUP ==="

# Remove worktrees
for worktree in .worktrees/*/; do
    git worktree remove "$worktree" --force 2>/dev/null
done
git worktree prune

# Archive state
mkdir -p .docs/swarm/archive
mv .docs/swarm/state.json ".docs/swarm/archive/${SWARM_ID}-state.json"
mv .docs/swarm/plans ".docs/swarm/archive/${SWARM_ID}-plans" 2>/dev/null

echo "✅ Cleanup complete"
```

---

## Final Report

```markdown
## 🎉 SWARM COMPLETE: ${SWARM_ID}

### Summary

| Metric | Value |
|--------|-------|
| Tasks | ${NUM_TASKS} |
| PRs Created | ${NUM_PRS} |
| PRs Merged | ${NUM_MERGED} |
| Duration | ${DURATION} |

### Task Results

| Task | Description | PR | Status |
|------|-------------|-----|--------|
| task-1 | ${DESC} | #101 | ✅ Merged |
| task-2 | ${DESC} | #102 | ✅ Merged |
| task-3 | ${DESC} | #103 | ✅ Merged |

### Artifacts

- **Release PR**: #${RELEASE_PR_NUMBER}
- **Archive**: .docs/swarm/archive/${SWARM_ID}-*

### Next Steps

1. Review release PR #${RELEASE_PR_NUMBER}
2. Merge to ${BASE_BRANCH}
3. Tag release: \`/release\`
```

---

## Orchestration Rules

1. **Parallelize aggressively** - Explore all tasks together, Plan all tasks together
2. **Sequence when needed** - Implement dependent tasks after their dependencies
3. **User checkpoints** - Get approval after analysis, before implementing
4. **Track everything** - State file knows status of all tasks
5. **Fail gracefully** - One task failure doesn't abort others
6. **Clean up always** - Remove worktrees even on failure

---

## Error Handling

### Task Failure

If a Coder reports failure:

```markdown
## ⚠️ TASK FAILURE

**Task**: task-2
**Phase**: Implementation
**Error**: Tests failing

### Options

1. **Skip task** - Proceed with other tasks, handle task-2 separately
2. **Debug** - Launch debug agent to investigate
3. **Abort swarm** - Stop everything, clean up

**Recommendation**: {based on failure type}
```

### Merge Conflict

If PR can't merge cleanly:

```markdown
## ⚠️ MERGE CONFLICT

**Task**: task-2
**PR**: #102
**Conflicting with**: task-1 changes

### Resolution Options

1. **Rebase** - Update task-2 branch on latest release
2. **Manual** - Resolve conflicts manually
3. **Skip** - Don't merge task-2, handle separately

**Action**: Rebasing task-2 branch...
```

---

## Abort Command

If user wants to abort:

```bash
# Close all PRs
for branch in $(git branch -r | grep "swarm/${SWARM_ID}"); do
    PR=$(gh pr list --head "${branch#origin/}" --json number -q '.[0].number')
    [ -n "$PR" ] && gh pr close "$PR"
done

# Delete release branch
git push origin --delete "${RELEASE_BRANCH}"
git branch -D "${RELEASE_BRANCH}"

# Cleanup worktrees
for wt in .worktrees/*/; do
    git worktree remove "$wt" --force
done

# Remove state
rm -rf .docs/swarm/plans
rm -f .docs/swarm/state.json

echo "✅ Swarm aborted and cleaned up"
```
