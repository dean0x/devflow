# GitHub Patterns Correct Examples

Extended correct patterns for GitHub API and CLI operations. Reference from main SKILL.md.

---

## API Usage Patterns

### Rate Limit Handling

**Check Before Batch Operations**
```bash
# CORRECT: Check rate limit before operations
check_rate_limit() {
    local remaining
    remaining=$(gh api rate_limit --jq '.resources.core.remaining' 2>/dev/null || echo "100")

    if [ "$remaining" -lt 10 ]; then
        local reset_time
        reset_time=$(gh api rate_limit --jq '.resources.core.reset')
        echo "Rate limit low ($remaining remaining), waiting..."
        sleep 60
    fi
}

# Use before batch operations
check_rate_limit
for issue in $(seq 1 100); do
    gh api repos/{owner}/{repo}/issues/${issue}
    sleep 1  # Throttle between calls
done
```

**Retry with Exponential Backoff**
```bash
# CORRECT: Retry with backoff on failure
retry_api_call() {
    local max_attempts=3
    local attempt=1
    local delay=2

    while [ $attempt -le $max_attempts ]; do
        if result=$(gh api "$@" 2>&1); then
            echo "$result"
            return 0
        fi

        echo "Attempt $attempt failed, retrying in ${delay}s..." >&2
        sleep $delay
        attempt=$((attempt + 1))
        delay=$((delay * 2))
    done

    echo "All $max_attempts attempts failed" >&2
    return 1
}
```

### Error Handling

**Wrapped API Calls**
```bash
# CORRECT: Always handle errors
make_api_call() {
    local response
    response=$(gh api "$@" 2>&1) || {
        echo "API call failed: $response" >&2
        return 1
    }
    echo "$response"
}
```

**Validate Responses**
```bash
# CORRECT: Check response before using
BODY=$(gh issue view $ISSUE --json body -q '.body' 2>/dev/null)
if [ -z "$BODY" ]; then
    echo "Issue body empty or not found"
    exit 1
fi
```

**Check Command Results**
```bash
# CORRECT: Verify each operation
if ! gh pr create --title "..." --body "..." --json number -q '.number' > pr_number.txt; then
    echo "PR creation failed"
    exit 1
fi

PR_NUMBER=$(cat pr_number.txt)
if [ -z "$PR_NUMBER" ]; then
    echo "Failed to get PR number"
    exit 1
fi
```

### Pagination

**Use --paginate Flag**
```bash
# CORRECT: Get all pages automatically
gh api repos/{owner}/{repo}/issues --paginate --jq '.[].number'
```

**GraphQL Pagination with Cursor**
```bash
# CORRECT: Paginate through all results
fetch_all_issues() {
    local cursor=""
    local has_next="true"

    while [ "$has_next" = "true" ]; do
        local query
        if [ -z "$cursor" ]; then
            query='query { repository(owner: "owner", name: "repo") { issues(first: 100) { nodes { number title } pageInfo { hasNextPage endCursor } } } }'
        else
            query="query { repository(owner: \"owner\", name: \"repo\") { issues(first: 100, after: \"$cursor\") { nodes { number title } pageInfo { hasNextPage endCursor } } } }"
        fi

        result=$(gh api graphql -f query="$query")
        echo "$result" | jq -r '.data.repository.issues.nodes[] | [.number, .title] | @tsv'

        has_next=$(echo "$result" | jq -r '.data.repository.issues.pageInfo.hasNextPage')
        cursor=$(echo "$result" | jq -r '.data.repository.issues.pageInfo.endCursor')
    done
}
```

### Efficient Queries

**Batch Field Selection**
```bash
# CORRECT: Get all needed fields in one query
gh pr view $PR --json title,body,state,author,reviews,commits
```

**GraphQL for Complex Queries**
```bash
# CORRECT: Single query for related data
gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        title
        body
        state
        reviews(first: 10) {
          nodes {
            state
            author { login }
            body
          }
        }
        comments(first: 20) {
          nodes {
            author { login }
            body
          }
        }
      }
    }
  }
' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR_NUMBER"
```

---

## CLI Command Patterns

### PR Comments

**Inline Comment with Commit SHA**
```bash
# CORRECT: Full comment with all required fields
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

sleep 1  # Rate limiting between comments
```

**Validate Line is in Diff**
```bash
# CORRECT: Check file and line are in PR before commenting
is_line_in_diff() {
    local file="$1"
    local line="$2"

    # Check file is in PR
    if ! gh pr diff $PR_NUMBER --name-only | grep -q "^${file}$"; then
        return 1
    fi

    # Check line is added/modified (has + prefix in diff)
    gh pr diff $PR_NUMBER -- "$file" | grep -n "^+" | cut -d: -f1 | grep -q "^${line}$"
}

if is_line_in_diff "$FILE" "$LINE"; then
    # Safe to create inline comment
    create_inline_comment "$FILE" "$LINE" "$COMMENT"
fi
```

**Comment Format Template**
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

### Issue Operations

**Fetch Issue with All Details**
```bash
# CORRECT: Get all relevant fields
gh issue view "$ISSUE_NUMBER" \
    --json number,title,body,state,labels,assignees,milestone,author,createdAt,comments
```

**Create Issue with Labels and Assignees**
```bash
# CORRECT: Full issue creation
gh issue create \
    --title "Bug: Login fails for SSO users" \
    --label "bug,priority-high" \
    --assignee "username" \
    --body "$(cat <<'EOF'
## Description
Login fails when using SSO authentication.

## Steps to Reproduce
1. Click "Login with SSO"
2. Enter credentials
3. Observe error

## Expected Behavior
User should be logged in successfully.

## Actual Behavior
Error message: "Authentication failed"
EOF
)"
```

**Tech Debt Issue Management**
```bash
# CORRECT: Check size before appending, archive if needed
MAX_SIZE=60000

add_tech_debt_item() {
    local new_item="$1"

    # Get current body
    local current_body
    current_body=$(gh issue view $TECH_DEBT_ISSUE --json body -q '.body')
    local body_length=${#current_body}

    # Check if approaching limit
    if [ $body_length -gt $MAX_SIZE ]; then
        echo "Tech debt issue approaching size limit, archiving..."
        archive_tech_debt_issue
    fi

    # Append new item
    gh issue comment $TECH_DEBT_ISSUE --body "$new_item"
}

archive_tech_debt_issue() {
    local old_issue=$TECH_DEBT_ISSUE

    # Close current issue
    gh issue close $old_issue --comment "## Archived
This issue reached the size limit.
**Continued in:** (see linked issue)"

    # Create new issue with reference
    TECH_DEBT_ISSUE=$(gh issue create \
        --title "Tech Debt Backlog" \
        --label "tech-debt" \
        --body "Continued from #${old_issue}

## Items
" \
        --json number -q '.number')

    # Link back
    gh issue comment $old_issue --body "**Continued in:** #${TECH_DEBT_ISSUE}"
}
```

**Extract Issue Data**
```bash
# CORRECT: Parse structured sections from issue body
BODY=$(gh issue view $ISSUE --json body -q '.body')

# Extract acceptance criteria
CRITERIA=$(echo "$BODY" | sed -n '/## Acceptance Criteria/,/^##/p' | grep -E '^\s*-\s*\[' || true)

# Extract dependencies
DEPENDS_ON=$(echo "$BODY" | grep -oE '(depends on|blocked by) #[0-9]+' | grep -oE '#[0-9]+' || true)

# Extract blocks
BLOCKS=$(echo "$BODY" | grep -oE 'blocks #[0-9]+' | grep -oE '#[0-9]+' || true)
```

### Release Operations

**Version Validation**
```bash
# CORRECT: Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ERROR: Invalid version format. Use semver (e.g., 1.2.3)"
    exit 1
fi
```

**Complete Release Flow**
```bash
# CORRECT: Tag first, then create release
create_release() {
    local version="$1"
    local changelog="$2"

    # Validate version
    if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Invalid version format"
        return 1
    fi

    # Create and push tag
    git tag -a "v${version}" -m "Version ${version}

${changelog}"
    git push origin "v${version}"

    # Create GitHub release
    gh release create "v${version}" \
        --title "v${version}" \
        --notes "$changelog"
}
```

**Release with Assets**
```bash
# CORRECT: Release with build artifacts
gh release create "v${VERSION}" \
    --title "v${VERSION} - ${RELEASE_TITLE}" \
    --notes-file CHANGELOG.md \
    ./dist/*.tar.gz ./dist/*.zip
```

**Release Notes from Commits**
```bash
# CORRECT: Generate notes from git history
generate_release_notes() {
    local last_tag
    last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

    echo "## Changes"
    echo ""

    if [ -n "$last_tag" ]; then
        git log ${last_tag}..HEAD --pretty=format:"- %s" --no-merges
    else
        git log --pretty=format:"- %s" --no-merges -20
    fi
}
```

### Branch Name from Issue

```bash
# CORRECT: Generate clean branch name from issue
generate_branch_name() {
    local issue_number="$1"
    local title="$2"
    local labels="$3"

    # Determine type from labels
    local branch_type="feature"
    case "$labels" in
        *bug*|*fix*) branch_type="fix" ;;
        *documentation*|*docs*) branch_type="docs" ;;
        *refactor*) branch_type="refactor" ;;
        *chore*|*maintenance*) branch_type="chore" ;;
    esac

    # Clean title for slug
    local slug
    slug=$(echo "$title" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-40)

    echo "${branch_type}/${issue_number}-${slug}"
}
```

### PR Operations

**PR with HEREDOC Body**
```bash
# CORRECT: Clean formatting with HEREDOC
gh pr create --title "Add user authentication" --body "$(cat <<'EOF'
## Summary
- Implement JWT-based authentication
- Add login/logout endpoints
- Add middleware for protected routes

## Test plan
- [ ] Test login with valid credentials
- [ ] Test login with invalid credentials
- [ ] Test protected route access
- [ ] Test token expiration
EOF
)"
```

**Draft PR for WIP**
```bash
# CORRECT: Use draft for work in progress
gh pr create --draft --title "WIP: Feature X" --body "Work in progress, not ready for review"
```

**PR Review**
```bash
# CORRECT: Review with body
gh pr review $PR_NUMBER --approve --body "LGTM! Tested locally and all checks pass."

gh pr review $PR_NUMBER --request-changes --body "$(cat <<'EOF'
## Requested Changes

1. **Security**: Input validation missing in `handleLogin`
2. **Performance**: N+1 query in user list endpoint

Please address these before merging.
EOF
)"
```

---

## Workflow Integration Patterns

### Triggering Workflows

```bash
# CORRECT: Trigger with validated inputs
gh workflow run "deploy.yml" \
    --ref main \
    -f environment="production" \
    -f version="${VERSION}"

# Wait for completion
sleep 5
RUN_ID=$(gh run list --workflow "deploy.yml" --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch $RUN_ID
```

### Check Run Status

```bash
# CORRECT: Wait for checks to complete
wait_for_checks() {
    local sha="$1"
    local max_wait=300
    local waited=0

    while [ $waited -lt $max_wait ]; do
        local status
        status=$(gh api repos/{owner}/{repo}/commits/${sha}/check-runs \
            --jq '.check_runs | map(select(.status != "completed")) | length')

        if [ "$status" = "0" ]; then
            echo "All checks completed"
            return 0
        fi

        echo "Waiting for checks... ($status pending)"
        sleep 10
        waited=$((waited + 10))
    done

    echo "Timeout waiting for checks"
    return 1
}
```

---

## GraphQL Patterns

### Efficient Queries

```bash
# CORRECT: Request only needed fields
gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        title
        state
        mergeable
      }
    }
  }
' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR_NUMBER"
```

### Mutations

```bash
# CORRECT: Add reaction to issue
gh api graphql -f query='
  mutation($subjectId: ID!, $content: ReactionContent!) {
    addReaction(input: {subjectId: $subjectId, content: $content}) {
      reaction {
        content
      }
    }
  }
' -f subjectId="$ISSUE_NODE_ID" -f content="THUMBS_UP"
```

---

## Rate Limit Aware Batch Processing

```bash
# CORRECT: Batch with rate limit awareness
batch_api_calls() {
    local calls=("$@")
    local results=()

    for call in "${calls[@]}"; do
        # Check rate limit
        REMAINING=$(gh api rate_limit --jq '.resources.core.remaining' 2>/dev/null || echo "100")

        if [ "$REMAINING" -lt 10 ]; then
            echo "Rate limit low, waiting 60s..." >&2
            sleep 60
        fi

        # Execute call
        result=$(eval "$call" 2>&1) || {
            echo "Failed: $call" >&2
            continue
        }

        results+=("$result")
        sleep 1  # Throttle between calls
    done

    printf '%s\n' "${results[@]}"
}
```
