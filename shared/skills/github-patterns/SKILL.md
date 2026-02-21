---
name: github-patterns
description: This skill should be used when the user asks to "comment on a PR", "create a release", "manage issues", "use gh CLI", "check PR status", or performs GitHub API operations. Provides patterns for PR comments, issue management, release workflows, rate limiting, and gh CLI usage for safe GitHub automation.
user-invocable: false
allowed-tools: Bash, Read, Grep, Glob
---

# GitHub Patterns

Foundation skill for GitHub API interactions. Provides patterns for rate limiting, PR comments, issue management, and releases.

## Iron Law

> **RESPECT RATE LIMITS OR FAIL GRACEFULLY**
>
> GitHub API rate limits are not suggestions. When remaining < 10, wait 60 seconds. Between each API call, wait 1-2 seconds. Batch operations where possible. Never spam the API.

---

## Rate Limiting

### Standard Throttling

```bash
# Between each API call
sleep 1

# For batch operations (>20 calls)
sleep 2

# Check remaining rate limit
REMAINING=$(gh api rate_limit --jq '.resources.core.remaining')

# If low, wait before continuing
if [ "$REMAINING" -lt 10 ]; then
    echo "Rate limit low ($REMAINING remaining), waiting 60s..."
    sleep 60
fi
```

### Error Handling

```bash
make_api_call() {
    local response
    response=$(gh api "$@" 2>&1) || {
        echo "API call failed: $response" >&2
        return 1
    }
    echo "$response"
}
```

---

## PR Comments

**Key constraints:**
- Only lines in the PR diff can receive inline comments
- Deduplicate before posting (same file + line + issue = keep one)
- Always include suggested fix
- Add Claude Code attribution footer

```bash
# Verify file is in PR diff
gh pr diff $PR_NUMBER --name-only | grep -q "^$FILE_PATH$"

# Create inline comment
gh api -X POST "repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/comments" \
  -f body="$COMMENT_BODY" \
  -f commit_id="$HEAD_SHA" \
  -f path="$FILE_PATH" \
  -F line=$LINE_NUMBER \
  -f side="RIGHT"

sleep 1  # Rate limiting
```

---

## Issue Management

### Fetching Issues

```bash
# Full details
gh issue view "$ISSUE_NUMBER" --json number,title,body,state,labels,assignees

# Search
gh issue list --search "$SEARCH_TERM" --state open --limit 5
```

### Branch Name from Issue

```bash
# Type from labels
BRANCH_TYPE="feature"  # default (or fix, docs, refactor, chore)

# Slug from title
SLUG=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-40)

# Result
BRANCH_NAME="${BRANCH_TYPE}/${ISSUE_NUMBER}-${SLUG}"
```

---

## Releases

### Create Release

```bash
# Validate semver
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1

# Create tag
git tag -a "v${VERSION}" -m "Version ${VERSION}"
git push origin "v${VERSION}"

# Create GitHub release
gh release create "v${VERSION}" \
    --title "v${VERSION} - ${RELEASE_TITLE}" \
    --notes "${RELEASE_NOTES}"
```

---

## Key Principles

1. **Rate limit awareness** - Check remaining calls, throttle appropriately
2. **Fail gracefully** - Handle API errors, don't crash on failures
3. **Deduplicate first** - Never spam duplicate comments or issues
4. **One summary** - Consolidate multiple issues into single comments
5. **Actionable** - Every comment includes a suggested fix
6. **Clear attribution** - Always include Claude Code footer

---

## Extended References

For extended patterns and examples, see:

- **[references/commands.md](references/commands.md)** - Extended gh CLI command examples
  - PR creation and queries
  - Issue operations (create, update, close)
  - Release workflows
  - GraphQL examples

- **[references/api.md](references/api.md)** - API patterns
  - Tech debt management (size limits, archiving, deduplication)
  - Issue parsing patterns
  - Error handling with retry/backoff
  - Webhook and Actions integration
