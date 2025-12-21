---
allowed-tools: TodoWrite
description: Quickly break down discussion into actionable tasks without interactive triage
---

## Your task

Extract action items from the current conversation and immediately save them as todos. No interaction, no triage, no GitHub issues - just fast task decomposition.

**Goal**: Quick capture of actionable items from discussion.

---

## Step 1: Extract Action Items

Scan the conversation for concrete next steps:

**Look for**:
- Tasks mentioned or implied ("We should...", "I'll need to...", "Let me...")
- Code changes discussed or agreed upon
- Files to create, modify, or review
- Dependencies to install or configure
- Tests to write or update
- Documentation to update
- Decisions that need to be made

---

## Step 2: Convert to Specific Todos

Transform extracted items into actionable tasks:

**Good**:
- "Add authentication middleware to routes in `src/middleware/auth`"
- "Write unit tests for user registration in `tests/auth.test.ts`"
- "Install password hashing library dependency"

**Bad**:
- "Improve authentication" (vague)
- "Add better error handling" (not specific)
- "Make it more secure" (not actionable)

---

## Step 3: Prioritize by Dependencies

Order tasks logically:
1. **Dependencies first** - installations, setup
2. **Core implementation** - main functionality
3. **Tests** - verification
4. **Documentation** - updates

---

## Step 4: Save with TodoWrite

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
- Specific with file paths when relevant
- Clear success criteria
- Pending status

---

## Step 5: Present Summary

```markdown
## BREAKDOWN COMPLETE

### Tasks Added (${count} items)

**Dependencies & Setup**
- ${task}
- ${task}

**Core Implementation**
- ${task}
- ${task}

**Testing**
- ${task}

**Documentation**
- ${task}

---

**Total: ${count} tasks saved to todo list**

💡 Run `/implement` to start working through these tasks
💡 Run `/specify` if you want detailed design for a specific feature
```

---

## Behavior Rules

### ALWAYS:
- Extract concrete action items immediately
- Use TodoWrite to save all items
- Break tasks into 15-60 minute chunks
- Include file paths and specific details
- Prioritize by dependencies

### NEVER:
- Ask user for selection
- Create vague or untestable tasks
- Skip obvious implementation steps
- Make tasks too large or complex
- Forget to use TodoWrite

### When to use `/breakdown` vs `/specify`:

- **`/breakdown`**: Fast capture, trust AI extraction, want all items as todos
- **`/specify`**: Detailed feature specification with technical design, creates GitHub issue
