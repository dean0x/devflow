---
allowed-tools: AskUserQuestion, TodoWrite, Read, Write, Edit, Bash, Grep, Glob
description: Systematically address PR review comments with implementation and resolution tracking
---

## Your task

Fetch PR review comments, triage them with the user, implement requested changes, and respond to reviewers. This command orchestrates the entire PR feedback resolution workflow.

**Philosophy**: PR comments are collaboration opportunities. Address them systematically, honestly, and completely.

---

## Step 1: Detect PR Context

Find the PR associated with the current branch:

```bash
echo "=== DETECTING PR CONTEXT ==="

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
    echo "❌ Not on a branch (detached HEAD)"
    exit 1
fi

# Check if arguments provided (PR number)
if [ -n "$ARGUMENTS" ]; then
  # Strip non-numeric characters
  PR_NUMBER=$(echo "$ARGUMENTS" | sed 's/[^0-9]//g')

  if [ -z "$PR_NUMBER" ]; then
    echo "❌ Invalid PR number: $ARGUMENTS"
    exit 1
  fi

  echo "Using specified PR: #$PR_NUMBER"
else
  # Auto-detect PR for current branch
  PR_NUMBER=$(gh pr list --head "$CURRENT_BRANCH" --json number --jq '.[0].number' 2>/dev/null || echo "")

  if [ -z "$PR_NUMBER" ]; then
    echo "❌ No PR found for branch: $CURRENT_BRANCH"
    echo "   Create PR first: /pull-request"
    echo "   Or specify PR number: /resolve-comments <number>"
    exit 1
  fi

  echo "Auto-detected PR #$PR_NUMBER for branch: $CURRENT_BRANCH"
fi

# Get PR details
PR_TITLE=$(gh pr view $PR_NUMBER --json title --jq '.title' 2>/dev/null || echo "Unknown")
PR_URL=$(gh pr view $PR_NUMBER --json url --jq '.url' 2>/dev/null || echo "")
PR_STATE=$(gh pr view $PR_NUMBER --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")

echo ""
echo "PR #$PR_NUMBER: $PR_TITLE"
echo "Status: $PR_STATE"
echo "URL: $PR_URL"
echo ""
```

### Step 2: Fetch and Parse Comments

Get all review comments for this PR:

```bash
echo "=== FETCHING PR COMMENTS ==="

# Fetch comments using gh API
# Note: This gets review comments (code-level) and issue comments (general)
gh pr view $PR_NUMBER --json comments,reviews --json body > /tmp/pr_comments_$PR_NUMBER.json

# Count comments
REVIEW_COUNT=$(cat /tmp/pr_comments_$PR_NUMBER.json | jq -r '.reviews | length')
COMMENT_COUNT=$(cat /tmp/pr_comments_$PR_NUMBER.json | jq -r '.comments | length')

echo "Review comments: $REVIEW_COUNT"
echo "General comments: $COMMENT_COUNT"
echo ""

if [ "$REVIEW_COUNT" -eq 0 ] && [ "$COMMENT_COUNT" -eq 0 ]; then
  echo "✅ No comments to resolve!"
  exit 0
fi
```

Parse the comments and extract relevant information:
- Author
- Body/content
- File path (for code comments)
- Line number (for code comments)
- Comment type (change request, question, nitpick, approval)
- Comment ID (for responding)

**IMPORTANT**: Use `Read` tool to parse the JSON file at `/tmp/pr_comments_$PR_NUMBER.json` and extract structured comment data.

### Step 3: Display Comments Grouped by Category

Present comments organized by type and file:

```markdown
💬 PR COMMENTS FOR #${PR_NUMBER}

## 📝 Code Change Requests (${count})
${For each code change request:}

**Comment ${N}** by @${author} on ${file}:${line}
> ${comment body}

**Context:**
```${language}
${code snippet from file around line}
```

---

## ❓ Questions (${count})
${For each question:}

**Comment ${N}** by @${author}
> ${question text}

---

## 🔧 Nitpicks / Style (${count})
${For each nitpick:}

**Comment ${N}** by @${author} on ${file}:${line}
> ${nitpick text}

---

## ✅ Approvals / Positive Feedback (${count})
${For each approval:}

**Comment ${N}** by @${author}
> ${feedback text}

---

**Total: ${total_count} comments**
```

### Step 4: Triage Comments with User

Use `AskUserQuestion` to let user decide which comments to address:

**Question 1: Select comments to address**
```
header: "Address comments"
question: "Which comments do you want to address in this session?"
multiSelect: true
options: [
  {
    label: "Comment 1: [summary]",
    description: "@author: [first 80 chars of comment]"
  },
  {
    label: "Comment 2: [summary]",
    description: "@author: [first 80 chars of comment]"
  },
  ...
]
```

**Question 2: Batch similar comments?**
```
header: "Batch comments"
question: "Any comments that should be addressed together (e.g., similar changes)?"
multiSelect: true
options: [List selected comments from Q1]
```

Save selected comments to todo list using `TodoWrite`:

```json
[
  {
    "content": "Address Comment 1: [summary] in file:line",
    "status": "pending",
    "activeForm": "Addressing Comment 1"
  },
  {
    "content": "Address Comment 2: [summary] in file:line",
    "status": "pending",
    "activeForm": "Addressing Comment 2"
  }
]
```

Present triage summary:

```markdown
🎯 COMMENT RESOLUTION PLAN

### Selected for this session (${count}):
- Comment ${N}: ${summary}
- Comment ${N}: ${summary}

### Deferred for later (${count}):
- Comment ${N}: ${summary}

### Batched together:
- Comments ${N1}, ${N2}: ${summary}

Total todos created: ${count}
```

---

## Step 5: Resolve Comments Iteratively

For each selected comment (or batch), follow this process:

### 5.1 Display Comment Context

```markdown
---
🔍 RESOLVING COMMENT ${N}/${total}
---

**From:** @${author}
**File:** ${file}:${line} (if applicable)
**Type:** ${change_request|question|nitpick}

**Comment:**
> ${full comment body}

**Current Code:**
```${language}
${code context from file}
```
```

### 5.2 Analyze What's Needed

Use `Grep` and `Read` tools to understand:
- What files need to change
- What the current implementation looks like
- What the reviewer is asking for

**Ask for clarification if ambiguous:**
```
header: "Clarification"
question: "Comment ${N} asks for '${summary}'. How should we proceed?"
multiSelect: false
options: [
  {label: "Approach 1", description: "..."},
  {label: "Approach 2", description: "..."},
  {label: "Ask reviewer for clarification", description: "Post reply requesting more details"}
]
```

### 5.3 Implement the Change

Use `Edit` or `Write` tools to make the requested changes:

1. **Read the relevant file(s)**
2. **Make the change** following the reviewer's request
3. **Verify the change** by reading back

```markdown
✏️ IMPLEMENTING CHANGE

Modifying: ${file}

Change: ${description}

Files modified:
- ${file1}
- ${file2}
```

### 5.4 Prompt for Reply Message

Use `AskUserQuestion` to get reply message:

```
header: "Reply"
question: "What should we reply to @${author} for Comment ${N}?"
multiSelect: false
options: [
  {
    label: "Use suggested reply",
    description: "${generated reply based on what was changed}"
  },
  {
    label: "Custom reply",
    description: "You'll write the reply manually"
  },
  {
    label: "Skip reply for now",
    description: "Implement change but don't reply yet"
  }
]
```

**If "Custom reply" selected**, prompt for custom message:
```
Please provide your reply message for @${author}:
```

**If "Use suggested reply"**, generate appropriate response:

**For change requests:**
```
✅ Done! I've ${what was changed}.

Changes made:
- ${file1}: ${change description}
- ${file2}: ${change description}

${Additional notes if relevant}
```

**For questions:**
```
${Answer to the question}

${Code example or explanation if relevant}
```

**For nitpicks:**
```
✅ Fixed in ${commit or "latest changes"}
```

### 5.5 Post Reply and Mark Complete

```bash
# Post the reply
gh pr comment $PR_NUMBER --body "${REPLY_MESSAGE}"

echo "✅ Reply posted"
```

Update todo list to mark this comment as completed:

```
TodoWrite: Mark comment ${N} as "completed"
```

```markdown
✅ COMMENT ${N} RESOLVED

- Changed: ${files}
- Reply: "${reply_summary}"
- Status: Resolved
```

---

## Step 6: Handle Deferred Comments

For comments not addressed in this session:

```markdown
⏸️ DEFERRED COMMENTS (${count})

These comments were not addressed in this session:

${For each deferred comment:}
**Comment ${N}** by @${author}
- Reason: ${user_selected or "not selected"}
- Suggestion: ${how to handle later}

---

💡 To address these later, run:
   /resolve-comments ${PR_NUMBER}
```

---

## Step 7: Create Commit for Changes

After all selected comments are addressed, ask about committing:

```
header: "Commit changes"
question: "Create commit for PR feedback changes?"
multiSelect: false
options: [
  {
    label: "Yes - create commit now",
    description: "Commit all changes with generated message"
  },
  {
    label: "No - I'll commit manually",
    description: "Leave changes uncommitted for review"
  }
]
```

**If "Yes"**, create commit:

```bash
# Stage all changes
git add -A

# Create commit with feedback reference
git commit -m "$(cat <<'EOF'
fix: address PR #${PR_NUMBER} review comments

Resolved comments from @${reviewers}:
- ${comment_summary_1}
- ${comment_summary_2}
- ${comment_summary_3}

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

# Push to remote
git push
```

---

## Step 8: Provide Session Summary

Present comprehensive summary:

```markdown
## ✅ COMMENT RESOLUTION SESSION COMPLETE

### PR #${PR_NUMBER}: ${title}

### 📊 Session Stats
- Comments addressed: ${count}
- Comments deferred: ${count}
- Files modified: ${count}
- Replies posted: ${count}

### ✅ Resolved Comments
${For each resolved:}
- Comment ${N}: ${summary}
  - Files: ${files}
  - Reply: ${reply_summary}

### ⏸️ Deferred Comments (${count})
${For each deferred:}
- Comment ${N}: ${summary} - ${reason}

### 📝 Changes Made
**Files Modified:**
${List all modified files}

**Commits Created:**
${List commits if any}

### 🔗 PR Status
- URL: ${PR_URL}
- Remaining comments: ${count}
- Next action: ${suggestion}

---

💡 **Next Steps:**

${If all comments resolved:}
✅ All comments resolved! Request re-review:
   gh pr review ${PR_NUMBER} --comment -b "All feedback addressed, ready for re-review"

${If comments remain:}
⏳ ${count} comments still pending:
   - Review deferred comments above
   - Run /resolve-comments ${PR_NUMBER} when ready

${If changes need testing:}
🧪 Test your changes:
   ${testing suggestions}
```

---

## Special Cases

### Handling "Out of Scope" Comments

If a comment asks for something out of scope:

```
Reply:
"Thanks for the suggestion! I think this is out of scope for this PR, which focuses on ${pr_focus}. I've created #${new_issue} to track this separately."
```

**Prompt user to create issue** or handle it appropriately.

### Handling Conflicting Comments

If multiple reviewers have conflicting requests:

```markdown
⚠️ CONFLICTING FEEDBACK DETECTED

**Comment ${N1}** by @${author1}:
> ${request1}

**Comment ${N2}** by @${author2}:
> ${request2}

These requests conflict. How should we proceed?
```

Use `AskUserQuestion` to decide:
```
options: [
  {label: "Follow @${author1}'s approach", description: "..."},
  {label: "Follow @${author2}'s approach", description: "..."},
  {label: "Ask for clarification", description: "Post comment to both reviewers"},
  {label: "Defer for discussion", description: "Skip both for now"}
]
```

### Handling Questions Without Changes

For comments that are just questions (no code changes needed):

1. **Answer the question** in reply
2. **No files modified**
3. **Mark as resolved** after posting answer

---

## Usage Examples

### Basic Usage
```bash
# Resolve comments for current branch's PR
/resolve-comments

# Resolve comments for specific PR
/resolve-comments 123

# Show comments only (no implementation)
/resolve-comments --list
```

### When to Use

**✅ Use /resolve-comments when:**
- PR has review feedback to address
- You want systematic comment resolution
- You want to track which comments were addressed
- You want help generating appropriate replies

**💡 Pro Tips:**
- Address quick wins first (nitpicks, simple changes)
- Batch similar comments together
- Test changes after each batch
- Commit incrementally, not all at once
- Be honest in replies about limitations

**⚠️ Before using:**
- Pull latest changes: `git pull origin $(git branch --show-current)`
- Ensure working tree is clean or stash changes
- Review all comments first to understand scope

---

## Integration with Workflow

**After /pull-request:**
```
1. Team reviews PR
2. Feedback comes in
3. /resolve-comments  ← systematically address feedback
4. Reviewers re-review
5. Repeat until approved
6. Merge!
```

**Integration Points:**
- After feedback: `/resolve-comments` (this command)
- Before pushing changes: `/review` (optional)
- After changes: `/commit` (if manual commit preferred)
- After addressing all: Request re-review via `gh pr review`
