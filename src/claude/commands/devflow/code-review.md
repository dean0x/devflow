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

## Phase 3: Synthesis (Sequential - After Audits Complete)

**WAIT for all Phase 2 audits to complete before proceeding.**

After all audit sub-agents have finished and saved their reports, launch the code-review sub-agent:

**code-review sub-agent:**
```
Synthesize code review findings for branch ${CURRENT_BRANCH}.

Context:
- Branch: ${CURRENT_BRANCH}
- Base: ${BASE_BRANCH}
- Audit Directory: ${AUDIT_BASE_DIR}
- Timestamp: ${TIMESTAMP}

Your tasks:
1. Read all audit reports from ${AUDIT_BASE_DIR}/*-report.${TIMESTAMP}.md
2. Generate summary report at ${AUDIT_BASE_DIR}/review-summary.${TIMESTAMP}.md
3. Ensure PR exists for this branch (create draft if missing)
4. Create individual PR comments for all 🔴 blocking and ⚠️ should-fix issues
   - Include suggested fixes with code examples
   - When multiple approaches exist, show pros/cons table with recommendation
5. Update tech debt GitHub issue with all ℹ️ pre-existing issues
   - Deduplicate semantically (same file + audit type + similar description)
   - Brief summary format with links to review docs

Report back:
- Merge recommendation
- Number of PR comments created
- Number of tech debt items added
- Links to PR and tech debt issue
```

---

## Phase 4: Present Results

After the code-review sub-agent completes, display final summary:

```markdown
🔍 CODE REVIEW COMPLETE

**Branch**: ${CURRENT_BRANCH}
**Audits**: {count} specialized audits completed

---

## 🚦 Merge Status: {RECOMMENDATION}

---

## 📊 Issues Found

| Category | Count | Action |
|----------|-------|--------|
| 🔴 Blocking | {count} | Must fix before merge |
| ⚠️ Should Fix | {count} | Fix while you're here |
| ℹ️ Pre-existing | {count} | Added to tech debt |

---

## 📝 Artifacts Created

- **Summary**: `${AUDIT_BASE_DIR}/review-summary.${TIMESTAMP}.md`
- **PR Comments**: {count} comments on PR #{number}
- **Tech Debt**: Issue #{number} updated

---

## 🎯 Next Steps

{Based on merge recommendation}
```

---

## Orchestration Rules

1. **Phase 2 is parallel** - Launch ALL audit sub-agents in a single message
2. **Phase 3 is sequential** - Only start after ALL Phase 2 audits complete
3. **Don't read reports yourself** - The code-review sub-agent handles synthesis
4. **Don't create PR comments yourself** - The code-review sub-agent handles GitHub
5. **Pass context accurately** - Ensure AUDIT_BASE_DIR and TIMESTAMP reach sub-agent
