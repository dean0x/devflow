# Review Methodology Patterns

Correct patterns for effective code reviews.

---

## 6-Step Review Process

1. **Understand Context** - Read PR description, linked issues
2. **Get Diff** - Analyze changed files
3. **Review by Category** - Security, architecture, performance, etc.
4. **Classify Issues** - CRITICAL, HIGH, MEDIUM, LOW
5. **Write Report** - Structured format with file:line references
6. **Post Comments** - Use GitHub API for PR comments

---

## Issue Classification

| Category | Criteria |
|----------|----------|
| CRITICAL | Security vulnerabilities, data loss, crashes |
| HIGH | Bugs, significant performance issues |
| MEDIUM | Code quality, maintainability |
| LOW | Style, documentation, minor improvements |

---

## Diff Analysis Commands

### Getting the Diff

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

### Useful Git Commands

| Command | Purpose |
|---------|---------|
| `git diff --name-only BASE...HEAD` | List changed files |
| `git diff BASE...HEAD --stat` | Summary of changes |
| `git diff BASE...HEAD --unified=0` | Only changed lines (no context) |
| `git diff BASE...HEAD -- path/` | Diff for specific directory |
| `git log BASE..HEAD --oneline` | Commits in this branch |
| `git show --stat HEAD` | Last commit details |

### Branch Detection

```bash
# Detect base branch (in priority order)
for branch in main master develop; do
  if git show-ref --verify --quiet refs/heads/$branch; then
    BASE_BRANCH=$branch
    break
  fi
done

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)

# Get branch slug for filenames
BRANCH_SLUG=$(echo "$CURRENT_BRANCH" | sed 's/\//-/g')
```

---

## Report File Conventions

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

# Save report
cat > "$REPORT_FILE" <<'REPORT'
{Generated report content}
REPORT

echo "Review saved: $REPORT_FILE"
```

---

## PR Comment Integration

### Comment Creation Function

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

### Comment Rules

1. **Only comment on blocking issues** - Category 1 (Issues in Your Changes)
2. **Verify file is in PR diff** - Skip files not part of the PR
3. **Rate limit API calls** - 1 second delay between comments
4. **Track statistics** - Count created vs skipped comments

### API Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `body` | Comment text | Markdown-formatted comment |
| `commit_id` | HEAD SHA | The commit to attach comment to |
| `path` | File path | Relative path to file |
| `line` | Line number | Line number in the diff |
| `side` | "RIGHT" | Comment on new file version |

### Comment Summary Section

Add to report footer:

```markdown
---

## PR Comment Summary

- **Comments Created**: ${COMMENTS_CREATED}
- **Comments Skipped**: ${COMMENTS_SKIPPED} (lines not in PR diff)
```

---

## Quick Reference

See [report-template.md](report-template.md) for full report format.
