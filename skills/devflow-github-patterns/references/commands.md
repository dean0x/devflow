# GitHub CLI Command Reference

Extended `gh` CLI command examples for common GitHub operations.

---

## PR Comments

### Creating Inline Comments

```bash
OWNER=$(echo $REPO_INFO | cut -d'/' -f1)
REPO=$(echo $REPO_INFO | cut -d'/' -f2)
HEAD_SHA=$(gh pr view $PR_NUMBER --json headRefOid -q '.headRefOid')

gh api \
  -X POST \
  "repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/comments" \
  -f body="$COMMENT_BODY" \
  -f commit_id="$HEAD_SHA" \
  -f path="$FILE_PATH" \
  -F line=$LINE_NUMBER \
  -f side="RIGHT"

sleep 1  # Rate limiting
```

### Line-in-Diff Validation

Only lines in the PR diff can receive inline comments:

```bash
# Get list of changed files
gh pr diff $PR_NUMBER --name-only

# Check if file is in the PR
gh pr diff $PR_NUMBER --name-only | grep -q "^$FILE_PATH$"

# Check if specific line is in the diff (added or modified)
gh pr diff $PR_NUMBER -- "$FILE_PATH" | grep -E "^\+.*"
```

### Comment Format Template

```markdown
**[SEVERITY] {Review Type}: {Issue Title}**

{Brief description}

**Suggested fix:**
```{language}
{code fix}
```

---
<sub>Severity: {CRITICAL|HIGH|MEDIUM} | [Claude Code](https://claude.com/code) `/review`</sub>
```

### Comment Deduplication Rules

Before creating comments, deduplicate similar issues:

1. **Same file + same line + same issue type** = keep only one
2. **Same file + adjacent lines (within 3 lines) + same issue** = consolidate
3. **Same issue pattern across files** = group in summary, not per-line
4. **Identical descriptions from different reviews** = merge

```markdown
BEFORE:
- Reviewer (security): src/api.ts:45 - Missing validation
- Reviewer (architecture): src/api.ts:45 - Input not validated

AFTER (merged):
- src/api.ts:45 - Missing input validation (security, architecture)
```

---

## Issue Operations

### Fetching Issues

```bash
# By number (full details)
gh issue view "$ISSUE_NUMBER" --json number,title,body,state,labels,assignees,milestone,author,createdAt,comments

# By search
gh issue list --search "$SEARCH_TERM" --state open --limit 5 --json number,title,state

# With specific labels
gh issue list --label "bug" --state open --limit 10

# Assigned to user
gh issue list --assignee "@me" --state open
```

### Creating Issues

```bash
# Basic issue
gh issue create --title "Issue title" --body "Issue description"

# With labels and assignees
gh issue create \
    --title "Bug: Login fails" \
    --label "bug,priority-high" \
    --assignee "username" \
    --body "Description here"

# From template
gh issue create --template "bug_report.md"
```

### Updating Issues

```bash
# Add comment
gh issue comment $ISSUE_NUMBER --body "Comment text"

# Edit issue
gh issue edit $ISSUE_NUMBER --title "New title" --body "New body"

# Add labels
gh issue edit $ISSUE_NUMBER --add-label "in-progress"

# Close with comment
gh issue close $ISSUE_NUMBER --comment "Closing: reason"
```

### Branch Name from Issue

```bash
# Type from labels (feature, fix, docs, refactor, chore)
BRANCH_TYPE="feature"  # default
for label in "${LABELS[@]}"; do
    case "$label" in
        bug|fix) BRANCH_TYPE="fix" ;;
        documentation|docs) BRANCH_TYPE="docs" ;;
        refactor) BRANCH_TYPE="refactor" ;;
        chore|maintenance) BRANCH_TYPE="chore" ;;
    esac
done

# Slug from title
SLUG=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-40)

# Branch name
BRANCH_NAME="${BRANCH_TYPE}/${ISSUE_NUMBER}-${SLUG}"
```

---

## Release Operations

### Version Validation

```bash
# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ERROR: Invalid version format. Use semver (e.g., 1.2.3)"
    exit 1
fi
```

### Tag Creation

```bash
# Create annotated tag
git tag -a "v${VERSION}" -m "Version ${VERSION}

${CHANGELOG_ENTRY}"

# Push tag
git push origin "v${VERSION}"
```

### GitHub Release Creation

```bash
# Basic release
gh release create "v${VERSION}" \
    --title "v${VERSION} - ${RELEASE_TITLE}" \
    --notes "${RELEASE_NOTES}"

# With assets
gh release create "v${VERSION}" \
    --title "v${VERSION}" \
    --notes-file CHANGELOG.md \
    ./dist/*.tar.gz ./dist/*.zip

# Draft release
gh release create "v${VERSION}" \
    --draft \
    --title "v${VERSION}" \
    --generate-notes

# Pre-release
gh release create "v${VERSION}-beta.1" \
    --prerelease \
    --title "v${VERSION} Beta 1"
```

### Release Notes from Commits

```bash
# Auto-generate notes
gh release create "v${VERSION}" --generate-notes

# Get commits since last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
    git log ${LAST_TAG}..HEAD --pretty=format:"- %s" --no-merges
fi
```

---

## PR Operations

### Creating PRs

```bash
# Basic PR
gh pr create --title "PR title" --body "Description"

# With base branch
gh pr create --base main --title "Feature" --body "Description"

# Draft PR
gh pr create --draft --title "WIP: Feature"

# With reviewers
gh pr create --reviewer "user1,user2" --title "Feature"

# Using HEREDOC for body
gh pr create --title "Feature" --body "$(cat <<'EOF'
## Summary
- Change 1
- Change 2

## Test plan
- [ ] Test item 1
EOF
)"
```

### PR Queries

```bash
# View PR details
gh pr view $PR_NUMBER --json title,body,state,author,reviews,commits

# List open PRs
gh pr list --state open --limit 10

# PRs ready for review
gh pr list --state open --json number,title,reviewDecision --jq '.[] | select(.reviewDecision == "REVIEW_REQUIRED")'

# My PRs
gh pr list --author "@me"
```

### PR Reviews

```bash
# Approve
gh pr review $PR_NUMBER --approve --body "LGTM"

# Request changes
gh pr review $PR_NUMBER --request-changes --body "Please fix X"

# Comment only
gh pr review $PR_NUMBER --comment --body "Some feedback"
```

---

## Rate Limit Management

### Check Rate Limit

```bash
# Check remaining calls
REMAINING=$(gh api rate_limit --jq '.resources.core.remaining')
RESET_TIME=$(gh api rate_limit --jq '.resources.core.reset')

echo "Remaining: $REMAINING"
echo "Resets at: $(date -r $RESET_TIME)"
```

### Throttling Pattern

```bash
make_api_call() {
    local response

    # Check rate limit first
    REMAINING=$(gh api rate_limit --jq '.resources.core.remaining' 2>/dev/null || echo "100")

    if [ "$REMAINING" -lt 10 ]; then
        echo "Rate limit low ($REMAINING remaining), waiting 60s..."
        sleep 60
    fi

    # Make the call
    response=$(gh api "$@" 2>&1) || {
        echo "API call failed: $response"
        return 1
    }

    # Standard delay between calls
    sleep 1

    echo "$response"
}
```

---

## API Direct Access

### GET Requests

```bash
# Get repo info
gh api repos/{owner}/{repo}

# Get specific fields
gh api repos/{owner}/{repo} --jq '.name, .description'

# With pagination
gh api repos/{owner}/{repo}/issues --paginate
```

### POST Requests

```bash
# Create issue via API
gh api repos/{owner}/{repo}/issues \
    -X POST \
    -f title="Issue title" \
    -f body="Issue body"

# With JSON body
gh api repos/{owner}/{repo}/issues \
    -X POST \
    --input - <<< '{"title": "Issue", "body": "Description"}'
```

### GraphQL

```bash
# Query with GraphQL
gh api graphql -f query='
  query {
    repository(owner: "owner", name: "repo") {
      issues(first: 10, states: OPEN) {
        nodes {
          number
          title
        }
      }
    }
  }
'
```
