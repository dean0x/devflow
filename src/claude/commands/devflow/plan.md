---
allowed-tools: AskUserQuestion, TodoWrite, Bash
description: Triage issues from discussion - implement now, defer to GitHub issue, or skip
---

## Your task

Triage issues and decisions from the current conversation. For each item, help user understand it and decide: implement now, defer to GitHub issue, or skip entirely. Convert "now" decisions into actionable todos.

**Goal**: Deliberate decision-making on each issue, not batch selection.

---

## Step 1: Extract Issues from Conversation

Scan the conversation for:
- **Technical issues** found in code review
- **Design decisions** that need to be made
- **Bugs or vulnerabilities** discovered
- **Refactoring opportunities** discussed
- **Missing features** or incomplete implementations
- **Technical debt** identified
- **Questions or uncertainties** raised

For each item, note:
- What is it?
- Why does it matter?
- Severity/impact (Critical, High, Medium, Low)

Group similar or trivial items together for batch triage.

---

## Step 2: Triage Each Issue

Present issues one at a time (or in small batches for similar items):

```markdown
## Issue ${n}/${total}: ${short_title}

**What**: ${clear_explanation}

**Why it matters**: ${impact_and_consequences}

**Severity**: ${Critical|High|Medium|Low}
```

Then ask using `AskUserQuestion`:

```
header: "Issue ${n}"
question: "What do you want to do with: ${short_title}?"
multiSelect: false
options: [
  {
    label: "Implement now",
    description: "Add to current implementation tasks"
  },
  {
    label: "Create GitHub issue",
    description: "Defer to later - will create and lock issue"
  },
  {
    label: "Skip entirely",
    description: "Not relevant or not worth tracking"
  }
]
```

**Batch similar issues** when appropriate:
```
header: "Simple fixes"
question: "These 3 similar issues (typos, formatting, minor cleanup) - handle them together?"
options: [
  { label: "Implement all now", description: "Add all to current tasks" },
  { label: "Create single GitHub issue", description: "Group into one deferred issue" },
  { label: "Skip all", description: "Not worth the effort" }
]
```

**Handle emerging clarifications**: If user's response raises new questions or reveals misunderstandings, address them immediately before continuing triage.

---

## Step 3: Create GitHub Issues for Deferred Items

For each "Create GitHub issue" decision, use `Bash` to create the issue:

```bash
gh issue create \
  --title "${issue_title}" \
  --body "$(cat <<'EOF'
## Context

${why_this_was_identified}

## Issue Details

${clear_description_of_the_issue}

## Suggested Approach

${potential_solution_if_discussed}

## Severity

${Critical|High|Medium|Low}

---

*Created during triage session. Review before implementation.*
EOF
)" \
  --label "${appropriate_labels}"
```

Then lock the issue (no reason required):

```bash
gh issue lock ${issue_number}
```

Track created issues for final summary.

---

## Step 4: Convert "Now" Items to Actionable Todos

For all items marked "Implement now":

1. **Break down** into specific, actionable tasks
2. **Order** by dependencies and priority
3. **Estimate** complexity (simple: 15min, medium: 30min, complex: 1hr+)

Good task breakdown:
- ✅ "Fix SQL injection in `src/db/users.ts:45` - use parameterized queries"
- ✅ "Add input validation for email field in registration endpoint"
- ✅ "Refactor `UserService` to use Result types instead of throwing"

Bad task breakdown:
- ❌ "Fix security issues" (too vague)
- ❌ "Improve error handling" (not specific)

---

## Step 5: Save Todos with TodoWrite

Use `TodoWrite` to save actionable tasks:

```json
[
  {
    "content": "${specific_task_description}",
    "status": "pending",
    "activeForm": "${task_in_progress_form}"
  }
]
```

Each task should be:
- Completable in 15-60 minutes
- Clear success criteria
- Include file paths when relevant
- Ordered by dependencies

---

## Step 6: Final Summary

```markdown
## TRIAGE COMPLETE

### Implementing Now (${count} items → ${task_count} tasks)

${For each "now" item:}
- **${issue_title}**
  - ${brief_description}
  - Tasks: ${list_of_specific_todos}

### Deferred to GitHub Issues (${count} items)

${For each deferred item:}
- **${issue_title}** → Issue #${number}
  - ${brief_description}
  - Severity: ${severity}
  - [View issue](${issue_url})

### Skipped (${count} items)

${For each skipped item:}
- ${issue_title} - ${reason_user_gave_or_inferred}

---

**Next Steps**:
- ${task_count} tasks saved to todo list
- ${issue_count} GitHub issues created and locked
- Run `/implement` to start working through tasks
```

---

## Behavior Rules

### ALWAYS:
- Explain each issue clearly before asking for decision
- Create actual GitHub issues via `gh` CLI
- Lock created issues immediately
- Break "now" items into specific, actionable todos
- Track all decisions for final summary
- Address clarifications that arise during triage

### NEVER:
- Present all issues as a batch selection list
- Skip the understanding phase
- Create vague or unactionable todos
- Forget to lock GitHub issues
- Ignore user questions that arise during triage

### Handle Edge Cases:
- **No issues found**: "I didn't identify any issues to triage from this conversation. Did I miss something?"
- **gh CLI not available**: Warn user, offer to output issue text for manual creation
- **User wants to reconsider**: Allow changing previous decisions before final save
