---
description: Comprehensive branch review using specialized sub-agents for PR readiness
---

## Your Task

Orchestrate specialized review sub-agents to review the current branch. Ensure a PR exists first, then run reviews that create line-specific comments directly on the PR.

---

## Phase 0: Pre-Flight Checks

Before running any reviews, ensure the branch is ready:

```bash
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ] || [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    echo "ERROR: Must be on a feature branch, not main/master"
    exit 1
fi

# Get base branch
BASE_BRANCH=""
for branch in main master develop; do
    if git show-ref --verify --quiet refs/heads/$branch; then
        BASE_BRANCH=$branch
        break
    fi
done

# Check if there are commits ahead
COMMITS_AHEAD=$(git rev-list --count $BASE_BRANCH..HEAD 2>/dev/null || echo "0")
if [ "$COMMITS_AHEAD" -eq 0 ]; then
    echo "ERROR: No commits ahead of $BASE_BRANCH. Nothing to review."
    exit 1
fi

echo "=== PRE-FLIGHT CHECKS ==="
echo "Branch: $CURRENT_BRANCH"
echo "Base: $BASE_BRANCH"
echo "Commits ahead: $COMMITS_AHEAD"
```

### Check for Uncommitted Changes

```bash
UNCOMMITTED=$(git status --porcelain)
if [ -n "$UNCOMMITTED" ]; then
    echo ""
    echo "⚠️ UNCOMMITTED CHANGES DETECTED:"
    git status --short
    echo ""
    echo "UNCOMMITTED=true"
else
    echo "✅ Working tree clean"
    echo "UNCOMMITTED=false"
fi
```

**If uncommitted changes exist:** Launch the Commit agent first.

```
Task tool with subagent_type="Commit":

"There are uncommitted changes that need to be committed before code review.
Analyze the changes, create appropriate atomic commits.
Report back when commits are complete."
```

**WAIT for Commit agent to complete before proceeding.**

### Check if Branch is Pushed

```bash
# Check if branch exists on remote
if git ls-remote --exit-code --heads origin "$CURRENT_BRANCH" >/dev/null 2>&1; then
    # Check if local is ahead of remote
    git fetch origin "$CURRENT_BRANCH" 2>/dev/null
    UNPUSHED=$(git rev-list origin/$CURRENT_BRANCH..HEAD 2>/dev/null | wc -l)
    if [ "$UNPUSHED" -gt 0 ]; then
        echo "⚠️ $UNPUSHED commits not pushed to remote"
        echo "NEEDS_PUSH=true"
    else
        echo "✅ Branch is up to date with remote"
        echo "NEEDS_PUSH=false"
    fi
else
    echo "⚠️ Branch not on remote yet"
    echo "NEEDS_PUSH=true"
fi
```

**If needs push:**
```bash
git push -u origin "$CURRENT_BRANCH"
```

### Check for Existing PR

```bash
PR_NUMBER=$(gh pr view --json number -q '.number' 2>/dev/null || echo "")

if [ -z "$PR_NUMBER" ]; then
    echo ""
    echo "⚠️ NO PR EXISTS for branch $CURRENT_BRANCH"
    echo "PR_EXISTS=false"
else
    echo "✅ PR #$PR_NUMBER exists"
    echo "PR_EXISTS=true"
    echo "PR_NUMBER=$PR_NUMBER"
fi
```

**If no PR exists:** Launch the PullRequest agent to create one.

```
Task tool with subagent_type="PullRequest":

"Create a pull request for branch ${CURRENT_BRANCH} targeting ${BASE_BRANCH}.
Analyze all commits and generate comprehensive title and description.
Create as ready for review (not draft).
Report back with PR number and URL."
```

**WAIT for PullRequest agent to complete before proceeding.**

---

## Phase 1: Setup Review Context

After ensuring PR exists, gather context for reviewers:

```bash
# Refresh PR number after potential creation
PR_NUMBER=$(gh pr view --json number -q '.number')
PR_URL=$(gh pr view --json url -q '.url')

# Get PR diff info for line comment targeting
DIFF_FILES=$(gh pr diff --name-only)

# Coordination variables
BRANCH_SLUG=$(echo "${CURRENT_BRANCH}" | sed 's/\//-/g')
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
REVIEW_BASE_DIR=".docs/reviews/${BRANCH_SLUG}"
mkdir -p "$REVIEW_BASE_DIR"

# Detect project type for conditional reviews
HAS_TYPESCRIPT=false
[ -f "tsconfig.json" ] && HAS_TYPESCRIPT=true

HAS_DB_CHANGES=false
echo "$DIFF_FILES" | grep -qiE '(migration|schema|\.sql|prisma|drizzle|knex)' && HAS_DB_CHANGES=true

echo ""
echo "=== CODE REVIEW CONTEXT ==="
echo "📌 PR: #$PR_NUMBER"
echo "🔗 URL: $PR_URL"
echo "📁 Reports: $REVIEW_BASE_DIR"
echo "⏱️  Timestamp: $TIMESTAMP"
echo "📦 TypeScript: $HAS_TYPESCRIPT"
echo "🗄️  Database: $HAS_DB_CHANGES"
```

---

## Phase 2: Run Review Sub-Agents (Parallel)

Launch ALL applicable review sub-agents in a **single message** using multiple Task tool calls for parallel execution.

**CRITICAL CONTEXT TO PASS TO EACH AGENT:**
- `PR_NUMBER`: For creating line comments
- `BASE_BRANCH`: For diff comparison
- `REVIEW_BASE_DIR`: For saving summary reports
- `TIMESTAMP`: For file naming

**Always Launch (7 core reviews):**

1. **SecurityReview**
   ```
   Analyze branch for security issues. Create PR line comments for issues found.

   PR_NUMBER: ${PR_NUMBER}
   BASE_BRANCH: ${BASE_BRANCH}
   REVIEW_BASE_DIR: ${REVIEW_BASE_DIR}
   TIMESTAMP: ${TIMESTAMP}

   For each issue found:
   - If line is in PR diff: Create line comment via gh api
   - If line is not in diff: Note in summary report

   Save summary to: ${REVIEW_BASE_DIR}/security-report.${TIMESTAMP}.md
   Report back: issues found, comments created, issues skipped
   ```

2. **PerformanceReview**
   ```
   Analyze branch for performance issues. Create PR line comments for issues found.

   PR_NUMBER: ${PR_NUMBER}
   BASE_BRANCH: ${BASE_BRANCH}
   REVIEW_BASE_DIR: ${REVIEW_BASE_DIR}
   TIMESTAMP: ${TIMESTAMP}
   ```

3. **ArchitectureReview**
   ```
   Analyze branch for architecture issues. Create PR line comments for issues found.

   PR_NUMBER: ${PR_NUMBER}
   BASE_BRANCH: ${BASE_BRANCH}
   REVIEW_BASE_DIR: ${REVIEW_BASE_DIR}
   TIMESTAMP: ${TIMESTAMP}
   ```

4. **TestsReview**
   ```
   Analyze branch for test coverage and quality issues. Create PR line comments.

   PR_NUMBER: ${PR_NUMBER}
   BASE_BRANCH: ${BASE_BRANCH}
   REVIEW_BASE_DIR: ${REVIEW_BASE_DIR}
   TIMESTAMP: ${TIMESTAMP}
   ```

5. **ComplexityReview**
   ```
   Analyze branch for code complexity issues. Create PR line comments.

   PR_NUMBER: ${PR_NUMBER}
   BASE_BRANCH: ${BASE_BRANCH}
   REVIEW_BASE_DIR: ${REVIEW_BASE_DIR}
   TIMESTAMP: ${TIMESTAMP}
   ```

6. **DependenciesReview**
   ```
   Analyze branch for dependency issues. Create PR line comments.

   PR_NUMBER: ${PR_NUMBER}
   BASE_BRANCH: ${BASE_BRANCH}
   REVIEW_BASE_DIR: ${REVIEW_BASE_DIR}
   TIMESTAMP: ${TIMESTAMP}
   ```

7. **DocumentationReview**
   ```
   Analyze branch for documentation issues. Create PR line comments.

   PR_NUMBER: ${PR_NUMBER}
   BASE_BRANCH: ${BASE_BRANCH}
   REVIEW_BASE_DIR: ${REVIEW_BASE_DIR}
   TIMESTAMP: ${TIMESTAMP}
   ```

**Conditional Reviews:**

8. **TypescriptReview** (if HAS_TYPESCRIPT=true)
   ```
   Analyze branch for TypeScript issues. Create PR line comments.

   PR_NUMBER: ${PR_NUMBER}
   BASE_BRANCH: ${BASE_BRANCH}
   REVIEW_BASE_DIR: ${REVIEW_BASE_DIR}
   TIMESTAMP: ${TIMESTAMP}
   ```

9. **DatabaseReview** (if HAS_DB_CHANGES=true)
   ```
   Analyze branch for database issues. Create PR line comments.

   PR_NUMBER: ${PR_NUMBER}
   BASE_BRANCH: ${BASE_BRANCH}
   REVIEW_BASE_DIR: ${REVIEW_BASE_DIR}
   TIMESTAMP: ${TIMESTAMP}
   ```

---

## Phase 3: Synthesis (After Reviews Complete)

**WAIT for all Phase 2 reviews to complete before proceeding.**

After all review sub-agents have finished, launch synthesis sub-agents in **parallel**:

### 3.1 CodeReview sub-agent (Summary Report)

```
Task tool with subagent_type="CodeReview":

"Generate code review summary for PR #${PR_NUMBER}.

Context:
- PR: #${PR_NUMBER}
- Branch: ${CURRENT_BRANCH}
- Base: ${BASE_BRANCH}
- Review Directory: ${REVIEW_BASE_DIR}
- Timestamp: ${TIMESTAMP}

Tasks:
1. Read all review reports from ${REVIEW_BASE_DIR}/*-report.${TIMESTAMP}.md
2. Aggregate issues by category (🔴/⚠️/ℹ️)
3. Count comments created vs issues skipped
4. Generate summary report at ${REVIEW_BASE_DIR}/review-summary.${TIMESTAMP}.md
5. Determine merge recommendation

Report back: Merge recommendation, total issues, total comments created"
```

### 3.2 TechDebt sub-agent (Tech Debt Management)

```
Task tool with subagent_type="TechDebt":

"Manage tech debt for code review on PR #${PR_NUMBER}.

Context:
- PR: #${PR_NUMBER}
- Branch: ${CURRENT_BRANCH}
- Review Directory: ${REVIEW_BASE_DIR}
- Timestamp: ${TIMESTAMP}

Tasks:
1. Read all review reports from ${REVIEW_BASE_DIR}/*-report.${TIMESTAMP}.md
2. Find or create Tech Debt Backlog issue
3. Add new ℹ️ pre-existing issues (deduplicated)
4. Check existing items - remove those that are fixed
5. Update issue with changes

Report back: Issue number, items added, items removed"
```

---

## Phase 4: Present Results

After ALL synthesis sub-agents complete, display final summary:

```markdown
## 🔍 CODE REVIEW COMPLETE

**PR**: #${PR_NUMBER}
**URL**: ${PR_URL}
**Branch**: ${CURRENT_BRANCH} → ${BASE_BRANCH}

---

### 🚦 Merge Status: {RECOMMENDATION}

---

### 📊 Review Results

| Category | Issues Found | PR Comments | Skipped |
|----------|--------------|-------------|---------|
| 🔴 Blocking | {count} | {count} | {count} |
| ⚠️ Should Fix | {count} | {count} | {count} |
| ℹ️ Pre-existing | {count} | - | {count} |

---

### 📝 Artifacts

- **PR Comments**: {total} line comments created on PR #{PR_NUMBER}
- **Summary**: `${REVIEW_BASE_DIR}/review-summary.${TIMESTAMP}.md`
- **Tech Debt**: Issue #{number} ({added} added, {removed} removed)

---

### 🎯 Next Steps

{If BLOCK MERGE:}
1. Review PR comments for fix suggestions
2. Address 🔴 blocking issues
3. Push fixes
4. Re-run `/code-review` to verify

{If APPROVED:}
1. Review ⚠️ suggestions (optional)
2. Merge PR when ready
```

---

## Orchestration Rules

1. **Phase 0 is sequential** - Must complete before reviews
2. **Phase 2 is parallel** - Launch ALL review sub-agents in single message
3. **Phase 3 is parallel** - Launch synthesis sub-agents in single message (after Phase 2)
4. **Pass PR context** - Every review agent needs PR_NUMBER for line comments
5. **Agents create comments directly** - No intermediate step needed
6. **Summary aggregates results** - CodeReview agent consolidates findings

---

## Error Handling

### No Changes to Review
```
Branch has no commits ahead of ${BASE_BRANCH}.
Nothing to review.
```

### Commit Agent Fails
```
Failed to commit changes. Please commit manually and retry:
  git add .
  git commit -m "your message"
  /code-review
```

### PR Creation Fails
```
Failed to create PR. Please create manually and retry:
  gh pr create --base ${BASE_BRANCH}
  /code-review
```

### Review Agent Fails
```
{Agent} failed. Other reviews completed successfully.
Check ${REVIEW_BASE_DIR} for partial results.
```
