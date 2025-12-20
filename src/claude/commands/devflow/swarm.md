---
description: Execute a single task through the complete lifecycle - orchestrates Design, Coder, and Review agents
---

# Swarm Command - Single Task Lifecycle Orchestrator

Orchestrate a single task from design through implementation to review by spawning specialized agents for each phase.

## Usage

```
/swarm <task description>
```

Example:
```
/swarm Implement user authentication with JWT tokens
```

For multi-task parallel execution, use `/coordinate` instead.

---

## Input

You receive:
- `TASK_DESCRIPTION`: What to implement
- `WORKTREE_DIR`: Isolated worktree path (e.g., `.worktrees/task-1`)
- `TASK_BRANCH`: Branch name for this task (e.g., `swarm/release-1/task-1`)
- `TARGET_BRANCH`: Branch to create PR against (e.g., `release/swarm-2025-01-15`)
- `TASK_ID`: Identifier for this task (e.g., `task-1`)

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

Orchestrate the complete task lifecycle by spawning specialized agents:

```
DESIGN (Design agent) → IMPLEMENT (Coder agent) → REVIEW (review-* agents) → REPORT
```

**Output**: A PR that's ready for merge (or issues that need addressing).

---

## Phase 1: Design

Spawn the Design agent to create a detailed implementation plan.

```
Task tool with subagent_type="Design":

"Create implementation design for: ${TASK_DESCRIPTION}

Working directory: ${WORKTREE_DIR}
Target branch: ${TARGET_BRANCH}

Explore the codebase, understand existing patterns, and create a detailed
implementation plan. Save the design to: .docs/design/${TASK_ID}-design.md

Be thorough - this plan will be executed by the Coder agent."
```

### Design Output Expected

The Design agent will:
1. Explore architecture, integration points, and reusable code inline
2. Synthesize findings and clarify ambiguities with user
3. Create detailed implementation plan
4. Persist design document

**Wait for Design agent to complete before proceeding.**

### Verify Design

```bash
DESIGN_FILE=".docs/design/${TASK_ID}-design.md"
if [ ! -f "$DESIGN_FILE" ]; then
    echo "ERROR: Design document not created"
    exit 1
fi

echo "✅ Design complete: $DESIGN_FILE"
```

---

## Phase 2: Implement

Spawn the Coder agent to execute the implementation plan.

```
Task tool with subagent_type="Coder":

"Implement the task according to the design document.

TASK_ID: ${TASK_ID}
TASK_DESCRIPTION: ${TASK_DESCRIPTION}
WORKTREE_DIR: ${WORKTREE_DIR}
TARGET_BRANCH: ${TARGET_BRANCH}
PLAN_FILE: .docs/design/${TASK_ID}-design.md

The design document contains:
- Files to modify/create
- Implementation steps
- Testing strategy
- Patterns to follow

Execute the plan:
1. Implement changes according to design
2. Write tests as specified
3. Run tests and fix any failures
4. Create atomic commits
5. Push and create PR against ${TARGET_BRANCH}

Report back with: PR number, files changed, test results."
```

### Coder Output Expected

The Coder agent will:
1. Read the design document
2. Implement changes step by step
3. Write and run tests
4. Create commits with descriptive messages
5. Push branch and create PR

**Wait for Coder agent to complete.**

### Verify Implementation

```bash
# Check PR was created
PR_NUMBER=$(gh pr list --head "${TASK_BRANCH}" --json number -q '.[0].number')
if [ -z "$PR_NUMBER" ]; then
    echo "ERROR: No PR created"
    exit 1
fi

PR_URL=$(gh pr view "$PR_NUMBER" --json url -q '.url')
echo "✅ Implementation complete: PR #${PR_NUMBER}"
echo "   URL: ${PR_URL}"
```

---

## Phase 3: Review (Inline Orchestration)

Run reviews by spawning review-* agents directly. Do NOT spawn a Review orchestrator.

### Setup

```bash
BRANCH_SLUG=$(echo "${TASK_BRANCH}" | sed 's/\//-/g')
REVIEW_TIMESTAMP=$(date +%Y-%m-%d_%H%M)
REVIEW_DIR=".docs/reviews/${BRANCH_SLUG}"
mkdir -p "$REVIEW_DIR"

# Get changed files for review selection
CHANGED_FILES=$(git diff --name-only ${TARGET_BRANCH}...HEAD)
```

### Determine Relevant Reviews

```bash
HAS_TS=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | head -1)
HAS_SQL=$(echo "$CHANGED_FILES" | grep -iE '\.(sql|prisma|drizzle)$' | head -1)
HAS_DEPS=$(echo "$CHANGED_FILES" | grep -E '(package\.json|requirements\.txt|Cargo\.toml)' | head -1)
```

### Spawn Review Agents (Parallel)

**Always run these 5 reviews:**

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

**Conditionally run based on file types:**

If TypeScript files changed:
```
Task tool with subagent_type="TypescriptReview":
"Review PR #${PR_NUMBER} for TypeScript issues.
Save report to: ${REVIEW_DIR}/typescript-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."
```

If database files changed:
```
Task tool with subagent_type="DatabaseReview":
"Review PR #${PR_NUMBER} for database issues.
Save report to: ${REVIEW_DIR}/database-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."
```

If dependency files changed:
```
Task tool with subagent_type="DependenciesReview":
"Review PR #${PR_NUMBER} for dependency issues.
Save report to: ${REVIEW_DIR}/dependencies-report.${REVIEW_TIMESTAMP}.md
Create PR line comments for issues found."
```

### Aggregate Results

After all reviews complete, read reports and determine status:

```markdown
| Condition | Status |
|-----------|--------|
| Any CRITICAL issues | ❌ BLOCKED |
| Any HIGH issues | ⚠️ CHANGES_REQUESTED |
| Only MEDIUM/LOW | ✅ APPROVED |
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

## Phase 4: Report

Return results to user:

```markdown
## 🔄 Swarm Task Complete: ${TASK_ID}

### Task
${TASK_DESCRIPTION}

### Status: ${STATUS}

| Metric | Value |
|--------|-------|
| PR Number | #${PR_NUMBER} |
| PR URL | ${PR_URL} |
| Design Doc | .docs/design/${TASK_ID}-design.md |
| Commits | ${NUM_COMMITS} |
| Files Changed | ${NUM_FILES} |
| Review Status | ${REVIEW_STATUS} |
| Reviews Run | ${NUM_REVIEWS} |

### Files Touched
${LIST_OF_FILES}

### Blocking Issues (if any)
${BLOCKING_ISSUES}

### Ready for Merge: ${YES_NO}
```

---

## Error Handling

### Design Failure

If Design agent fails:

```markdown
## ❌ Design Phase Failed

**Task**: ${TASK_ID}
**Error**: ${ERROR_MESSAGE}

**Options**:
1. Retry Design phase
2. Escalate to user for manual design
3. Skip task

**Recommendation**: ${RECOMMENDATION}
```

### Implementation Failure

If Coder agent fails:

```markdown
## ❌ Implementation Failed

**Task**: ${TASK_ID}
**Phase**: Implementation (Coder agent)
**Error**: ${ERROR_MESSAGE}

**Options**:
1. Spawn Debug agent to investigate
2. Retry with Coder agent
3. Escalate to user
4. Skip task

**Recommendation**: ${RECOMMENDATION}
```

### Review Issues Found

```markdown
## ⚠️ Review Found Issues

**Task**: ${TASK_ID}
**PR**: #${PR_NUMBER}

**Issues Found**:
${LIST_OF_ISSUES}

**Next Steps**:
Run `/resolve-comments #${PR_NUMBER}` to address feedback systematically.
```

---

## Cleanup (if standalone)

If running as standalone (not part of orchestrator):

```bash
# After PR is merged, cleanup worktree
git worktree remove "${WORKTREE_DIR}" --force
git worktree prune
git branch -d "${TASK_BRANCH}" 2>/dev/null

echo "✅ Cleanup complete"
```

---

## Principles

1. **Orchestrate, don't implement** - Spawn specialized agents for each phase
2. **Single responsibility** - One task, one lifecycle
3. **Direct agent spawning** - Spawn worker agents directly, no orchestrator chains
4. **Isolated execution** - Worktree prevents interference
5. **Honest reporting** - Surface all issues, don't hide failures
6. **Retry with limits** - Attempt recovery, but escalate if stuck
