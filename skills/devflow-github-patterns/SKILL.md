---
name: devflow-github-patterns
description: GitHub API patterns for PR comments, issue management, and release workflows. Load when performing git/GitHub operations via gh CLI.
allowed-tools: Bash, Read, Grep, Glob
---

# GitHub Patterns Skill

Foundation skill for GitHub API interactions. Provides patterns for rate limiting, deduplication, issue parsing, and release workflows.

## Iron Law

> **RESPECT RATE LIMITS OR FAIL GRACEFULLY**
>
> GitHub API rate limits are not suggestions. When remaining < 10, wait 60 seconds. Between each API call, wait 1-2 seconds. Batch operations where possible. Never spam the API.

---

## Rate Limiting Patterns

### Standard API Throttling

```bash
# Between each API call
sleep 1

# For batch operations (>20 calls), increase delay
sleep 2

# Check remaining rate limit
REMAINING=$(gh api rate_limit --jq '.resources.core.remaining')

# If low, wait before continuing
if [ "$REMAINING" -lt 10 ]; then
    echo "⚠️ Rate limit low ($REMAINING remaining), waiting 60s..."
    sleep 60
fi
```

### Error Handling

```bash
# Wrap API calls with error handling
make_api_call() {
    local response
    response=$(gh api "$@" 2>&1) || {
        echo "⚠️ API call failed: $response"
        return 1
    }
    echo "$response"
}
```

---

## PR Comment Patterns

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

### Comment Deduplication

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

### Comment Format

```markdown
**🔴 {Review Type}: {Issue Title}**

{Brief description}

**Suggested fix:**
```{language}
{code fix}
```

---
<sub>Severity: {CRITICAL|HIGH|MEDIUM} | 🤖 [Claude Code](https://claude.com/code) `/review`</sub>
```

---

## Issue Management Patterns

### Fetching Issues

```bash
# By number
gh issue view "$ISSUE_NUMBER" --json number,title,body,state,labels,assignees,milestone,author,createdAt,comments

# By search
gh issue list --search "$SEARCH_TERM" --state open --limit 5 --json number,title,state
```

### Parsing Issue Data

Extract from issue body:
- **Acceptance Criteria**: Look for sections like "## Acceptance Criteria", "## Done when", "- [ ]" checkboxes
- **Dependencies**: Look for "depends on #X", "blocked by #X"
- **Blocks**: Look for "blocks #X"

### Branch Name Generation

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

## Tech Debt Management Patterns

### Issue Size Limits

GitHub issue body limit is ~65,536 characters. Archive when approaching limit:

```bash
MAX_SIZE=60000
BODY_LENGTH=${#CURRENT_BODY}

if [ $BODY_LENGTH -gt $MAX_SIZE ]; then
    echo "📦 Tech debt issue approaching size limit, archiving..."
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

### Semantic Deduplication

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

### Item Format

```markdown
- [ ] **[{review-type}]** `{file}:{line}` - {brief description}
  → [Review: {date}]({relative-path-to-review-doc})
```

### Cleanup Verification

For each unchecked item, verify if still present:

| Audit Type | Verification Pattern |
|------------|---------------------|
| security | Look for vulnerable pattern (SQL concat, hardcoded secrets) |
| performance | Check for N+1 patterns, nested loops |
| architecture | Check coupling/dependency issues |
| tests | Check if test coverage added |

Context-aware checking (lines may shift):
```bash
# Read surrounding lines (±10 from reported location)
CONTEXT=$(sed -n "$((LINE-10)),$((LINE+10))p" "$FILE" 2>/dev/null)

if echo "$CONTEXT" | grep -qE "$PATTERN"; then
    echo "STILL PRESENT"
else
    echo "POSSIBLY FIXED"
fi
```

---

## Release Workflow Patterns

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

### GitHub Release

```bash
gh release create "v${VERSION}" \
    --title "v${VERSION} - ${RELEASE_TITLE}" \
    --notes "${RELEASE_NOTES}"
```

---

## Key Principles

1. **Rate limit awareness** - Always check remaining calls, throttle appropriately
2. **Fail gracefully** - Handle API errors, don't crash on failures
3. **Deduplicate first** - Never spam duplicate comments or issues
4. **One summary** - Consolidate multiple issues into single comments
5. **Actionable** - Every comment includes a suggested fix
6. **Clear attribution** - Always include Claude Code footer
7. **Conservative cleanup** - Only remove items when confident they're fixed

## Related Skills

| Skill | Use For |
|-------|---------|
| `devflow-git-safety` | Lock handling, sequential ops, sensitive file detection |
| `devflow-github-patterns` | GitHub API, rate limits, PR comments, releases |
| `devflow-commit` | Commit message format, atomic grouping |
| `devflow-pull-request` | PR descriptions, size assessment, breaking changes |
| `devflow-worktree` | Parallel development, task isolation |
