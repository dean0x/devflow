---
allowed-tools: Bash, Read, Grep, Glob, TodoWrite
description: Generate daily standup report with progress and plans
---

## Your task

Generate a concise daily standup report by analyzing recent work, current todos, and planned activities.

### Step 1: Analyze Yesterday's Work

```bash
# Get commits from last 24 hours
echo "=== YESTERDAY'S COMMITS ==="
git log --since="24 hours ago" --oneline --author="$(git config user.email)" 2>/dev/null || echo "No commits in last 24 hours"
echo ""

# Check recent devlog entries
if [ -f ".docs/status/compact/INDEX.md" ]; then
    echo "=== RECENT ACTIVITY FROM DEVLOG ==="
    head -20 .docs/status/compact/INDEX.md 2>/dev/null || echo "No recent devlog entries"
    echo ""
fi
```

### Step 2: Current Status

Check current branch, uncommitted changes, and active todos:
- Use TodoWrite to get current todo list
- Show current branch and any uncommitted work
- Identify any blockers or issues

### Step 3: Today's Plan

Analyze and present today's priorities:
- Top priority todos
- Any PRs that need review
- Scheduled meetings or deadlines (if mentioned in context)

### Step 4: Generate Standup Report

```markdown
# Daily Standup - {DATE}

## 📅 Yesterday
{List completed items from commits and devlog}
- ✅ {Completed task 1}
- ✅ {Completed task 2}

## 📋 Today's Plan
{List from todos and context}
- 🎯 {Priority 1}
- 📌 {Priority 2}
- 📝 {Priority 3}

## 🚧 Blockers
{Any identified blockers or concerns}
- ⚠️ {Blocker if any}

## 💬 Notes
{Any additional context or needs}

---
*Generated at {TIME} | Branch: {BRANCH} | Uncommitted changes: {YES/NO}*
```

Save the standup report to `.docs/standups/{DATE}.md` for historical reference.