---
description: Comprehensive branch review using specialized sub-agents for PR readiness
allowed-tools: Task, Bash, Read, Write, Grep, Glob
---

## Your Task

Orchestrate multiple specialized audit sub-agents to review the current branch, then synthesize their findings into an actionable summary.

---

## Step 1: Determine Review Scope

Get the current branch and base branch:

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

---

## Step 2: Set Up Audit Structure

Create directory for audit reports:

```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
BRANCH_SLUG=$(echo "$CURRENT_BRANCH" | sed 's/\//-/g')
AUDIT_BASE_DIR=".docs/audits/${BRANCH_SLUG}"
mkdir -p "$AUDIT_BASE_DIR"

echo "📁 Audit reports: $AUDIT_BASE_DIR"
echo ""
```

---

## Step 3: Launch Audit Sub-Agents in Parallel

Use the Task tool to launch all audit sub-agents in parallel. Each will analyze the branch and save its report.

**Launch these sub-agents:**

Use Task tool with `subagent_type` for each audit:

```
1. Launch audit-security sub-agent:
   "Analyze branch ${CURRENT_BRANCH} for security issues. Compare against ${BASE_BRANCH}. Save report to ${AUDIT_BASE_DIR}/security-report.${TIMESTAMP}.md"

2. Launch audit-performance sub-agent:
   "Analyze branch ${CURRENT_BRANCH} for performance issues. Compare against ${BASE_BRANCH}. Save report to ${AUDIT_BASE_DIR}/performance-report.${TIMESTAMP}.md"

3. Launch audit-architecture sub-agent:
   "Analyze branch ${CURRENT_BRANCH} for architecture issues. Compare against ${BASE_BRANCH}. Save report to ${AUDIT_BASE_DIR}/architecture-report.${TIMESTAMP}.md"

4. Launch audit-tests sub-agent:
   "Analyze branch ${CURRENT_BRANCH} for test coverage and quality issues. Compare against ${BASE_BRANCH}. Save report to ${AUDIT_BASE_DIR}/tests-report.${TIMESTAMP}.md"

5. Launch audit-complexity sub-agent:
   "Analyze branch ${CURRENT_BRANCH} for code complexity issues. Compare against ${BASE_BRANCH}. Save report to ${AUDIT_BASE_DIR}/complexity-report.${TIMESTAMP}.md"

6. Launch audit-dependencies sub-agent:
   "Analyze branch ${CURRENT_BRANCH} for dependency issues. Compare against ${BASE_BRANCH}. Save report to ${AUDIT_BASE_DIR}/dependencies-report.${TIMESTAMP}.md"

7. Launch audit-documentation sub-agent:
   "Analyze branch ${CURRENT_BRANCH} for documentation issues. Compare against ${BASE_BRANCH}. Save report to ${AUDIT_BASE_DIR}/documentation-report.${TIMESTAMP}.md"

8. Launch audit-typescript sub-agent (if TypeScript project):
   "Analyze branch ${CURRENT_BRANCH} for TypeScript issues. Compare against ${BASE_BRANCH}. Save report to ${AUDIT_BASE_DIR}/typescript-report.${TIMESTAMP}.md"

9. Launch audit-database sub-agent (if database changes detected):
   "Analyze branch ${CURRENT_BRANCH} for database issues. Compare against ${BASE_BRANCH}. Save report to ${AUDIT_BASE_DIR}/database-report.${TIMESTAMP}.md"
```

**IMPORTANT:** Launch ALL applicable sub-agents in a single message using multiple Task tool calls for parallel execution.

---

## Step 4: Read Audit Reports

After all sub-agents complete, read each generated report:

```bash
# List generated reports
ls -1 "$AUDIT_BASE_DIR"/*-report.${TIMESTAMP}.md
```

Use the Read tool to read each report file:
- `${AUDIT_BASE_DIR}/security-report.${TIMESTAMP}.md`
- `${AUDIT_BASE_DIR}/performance-report.${TIMESTAMP}.md`
- `${AUDIT_BASE_DIR}/architecture-report.${TIMESTAMP}.md`
- `${AUDIT_BASE_DIR}/tests-report.${TIMESTAMP}.md`
- `${AUDIT_BASE_DIR}/complexity-report.${TIMESTAMP}.md`
- `${AUDIT_BASE_DIR}/dependencies-report.${TIMESTAMP}.md`
- `${AUDIT_BASE_DIR}/documentation-report.${TIMESTAMP}.md`
- (Plus typescript and database reports if generated)

---

## Step 5: Extract Blocking Issues

From each report, extract issues from the **🔴 Issues in Your Changes** section.

These are blocking issues introduced in this branch that must be fixed before merge.

For each report:
1. Look for the "🔴 Issues in Your Changes (BLOCKING)" section
2. Extract all CRITICAL and HIGH severity issues
3. Note the file:line references

Create a consolidated list of all blocking issues across all audits.

---

## Step 6: Create Summary Report

Create a comprehensive summary at `${AUDIT_BASE_DIR}/review-summary.${TIMESTAMP}.md`:

```markdown
# Code Review Summary - ${CURRENT_BRANCH}

**Date**: $(date +%Y-%m-%d %H:%M:%S)
**Branch**: ${CURRENT_BRANCH}
**Base**: ${BASE_BRANCH}
**Audits Run**: {count} specialized audits

---

## 🚦 Merge Recommendation

{One of:}
- ❌ **BLOCK MERGE** - Critical issues in your changes must be fixed
- ⚠️ **REVIEW REQUIRED** - High priority issues need attention
- ✅ **APPROVED WITH CONDITIONS** - Minor issues to address
- ✅ **APPROVED** - No blocking issues found

**Confidence**: {High/Medium/Low}

---

## 🔴 Blocking Issues (Must Fix Before Merge)

Issues introduced in lines you added or modified:

### Security (CRITICAL: X, HIGH: Y)
{List critical/high issues from security audit's 🔴 section}
- **[Issue]** - `file:line` - {description}

### Performance (CRITICAL: X, HIGH: Y)
{List critical/high issues from performance audit's 🔴 section}
- **[Issue]** - `file:line` - {description}

### Architecture (HIGH: X)
{List high issues from architecture audit's 🔴 section}
- **[Issue]** - `file:line` - {description}

### Tests (HIGH: X)
{List high issues from tests audit's 🔴 section}
- **[Issue]** - `file:line` - {description}

### Complexity (HIGH: X)
{List high issues from complexity audit's 🔴 section}
- **[Issue]** - `file:line` - {description}

### Dependencies (CRITICAL: X, HIGH: Y)
{List critical/high issues from dependencies audit's 🔴 section}
- **[Issue]** - `file:line` - {description}

### Documentation (HIGH: X)
{List high issues from documentation audit's 🔴 section}
- **[Issue]** - `file:line` - {description}

### TypeScript (HIGH: X)
{If applicable - list high issues from typescript audit's 🔴 section}
- **[Issue]** - `file:line` - {description}

### Database (CRITICAL: X, HIGH: Y)
{If applicable - list critical/high issues from database audit's 🔴 section}
- **[Issue]** - `file:line` - {description}

---

## ⚠️ Should Fix While You're Here

Issues in code you touched (from ⚠️ sections of each audit):

{Count of issues by audit - don't list all, just summarize}
- Security: {count} issues in code you touched
- Performance: {count} issues in code you touched
- Architecture: {count} issues in code you touched
- Tests: {count} issues in code you touched
- Complexity: {count} issues in code you touched

See individual audit reports for details.

---

## ℹ️ Pre-existing Issues Found

Issues unrelated to your changes (from ℹ️ sections):

{Count by audit}
- Security: {count} pre-existing issues
- Performance: {count} pre-existing issues
- Architecture: {count} pre-existing issues
- Tests: {count} pre-existing issues
- Complexity: {count} pre-existing issues
- Dependencies: {count} pre-existing issues
- Documentation: {count} pre-existing issues

Consider fixing in separate PRs.

---

## 📊 Summary by Category

**Your Changes (🔴 BLOCKING):**
- CRITICAL: {total_critical}
- HIGH: {total_high}
- MEDIUM: {total_medium}

**Code You Touched (⚠️ SHOULD FIX):**
- HIGH: {total_high}
- MEDIUM: {total_medium}

**Pre-existing (ℹ️ OPTIONAL):**
- MEDIUM: {total_medium}
- LOW: {total_low}

---

## 🎯 Action Plan

**Before Merge (Priority Order):**

1. {Highest priority blocking issue from any audit}
   - File: {file:line}
   - Fix: {recommended fix}

2. {Second highest priority blocking issue}
   - File: {file:line}
   - Fix: {recommended fix}

3. {Third highest priority blocking issue}
   - File: {file:line}
   - Fix: {recommended fix}

{Continue for all blocking issues}

**While You're Here (Optional):**
- Review ⚠️ sections in individual audit reports
- Fix issues in code you modified

**Future Work:**
- Create issues for pre-existing problems
- Track in technical debt backlog

---

## 📁 Individual Audit Reports

Detailed analysis available in:
- [Security Audit](security-report.${TIMESTAMP}.md)
- [Performance Audit](performance-report.${TIMESTAMP}.md)
- [Architecture Audit](architecture-report.${TIMESTAMP}.md)
- [Test Coverage Audit](tests-report.${TIMESTAMP}.md)
- [Complexity Audit](complexity-report.${TIMESTAMP}.md)
- [Dependencies Audit](dependencies-report.${TIMESTAMP}.md)
- [Documentation Audit](documentation-report.${TIMESTAMP}.md)
{If applicable:}
- [TypeScript Audit](typescript-report.${TIMESTAMP}.md)
- [Database Audit](database-report.${TIMESTAMP}.md)

---

## 💡 Next Steps

{If blocking issues exist:}
**Fix blocking issues then re-run `/code-review` to verify**

{If no blocking issues:}
**Ready to create PR:**
1. Run `/commit` to create final commits
2. Run `/pull-request` to create PR with this review as reference

{If issues in touched code:}
**Consider fixing ⚠️ issues while you're working in these files**

---

*Review generated by DevFlow audit orchestration*
*{Timestamp}*
```

Save this summary using Write tool.

---

## Step 7: Present Results to Developer

Show clear, actionable summary:

```markdown
🔍 CODE REVIEW COMPLETE

**Branch**: ${CURRENT_BRANCH}
**Audits**: {count} specialized audits completed

---

## 🚦 Merge Status

{Show the merge recommendation - one of:}
❌ **BLOCK MERGE** - {count} critical issues in your changes
⚠️ **REVIEW REQUIRED** - {count} high priority issues
✅ **APPROVED WITH CONDITIONS** - {count} minor issues
✅ **APPROVED** - No blocking issues found

---

## 🔴 Issues You Introduced ({total_count})

{Show top 3-5 most critical blocking issues}

**Security:**
- {Issue 1} - `file:line`

**Performance:**
- {Issue 1} - `file:line`

**Architecture:**
- {Issue 1} - `file:line`

{Show total counts}
Total blocking issues: {count}
- CRITICAL: {count}
- HIGH: {count}
- MEDIUM: {count}

---

## ⚠️ Issues in Code You Touched ({total_count})

{Show counts by audit}
- Security: {count} issues
- Performance: {count} issues
- Architecture: {count} issues
- Tests: {count} issues
- Complexity: {count} issues

See individual reports for details.

---

## ℹ️ Pre-existing Issues ({total_count})

{Show count by audit}
Found {count} legacy issues unrelated to your changes.
Consider fixing in separate PRs.

---

## 📁 Reports Saved

**Summary**: ${AUDIT_BASE_DIR}/review-summary.${TIMESTAMP}.md

**Individual Audits**:
{List all generated reports}

---

## 🎯 Next Steps

{If blocking issues:}
1. Fix the {count} blocking issues listed above
2. Re-run `/code-review` to verify fixes
3. Then create PR with `/pull-request`

{If no blocking issues:}
1. Review ⚠️ issues (optional improvements)
2. Create commits: `/commit`
3. Create PR: `/pull-request`

{Always show:}
💡 Full details in: ${AUDIT_BASE_DIR}/review-summary.${TIMESTAMP}.md
```

---

## Key Principles

1. **Launch sub-agents in parallel** - Use multiple Task calls in one message
2. **Read all reports** - Don't skip any audit results
3. **Extract blocking issues** - Focus on 🔴 sections from each report
4. **Be specific** - File:line references, exact issues, clear fixes
5. **Prioritize** - Blocking (must fix) vs should fix vs optional
6. **Be actionable** - Clear next steps based on findings
