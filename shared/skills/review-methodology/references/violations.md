# Review Methodology Violations

Common anti-patterns that undermine effective code reviews.

---

## Review Process Violations

| Violation | Problem | Fix |
|-----------|---------|-----|
| Blocking for pre-existing issues | Unfair to author | Only flag issues in changed code |
| Missing severity classification | Unclear priority | Use CRITICAL/HIGH/MEDIUM/LOW |
| No file:line references | Hard to locate | Always include specific locations |
| Vague feedback | Not actionable | Provide concrete fixes |
| Mixing concerns | Confusing review | Separate by category |
| Opinion as requirement | Overreach | Distinguish style from correctness |

---

## Diff Analysis Violations

### Incorrect Base Branch Detection

```bash
# VIOLATION: Hardcoding base branch
BASE_BRANCH="main"  # Fails if repo uses master or develop

# VIOLATION: Not verifying branch exists
git diff main...HEAD  # Errors if main doesn't exist
```

### Missing Change Context

```bash
# VIOLATION: Getting all files instead of changed files
git ls-files  # Wrong - includes unchanged files

# VIOLATION: Missing line-level precision
git diff --name-only  # Only file names, no line numbers
```

---

## PR Comment Violations

### Commenting on Wrong Lines

```bash
# VIOLATION: Commenting without checking if file is in diff
gh api "repos/${REPO}/pulls/${PR_NUMBER}/comments" \
    -f path="$FILE" \
    -f line="$LINE"  # May fail if file not in PR

# VIOLATION: No rate limiting
for issue in "${ISSUES[@]}"; do
    create_pr_comment "$issue"  # Will hit API rate limits
done
```

### Wrong Comment Scope

```bash
# VIOLATION: Commenting on pre-existing issues
# Category 3 issues should NOT get PR comments
create_pr_comment "file.ts" "456" "Pre-existing bug"  # Wrong!

# VIOLATION: Missing severity indicator
create_pr_comment "file.ts" "123" "This is a problem"  # No severity
```

---

## Report Violations

### Missing Structure

```markdown
# VIOLATION: Flat list without categories

- Bug in file.ts:123
- Security issue in auth.ts:45
- Style problem in utils.ts:89
```

### Missing Context

```markdown
# VIOLATION: Issue without remediation

**Issue**: SQL injection in query.ts:34
<!-- No fix provided, no severity, no impact -->
```

### Incorrect File Naming

```bash
# VIOLATION: Non-standard naming
REPORT_FILE="review.md"  # No timestamp, no branch

# VIOLATION: Wrong directory
REPORT_FILE="./reviews/report.md"  # Should be .docs/reviews/
```

---

## Detection Patterns

Use these to find violations in review code:

```bash
# Find hardcoded base branches
grep -r 'BASE_BRANCH="main"' --include="*.sh"

# Find missing rate limiting
grep -r 'gh api.*comments' --include="*.sh" | grep -v 'sleep'

# Find missing severity classifications
grep -r 'create_pr_comment' --include="*.sh" | grep -v 'CRITICAL\|HIGH\|MEDIUM\|LOW'
```

---

## Quick Reference

See [report-template.md](report-template.md) for proper review format.
