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

```markdown
# VIOLATION: Publishing from inside a review

A review that posts its own comments bypasses the repo-visibility gate and the
comment-sink scrub that post-review-summary applies, and publishes findings that were
never synthesized or deduplicated. Write the finding into the report instead.

# VIOLATION: Commenting on pre-existing issues

Category 3 findings belong to the summary report. A comment on a line the author did
not touch reads as a request to fix unrelated code.
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
REPORT_FILE="./reviews/report.md"  # Should be .devflow/docs/reviews/
```

---

## Detection Patterns

Use these to find violations in review code:

```bash
# Find hardcoded base branches
grep -r 'BASE_BRANCH="main"' --include="*.sh"

# Find review instructions that post their own comments instead of writing the report
grep -rn 'gh pr comment' --include="*.md" --include="*.sh"
grep -rn 'gh api .*/comments' --include="*.md" --include="*.sh"
```

---

## Quick Reference

See [report-template.md](report-template.md) for proper review format.
