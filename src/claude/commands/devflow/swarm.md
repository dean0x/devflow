---
description: Execute a single task through the complete lifecycle - orchestrates exploration, planning, implementation, and review with parallel agents
---

# Swarm Command - Single Task Lifecycle Orchestrator

Orchestrate a single task from exploration through implementation to review by spawning multiple specialized agents in parallel where beneficial.

## Usage

```
/swarm <task description>
/swarm #42  (GitHub issue number)
```

Example:
```
/swarm Implement user authentication with JWT tokens
/swarm #42
```

Swarm handles a single task end-to-end. For multiple independent tasks, run separate `/swarm` commands.

---

## Input

You receive:
- `TASK_DESCRIPTION`: What to implement (or GitHub issue number)
- `WORKTREE_DIR`: Isolated worktree path (optional, generated if not provided)
- `TASK_BRANCH`: Branch name for this task (optional, generated if not provided)
- `TARGET_BRANCH`: Branch to create PR against (default: current branch)

If not provided, generate defaults:

```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
TASK_ID="task-${TIMESTAMP}"
TASK_BRANCH="swarm/${TASK_ID}"
TARGET_BRANCH=$(git branch --show-current)
WORKTREE_DIR=".worktrees/${TASK_ID}"

# Create worktree
mkdir -p .worktrees
git worktree add -b "${TASK_BRANCH}" "${WORKTREE_DIR}" "${TARGET_BRANCH}"
```

## Your Mission

Orchestrate the complete task lifecycle with parallel agents:

```
EXPLORE (parallel) → PLAN (parallel) → IMPLEMENT (parallel if possible) → REVIEW (parallel) → REPORT
```

**Output**: A PR that's ready for merge (or issues that need addressing).

---

## Phase 1: Fetch Task Details (if issue number)

If input is a GitHub issue number:

```
Task tool with subagent_type="GetIssue":
"Fetch details for GitHub issue #${ISSUE_NUMBER}

Return: title, description, acceptance criteria, labels, linked issues"
```

---

## Phase 2: Explore (Parallel Agents)

Spawn multiple Explore agents to understand different aspects.

**Spawn in a single message (parallel execution):**

```
Task tool with subagent_type="Explore":
"Explore ARCHITECTURE for: ${TASK_DESCRIPTION}

Working directory: ${WORKTREE_DIR}

Find:
- Similar implementations in codebase
- Architectural patterns used
- Module/component structure
- How similar features are organized

Thoroughness: medium
Report: architecture patterns with file:line references"

Task tool with subagent_type="Explore":
"Explore INTEGRATION POINTS for: ${TASK_DESCRIPTION}

Working directory: ${WORKTREE_DIR}

Find:
- Entry points (routes, handlers, CLI)
- Services this will interact with
- Database models affected
- Configuration needed

Thoroughness: medium
Report: integration points with file:line references"

Task tool with subagent_type="Explore":
"Explore REUSABLE CODE for: ${TASK_DESCRIPTION}

Working directory: ${WORKTREE_DIR}

Find:
- Existing utilities to leverage
- Helper functions
- Validation patterns
- Error handling patterns
- Logging patterns

Thoroughness: medium
Report: reusable code with file:line references"

Task tool with subagent_type="Explore":
"Explore EDGE CASES for: ${TASK_DESCRIPTION}

Working directory: ${WORKTREE_DIR}

Find how similar features handle:
- Invalid input scenarios
- Missing dependencies / external service failures
- Race conditions / concurrent requests
- Permission / authorization failures
- Resource limits

Thoroughness: quick
Report: edge case patterns with file:line references"
```

### Synthesize Exploration

Combine findings into:
- Patterns to follow (with file:line)
- Integration points (with file:line)
- Code to reuse (with file:line)
- Edge cases to handle

---

## Phase 3: Plan (Parallel Agents)

Spawn multiple Plan agents for different aspects.

**Spawn in a single message (parallel execution):**

```
Task tool with subagent_type="Plan":
"Plan IMPLEMENTATION STEPS for: ${TASK_DESCRIPTION}

Based on exploration:
${EXPLORATION_SUMMARY}

Create detailed step-by-step implementation plan:
- Files to create/modify
- Order of changes
- Dependencies between steps
- What each step produces

Output: Ordered implementation steps with file paths"

Task tool with subagent_type="Plan":
"Plan TESTING STRATEGY for: ${TASK_DESCRIPTION}

Based on exploration:
${EXPLORATION_SUMMARY}

Design testing approach:
- Unit tests needed
- Integration tests needed
- Edge cases to test
- Test file locations

Output: Testing plan with specific test cases"

Task tool with subagent_type="Plan":
"Analyze PARALLELIZATION for: ${TASK_DESCRIPTION}

Based on exploration:
${EXPLORATION_SUMMARY}

Determine if work can be split:
- Independent components that don't share state
- Files that can be worked on simultaneously
- Work that MUST be sequential (shared dependencies)

Output:
- PARALLELIZABLE: [list of independent work units]
- SEQUENTIAL: [work that must be done in order]
- REASONING: [why this split]"
```

### Synthesize Planning

Combine into:
- Implementation steps (ordered)
- Testing strategy
- Parallelization decision

---

## Phase 4: Implement (Parallel Coders if Beneficial)

Based on the parallelization analysis, spawn Coder agents.

### If Work is Parallelizable

Spawn multiple Coder agents in a single message:

```
Task tool with subagent_type="Coder":
"Implement COMPONENT A: ${COMPONENT_A_DESCRIPTION}

TASK_ID: ${TASK_ID}-component-a
WORKTREE_DIR: ${WORKTREE_DIR}
TARGET_BRANCH: ${TARGET_BRANCH}

Implementation steps:
${COMPONENT_A_STEPS}

Patterns to follow:
${RELEVANT_PATTERNS}

After implementation:
- Write tests for this component
- Run tests, fix failures
- Create atomic commits
- DO NOT create PR yet (coordinator will do that)

Report: files changed, tests written, commit hashes"

Task tool with subagent_type="Coder":
"Implement COMPONENT B: ${COMPONENT_B_DESCRIPTION}

TASK_ID: ${TASK_ID}-component-b
WORKTREE_DIR: ${WORKTREE_DIR}
TARGET_BRANCH: ${TARGET_BRANCH}

Implementation steps:
${COMPONENT_B_STEPS}

Patterns to follow:
${RELEVANT_PATTERNS}

After implementation:
- Write tests for this component
- Run tests, fix failures
- Create atomic commits
- DO NOT create PR yet (coordinator will do that)

Report: files changed, tests written, commit hashes"
```

### If Work Must Be Sequential

Spawn a single Coder agent:

```
Task tool with subagent_type="Coder":
"Implement: ${TASK_DESCRIPTION}

TASK_ID: ${TASK_ID}
WORKTREE_DIR: ${WORKTREE_DIR}
TARGET_BRANCH: ${TARGET_BRANCH}
PLAN: ${IMPLEMENTATION_PLAN}

Implementation steps:
${ORDERED_STEPS}

Testing strategy:
${TESTING_STRATEGY}

Patterns to follow:
${PATTERNS}

Execute the plan:
1. Implement changes step by step
2. Write tests as specified
3. Run tests and fix any failures
4. Create atomic commits
5. Push and create PR against ${TARGET_BRANCH}

Report: PR number, files changed, test results"
```

### Verify Implementation

```bash
PR_NUMBER=$(gh pr list --head "${TASK_BRANCH}" --json number -q '.[0].number')
if [ -z "$PR_NUMBER" ]; then
    echo "ERROR: No PR created"
    exit 1
fi

PR_URL=$(gh pr view "$PR_NUMBER" --json url -q '.url')
echo "Implementation complete: PR #${PR_NUMBER}"
```

---

## Phase 5: Review (Parallel Agents)

Spawn review agents in parallel.

### Setup

```bash
BRANCH_SLUG=$(echo "${TASK_BRANCH}" | sed 's/\//-/g')
REVIEW_TIMESTAMP=$(date +%Y-%m-%d_%H%M)
REVIEW_DIR=".docs/reviews/${BRANCH_SLUG}"
mkdir -p "$REVIEW_DIR"

# Determine which reviews to run
CHANGED_FILES=$(git diff --name-only ${TARGET_BRANCH}...HEAD)
HAS_TS=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | head -1)
HAS_SQL=$(echo "$CHANGED_FILES" | grep -iE '\.(sql|prisma|drizzle)$' | head -1)
HAS_DEPS=$(echo "$CHANGED_FILES" | grep -E '(package\.json|requirements\.txt|Cargo\.toml)' | head -1)
```

### Spawn Review Agents (Parallel)

**Always run these 5 reviews in a single message:**

```
Task tool with subagent_type="SecurityReview":
"Review PR #${PR_NUMBER} for security issues.
Save report to: ${REVIEW_DIR}/security-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."

Task tool with subagent_type="ArchitectureReview":
"Review PR #${PR_NUMBER} for architecture issues.
Save report to: ${REVIEW_DIR}/architecture-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."

Task tool with subagent_type="PerformanceReview":
"Review PR #${PR_NUMBER} for performance issues.
Save report to: ${REVIEW_DIR}/performance-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."

Task tool with subagent_type="ComplexityReview":
"Review PR #${PR_NUMBER} for complexity issues.
Save report to: ${REVIEW_DIR}/complexity-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."

Task tool with subagent_type="TestsReview":
"Review PR #${PR_NUMBER} for test quality.
Save report to: ${REVIEW_DIR}/tests-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."
```

**Conditionally add based on file types:**

If TypeScript files changed, add:
```
Task tool with subagent_type="TypescriptReview":
"Review PR #${PR_NUMBER} for TypeScript issues.
Save report to: ${REVIEW_DIR}/typescript-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."
```

If database files changed, add:
```
Task tool with subagent_type="DatabaseReview":
"Review PR #${PR_NUMBER} for database issues.
Save report to: ${REVIEW_DIR}/database-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."
```

If dependency files changed, add:
```
Task tool with subagent_type="DependenciesReview":
"Review PR #${PR_NUMBER} for dependency issues.
Save report to: ${REVIEW_DIR}/dependencies-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."
```

### Aggregate Review Results

```markdown
| Condition | Status |
|-----------|--------|
| Any CRITICAL issues | BLOCKED |
| Any HIGH issues | CHANGES_REQUESTED |
| Only MEDIUM/LOW | APPROVED |
```

### Handle Review Results

```markdown
If APPROVED:
    → Task complete, ready for merge

If CHANGES_REQUESTED:
    → Report issues found
    → PR needs attention before merge
    → User can run /resolve-comments to address feedback

If BLOCKED:
    → Report blocking issues
    → Do not proceed
```

**Swarm does NOT auto-fix review issues.** Comment resolution is explicit via `/resolve-comments`.

---

## Phase 6: Report

Return results to user:

```markdown
## Swarm Task Complete: ${TASK_ID}

### Task
${TASK_DESCRIPTION}

### Status: ${STATUS}

| Metric | Value |
|--------|-------|
| PR Number | #${PR_NUMBER} |
| PR URL | ${PR_URL} |
| Explore Agents | ${NUM_EXPLORERS} |
| Plan Agents | ${NUM_PLANNERS} |
| Coder Agents | ${NUM_CODERS} (${PARALLEL_OR_SEQUENTIAL}) |
| Review Agents | ${NUM_REVIEWERS} |
| Commits | ${NUM_COMMITS} |
| Files Changed | ${NUM_FILES} |
| Review Status | ${REVIEW_STATUS} |

### Files Touched
${LIST_OF_FILES}

### Blocking Issues (if any)
${BLOCKING_ISSUES}

### Ready for Merge: ${YES_NO}
```

---

## Error Handling

### Exploration Failure

```markdown
## Exploration Failed

**Error**: ${ERROR_MESSAGE}

**Options**:
1. Retry exploration with different focus
2. Proceed with limited context
3. Escalate to user

**Recommendation**: ${RECOMMENDATION}
```

### Implementation Failure

```markdown
## Implementation Failed

**Phase**: ${FAILED_PHASE}
**Error**: ${ERROR_MESSAGE}

**Options**:
1. Spawn Debug agent to investigate
2. Retry with single Coder
3. Escalate to user

**Recommendation**: ${RECOMMENDATION}
```

### Review Issues Found

```markdown
## Review Found Issues

**PR**: #${PR_NUMBER}
**Issues Found**: ${LIST_OF_ISSUES}

**Next Steps**:
Run `/resolve-comments #${PR_NUMBER}` to address feedback.
```

---

## Cleanup (if standalone)

After PR is merged:

```bash
git worktree remove "${WORKTREE_DIR}" --force
git worktree prune
git branch -d "${TASK_BRANCH}" 2>/dev/null

echo "Cleanup complete"
```

---

## Architecture

```
/swarm (command - runs in main context)
├── spawns: GetIssue agent (if issue number provided)
├── spawns: 4 Explore agents (parallel)
│   ├── Architecture exploration
│   ├── Integration points exploration
│   ├── Reusable code exploration
│   └── Edge cases exploration
├── synthesizes exploration results
├── spawns: 3 Plan agents (parallel)
│   ├── Implementation steps
│   ├── Testing strategy
│   └── Parallelization analysis
├── spawns: 1-N Coder agents (parallel if work is parallelizable)
│   └── Each works on independent component
├── creates PR (if parallel coders, merges their work first)
├── spawns: 5-8 review-* agents (parallel)
│   └── Security, Architecture, Performance, Complexity, Tests, [TypeScript, Database, Dependencies]
└── reports results
```

---

## Principles

1. **Parallel by default** - Explore, plan, and review in parallel
2. **Smart parallelization** - Split implementation when beneficial
3. **Sequential when needed** - Respect dependencies between components
4. **Comprehensive review** - All PRs get full review coverage
5. **Honest reporting** - Surface all issues, don't hide failures
6. **Isolated execution** - Worktree prevents interference
