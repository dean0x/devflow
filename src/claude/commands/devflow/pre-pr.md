---
description: Comprehensive branch review using specialized sub-agents for PR readiness
allowed-tools: Task, Bash, Read, Write, Grep, Glob
---

## Your Task

Perform a comprehensive review of this entire feature branch by orchestrating multiple specialized sub-agents in parallel. This is designed for thorough analysis before creating pull requests or merging branches.

### Step 1: Analyze Branch Changes

First, determine the branch and base for comparison:

```bash
# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
    echo "❌ Not on a branch (detached HEAD). Checkout a feature branch first."
    exit 1
fi

# Determine base branch (main, master, or develop)
BASE_BRANCH=""
for branch in main master develop; do
    if git show-ref --verify --quiet refs/heads/$branch; then
        BASE_BRANCH=$branch
        break
    fi
done

if [ -z "$BASE_BRANCH" ]; then
    echo "❌ Could not find base branch (main/master/develop). Specify manually."
    exit 1
fi

echo "=== BRANCH REVIEW SCOPE ==="
echo "Current branch: $CURRENT_BRANCH"
echo "Base branch: $BASE_BRANCH"
echo ""

# Check if there are changes to review
if git diff --quiet $BASE_BRANCH...HEAD; then
    echo "No changes between $BASE_BRANCH and $CURRENT_BRANCH"
    exit 0
fi

# Show comprehensive change summary
echo "=== CHANGES TO REVIEW ==="
git diff --stat $BASE_BRANCH...HEAD
echo ""
echo "=== COMMIT HISTORY ==="
git log --oneline $BASE_BRANCH..HEAD
echo ""
```

### Step 2: Detect Change Categories

Analyze what types of changes are in this branch to determine which specialized agents are needed:

```bash
# Check if database-related files changed
DB_CHANGES=$(git diff --name-only $BASE_BRANCH...HEAD | grep -E '\.(sql|prisma|migration|knex|sequelize|db)' || true)
DB_CHANGES+=$(git diff --name-only $BASE_BRANCH...HEAD | grep -iE '(migration|schema|database|models/)' || true)

if [ -n "$DB_CHANGES" ]; then
    echo "🗄️  Database changes detected - will run database audit"
    INCLUDE_DB_AUDIT=true
else
    echo "ℹ️  No database changes detected - skipping database audit"
    INCLUDE_DB_AUDIT=false
fi
echo ""
```

### Step 3: Launch Specialized Sub-Agents in Parallel

Launch these sub-agents in parallel based on change detection:

**Core Audits (Always Run)**:
1. audit-security sub-agent
2. audit-performance sub-agent
3. audit-architecture sub-agent
4. audit-tests sub-agent
5. audit-complexity sub-agent
6. audit-dependencies sub-agent
7. audit-documentation sub-agent

**Conditional Audits** (automatically detect and skip if not applicable):
8. audit-typescript sub-agent (only if .ts/.tsx files changed or tsconfig.json exists)
9. audit-database sub-agent (only if database changes detected)

### Step 4: Synthesize Comprehensive Review

After all sub-agents complete their analysis:

1. **Collect Results**: Gather findings from all 7-8 specialized sub-agents (depending on change types)
2. **Cross-Reference Issues**: Identify overlapping concerns between domains
3. **Prioritize for PR**: Focus on merge-blocking vs nice-to-have improvements
4. **Create PR-Ready Review**: Structure for easy consumption by human reviewers

### Step 5: Save Comprehensive Review Document

Create a detailed review document at `.docs/reviews/branch-{BRANCH_NAME}-{YYYY-MM-DD_HHMM}.md`:

```markdown
# Branch Review - {BRANCH_NAME}
**Date**: {current_date}
**Time**: {current_time}
**Type**: Branch Review (PR Readiness Assessment)
**Branch**: {CURRENT_BRANCH}
**Base**: {BASE_BRANCH}
**Reviewer**: AI Sub-Agent Orchestra

---

## 📊 Branch Overview

**Commits**: {commit_count} commits
**Files Changed**: {files_changed}
**Lines Added**: {lines_added}
**Lines Removed**: {lines_removed}
**Review Duration**: {duration}

### Change Categories
- 🎯 **Features**: {feature_changes}
- 🐛 **Bug Fixes**: {bug_fixes}
- 🔧 **Refactoring**: {refactoring}
- 📚 **Documentation**: {doc_changes}
- 🧪 **Tests**: {test_changes}

---

## 🎯 PR Readiness Assessment

### 🚦 MERGE RECOMMENDATION
**Status**: {✅ READY TO MERGE | ⚠️ ISSUES TO ADDRESS | 🚫 NOT READY}

**Confidence Level**: {High/Medium/Low}

### Blocking Issues (Must Fix Before Merge)
- 🔴 {critical_issue_1} in {file:line}
- 🔴 {critical_issue_2} in {file:line}

### High Priority (Should Fix Before Merge)
- 🟠 {high_issue_1} in {file:line}
- 🟠 {high_issue_2} in {file:line}

---

## 🔍 Detailed Sub-Agent Analysis

### 🔒 Security Analysis (audit-security)
**Risk Level**: {Low/Medium/High/Critical}

#### Security Issues Found
{detailed security findings with file:line references}

#### Security Recommendations
{specific security improvements needed}

### 📘 TypeScript Analysis (audit-typescript)
**Type Safety**: {Excellent/Good/Acceptable/Poor}
**Note**: Only included if TypeScript files changed or project uses TypeScript

#### TypeScript Issues Found
{detailed type safety findings with file:line references}

#### TypeScript Recommendations
{specific type safety improvements needed}

### ⚡ Performance Analysis (audit-performance)
**Performance Impact**: {Positive/Neutral/Negative}

#### Performance Issues Found
{detailed performance findings with optimizations}

#### Performance Recommendations
{specific performance improvements}

### 🏗️ Architecture Analysis (audit-architecture)
**Architecture Quality**: {Excellent/Good/Acceptable/Poor}

#### Architectural Issues Found
{detailed architecture findings and design concerns}

#### Architecture Recommendations
{specific architectural improvements}

### 🧪 Test Coverage Analysis (audit-tests)
**Coverage Assessment**: {Excellent/Good/Adequate/Insufficient}

#### Testing Issues Found
{detailed test coverage gaps and quality issues}

#### Testing Recommendations
{specific tests that should be added}

### 🧠 Complexity Analysis (audit-complexity)
**Maintainability Score**: {Excellent/Good/Acceptable/Poor}

#### Complexity Issues Found
{detailed complexity and maintainability concerns}

#### Complexity Recommendations
{specific refactoring suggestions}

### 📦 Dependency Analysis (audit-dependencies)
**Dependency Health**: {Excellent/Good/Acceptable/Poor}

#### Dependency Issues Found
{detailed dependency concerns and security issues}

#### Dependency Recommendations
{specific dependency management improvements}

### 📚 Documentation Analysis (audit-documentation)
**Documentation Quality**: {Excellent/Good/Acceptable/Poor}

#### Documentation Issues Found
{detailed documentation drift, missing docs, stale examples}

#### Documentation Recommendations
{specific documentation updates needed}

### 🗄️ Database Analysis (audit-database)
**Database Health**: {Excellent/Good/Acceptable/Poor}
**Note**: Only included if database changes detected

#### Database Issues Found
{detailed database design, migration, and query issues}

#### Database Recommendations
{specific database improvements needed}

---

## 🎯 Action Plan

### Pre-Merge Checklist (Blocking)
- [ ] {blocking_action_1} - {estimated_effort}
- [ ] {blocking_action_2} - {estimated_effort}
- [ ] {blocking_action_3} - {estimated_effort}

### Post-Merge Improvements (Non-Blocking)
- [ ] {improvement_1} - {estimated_effort}
- [ ] {improvement_2} - {estimated_effort}
- [ ] {improvement_3} - {estimated_effort}

### Follow-Up Tasks
- [ ] {followup_1}
- [ ] {followup_2}

---

## 📈 Quality Metrics

### Code Quality Score: {score}/10

**Breakdown**:
- Security: {score}/10
- TypeScript: {score}/10 (if applicable)
- Performance: {score}/10
- Architecture: {score}/10
- Test Coverage: {score}/10
- Maintainability: {score}/10
- Dependencies: {score}/10
- Documentation: {score}/10
- Database: {score}/10 (if applicable)

### Comparison to {BASE_BRANCH}
- Quality Trend: {Improving/Stable/Declining}
- Technical Debt: {Reduced/Neutral/Increased}
- Test Coverage: {Increased/Maintained/Decreased}

---

## 🔗 Related Resources

### Files Requiring Attention
- {file1} - {reason}
- {file2} - {reason}
- {file3} - {reason}

### Similar Issues in Codebase
- {related_issue_1} in {location}
- {related_issue_2} in {location}

### Documentation Updates Needed
- {doc_update_1}
- {doc_update_2}

---

## 💡 Reviewer Notes

### Human Review Focus Areas
Based on sub-agent analysis, human reviewers should focus on:
1. {focus_area_1} - {reason}
2. {focus_area_2} - {reason}
3. {focus_area_3} - {reason}

### Discussion Points
- {discussion_point_1}
- {discussion_point_2}
- {discussion_point_3}

---

*Comprehensive review generated by DevFlow sub-agent orchestration*
*Next: Address blocking issues, then create PR with this review as reference*
```

### Step 6: Provide Executive Summary

Give the developer a clear, actionable summary:

```
🔍 BRANCH REVIEW COMPLETE: {BRANCH_NAME}

📊 ANALYSIS SUMMARY:
- Files analyzed: {X} files, {Y} commits
- Issues found: {Critical} critical, {High} high, {Medium} medium, {Low} low
- Review confidence: {High/Medium/Low}

🚦 PR READINESS: {✅ READY | ⚠️ ISSUES TO ADDRESS | 🚫 NOT READY}

🎯 CRITICAL ACTIONS BEFORE MERGE:
1. {Most critical blocking issue}
2. {Second most critical blocking issue}
3. {Third most critical blocking issue}

⚡ QUICK WINS:
- {Easy fix 1} ({estimated time})
- {Easy fix 2} ({estimated time})

📄 Full review: .docs/reviews/branch-{branch}-{timestamp}.md

🔄 NEXT STEPS:
1. Address blocking issues above
2. Run `/pre-commit` after fixes to verify
3. Create PR using this review as reference
4. Share review with team for human review focus
```
