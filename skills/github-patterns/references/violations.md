# GitHub Patterns Violation Examples

Extended violation patterns for GitHub API and CLI operations. Reference from main SKILL.md.

---

## API Usage Violations

### Rate Limit Violations

**Ignoring Rate Limits**
```bash
# VIOLATION: No rate limit check before batch operations
for issue in $(seq 1 100); do
    gh api repos/{owner}/{repo}/issues/${issue}
done
```

**No Backoff on Rate Limit Error**
```bash
# VIOLATION: Fails immediately without retry
response=$(gh api repos/{owner}/{repo}/issues 2>&1)
if [ $? -ne 0 ]; then
    echo "Failed"
    exit 1
fi
```

### Error Handling Violations

**Missing Error Handling**
```bash
# VIOLATION: Assumes success, ignores errors
PR_NUMBER=$(gh pr create --title "..." --body "..." --json number -q '.number')
gh pr merge $PR_NUMBER
```

**Silent Failure**
```bash
# VIOLATION: Swallows errors without reporting
gh issue create --title "..." 2>/dev/null || true
```

**No Response Validation**
```bash
# VIOLATION: Trusts API response without validation
BODY=$(gh issue view $ISSUE --json body -q '.body')
# Directly uses BODY without checking if empty or malformed
```

### Security Violations

**Hardcoded Tokens**
```bash
# VIOLATION: Token in script
gh api -H "Authorization: token ghp_xxxxxxxxxxxx" repos/{owner}/{repo}
```

**Token in Command History**
```bash
# VIOLATION: Exposes token in shell history
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

### Pagination Violations

**Missing Pagination**
```bash
# VIOLATION: Only gets first page (30 items by default)
gh api repos/{owner}/{repo}/issues --jq '.[].number'
```

**Incorrect Pagination Handling**
```bash
# VIOLATION: Manual page limit that may miss data
for page in 1 2 3; do
    gh api "repos/{owner}/{repo}/issues?page=$page"
done
# What if there are 4+ pages?
```

### Query Violations

**Inefficient Multiple Queries**
```bash
# VIOLATION: Separate queries for data available in one
gh pr view $PR --json title
gh pr view $PR --json body
gh pr view $PR --json state
# Should use: gh pr view $PR --json title,body,state
```

**Missing Field Selection**
```bash
# VIOLATION: Fetches all fields when only one needed
gh issue list --json number,title,body,state,labels,assignees,milestone
# When you only need numbers
```

---

## CLI Command Violations

### PR Comment Violations

**Invalid Line Comment Target**
```bash
# VIOLATION: Commenting on line not in diff
gh api -X POST "repos/${OWNER}/${REPO}/pulls/${PR}/comments" \
    -f body="Comment" \
    -f path="unchanged_file.ts" \
    -F line=50  # Line not in PR diff
```

**Missing Commit SHA**
```bash
# VIOLATION: Comment without commit reference
gh api -X POST "repos/${OWNER}/${REPO}/pulls/${PR}/comments" \
    -f body="Comment" \
    -f path="file.ts" \
    -F line=10
    # Missing: -f commit_id="$HEAD_SHA"
```

**No Rate Limiting Between Comments**
```bash
# VIOLATION: Rapid-fire comments may hit rate limit
for file in "${FILES[@]}"; do
    gh api -X POST "repos/${OWNER}/${REPO}/pulls/${PR}/comments" \
        -f body="Issue found" \
        -f path="$file"
    # Missing: sleep between calls
done
```

### Issue Operations Violations

**Duplicate Issue Creation**
```bash
# VIOLATION: Creates duplicate without checking existing
gh issue create --title "Bug: Login fails" --body "..."
# Should check for existing similar issues first
```

**Tech Debt Issue Size Ignored**
```bash
# VIOLATION: Appending to issue without size check
gh issue comment $TECH_DEBT_ISSUE --body "$NEW_ITEMS"
# Issue may exceed 65,536 character limit
```

**Missing Issue Link Back**
```bash
# VIOLATION: Creates related issues without linking
NEW_ISSUE=$(gh issue create --title "Subtask" --json number -q '.number')
# Should add reference to parent issue
```

### Release Violations

**Invalid Version Format**
```bash
# VIOLATION: Non-semver version
gh release create "version-1.2" --title "Release"
# Should be: v1.2.0
```

**Missing Tag Before Release**
```bash
# VIOLATION: Creates release without tag
gh release create "v1.0.0" --title "Release"
# Tag should be created and pushed first for proper git history
```

**No Changelog Reference**
```bash
# VIOLATION: Release without documented changes
gh release create "v1.0.0" --generate-notes
# Should have curated release notes or changelog reference
```

### Branch Name Violations

**Invalid Characters in Branch**
```bash
# VIOLATION: Spaces and special characters
BRANCH="feature/new feature with spaces!"
git checkout -b "$BRANCH"
```

**Missing Issue Reference**
```bash
# VIOLATION: Branch without issue number for tracking
BRANCH="feature/add-login"
# Should be: feature/123-add-login (with issue reference)
```

### PR Creation Violations

**Missing Base Branch**
```bash
# VIOLATION: PR to wrong base branch
gh pr create --title "Feature" --body "..."
# May default to wrong branch in forks
```

**No Draft for WIP**
```bash
# VIOLATION: Non-draft PR for incomplete work
gh pr create --title "WIP: Feature" --body "Not ready yet"
# Should use: --draft
```

**Missing Test Plan**
```bash
# VIOLATION: PR without test instructions
gh pr create --title "Feature" --body "Added feature X"
# Should include: ## Test plan section
```

---

## Workflow Integration Violations

### Webhook Handling Violations

**No Signature Verification**
```bash
# VIOLATION: Trusts webhook payload without verification
process_webhook() {
    local payload="$1"
    # Directly processes without checking X-Hub-Signature-256
}
```

**Blocking Webhook Handler**
```bash
# VIOLATION: Long-running operation in webhook handler
handle_push_event() {
    run_full_test_suite  # May timeout
    deploy_to_production  # Takes too long
}
# Should acknowledge immediately, process async
```

### Actions Integration Violations

**Workflow Dispatch Without Validation**
```bash
# VIOLATION: Triggers workflow with unvalidated inputs
gh workflow run "deploy.yml" -f environment="$USER_INPUT"
# USER_INPUT could be malicious or invalid
```

**No Run Status Check**
```bash
# VIOLATION: Triggers workflow without waiting for result
gh workflow run "build.yml"
echo "Triggered"
# Should check run status for critical workflows
```

---

## GraphQL Violations

**Over-fetching Data**
```bash
# VIOLATION: Requesting all fields when few needed
gh api graphql -f query='
  query {
    repository(owner: "owner", name: "repo") {
      pullRequest(number: 1) {
        title body state author { login }
        reviews(first: 100) { nodes { ... } }
        comments(first: 100) { nodes { ... } }
        commits(first: 250) { nodes { ... } }
      }
    }
  }
'
# If only title and state needed, this wastes resources
```

**Missing Pagination in GraphQL**
```bash
# VIOLATION: No cursor for paginated data
gh api graphql -f query='
  query {
    repository(owner: "owner", name: "repo") {
      issues(first: 100) {
        nodes { number title }
        # Missing: pageInfo { hasNextPage endCursor }
      }
    }
  }
'
```
