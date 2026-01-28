# Review Commands Reference

Bash commands for review operations.

## Getting the Diff

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

## Useful Git Commands

| Command | Purpose |
|---------|---------|
| `git diff --name-only BASE...HEAD` | List changed files |
| `git diff BASE...HEAD --stat` | Summary of changes |
| `git diff BASE...HEAD --unified=0` | Only changed lines (no context) |
| `git diff BASE...HEAD -- path/` | Diff for specific directory |
| `git log BASE..HEAD --oneline` | Commits in this branch |
| `git show --stat HEAD` | Last commit details |

## Branch Detection

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
