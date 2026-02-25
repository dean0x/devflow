# Review Report Template

Full template for generating review reports.

## Report Structure

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

## PR Line Comment Format

For individual line comments on PRs:

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
<sub>Claude Code `/code-review`</sub>
```

## File Naming

Reports use this naming convention:
- Directory: `.docs/reviews/{branch-slug}/`
- Filename: `{domain}-report.{YYYY-MM-DD_HHMM}.md`
- Summary: `review-summary.{YYYY-MM-DD_HHMM}.md`
