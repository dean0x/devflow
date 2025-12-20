---
description: Coordinate a product release - parse release issue, prioritize features, execute parallel feature lifecycles, supervise progress
---

# Coordinator - Release Orchestrator

Coordinate feature development for a product release. Parse a GitHub release issue containing the release plan, prioritize features, execute feature lifecycles (Design → Coder → Review) in parallel, and supervise their progress until all features are ready.

**Does NOT handle merging or releasing** - that's a separate workflow.

## Usage

```
/coordinate #42
/coordinate https://github.com/org/repo/issues/42
```

The release issue should contain references to feature issues (e.g., `#101`, `#102`).

---

## Input

You receive:
- `RELEASE_ISSUE`: GitHub issue number or URL containing the release plan
- `BASE_BRANCH`: Branch to base work on (default: main)

## Your Mission

Coordinate feature development for a release:

```
PARSE → PRIORITIZE → SETUP → EXECUTE → SUPERVISE → REPORT
```

**Output**: All feature PRs ready for review, with progress tracked and issues surfaced.

---

## Phase 1: Parse Release Issue

### Fetch Release Issue

```bash
# Extract issue number from URL or use directly
ISSUE_NUMBER=$(echo "${RELEASE_ISSUE}" | grep -oE '[0-9]+$' || echo "${RELEASE_ISSUE}")

# Fetch issue details
gh issue view "${ISSUE_NUMBER}" --json title,body,labels,milestone

# Store for reference
gh issue view "${ISSUE_NUMBER}" > .docs/coordinate/release-issue.md
```

### Extract Feature Issues

Parse the release issue body to find referenced feature issues:

```markdown
Look for patterns:
- #123 (issue references)
- https://github.com/org/repo/issues/123 (full URLs)
- - [ ] #123 Feature name (checklist items)
- Fixes #123, Closes #123, Relates to #123
```

**For each referenced issue:**

```bash
# Fetch feature issue details
gh issue view "${FEATURE_ISSUE}" --json number,title,body,labels,assignees,state

# Extract:
# - Title (feature name)
# - Body (requirements/acceptance criteria)
# - Labels (priority, complexity, type)
# - State (open/closed - skip closed)
```

### Build Feature List

```markdown
## 📋 Release Features

| # | Issue | Title | Priority | Complexity | Dependencies |
|---|-------|-------|----------|------------|--------------|
| 1 | #101 | User authentication | P0 | High | None |
| 2 | #102 | Rate limiting | P1 | Medium | #101 |
| 3 | #103 | Dashboard redesign | P1 | Medium | None |
| 4 | #104 | API documentation | P2 | Low | #101, #102 |

### Closed/Completed (skip)
- #100 - Already merged
```

---

## Phase 2: Prioritize and Plan

### Analyze Dependencies

From issue bodies and labels, identify:

1. **Explicit dependencies**: "Depends on #X", "Blocked by #X"
2. **Implicit dependencies**: Shared code areas, API contracts
3. **Priority labels**: P0 (critical), P1 (high), P2 (medium), P3 (low)

### Build Dependency Graph

```markdown
## Dependency Analysis

#101 (User auth)
  └── blocks: #102, #104

#102 (Rate limiting)
  ├── depends on: #101
  └── blocks: #104

#103 (Dashboard)
  └── independent

#104 (API docs)
  └── depends on: #101, #102
```

### Determine Execution Order

```markdown
## Execution Plan

### Wave 1 (Parallel - no dependencies)
- #101 User authentication (P0)
- #103 Dashboard redesign (P1)

### Wave 2 (After Wave 1)
- #102 Rate limiting (P1) - requires #101

### Wave 3 (After Wave 2)
- #104 API documentation (P2) - requires #101, #102

### Parallelization
- Max concurrent feature lifecycles: 2-3 (based on complexity)
- Wave 1: 2 parallel
- Wave 2: 1 (waiting on #101)
- Wave 3: 1 (waiting on #102)
```

### User Checkpoint

Present the plan for approval:

```markdown
## 🚦 RELEASE PLAN: ${RELEASE_TITLE}

### Features to Implement: ${NUM_FEATURES}

| Wave | Issues | Parallel | Blocked By |
|------|--------|----------|------------|
| 1 | #101, #103 | 2 | - |
| 2 | #102 | 1 | #101 |
| 3 | #104 | 1 | #102 |

### Estimated Feature Lifecycles: ${TOTAL}

### Skipped (already complete)
- #100 (closed)

### Questions/Clarifications Needed
${LIST_ANY_AMBIGUITIES}

**Proceed with execution?** (yes/no/modify)
```

**Wait for user approval before proceeding.**

---

## Phase 3: Setup Infrastructure

### Create Release Branch

```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
RELEASE_ID="release-${ISSUE_NUMBER}-${TIMESTAMP}"
RELEASE_BRANCH="release/${RELEASE_ID}"

# Determine base branch
BASE_BRANCH="${BASE_BRANCH:-main}"
git checkout "${BASE_BRANCH}"
git pull origin "${BASE_BRANCH}"
git checkout -b "${RELEASE_BRANCH}"
git push -u origin "${RELEASE_BRANCH}"

echo "✅ Release branch: ${RELEASE_BRANCH}"
```

### Create Worktrees for Each Feature

```bash
mkdir -p .worktrees

for ISSUE in ${FEATURE_ISSUES[@]}; do
    TASK_ID="feature-${ISSUE}"
    WORKTREE_DIR=".worktrees/${TASK_ID}"
    BRANCH_NAME="${RELEASE_ID}/${TASK_ID}"

    git worktree add -b "${BRANCH_NAME}" "${WORKTREE_DIR}" "${RELEASE_BRANCH}"
    echo "✅ ${TASK_ID}: ${WORKTREE_DIR}"
done
```

### Initialize State

Create `.docs/coordinate/state.json`:

```json
{
  "release_id": "${RELEASE_ID}",
  "release_issue": "${ISSUE_NUMBER}",
  "release_branch": "${RELEASE_BRANCH}",
  "started_at": "$(date -Iseconds)",
  "status": "executing",
  "waves": [
    {
      "wave": 1,
      "status": "pending",
      "features": ["#101", "#103"]
    }
  ],
  "features": {
    "#101": {
      "title": "User authentication",
      "priority": "P0",
      "status": "pending",
      "wave": 1,
      "depends_on": [],
      "blocks": ["#102", "#104"],
      "worktree": ".worktrees/feature-101",
      "branch": "${RELEASE_ID}/feature-101",
      "pr_number": null,
      "lifecycle_status": null,
      "started_at": null,
      "completed_at": null,
      "error": null
    }
  },
  "completed": [],
  "failed": [],
  "blocked": []
}
```

---

## Phase 4: Execute Waves

### Wave Execution Loop

For each wave in order:

```
For wave in waves:
    1. Check all dependencies satisfied
    2. Execute feature lifecycle (Design → Coder → Review) for each feature
    3. Monitor progress
    4. Collect results
    5. Update state
    6. Proceed to next wave (or handle failures)
```

### Execute Feature Lifecycle (Inline Swarm Logic)

For each feature in current wave, run the complete lifecycle:

#### Step 1: Design Phase

Spawn Design agents for all features in wave (parallel):

```
Task tool with subagent_type="Design" (for each feature in wave):

"Create implementation design for GitHub issue #${ISSUE_NUMBER}: ${ISSUE_TITLE}

TASK_ID: feature-${ISSUE_NUMBER}
Working directory: .worktrees/feature-${ISSUE_NUMBER}
Target branch: ${RELEASE_BRANCH}

Requirements from issue:
${ISSUE_BODY}

Explore the codebase, understand existing patterns, and create a detailed
implementation plan. Save the design to: .docs/design/feature-${ISSUE_NUMBER}-design.md

Be thorough - this plan will be executed by the Coder agent."
```

Wait for all Design agents to complete before proceeding.

#### Step 2: Implementation Phase

Spawn Coder agents for all features (parallel):

```
Task tool with subagent_type="Coder" (for each feature):

"Implement GitHub issue #${ISSUE_NUMBER} according to the design document.

TASK_ID: feature-${ISSUE_NUMBER}
TASK_DESCRIPTION: ${ISSUE_TITLE}
WORKTREE_DIR: .worktrees/feature-${ISSUE_NUMBER}
TARGET_BRANCH: ${RELEASE_BRANCH}
PLAN_FILE: .docs/design/feature-${ISSUE_NUMBER}-design.md

Execute the plan:
1. Implement changes according to design
2. Write tests as specified
3. Run tests and fix any failures
4. Create atomic commits
5. Push and create PR against ${RELEASE_BRANCH}

Report back with: PR number, files changed, test results."
```

Wait for all Coder agents to complete before proceeding.

#### Step 3: Review Phase

For each feature's PR, spawn review agents (parallel):

```bash
# Setup review directory
REVIEW_TIMESTAMP=$(date +%Y-%m-%d_%H%M)
REVIEW_DIR=".docs/reviews/feature-${ISSUE_NUMBER}"
mkdir -p "$REVIEW_DIR"

# Get changed files to determine which reviews to run
CHANGED_FILES=$(git diff --name-only ${RELEASE_BRANCH}...HEAD)
HAS_TS=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | head -1)
HAS_SQL=$(echo "$CHANGED_FILES" | grep -iE '\.(sql|prisma|drizzle)$' | head -1)
HAS_DEPS=$(echo "$CHANGED_FILES" | grep -E '(package\.json|requirements\.txt|Cargo\.toml)' | head -1)
```

**Always run these 5 reviews (in parallel):**

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

#### Step 4: Aggregate Review Results

```markdown
| Condition | Status |
|-----------|--------|
| Any CRITICAL issues | ❌ BLOCKED |
| Any HIGH issues | ⚠️ CHANGES_REQUESTED |
| Only MEDIUM/LOW | ✅ APPROVED |
```

### Track Active Features

```markdown
## 🔄 Wave 1 Progress

| Feature | Design | Coder | Review | PR | Status |
|---------|--------|-------|--------|-----|--------|
| #101 | ✅ | 🔄 | ⏳ | - | Implementing |
| #103 | ✅ | ✅ | 🔄 | #201 | In Review |
```

---

## Phase 5: Supervise Progress

### Monitor Feature Lifecycle Results

As each feature lifecycle completes, capture:

```json
{
  "feature": "#101",
  "status": "completed" | "failed" | "blocked",
  "phases": {
    "design": "completed",
    "coder": "completed",
    "review": "approved"
  },
  "pr_number": 201,
  "files_touched": [...],
  "review_status": "approved" | "changes_requested",
  "blocking_issues": [],
  "duration": "25m"
}
```

### Handle Completion

When a feature lifecycle succeeds:

```bash
# Update state
# Mark feature as completed
# Check if this unblocks other features
# Update release issue with progress

gh issue comment "${RELEASE_ISSUE}" --body "$(cat <<'EOF'
## ✅ Feature Completed: #${FEATURE_ISSUE}

**PR**: #${PR_NUMBER}
**Status**: Ready for review

Progress: ${COMPLETED}/${TOTAL} features complete
EOF
)"
```

### Handle Failures

When a feature lifecycle fails (Design, Coder, or Review phase):

```markdown
## ❌ Feature Failed: #${FEATURE_ISSUE}

**Phase**: ${FAILED_PHASE} (Design | Coder | Review)
**Error**: ${ERROR_MESSAGE}

### Impact Analysis

**Blocked features**:
- #102 (depends on #101)
- #104 (depends on #101)

### Options

1. **Retry** - Re-run failed phase and continue lifecycle
2. **Skip** - Continue with other features, handle this separately
3. **Escalate** - Pause and get user input

**Recommendation**: ${RECOMMENDATION}
```

**Ask user how to proceed for failures.**

### Unblock Dependent Features

When a feature completes:

```bash
# Check what features are now unblocked
for BLOCKED in ${BLOCKED_BY_THIS[@]}; do
    # Check if all dependencies are now satisfied
    if all_deps_complete "${BLOCKED}"; then
        # Add to next execution batch
        add_to_ready_queue "${BLOCKED}"
    fi
done
```

---

## Phase 6: Progress Reporting

### Real-time Status

Maintain and display:

```markdown
## 📊 Release Progress: ${RELEASE_TITLE}

### Overall: ${COMPLETED}/${TOTAL} (${PERCENT}%)

| Wave | Status | Features | Completed | Failed |
|------|--------|----------|-----------|--------|
| 1 | ✅ Complete | 2 | 2 | 0 |
| 2 | 🔄 Executing | 1 | 0 | 0 |
| 3 | ⏳ Waiting | 1 | - | - |

### Feature Status

| Issue | Title | Wave | Status | PR |
|-------|-------|------|--------|-----|
| #101 | User auth | 1 | ✅ Complete | #201 |
| #103 | Dashboard | 1 | ✅ Complete | #202 |
| #102 | Rate limit | 2 | 🔄 Implementing | - |
| #104 | API docs | 3 | ⏳ Blocked | - |

### Active Lifecycles: 1
### Blocked: 1 (waiting on #102)
### Failed: 0
```

### Update Release Issue

Periodically update the release issue with progress:

```bash
gh issue comment "${RELEASE_ISSUE}" --body "$(cat <<'EOF'
## 📊 Coordinator Status Update

**Time**: $(date)
**Progress**: ${COMPLETED}/${TOTAL} features

### Completed
${COMPLETED_LIST}

### In Progress
${IN_PROGRESS_LIST}

### Blocked
${BLOCKED_LIST}

### PRs Ready for Review
${PR_LIST}
EOF
)"
```

---

## Phase 7: Final Report

When all features are processed:

```markdown
## 🎉 RELEASE DEVELOPMENT COMPLETE

### Release: ${RELEASE_TITLE}
### Issue: #${RELEASE_ISSUE}

---

## Summary

| Metric | Value |
|--------|-------|
| Features Attempted | ${TOTAL} |
| Features Completed | ${COMPLETED} |
| Features Failed | ${FAILED} |
| PRs Created | ${NUM_PRS} |
| Total Duration | ${DURATION} |

---

## Feature Results

| Issue | Title | Status | PR | Review |
|-------|-------|--------|-----|--------|
| #101 | User auth | ✅ | #201 | Approved |
| #103 | Dashboard | ✅ | #202 | Approved |
| #102 | Rate limit | ✅ | #203 | Approved |
| #104 | API docs | ❌ | - | Failed |

---

## PRs Ready for Merge

All PRs target: `${RELEASE_BRANCH}`

1. #201 - User authentication
2. #202 - Dashboard redesign
3. #203 - Rate limiting

---

## Failed Features (require attention)

### #104 - API documentation
**Error**: Design phase failed - unclear requirements
**Recommendation**: Clarify issue requirements and retry manually

---

## Next Steps

1. Review PRs: #201, #202, #203
2. Address failed features
3. Run integration tests on release branch
4. Merge release branch to ${BASE_BRANCH}
5. Close release issue #${RELEASE_ISSUE}

---

## Artifacts

- Release branch: `${RELEASE_BRANCH}`
- State file: `.docs/coordinate/state.json`
- Design docs: `.docs/design/feature-*-design.md`
```

### Update Release Issue

```bash
gh issue comment "${RELEASE_ISSUE}" --body "$(cat <<'EOF'
## 🎉 Development Complete

All features have been processed.

### Results
- ✅ Completed: ${COMPLETED}
- ❌ Failed: ${FAILED}

### PRs Ready for Review
${PR_LIST}

### Next Steps
1. Review and merge PRs
2. Address any failed features
3. Close this issue when release ships

---
🤖 Generated by DevFlow Coordinator
EOF
)"
```

---

## Supervision Patterns

### Stuck Detection

If a feature lifecycle takes too long:

```markdown
## ⚠️ Feature Lifecycle Possibly Stuck

**Feature**: #101
**Current Phase**: Coder (Implementation)
**Duration**: 45m (expected: 20m)

### Options
1. Check agent status
2. Set timeout and move on
3. Escalate to user
```

### Conflict Detection

If multiple features touch same files:

```markdown
## ⚠️ Potential Conflict Detected

**Features**: #101, #103
**Shared files**: src/utils/helpers.ts

### Resolution
- #101 should merge first (earlier wave)
- #103 may need rebase after #101 merges
```

### Resource Management

```markdown
## 📊 Resource Usage

- Active feature lifecycles: 2/3 max
- Pending features: 2
- Estimated remaining: 45m

### Throttling
- Limiting concurrent features to prevent context overload
- Next batch will start when current completes
```

---

## Error Recovery

### Partial Completion

```markdown
## ⚠️ PARTIAL RELEASE COMPLETION

### Completed: 3/4 features
### Failed: 1 feature

### Options

1. **Proceed without failed feature**
   - Merge completed PRs
   - Handle #104 as follow-up issue

2. **Retry failed feature**
   - Attempt once more with different approach

3. **Pause for manual intervention**
   - User reviews and fixes
   - Then resume orchestration

**Recommendation**: Proceed with completed features
```

### Full Abort

```bash
echo "=== ABORTING ORCHESTRATION ==="

# Update release issue
gh issue comment "${RELEASE_ISSUE}" --body "## ❌ Orchestration Aborted

Reason: ${REASON}

### Cleanup
- PRs closed
- Branches deleted
- Worktrees removed"

# Cleanup worktrees
for worktree in .worktrees/*/; do
    git worktree remove "$worktree" --force 2>/dev/null
done
git worktree prune

# Update state
echo '{"status": "aborted", "reason": "${REASON}"}' > .docs/coordinate/state.json

echo "✅ Aborted and cleaned up"
```

---

## Architecture

```
/coordinate (command - runs in main context)
├── Parses release issue for feature references
├── For each wave of features:
│   ├── spawns: Design agents (parallel per feature)
│   ├── waits for completion
│   ├── spawns: Coder agents (parallel per feature)
│   ├── waits for completion
│   └── spawns: review-* agents (parallel per feature/review type)
└── Reports: PRs ready for review, issues identified
```

**Why command-level orchestration**: Commands run in the main context and have access to the Task tool for spawning agents. Agents cannot spawn other agents.

---

## Principles

1. **Issue-driven** - Everything traces back to GitHub issues
2. **Prioritize smartly** - P0 first, respect dependencies
3. **Parallelize safely** - Independent features run concurrently
4. **Supervise actively** - Monitor progress, detect problems early
5. **Fail gracefully** - One failure doesn't stop others
6. **Communicate clearly** - Update release issue with progress
7. **Don't merge** - That's a separate, human-controlled workflow
