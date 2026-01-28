# GitHub API Patterns Reference

Extended patterns for GitHub API operations including tech debt management and issue lifecycle.

---

## Tech Debt Management

### Issue Size Limits

GitHub issue body limit is ~65,536 characters. Monitor and archive when approaching:

```bash
MAX_SIZE=60000
BODY_LENGTH=${#CURRENT_BODY}

if [ $BODY_LENGTH -gt $MAX_SIZE ]; then
    echo "Tech debt issue approaching size limit, archiving..."
    # Close current, create new, link them
fi
```

### Archive Workflow

```bash
OLD_ISSUE_NUMBER=$TECH_DEBT_ISSUE

# Close current issue with archive note
gh issue close $TECH_DEBT_ISSUE --comment "## Archived
This issue reached the size limit.
**Continued in:** (new issue linked below)"

# Create new issue with reference
TECH_DEBT_ISSUE=$(gh issue create \
    --title "Tech Debt Backlog" \
    --label "tech-debt" \
    --body "... Previous Archives: #${OLD_ISSUE_NUMBER} ..." \
    --json number -q '.number')

# Link back
gh issue comment $OLD_ISSUE_NUMBER --body "**Continued in:** #${TECH_DEBT_ISSUE}"
```

### Tech Debt Item Format

```markdown
- [ ] **[{review-type}]** `{file}:{line}` - {brief description}
  -> [Review: {date}]({relative-path-to-review-doc})
```

### Semantic Deduplication Algorithm

```
For each new_item:
    is_duplicate = false

    For each existing_item in current_issue:
        # Fast path: file + review type match
        if new_item.file == existing_item.file AND
           new_item.audit_type == existing_item.audit_type:

            # Check description similarity
            if descriptions_similar(new_item.desc, existing_item.desc):
                is_duplicate = true
                break

    if not is_duplicate:
        items_to_add.append(new_item)
```

---

## Cleanup Verification

For each unchecked tech debt item, verify if issue still present:

| Audit Type | Verification Pattern |
|------------|---------------------|
| security | Look for vulnerable pattern (SQL concat, hardcoded secrets) |
| performance | Check for N+1 patterns, nested loops |
| architecture | Check coupling/dependency issues |
| tests | Check if test coverage added |

### Context-Aware Checking

Lines may shift due to edits. Search surrounding context:

```bash
# Read surrounding lines (+/-10 from reported location)
CONTEXT=$(sed -n "$((LINE-10)),$((LINE+10))p" "$FILE" 2>/dev/null)

if echo "$CONTEXT" | grep -qE "$PATTERN"; then
    echo "STILL PRESENT"
else
    echo "POSSIBLY FIXED"
fi
```

---

## Issue Parsing Patterns

### Extracting Issue Data

Parse structured sections from issue body:

**Acceptance Criteria**:
- Look for `## Acceptance Criteria`, `## Done when`
- Parse `- [ ]` checkbox lists
- Extract numbered lists under these headers

**Dependencies**:
- Pattern: `depends on #X`, `blocked by #X`
- Extract issue numbers for dependency graph

**Blocks**:
- Pattern: `blocks #X`, `blocking #X`
- Track downstream dependencies

### Example Parser

```bash
# Extract acceptance criteria
CRITERIA=$(echo "$BODY" | sed -n '/## Acceptance Criteria/,/^##/p' | grep -E '^\s*-\s*\[' || true)

# Extract dependencies
DEPENDS_ON=$(echo "$BODY" | grep -oE '(depends on|blocked by) #[0-9]+' | grep -oE '#[0-9]+' || true)

# Extract blocks
BLOCKS=$(echo "$BODY" | grep -oE 'blocks #[0-9]+' | grep -oE '#[0-9]+' || true)
```

---

## Error Handling Patterns

### Wrapped API Calls

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

### Retry with Backoff

```bash
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

### Rate Limit Aware Batch

```bash
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

---

## Webhook Patterns

### Common Webhook Events

| Event | Trigger | Use Case |
|-------|---------|----------|
| `push` | Code pushed | CI/CD trigger |
| `pull_request` | PR opened/updated | Code review |
| `issues` | Issue created/edited | Triage automation |
| `release` | Release published | Deploy trigger |
| `check_run` | CI status change | Status reporting |

### Webhook Payload Fields

```json
{
  "action": "opened|closed|edited|...",
  "repository": { "full_name": "owner/repo" },
  "sender": { "login": "username" },
  "pull_request": { ... },
  "issue": { ... }
}
```

---

## GraphQL Patterns

### Efficient Queries

```bash
# Get PR with reviews and comments in one query
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

### Mutations

```bash
# Add reaction to issue
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

## Actions Integration

### Triggering Workflows

```bash
# Trigger workflow dispatch
gh workflow run "workflow.yml" \
    --ref main \
    -f input1="value1" \
    -f input2="value2"

# List workflow runs
gh run list --workflow "workflow.yml" --limit 5

# View run details
gh run view $RUN_ID
```

### Check Runs

```bash
# List check runs for a commit
gh api repos/{owner}/{repo}/commits/{sha}/check-runs

# Get check run status
gh api repos/{owner}/{repo}/check-runs/{check_run_id} --jq '.status, .conclusion'
```
