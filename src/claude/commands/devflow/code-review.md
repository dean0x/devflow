---
description: Comprehensive branch review using specialized sub-agents for PR readiness
allowed-tools: Task, Bash, Read, Grep, Glob
---

## Your Task

Orchestrate specialized audit sub-agents to review the current branch, then delegate synthesis to the code-review sub-agent for PR comments and tech debt management.

**This command is a lightweight orchestrator. Heavy lifting is done by sub-agents.**

---

## Phase 1: Setup

### Step 1.1: Determine Review Scope

```bash
# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
    echo "❌ Not on a branch (detached HEAD)"
    exit 1
fi

# Find base branch
BASE_BRANCH=""
for branch in main master develop; do
  if git show-ref --verify --quiet refs/heads/$branch; then
    BASE_BRANCH=$branch
    break
  fi
done

if [ -z "$BASE_BRANCH" ]; then
    echo "❌ Could not find base branch (main/master/develop)"
    exit 1
fi

# Check for changes
if git diff --quiet $BASE_BRANCH...HEAD; then
    echo "ℹ️ No changes between $BASE_BRANCH and $CURRENT_BRANCH"
    exit 0
fi

# Show change summary
echo "=== CODE REVIEW SCOPE ==="
echo "Branch: $CURRENT_BRANCH"
echo "Base: $BASE_BRANCH"
echo ""
git diff --stat $BASE_BRANCH...HEAD
echo ""
git log --oneline $BASE_BRANCH..HEAD | head -5
echo ""
```

### Step 1.2: Set Up Audit Structure

```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
BRANCH_SLUG=$(echo "$CURRENT_BRANCH" | sed 's/\//-/g')
AUDIT_BASE_DIR=".docs/audits/${BRANCH_SLUG}"
mkdir -p "$AUDIT_BASE_DIR"

echo "📁 Audit reports: $AUDIT_BASE_DIR"
echo "⏱️  Timestamp: $TIMESTAMP"
echo ""
```

### Step 1.3: Detect Project Type

```bash
# Check for TypeScript
HAS_TYPESCRIPT=false
if [ -f "tsconfig.json" ] || ls *.ts 2>/dev/null | head -1 > /dev/null; then
    HAS_TYPESCRIPT=true
fi

# Check for database changes
HAS_DB_CHANGES=false
if git diff --name-only $BASE_BRANCH...HEAD | grep -qiE '(migration|schema|\.sql|prisma|drizzle|knex)'; then
    HAS_DB_CHANGES=true
fi

echo "TypeScript project: $HAS_TYPESCRIPT"
echo "Database changes: $HAS_DB_CHANGES"
```

---

## Phase 2: Run Audit Sub-Agents (Parallel)

Launch ALL applicable audit sub-agents in a **single message** using multiple Task tool calls for parallel execution.

**IMPORTANT:** You MUST launch these as parallel Task calls in ONE message.

**Always Launch (7 core audits):**

1. **audit-security**
   ```
   Analyze branch for security issues. Compare against base branch.
   Save report to: ${AUDIT_BASE_DIR}/security-report.${TIMESTAMP}.md
   ```

2. **audit-performance**
   ```
   Analyze branch for performance issues. Compare against base branch.
   Save report to: ${AUDIT_BASE_DIR}/performance-report.${TIMESTAMP}.md
   ```

3. **audit-architecture**
   ```
   Analyze branch for architecture issues. Compare against base branch.
   Save report to: ${AUDIT_BASE_DIR}/architecture-report.${TIMESTAMP}.md
   ```

4. **audit-tests**
   ```
   Analyze branch for test coverage and quality issues. Compare against base branch.
   Save report to: ${AUDIT_BASE_DIR}/tests-report.${TIMESTAMP}.md
   ```

5. **audit-complexity**
   ```
   Analyze branch for code complexity issues. Compare against base branch.
   Save report to: ${AUDIT_BASE_DIR}/complexity-report.${TIMESTAMP}.md
   ```

6. **audit-dependencies**
   ```
   Analyze branch for dependency issues. Compare against base branch.
   Save report to: ${AUDIT_BASE_DIR}/dependencies-report.${TIMESTAMP}.md
   ```

7. **audit-documentation**
   ```
   Analyze branch for documentation issues. Compare against base branch.
   Save report to: ${AUDIT_BASE_DIR}/documentation-report.${TIMESTAMP}.md
   ```

**Conditional Audits:**

8. **audit-typescript** (if HAS_TYPESCRIPT=true)
   ```
   Analyze branch for TypeScript issues. Compare against base branch.
   Save report to: ${AUDIT_BASE_DIR}/typescript-report.${TIMESTAMP}.md
   ```

9. **audit-database** (if HAS_DB_CHANGES=true)
   ```
   Analyze branch for database issues. Compare against base branch.
   Save report to: ${AUDIT_BASE_DIR}/database-report.${TIMESTAMP}.md
   ```

---

## Phase 3: Synthesis (After Audits Complete)

**WAIT for all Phase 2 audits to complete before proceeding.**

After all audit sub-agents have finished, launch THREE synthesis sub-agents in **parallel**:

### 3.1 code-review sub-agent (Summary Report)

```
Generate code review summary for branch ${CURRENT_BRANCH}.

Context:
- Branch: ${CURRENT_BRANCH}
- Base: ${BASE_BRANCH}
- Audit Directory: ${AUDIT_BASE_DIR}
- Timestamp: ${TIMESTAMP}

Tasks:
1. Read all audit reports from ${AUDIT_BASE_DIR}/*-report.${TIMESTAMP}.md
2. Extract and categorize all issues (🔴/⚠️/ℹ️)
3. Generate summary report at ${AUDIT_BASE_DIR}/review-summary.${TIMESTAMP}.md
4. Determine merge recommendation

Report back: Merge recommendation and issue counts
```

### 3.2 pr-comments sub-agent (PR Comments)

```
Create PR comments for code review findings on branch ${CURRENT_BRANCH}.

Context:
- Branch: ${CURRENT_BRANCH}
- Audit Directory: ${AUDIT_BASE_DIR}
- Timestamp: ${TIMESTAMP}

Tasks:
1. Read all audit reports from ${AUDIT_BASE_DIR}/*-report.${TIMESTAMP}.md
2. Ensure PR exists (create draft if missing)
3. Create individual comments for all 🔴 blocking issues
4. Create individual comments for all ⚠️ should-fix issues
5. Include suggested fixes with code examples
6. Show pros/cons table when multiple approaches exist
7. Add Claude Code attribution to each comment

Report back: PR number and count of comments created
```

### 3.3 tech-debt sub-agent (Tech Debt Management)

```
Manage tech debt for code review on branch ${CURRENT_BRANCH}.

Context:
- Branch: ${CURRENT_BRANCH}
- Audit Directory: ${AUDIT_BASE_DIR}
- Timestamp: ${TIMESTAMP}

Tasks:
1. Read all audit reports from ${AUDIT_BASE_DIR}/*-report.${TIMESTAMP}.md
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
**Audits**: {count} specialized audits completed

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

- **Summary**: `${AUDIT_BASE_DIR}/review-summary.${TIMESTAMP}.md`
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

1. **Phase 2 is parallel** - Launch ALL audit sub-agents in a single message
2. **Phase 3 is parallel** - Launch ALL synthesis sub-agents in a single message (after Phase 2)
3. **Don't read reports yourself** - Sub-agents handle all file reading
4. **Don't create artifacts yourself** - Each sub-agent creates its own outputs
5. **Pass context accurately** - Ensure AUDIT_BASE_DIR and TIMESTAMP reach all sub-agents
6. **Consolidate results** - Combine reports from all three synthesis agents for final output
