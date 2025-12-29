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

## Phase 2: Explore (Parallel)

Spawn 4 Explore agents **in a single message**:

```
Task(subagent_type="Explore"):
"Explore ARCHITECTURE for: ${TASK_DESCRIPTION}
Working directory: ${WORKTREE_DIR}
Thoroughness: medium
Find: Similar implementations, architectural patterns, module structure"

Task(subagent_type="Explore"):
"Explore INTEGRATION POINTS for: ${TASK_DESCRIPTION}
Working directory: ${WORKTREE_DIR}
Thoroughness: medium
Find: Entry points, services, database models, configuration"

Task(subagent_type="Explore"):
"Explore REUSABLE CODE for: ${TASK_DESCRIPTION}
Working directory: ${WORKTREE_DIR}
Thoroughness: medium
Find: Utilities, helpers, validation patterns, error handling"

Task(subagent_type="Explore"):
"Explore EDGE CASES for: ${TASK_DESCRIPTION}
Working directory: ${WORKTREE_DIR}
Thoroughness: quick
Find: Error scenarios, race conditions, permission failures"
```

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

Combine into: patterns, integration points, reusable code, edge cases"
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

If multiple Coders were used, spawn PullRequest agent to create unified PR:

```
Task(subagent_type="PullRequest"):

"Create PR for swarm task: ${TASK_DESCRIPTION}

TASK_BRANCH: ${TASK_BRANCH}
TARGET_BRANCH: ${TARGET_BRANCH}
WORKTREE_DIR: ${WORKTREE_DIR}

Commits from: ${CODER_COMMITS}

Create comprehensive PR description"
```

Capture PR info:

```bash
PR_NUMBER=$(gh pr view --json number -q '.number')
PR_URL=$(gh pr view --json url -q '.url')
```

---

## Phase 8: Review (Parallel)

Setup:

```bash
BRANCH_SLUG=$(echo "${TASK_BRANCH}" | sed 's/\//-/g')
REVIEW_TIMESTAMP=$(date +%Y-%m-%d_%H%M)
REVIEW_DIR=".docs/reviews/${BRANCH_SLUG}"
mkdir -p "$REVIEW_DIR"
```

Spawn 6 review agents **in a single message**:

```
Task(subagent_type="SecurityReview"):
"Review PR #${PR_NUMBER}. Save: ${REVIEW_DIR}/security-report.${REVIEW_TIMESTAMP}.md"

Task(subagent_type="ArchitectureReview"):
"Review PR #${PR_NUMBER}. Save: ${REVIEW_DIR}/architecture-report.${REVIEW_TIMESTAMP}.md"

Task(subagent_type="PerformanceReview"):
"Review PR #${PR_NUMBER}. Save: ${REVIEW_DIR}/performance-report.${REVIEW_TIMESTAMP}.md"

Task(subagent_type="ComplexityReview"):
"Review PR #${PR_NUMBER}. Save: ${REVIEW_DIR}/complexity-report.${REVIEW_TIMESTAMP}.md"

Task(subagent_type="ConsistencyReview"):
"Review PR #${PR_NUMBER}. Save: ${REVIEW_DIR}/consistency-report.${REVIEW_TIMESTAMP}.md"

Task(subagent_type="TestsReview"):
"Review PR #${PR_NUMBER}. Save: ${REVIEW_DIR}/tests-report.${REVIEW_TIMESTAMP}.md"
```

**Conditionally add** (based on changed files):
- `TypescriptReview` - if .ts/.tsx files
- `DatabaseReview` - if SQL/migration files
- `DependenciesReview` - if package.json/requirements.txt

---

## Phase 9: Review Synthesis (Parallel)

**WAIT** for Phase 8, then spawn synthesis agents **in a single message**:

```
Task(subagent_type="Comment"):
"Create PR comments for swarm task.
PR_NUMBER: ${PR_NUMBER}
REVIEW_BASE_DIR: ${REVIEW_DIR}
TIMESTAMP: ${REVIEW_TIMESTAMP}
Create inline comments, consolidate skipped into summary"

Task(subagent_type="TechDebt"):
"Track tech debt for swarm task.
REVIEW_DIR: ${REVIEW_DIR}
TIMESTAMP: ${REVIEW_TIMESTAMP}
Add pre-existing issues to backlog"

Task(subagent_type="Summary"):
"Synthesize review findings for swarm task.
PR_NUMBER: ${PR_NUMBER}
REVIEW_BASE_DIR: ${REVIEW_DIR}
TIMESTAMP: ${REVIEW_TIMESTAMP}
Generate summary with merge recommendation"
```

---

## Phase 10: Final Report

Display agent outputs:

```markdown
## 🐝 Swarm Complete: ${TASK_ID}

### Task
${TASK_DESCRIPTION}

---

### 🚦 Status: {from Summary agent}

---

### 📊 Execution Summary

| Phase | Agents | Status |
|-------|--------|--------|
| Explore | 4 | ✅ |
| Plan | 3 | ✅ |
| Implement | {n} ({parallel/sequential}) | ✅ |
| Review | {n} | ✅ |
| Synthesis | 3 | ✅ |

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

If BLOCKED: Fix issues, run `/resolve-comments`
If APPROVED: Ready to merge
```

---

## Error Handling

### Agent Failure

If any agent fails:

```markdown
## ⚠️ Swarm Error

**Phase**: {phase}
**Agent**: {agent type}
**Error**: {error message}

**Options**:
1. Retry phase
2. Spawn Debug agent to investigate
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
├─ Phase 2: Explore (PARALLEL)
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
│
├─ Phase 7: Create PR (if parallel coders)
│  └─ PullRequest agent
│
├─ Phase 8: Review (PARALLEL)
│  ├─ SecurityReview
│  ├─ ArchitectureReview
│  ├─ PerformanceReview
│  ├─ ComplexityReview
│  ├─ ConsistencyReview
│  ├─ TestsReview
│  └─ (conditional: TypeScript, Database, Dependencies)
│
├─ Phase 9: Review Synthesis (PARALLEL)
│  ├─ Comment agent
│  ├─ TechDebt agent
│  └─ Summary agent
│
└─ Phase 10: Display agent outputs
```

---

## Principles

1. **Orchestration only** - Command spawns agents, never does work itself
2. **Parallel by default** - Explore, plan, review, synthesis all parallel
3. **Agent ownership** - Each agent owns its output completely
4. **Consistent patterns** - Same synthesis agents as `/review`
5. **Clean handoffs** - Each phase passes structured data to next
6. **Honest reporting** - Display agent outputs directly
