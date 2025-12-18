---
description: Comprehensive branch review using specialized sub-agents for PR readiness
allowed-tools: Task, Bash, Read, Grep, Glob
---

## Your Task

Orchestrate specialized review sub-agents to review the current branch, then synthesize findings into PR comments and tech debt tracking.

---

## Phase 1: Setup

```bash
# Get current branch for directory naming
CURRENT_BRANCH=$(git branch --show-current)
BRANCH_SLUG=$(echo "${CURRENT_BRANCH:-standalone}" | sed 's/\//-/g')

# Coordination variables (shared across all sub-agents)
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
REVIEW_BASE_DIR=".docs/reviews/${BRANCH_SLUG}"
mkdir -p "$REVIEW_BASE_DIR"

# Detect project type for conditional reviews
HAS_TYPESCRIPT=false
[ -f "tsconfig.json" ] && HAS_TYPESCRIPT=true

HAS_DB_CHANGES=false
git diff --name-only HEAD~10..HEAD 2>/dev/null | grep -qiE '(migration|schema|\.sql|prisma|drizzle|knex)' && HAS_DB_CHANGES=true

echo "=== CODE REVIEW ==="
echo "📁 Reports: $REVIEW_BASE_DIR"
echo "⏱️  Timestamp: $TIMESTAMP"
echo "📦 TypeScript: $HAS_TYPESCRIPT"
echo "🗄️  Database: $HAS_DB_CHANGES"
```

---

## Phase 2: Run Review Sub-Agents (Parallel)

Launch ALL applicable review sub-agents in a **single message** using multiple Task tool calls for parallel execution.

**IMPORTANT:** You MUST launch these as parallel Task calls in ONE message.

**Always Launch (7 core reviews):**

1. **SecurityReview**
   ```
   Analyze branch for security issues. Compare against base branch.
   Save report to: ${REVIEW_BASE_DIR}/security-report.${TIMESTAMP}.md
   ```

2. **PerformanceReview**
   ```
   Analyze branch for performance issues. Compare against base branch.
   Save report to: ${REVIEW_BASE_DIR}/performance-report.${TIMESTAMP}.md
   ```

3. **ArchitectureReview**
   ```
   Analyze branch for architecture issues. Compare against base branch.
   Save report to: ${REVIEW_BASE_DIR}/architecture-report.${TIMESTAMP}.md
   ```

4. **TestsReview**
   ```
   Analyze branch for test coverage and quality issues. Compare against base branch.
   Save report to: ${REVIEW_BASE_DIR}/tests-report.${TIMESTAMP}.md
   ```

5. **ComplexityReview**
   ```
   Analyze branch for code complexity issues. Compare against base branch.
   Save report to: ${REVIEW_BASE_DIR}/complexity-report.${TIMESTAMP}.md
   ```

6. **DependenciesReview**
   ```
   Analyze branch for dependency issues. Compare against base branch.
   Save report to: ${REVIEW_BASE_DIR}/dependencies-report.${TIMESTAMP}.md
   ```

7. **DocumentationReview**
   ```
   Analyze branch for documentation issues. Compare against base branch.
   Save report to: ${REVIEW_BASE_DIR}/documentation-report.${TIMESTAMP}.md
   ```

**Conditional Reviews:**

8. **TypescriptReview** (if HAS_TYPESCRIPT=true)
   ```
   Analyze branch for TypeScript issues. Compare against base branch.
   Save report to: ${REVIEW_BASE_DIR}/typescript-report.${TIMESTAMP}.md
   ```

9. **DatabaseReview** (if HAS_DB_CHANGES=true)
   ```
   Analyze branch for database issues. Compare against base branch.
   Save report to: ${REVIEW_BASE_DIR}/database-report.${TIMESTAMP}.md
   ```

---

## Phase 3: Synthesis (After Reviews Complete)

**WAIT for all Phase 2 reviews to complete before proceeding.**

After all review sub-agents have finished, launch THREE synthesis sub-agents in **parallel**:

### 3.1 CodeReview sub-agent (Summary Report)

```
Generate code review summary for branch ${CURRENT_BRANCH}.

Context:
- Branch: ${CURRENT_BRANCH}
- Base: ${BASE_BRANCH}
- Review Directory: ${REVIEW_BASE_DIR}
- Timestamp: ${TIMESTAMP}

Tasks:
1. Read all review reports from ${REVIEW_BASE_DIR}/*-report.${TIMESTAMP}.md
2. Extract and categorize all issues (🔴/⚠️/ℹ️)
3. Generate summary report at ${REVIEW_BASE_DIR}/review-summary.${TIMESTAMP}.md
4. Determine merge recommendation

Report back: Merge recommendation and issue counts
```

### 3.2 PrComments sub-agent (PR Comments)

```
Create PR comments for code review findings on branch ${CURRENT_BRANCH}.

Context:
- Branch: ${CURRENT_BRANCH}
- Review Directory: ${REVIEW_BASE_DIR}
- Timestamp: ${TIMESTAMP}

Tasks:
1. Read all review reports from ${REVIEW_BASE_DIR}/*-report.${TIMESTAMP}.md
2. Ensure PR exists (create draft if missing)
3. Create individual comments for all 🔴 blocking issues
4. Create individual comments for all ⚠️ should-fix issues
5. Include suggested fixes with code examples
6. Show pros/cons table when multiple approaches exist
7. Add Claude Code attribution to each comment

Report back: PR number and count of comments created
```

### 3.3 TechDebt sub-agent (Tech Debt Management)

```
Manage tech debt for code review on branch ${CURRENT_BRANCH}.

Context:
- Branch: ${CURRENT_BRANCH}
- Review Directory: ${REVIEW_BASE_DIR}
- Timestamp: ${TIMESTAMP}

Tasks:
1. Read all review reports from ${REVIEW_BASE_DIR}/*-report.${TIMESTAMP}.md
2. Find or create Tech Debt Backlog issue
3. Check if archive needed (approaching 60k char limit)
4. Add new ℹ️ pre-existing issues (deduplicated)
5. Check existing items - remove those that are fixed
6. Update issue with changes

Report back: Issue number, items added, items removed
```

**IMPORTANT:** Launch all THREE synthesis sub-agents in a SINGLE message for parallel execution.

---

## Phase 4: Present Results

After ALL synthesis sub-agents complete, consolidate their reports and display final summary:

```markdown
🔍 CODE REVIEW COMPLETE

**Branch**: ${CURRENT_BRANCH}
**Reviews**: {count} specialized reviews completed

---

## 🚦 Merge Status: {RECOMMENDATION from code-review agent}

---

## 📊 Issues Found

| Category | Count | Action |
|----------|-------|--------|
| 🔴 Blocking | {count} | Must fix before merge |
| ⚠️ Should Fix | {count} | Fix while you're here |
| ℹ️ Pre-existing | {count} | Managed in tech debt |

---

## 📝 Artifacts Created

- **Summary**: `${REVIEW_BASE_DIR}/review-summary.${TIMESTAMP}.md`
- **PR Comments**: {count} comments on PR #{number from pr-comments agent}
- **Tech Debt**: Issue #{number from tech-debt agent}
  - Added: {count} new items
  - Removed: {count} fixed items

---

## 🎯 Next Steps

{If BLOCK MERGE:}
1. Review PR comments for fix suggestions
2. Address 🔴 blocking issues
3. Re-run `/code-review` to verify

{If APPROVED:}
1. Review ⚠️ suggestions (optional)
2. Create commits: `/commit`
3. Create PR: `/pull-request`
```

---

## Orchestration Rules

1. **Phase 2 is parallel** - Launch ALL review sub-agents in a single message
2. **Phase 3 is parallel** - Launch ALL synthesis sub-agents in a single message (after Phase 2)
3. **Don't read reports yourself** - Sub-agents handle all file reading
4. **Don't create artifacts yourself** - Each sub-agent creates its own outputs
5. **Pass context accurately** - Ensure REVIEW_BASE_DIR and TIMESTAMP reach all sub-agents
6. **Consolidate results** - Combine reports from all three synthesis agents for final output
