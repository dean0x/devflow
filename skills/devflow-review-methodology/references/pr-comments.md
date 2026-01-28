# PR Comment Integration

Details for creating line-specific PR comments via GitHub API.

## Comment Creation Function

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

## Comment Rules

1. **Only comment on blocking issues** - Category 1 (Issues in Your Changes)
2. **Verify file is in PR diff** - Skip files not part of the PR
3. **Rate limit API calls** - 1 second delay between comments
4. **Track statistics** - Count created vs skipped comments

## API Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `body` | Comment text | Markdown-formatted comment |
| `commit_id` | HEAD SHA | The commit to attach comment to |
| `path` | File path | Relative path to file |
| `line` | Line number | Line number in the diff |
| `side` | "RIGHT" | Comment on new file version |

## Comment Summary Section

Add to report footer:

```markdown
---

## PR Comment Summary

- **Comments Created**: ${COMMENTS_CREATED}
- **Comments Skipped**: ${COMMENTS_SKIPPED} (lines not in PR diff)
```
