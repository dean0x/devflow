---
name: devflow-review-methodology
description: Standard review process for all DevFlow review agents. Load when performing code reviews to ensure consistent 6-step process with 3-category issue classification. This is the shared methodology for SecurityReview, PerformanceReview, and all other review agents.
allowed-tools: Read, Grep, Glob, Bash
---

# Review Methodology

The canonical review process for all DevFlow review agents. Ensures consistent, fair, and actionable code reviews.

## Core Philosophy

1. **Focus on changed lines first** - Developer introduced these
2. **Context matters** - Issues near changes should be fixed together
3. **Be fair** - Don't block PRs for legacy code
4. **Be specific** - Exact file:line with examples
5. **Be actionable** - Clear fixes, not vague complaints

---

## 6-Step Review Process

### Step 1: Identify Changed Lines

Get the diff to understand exactly what changed:

```bash
# Get the base branch
BASE_BRANCH=""
for branch in main master develop; do
  if git show-ref --verify --quiet refs/heads/$branch; then
    BASE_BRANCH=$branch
    break
  fi
done

# Get changed files
git diff --name-only $BASE_BRANCH...HEAD > /tmp/changed_files.txt

# Get detailed diff with line numbers
git diff $BASE_BRANCH...HEAD > /tmp/full_diff.txt

# Extract exact line numbers that changed
git diff $BASE_BRANCH...HEAD --unified=0 | grep -E '^@@' > /tmp/changed_lines.txt

# Get diff statistics
git diff $BASE_BRANCH...HEAD --stat > /tmp/diff_stats.txt

echo "Changed files: $(wc -l < /tmp/changed_files.txt)"
echo "Base branch: $BASE_BRANCH"
echo "Current branch: $(git branch --show-current)"
```

### Step 2: Categorize Issues (Three Categories)

For every issue found, determine which category it belongs to:

**Category 1: Issues in Your Changes (BLOCKING)**
- Lines that were ADDED or MODIFIED in this branch
- These are NEW issues introduced by this PR
- **Priority**: BLOCKING - must fix before merge
- **Icon**: Red circle with cross

**Category 2: Issues in Code You Touched (Should Fix)**
- Lines that exist in files you modified, but you didn't directly change them
- Issues near your changes (same function, same file section)
- **Priority**: HIGH - should fix while you're here
- **Icon**: Warning triangle

**Category 3: Pre-existing Issues (Not Blocking)**
- Lines in files you reviewed but didn't modify at all
- Legacy issues unrelated to this PR
- **Priority**: INFORMATIONAL - fix in separate PR
- **Icon**: Information circle

### Step 3: Analyze with Domain Expertise

Apply your specialized lens (security, performance, tests, etc.) to:

1. **Your Changes (Category 1)**
   - Analyze every added/modified line
   - These get the most scrutiny
   - Any issue here blocks the PR

2. **Code You Touched (Category 2)**
   - Analyze the context around your changes
   - Same function, same class, same module
   - Issues here should be fixed together

3. **Pre-existing Code (Category 3)**
   - Note but don't block for these
   - Suggest creating separate issues
   - Track technical debt separately

### Step 4: Prioritize by Severity

Within each category, rank issues:

**CRITICAL** - Immediate risk, must fix:
- Security vulnerabilities that can be exploited
- Data loss or corruption risks
- Breaking changes to public APIs

**HIGH** - Significant risk, should fix:
- Performance degradation
- Maintainability issues
- Missing error handling

**MEDIUM** - Moderate risk, consider fixing:
- Code style inconsistencies
- Missing documentation
- Suboptimal patterns

**LOW** - Minor improvements:
- Naming suggestions
- Optional optimizations
- Style preferences

### Step 5: Create Actionable Comments

For each issue, provide:

1. **Location**: Exact file:line reference
2. **Problem**: Clear description of the issue
3. **Impact**: Why this matters
4. **Fix**: Specific code showing the solution
5. **Category**: Which of the 3 categories

**PR Line Comment Format**:

```markdown
**{Icon} {Domain}: {Issue Title}**

{Brief description of the issue}

**Current:**
```{language}
{problematic code}
```

**Suggested Fix:**
```{language}
{fixed code}
```

**Why:** {Explanation of impact}

---
*Severity: {CRITICAL/HIGH/MEDIUM} | Category: {Your Changes/Code You Touched/Pre-existing}*
<sub>Claude Code `/review`</sub>
```

### Step 6: Generate Report

Create comprehensive report with all three sections:

```markdown
# {Domain} Review Report

**Branch**: ${CURRENT_BRANCH}
**Base**: ${BASE_BRANCH}
**Date**: $(date +%Y-%m-%d %H:%M:%S)
**Files Analyzed**: ${FILE_COUNT}
**Lines Changed**: ${LINES_CHANGED}

---

## Issues in Your Changes (BLOCKING)

These issues were introduced in lines you added or modified:

### CRITICAL

**[Issue Title]** - `file.ts:123` (line ADDED in this branch)
- **Issue**: {description}
- **Impact**: {why it matters}
- **Code**:
  ```typescript
  {problematic code}
  ```
- **Fix**:
  ```typescript
  {corrected code}
  ```

### HIGH

{More findings in lines you changed}

---

## Issues in Code You Touched (Should Fix)

These issues exist in code you modified or functions you updated:

### HIGH

**[Issue Title]** - `file.ts:89` (in function you modified)
- **Issue**: {description}
- **Context**: You modified this function but didn't fix this
- **Recommendation**: Fix while you're here

{More findings in touched code}

---

## Pre-existing Issues (Not Blocking)

These issues exist in files you reviewed but are unrelated to your changes:

### MEDIUM

**[Issue Title]** - `file.ts:456` (pre-existing, line not changed)
- **Issue**: {description}
- **Recommendation**: Fix in separate PR
- **Reason not blocking**: Existed before your changes

{More pre-existing findings}

---

## Summary

**Your Changes:**
- CRITICAL: X (MUST FIX)
- HIGH: Y (MUST FIX)
- MEDIUM: Z

**Code You Touched:**
- HIGH: X (SHOULD FIX)
- MEDIUM: Y (SHOULD FIX)

**Pre-existing:**
- MEDIUM: X (OPTIONAL)
- LOW: Y (OPTIONAL)

**{Domain} Score**: {X}/10

**Merge Recommendation**:
- BLOCK MERGE (if critical/high issues in your changes)
- REVIEW REQUIRED (if medium issues in your changes)
- APPROVED WITH CONDITIONS (if only touched/pre-existing issues)
- APPROVED (if no issues in your changes)

---

## Remediation Priority

**Fix before merge:**
1. {Critical issue in your changes}
2. {High issue in your changes}

**Fix while you're here:**
1. {Issue in code you touched}

**Future work:**
- Create issues for pre-existing problems
- Track technical debt separately
```

---

## PR Comment Integration

When PR_NUMBER is provided, create line-specific comments:

```bash
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
COMMIT_SHA=$(git rev-parse HEAD)
COMMENTS_CREATED=0
COMMENTS_SKIPPED=0

create_pr_comment() {
    local FILE="$1" LINE="$2" BODY="$3"

    # Only comment on lines in the PR diff
    if gh pr diff "$PR_NUMBER" --name-only 2>/dev/null | grep -q "^${FILE}$"; then
        gh api "repos/${REPO}/pulls/${PR_NUMBER}/comments" \
            -f body="$BODY" \
            -f commit_id="$COMMIT_SHA" \
            -f path="$FILE" \
            -f line="$LINE" \
            -f side="RIGHT" 2>/dev/null \
            && COMMENTS_CREATED=$((COMMENTS_CREATED + 1)) \
            || COMMENTS_SKIPPED=$((COMMENTS_SKIPPED + 1))
    else
        COMMENTS_SKIPPED=$((COMMENTS_SKIPPED + 1))
    fi

    # Rate limiting
    sleep 1
}

# Only create comments for BLOCKING issues (Category 1)
# Category 2 and 3 go in the summary report only
```

---

## Report File Conventions

Save reports to standardized location:

```bash
# Get timestamp and branch slug
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
BRANCH_SLUG=$(git branch --show-current | sed 's/\//-/g')

# When invoked by /review command
REPORT_FILE=".docs/reviews/${BRANCH_SLUG}/{domain}-report.${TIMESTAMP}.md"

# When invoked standalone
REPORT_FILE="${REPORT_FILE:-.docs/reviews/standalone/{domain}-report.${TIMESTAMP}.md}"

# Ensure directory exists
mkdir -p "$(dirname "$REPORT_FILE")"

# Save report with comment stats
cat > "$REPORT_FILE" <<'REPORT'
{Generated report content}

---

## PR Comment Summary

- **Comments Created**: ${COMMENTS_CREATED}
- **Comments Skipped**: ${COMMENTS_SKIPPED} (lines not in PR diff)
REPORT

echo "Review saved: $REPORT_FILE"
```

---

## Key Principles Summary

| Principle | Description |
|-----------|-------------|
| **Diff-Aware** | Focus on actual changes, not pre-existing issues |
| **Fair** | Don't block PRs for legacy problems |
| **Specific** | Exact file:line, not vague complaints |
| **Actionable** | Show the fix, not just the problem |
| **Categorized** | Clear distinction between blocking and informational |
| **Prioritized** | Critical > High > Medium > Low |
| **Documented** | Reports saved for future reference |

---

## Integration

This methodology is used by:
- **SecurityReview**: Security-focused analysis
- **PerformanceReview**: Performance-focused analysis
- **ArchitectureReview**: Architecture-focused analysis
- **TestsReview**: Test quality analysis
- **ConsistencyReview**: Code consistency analysis
- **ComplexityReview**: Complexity analysis
- **RegressionReview**: Regression detection
- **DependenciesReview**: Dependency analysis
- **DocumentationReview**: Documentation analysis
- **TypescriptReview**: TypeScript analysis
- **DatabaseReview**: Database analysis

All review agents should load this skill and apply its methodology with their domain expertise.
