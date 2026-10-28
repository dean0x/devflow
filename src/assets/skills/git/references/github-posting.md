# GitHub Posting Recipes

A machine with compliance on installs this file. A machine with compliance off does not.

The temp files these recipes name, and the trap that removes them, are in `github-api.md` under "The D11 temp files, and their removal".

---

## PR Comments

### Comment Rules

- Only lines in the PR diff can receive inline comments
- Deduplicate before posting (same file + line = keep one)
- Always include a suggested fix; every comment carries the `<!-- devflow:* -->` marker, and the visible devflow footer (*Posted by [devflow](https://github.com/dean0x/devflow)*) is appended only on summary comments (see src/assets/agents/git.mds)

### Inline Comment with Commit SHA

```bash
OWNER=$(echo "$REPO_INFO" | cut -d'/' -f1)
REPO=$(echo "$REPO_INFO" | cut -d'/' -f2)
HEAD_SHA=$(gh pr view "$PR_NUMBER" --json headRefOid -q '.headRefOid')

printf '%s\n' "$COMMENT_BODY" > "$DEVFLOW_BODY_RAW" \
  && node "$HOME/.devflow/scripts/redact-secrets.cjs" \
    "$DEVFLOW_BODY_RAW" "$DEVFLOW_BODY" \
  && gh api \
    -X POST \
    "repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/comments" \
    -F body=@"$DEVFLOW_BODY" \
    -f commit_id="$HEAD_SHA" \
    -f path="$FILE_PATH" \
    -F line="$LINE_NUMBER" \
    -f side="RIGHT"

sleep 1  # Rate limiting between comments
```

### Validate Line is in Diff

```bash
is_line_in_diff() {
    local file="$1"
    local line="$2"

    if ! gh pr diff "$PR_NUMBER" --name-only | grep -q "^${file}$"; then
        return 1
    fi

    gh pr diff "$PR_NUMBER" -- "$file" | grep -n "^+" | cut -d: -f1 | grep -q "^${line}$"
}

if is_line_in_diff "$FILE" "$LINE"; then
    create_inline_comment "$FILE" "$LINE" "$COMMENT"
fi
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
<sub>Severity: {CRITICAL|HIGH|MEDIUM} | [Claude Code](https://claude.com/code) `/code-review`</sub>
```

---

## PR Operations

### PR Review

Both posts reuse the one temp-file pair, so each composes its OWN content as the first
link of its own chain — `$DEVFLOW_BODY` is the scrubber's output, not a shared mailbox.

```bash
printf '%s\n' "LGTM! Tested locally and all checks pass." > "$DEVFLOW_BODY_RAW" \
  && node "$HOME/.devflow/scripts/redact-secrets.cjs" \
    "$DEVFLOW_BODY_RAW" "$DEVFLOW_BODY" \
  && gh pr review "$PR_NUMBER" --approve --body-file "$DEVFLOW_BODY"

{ cat > "$DEVFLOW_BODY_RAW" <<'EOF'
## Requested Changes
1. **Security**: Input validation missing in `handleLogin`
2. **Performance**: N+1 query in user list endpoint
EOF
} && node "$HOME/.devflow/scripts/redact-secrets.cjs" \
    "$DEVFLOW_BODY_RAW" "$DEVFLOW_BODY" \
  && gh pr review "$PR_NUMBER" --request-changes --body-file "$DEVFLOW_BODY"
```

---

## Review Threads (GraphQL)

The fetch recipe is in `github-api.md`.

### Reply to a Review Thread

```bash
printf '%s\n' "$REPLY_BODY" > "$DEVFLOW_BODY_RAW" \
  && node "$HOME/.devflow/scripts/redact-secrets.cjs" \
    "$DEVFLOW_BODY_RAW" "$DEVFLOW_BODY" \
  && gh api graphql -f query='
  mutation($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {
      pullRequestReviewThreadId: $threadId
      body: $body
    }) {
      comment {
        id
        body
      }
    }
  }
' -f threadId="$THREAD_ID" -F body=@"$DEVFLOW_BODY"
```

### Resolve a Review Thread

The resolve condition is stated once, in the Git agent's D9 gate. This reference holds the mutation, not the rule that calls it.

```bash
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
        isResolved
      }
    }
  }
' -f threadId="$THREAD_ID"
```

---

## Posting Violations

```bash
# VIOLATION: Comment on line not in diff
gh api -X POST "repos/.../pulls/${PR}/comments" -f path="unchanged_file.ts" -F line=50

# VIOLATION: Missing commit_id
gh api -X POST "repos/.../pulls/${PR}/comments" -F body=@"$DEVFLOW_BODY" -f path="file.ts"

# VIOLATION: No rate limiting between comments
for file in "${FILES[@]}"; do
    gh api -X POST "repos/.../pulls/${PR}/comments" -F body=@"$DEVFLOW_BODY" -f path="$file"
done
```
