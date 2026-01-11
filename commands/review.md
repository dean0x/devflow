---
description: Comprehensive branch review using specialized sub-agents for PR readiness
---

# Code Review - Full Branch Review Orchestrator

Run a comprehensive review of the current branch. You handle the full workflow: pre-flight checks, review selection, parallel execution, and synthesis.

## Your Task

Run a complete code review:
1. **Pre-flight**: Ensure committed, pushed, PR exists
2. **Analyze**: Detect file types to determine relevant reviews
3. **Review**: Spawn review agents in parallel
4. **Synthesize**: Aggregate results, determine merge recommendation
5. **Report**: Create summary and manage tech debt

---

## Phase 1: Pre-Flight Checks

### Check Branch State

```bash
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ] || [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    echo "ERROR: Must be on a feature branch"
    exit 1
fi

# Get base branch
BASE_BRANCH=""
for branch in main master develop; do
    git show-ref --verify --quiet refs/heads/$branch && BASE_BRANCH=$branch && break
done

# Check commits ahead
COMMITS_AHEAD=$(git rev-list --count $BASE_BRANCH..HEAD 2>/dev/null || echo "0")
[ "$COMMITS_AHEAD" -eq 0 ] && echo "ERROR: No commits to review" && exit 1

echo "Branch: $CURRENT_BRANCH ($COMMITS_AHEAD commits ahead of $BASE_BRANCH)"
```

### Handle Uncommitted Changes

```bash
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️ Uncommitted changes detected"
    # SPAWN: Commit agent
fi
```

**If uncommitted changes**: Spawn Commit agent first, wait for completion.

### Ensure Branch Pushed

```bash
if ! git ls-remote --exit-code --heads origin "$CURRENT_BRANCH" >/dev/null 2>&1; then
    echo "Pushing branch to remote..."
    git push -u origin "$CURRENT_BRANCH"
fi
```

### Ensure PR Exists

```bash
PR_NUMBER=$(gh pr view --json number -q '.number' 2>/dev/null || echo "")
if [ -z "$PR_NUMBER" ]; then
    echo "⚠️ No PR exists"
    # SPAWN: PullRequest agent
fi
```

**If no PR**: Spawn PullRequest agent, wait for completion.

### Capture PR Context

```bash
PR_NUMBER=$(gh pr view --json number -q '.number')
PR_URL=$(gh pr view --json url -q '.url')
echo "PR: #$PR_NUMBER - $PR_URL"
```

---

## Phase 2: Analyze Changed Files

Determine which reviews to run based on file types:

```bash
# Get changed files
CHANGED_FILES=$(git diff --name-only $BASE_BRANCH...HEAD)

# Detect file types
HAS_TS=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | head -1)
HAS_JS=$(echo "$CHANGED_FILES" | grep -E '\.(js|jsx)$' | head -1)
HAS_PY=$(echo "$CHANGED_FILES" | grep -E '\.py$' | head -1)
HAS_SQL=$(echo "$CHANGED_FILES" | grep -iE '\.(sql|prisma|drizzle)$' | head -1)
HAS_MIGRATIONS=$(echo "$CHANGED_FILES" | grep -iE '(migration|schema)' | head -1)
HAS_DEPS=$(echo "$CHANGED_FILES" | grep -E '(package\.json|requirements\.txt|Cargo\.toml|go\.mod)' | head -1)
HAS_DOCS=$(echo "$CHANGED_FILES" | grep -E '\.(md|rst|txt)$' | head -1)
HAS_TESTS=$(echo "$CHANGED_FILES" | grep -E '\.(test|spec)\.' | head -1)

echo "=== FILE ANALYSIS ==="
echo "TypeScript/JS: $([ -n "$HAS_TS$HAS_JS" ] && echo 'yes' || echo 'no')"
echo "Python: $([ -n "$HAS_PY" ] && echo 'yes' || echo 'no')"
echo "Database: $([ -n "$HAS_SQL$HAS_MIGRATIONS" ] && echo 'yes' || echo 'no')"
echo "Dependencies: $([ -n "$HAS_DEPS" ] && echo 'yes' || echo 'no')"
echo "Documentation: $([ -n "$HAS_DOCS" ] && echo 'yes' || echo 'no')"
echo "Tests: $([ -n "$HAS_TESTS" ] && echo 'yes' || echo 'no')"
```

### Determine Review Focus Areas

| Focus | Run When | Pattern Skill Applied |
|-------|----------|----------------------|
| security | Always | devflow-security-patterns |
| architecture | Always | devflow-architecture-patterns |
| performance | Always | devflow-performance-patterns |
| complexity | Always | devflow-complexity-patterns |
| consistency | Always | devflow-consistency-patterns |
| regression | Always | devflow-regression-patterns |
| tests | Always | devflow-tests-patterns |
| dependencies | Dependencies changed | devflow-dependencies-patterns |
| documentation | Docs or significant code changed | devflow-documentation-patterns |
| typescript | .ts/.tsx files changed | devflow-typescript |
| database | db/migration files changed | devflow-database-patterns |

---

## Phase 3: Run Reviews (Parallel)

Setup coordination:

```bash
BRANCH_SLUG=$(echo "$CURRENT_BRANCH" | sed 's/\//-/g')
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
REVIEW_DIR=".docs/reviews/${BRANCH_SLUG}"
mkdir -p "$REVIEW_DIR"
```

**Spawn Reviewer agents in parallel** using Task tool. Each Reviewer is invoked with a specific focus via prompt injection:

```
Task(subagent_type="Reviewer"):

"Review this code focusing exclusively on {FOCUS}.
Apply patterns from devflow-{focus}-patterns skill.
Follow the 6-step process from devflow-review-methodology.

PR_NUMBER: ${PR_NUMBER}
BASE_BRANCH: ${BASE_BRANCH}
REVIEW_BASE_DIR: ${REVIEW_DIR}
TIMESTAMP: ${TIMESTAMP}

Output findings to: ${REVIEW_DIR}/{focus}.md
Report back: issues found by category (blocking/should-fix/informational), merge recommendation"
```

Spawn one Reviewer per focus area from the table above. Always run the 7 "Always" focus areas; conditionally run the others based on changed file types.

---

## Phase 4: Synthesis (Parallel)

**WAIT** for all Phase 3 review agents to complete, then spawn synthesis agents **in parallel**:

**IMPORTANT:** Launch ALL THREE agents in a SINGLE message for parallel execution.

### 4.1 Comment Agent (PR Comments)

```
Task(subagent_type="Comment"):

"Create PR inline comments for code review findings.

PR_NUMBER: ${PR_NUMBER}
REVIEW_BASE_DIR: ${REVIEW_DIR}
TIMESTAMP: ${TIMESTAMP}

1. Read all review reports from ${REVIEW_DIR}
2. Deduplicate similar issues
3. Create inline comments on lines in the PR diff
4. Consolidate skipped issues into ONE summary comment

Report back: inline comments created, comments skipped, summary created"
```

### 4.2 TechDebt Agent (Debt Tracking)

```
Task(subagent_type="TechDebt"):

"Update tech debt tracking with pre-existing issues from code review.

REVIEW_DIR: ${REVIEW_DIR}
TIMESTAMP: ${TIMESTAMP}

1. Read all review reports from ${REVIEW_DIR}
2. Extract ℹ️ pre-existing issues
3. Find or create Tech Debt Backlog GitHub issue
4. Add new pre-existing issues (deduplicated)
5. Remove items that have been fixed

Report back: issue number, items added, items removed"
```

### 4.3 Summary Agent (Aggregation + Recommendation)

```
Task(subagent_type="Summary"):

"Synthesize all review findings into comprehensive summary.

PR_NUMBER: ${PR_NUMBER}
REVIEW_BASE_DIR: ${REVIEW_DIR}
TIMESTAMP: ${TIMESTAMP}

1. Read all review reports from ${REVIEW_DIR}
2. Extract and categorize issues (🔴/⚠️/ℹ️)
3. Determine merge recommendation
4. Generate summary report file

Report back: recommendation, issue counts, summary file path"
```

---

## Phase 5: Collect Results

**WAIT** for all Phase 4 agents to complete. Collect their outputs:

| Agent | Output |
|-------|--------|
| Comment | Inline comments created, skipped count, summary comment |
| TechDebt | Issue number, items added/removed |
| Summary | Recommendation, issue counts, summary file |

---

## Phase 6: Final Report

Display results from all agents:

```markdown
## 🔍 Code Review Complete

**PR**: #${PR_NUMBER} - ${PR_URL}

---

### 🚦 Recommendation: {from Summary agent}

---

### 📊 Results (from Summary agent)

| Metric | Count |
|--------|-------|
| Reviews Run | {n} |
| 🔴 Blocking Issues | {n} |
| ⚠️ Should-Fix Issues | {n} |
| ℹ️ Pre-existing Issues | {n} |

---

### 💬 PR Comments (from Comment agent)

- Inline comments: {n} created
- Summary comment: {created/not needed}
- Skipped: {n} (lines not in diff)

---

### 📋 Tech Debt (from TechDebt agent)

- Issue: #{issue_number}
- Added: {n} new items
- Removed: {n} fixed items

---

### 📁 Artifacts

- Summary: `${REVIEW_DIR}/review-summary.${TIMESTAMP}.md`
- Reports: `${REVIEW_DIR}/*-report.${TIMESTAMP}.md`

---

### 🎯 Next Steps

{From Summary agent recommendation}
```

---

## Key Principles

1. **Orchestration only** - Command spawns agents, doesn't do work itself
2. **Parallel execution** - Reviews parallel, then synthesis agents parallel
3. **Agent responsibilities**:
   - Review agents → Find issues
   - Comment agent → Create PR comments
   - TechDebt agent → Track pre-existing issues
   - Summary agent → Aggregate, recommend, report
4. **Full automation** - Handles commit/push/PR creation via agents
