---
description: Execute a single task through the complete lifecycle - orchestrates exploration, planning, implementation, and review with parallel agents
---

# Implement Command - Single Task Lifecycle Orchestrator

Orchestrate a single task from exploration through implementation to review by spawning specialized agents. The orchestrator only spawns agents and passes context - all work is done by agents.

## Usage

```
/implement <task description>
/implement #42  (GitHub issue number)
/implement      (use conversation context)
```

---

## Input

`$ARGUMENTS` contains whatever follows `/implement`:

- `/implement implement JWT auth` → `$ARGUMENTS` = "implement JWT auth"
- `/implement #42` → `$ARGUMENTS` = "#42" (GitHub issue)
- `/implement` → `$ARGUMENTS` = "" (use conversation context)

---

## Context

```bash
# Capture input
TASK_INPUT="$ARGUMENTS"

# Generate identifiers
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
TASK_ID="task-${TIMESTAMP}"
TASK_BRANCH="implement/${TASK_ID}"
TARGET_BRANCH=$(git branch --show-current)
WORKTREE_DIR=".worktrees/${TASK_ID}"

echo "=== IMPLEMENT: ${TASK_ID} ==="
echo "Input: ${TASK_INPUT:-'(from conversation context)'}"
echo "Branch: ${TASK_BRANCH}"
echo "Target: ${TARGET_BRANCH}"
```

---

## Phase 1: Setup

### Create Worktree

```bash
mkdir -p .worktrees
git worktree add -b "${TASK_BRANCH}" "${WORKTREE_DIR}" "${TARGET_BRANCH}"
echo "Worktree: ${WORKTREE_DIR}"
```

### Fetch Issue Details (if issue number)

If input is a GitHub issue number, spawn GetIssue agent:

```
Task(subagent_type="GetIssue"):

"Fetch details for GitHub issue #${ISSUE_NUMBER}

Return: title, description, acceptance criteria, labels, linked issues"
```

---

## Phase 1.5: Orient

Spawn Skimmer agent to get codebase overview before detailed exploration:

```
Task(subagent_type="Skimmer"):
"Orient in codebase for: ${TASK_DESCRIPTION}
Working directory: ${WORKTREE_DIR}

Use skim to:
1. Get project structure overview
2. Identify relevant source directories
3. Find files/functions related to the task
4. Detect existing patterns

Return: Codebase map with relevant files, key functions, integration points"
```

Capture orientation output:

```bash
CODEBASE_ORIENTATION="${SKIMMER_OUTPUT}"
```

---

## Phase 2: Explore (Parallel)

Spawn 4 Explore agents **in a single message**, passing Skimmer context:

```
Task(subagent_type="Explore"):
"Explore ARCHITECTURE for: ${TASK_DESCRIPTION}
Working directory: ${WORKTREE_DIR}
Codebase orientation: ${CODEBASE_ORIENTATION}
Thoroughness: medium
Find: Similar implementations, architectural patterns, module structure"

Task(subagent_type="Explore"):
"Explore INTEGRATION POINTS for: ${TASK_DESCRIPTION}
Working directory: ${WORKTREE_DIR}
Codebase orientation: ${CODEBASE_ORIENTATION}
Thoroughness: medium
Find: Entry points, services, database models, configuration"

Task(subagent_type="Explore"):
"Explore REUSABLE CODE for: ${TASK_DESCRIPTION}
Working directory: ${WORKTREE_DIR}
Codebase orientation: ${CODEBASE_ORIENTATION}
Thoroughness: medium
Find: Utilities, helpers, validation patterns, error handling"

Task(subagent_type="Explore"):
"Explore EDGE CASES for: ${TASK_DESCRIPTION}
Working directory: ${WORKTREE_DIR}
Codebase orientation: ${CODEBASE_ORIENTATION}
Thoroughness: quick
Find: Error scenarios, race conditions, permission failures"
```

### Failure Tracking

After collecting outputs, track success/failure status:

```bash
EXPLORER_STATUS=""
FAILED_EXPLORATIONS=""

# Check each explorer output
if [ -z "$ARCHITECTURE_OUTPUT" ]; then
  FAILED_EXPLORATIONS="${FAILED_EXPLORATIONS}architecture,"
else
  EXPLORER_STATUS="${EXPLORER_STATUS}✅ Architecture "
fi

if [ -z "$INTEGRATION_OUTPUT" ]; then
  FAILED_EXPLORATIONS="${FAILED_EXPLORATIONS}integration,"
else
  EXPLORER_STATUS="${EXPLORER_STATUS}✅ Integration "
fi

if [ -z "$REUSABLE_CODE_OUTPUT" ]; then
  FAILED_EXPLORATIONS="${FAILED_EXPLORATIONS}reusable,"
else
  EXPLORER_STATUS="${EXPLORER_STATUS}✅ Reusable "
fi

if [ -z "$EDGE_CASES_OUTPUT" ]; then
  FAILED_EXPLORATIONS="${FAILED_EXPLORATIONS}edge-cases,"
else
  EXPLORER_STATUS="${EXPLORER_STATUS}✅ Edge Cases"
fi

echo "Explorer status: ${EXPLORER_STATUS}"
if [ -n "$FAILED_EXPLORATIONS" ]; then
  echo "⚠️ Failed explorations: ${FAILED_EXPLORATIONS}"
fi
```

Pass failure context to Synthesize agent so it can flag gaps in coverage.

---

## Phase 3: Synthesize Exploration

**WAIT** for Phase 2, then spawn Synthesize agent:

```
Task(subagent_type="Synthesize"):

"Synthesize EXPLORATION outputs for: ${TASK_DESCRIPTION}

Mode: exploration

Explorer outputs:
${ARCHITECTURE_OUTPUT}
${INTEGRATION_OUTPUT}
${REUSABLE_CODE_OUTPUT}
${EDGE_CASES_OUTPUT}

Failed explorations: ${FAILED_EXPLORATIONS:-none}

Combine into: patterns, integration points, reusable code, edge cases.
If any explorations failed, note the gap in your synthesis and recommend whether re-exploration is needed."
```

---

## Phase 4: Plan (Parallel)

Spawn 3 Plan agents **in a single message**:

```
Task(subagent_type="Plan"):
"Plan IMPLEMENTATION STEPS for: ${TASK_DESCRIPTION}
Exploration summary: ${EXPLORATION_SYNTHESIS}
Output: Ordered steps with files and dependencies"

Task(subagent_type="Plan"):
"Plan TESTING STRATEGY for: ${TASK_DESCRIPTION}
Exploration summary: ${EXPLORATION_SYNTHESIS}
Output: Unit tests, integration tests, edge case tests"

Task(subagent_type="Plan"):
"Analyze PARALLELIZATION for: ${TASK_DESCRIPTION}
Exploration summary: ${EXPLORATION_SYNTHESIS}
Output: PARALLELIZABLE vs SEQUENTIAL work units"
```

---

## Phase 5: Synthesize Planning

**WAIT** for Phase 4, then spawn Synthesize agent:

```
Task(subagent_type="Synthesize"):

"Synthesize PLANNING outputs for: ${TASK_DESCRIPTION}

Mode: planning

Planner outputs:
${IMPLEMENTATION_STEPS}
${TESTING_STRATEGY}
${PARALLELIZATION_ANALYSIS}

Combine into: execution plan with parallel/sequential decision"
```

---

## Phase 6: Implement

Based on synthesis, spawn Coder agent(s).

### If PARALLEL (multiple independent components)

Spawn multiple Coder agents **in a single message**:

```
Task(subagent_type="Coder"):
"Implement COMPONENT A: ${COMPONENT_A_DESCRIPTION}
TASK_ID: ${TASK_ID}-a
WORKTREE_DIR: ${WORKTREE_DIR}
Steps: ${COMPONENT_A_STEPS}
Patterns: ${PATTERNS}
DO NOT create PR - coordinator will handle"

Task(subagent_type="Coder"):
"Implement COMPONENT B: ${COMPONENT_B_DESCRIPTION}
TASK_ID: ${TASK_ID}-b
WORKTREE_DIR: ${WORKTREE_DIR}
Steps: ${COMPONENT_B_STEPS}
Patterns: ${PATTERNS}
DO NOT create PR - coordinator will handle"
```

### If SEQUENTIAL (dependent work)

Spawn single Coder agent:

```
Task(subagent_type="Coder"):
"Implement: ${TASK_DESCRIPTION}
TASK_ID: ${TASK_ID}
WORKTREE_DIR: ${WORKTREE_DIR}
TARGET_BRANCH: ${TARGET_BRANCH}
Plan: ${EXECUTION_PLAN}
Create PR against ${TARGET_BRANCH} when complete"
```

---

## Phase 7: Create PR (if parallel implementation)

If multiple Coders were used, apply `devflow-pull-request` skill patterns to create unified PR:

```bash
# Apply devflow-pull-request patterns for comprehensive PR
# 1. Analyze all commits from parallel coders
# 2. Generate title following conventional format
# 3. Create description with all required sections
# 4. Run gh pr create

cd "${WORKTREE_DIR}"
git push -u origin "${TASK_BRANCH}"

# Create PR using devflow-pull-request patterns
gh pr create \
  --base "${TARGET_BRANCH}" \
  --head "${TASK_BRANCH}" \
  --title "${PR_TITLE}" \
  --body "${PR_DESCRIPTION}"
```

Capture PR info:

```bash
PR_NUMBER=$(gh pr view --json number -q '.number')
PR_URL=$(gh pr view --json url -q '.url')
```

---

## Phase 8: Code Review

**Invoke the `/review` command** to run comprehensive review. This ensures review orchestration logic is not duplicated.

The `/review` command will:
1. Spawn Reviewer agents in parallel (7 always + conditional)
2. Each Reviewer focuses on one area (security, architecture, performance, etc.)
3. Create PR inline comments for blocking issues
4. Track pre-existing issues in tech debt backlog
5. Synthesize findings with merge recommendation

```bash
# /review handles:
# - Spawning Reviewer agents with focus areas
# - Comment agent for PR comments
# - TechDebt agent for backlog tracking
# - Summary agent for recommendation
```

The review outputs are captured from the `/review` command's final report.

---

## Phase 9: Final Report

Display agent outputs:

```markdown
## ✅ Implementation Complete: ${TASK_ID}

### Task
${TASK_DESCRIPTION}

---

### 🚦 Status: {from Summary agent}

---

### 📊 Execution Summary

| Phase | Agents | Status |
|-------|--------|--------|
| Orient | 1 (Skimmer) | ✅ |
| Explore | 4 | ✅ |
| Plan | 3 | ✅ |
| Implement | {n} ({parallel/sequential}) + self-review | ✅ |
| Review | via /review command | ✅ |

---

### 📝 PR (from PullRequest/Coder agent)
- Number: #${PR_NUMBER}
- URL: ${PR_URL}
- Files: {n} changed
- Commits: {n}

---

### 💬 Comments (from Comment agent)
- Inline: {n} created
- Skipped: {n}

---

### 📋 Tech Debt (from TechDebt agent)
- Issue: #{issue}
- Added: {n}

---

### 🎯 Next Steps (from Summary agent)
{Based on recommendation}

If BLOCKED: Fix issues, address PR comments directly
If APPROVED: Ready to merge
```

---

## Error Handling

### Agent Failure

If any agent fails:

```markdown
## ⚠️ Implementation Error

**Phase**: {phase}
**Agent**: {agent type}
**Error**: {error message}

**Options**:
1. Retry phase
2. Investigate the error systematically
3. Escalate to user
```

---

## Cleanup

After task complete (manual or hook):

```bash
git worktree remove "${WORKTREE_DIR}" --force
git worktree prune
```

---

## Architecture

```
/implement (orchestrator - spawns agents only)
│
├─ Phase 1: Setup
│  └─ GetIssue agent (if issue number)
│
├─ Phase 1.5: Orient
│  └─ Skimmer agent (codebase overview via skim)
│
├─ Phase 2: Explore (PARALLEL, with Skimmer context)
│  ├─ Explore: Architecture
│  ├─ Explore: Integration
│  ├─ Explore: Reusable code
│  └─ Explore: Edge cases
│
├─ Phase 3: Synthesize Exploration
│  └─ Synthesize agent (mode: exploration)
│
├─ Phase 4: Plan (PARALLEL)
│  ├─ Plan: Implementation steps
│  ├─ Plan: Testing strategy
│  └─ Plan: Parallelization
│
├─ Phase 5: Synthesize Planning
│  └─ Synthesize agent (mode: planning)
│
├─ Phase 6: Implement
│  └─ 1-N Coder agents (parallel if beneficial)
│  └─ Each Coder runs self-review via Stop hook (9 pillars)
│
├─ Phase 7: Create PR (if parallel coders)
│  └─ Apply devflow-pull-request patterns
│
├─ Phase 8: Code Review
│  └─ Invokes /review command (DRY - no duplication)
│      ├─ Reviewer agents (7 focus areas + conditional)
│      ├─ Comment agent
│      ├─ TechDebt agent
│      └─ Summary agent
│
└─ Phase 9: Display agent outputs
```

---

## Principles

1. **Orchestration only** - Command spawns agents, never does work itself
2. **Parallel by default** - Explore, plan, review, synthesis all parallel
3. **Agent ownership** - Each agent owns its output completely
4. **Consistent patterns** - Same synthesis agents as `/review`
5. **Clean handoffs** - Each phase passes structured data to next
6. **Honest reporting** - Display agent outputs directly
