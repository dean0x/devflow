---
allowed-tools: AskUserQuestion, TodoWrite, Read, Write, Edit, Bash, Grep, Glob
description: Extract actionable next steps from discussion and let user select which to tackle
---

## Your task

Analyze the current discussion to extract actionable next steps, present them to the user for selection, and save only the chosen tasks to the todo list. This command is identical to `/plan-next-steps` but adds user selection before loading todos.

**🎯 FOCUS**: Extract action items from discussion, let user choose which to tackle, then save to todo list.

---

## Step 1: Extract Next Steps from Discussion

**FOCUS**: Look at the current discussion and identify concrete next steps that emerged from the conversation.

**What to Extract**:
- **Immediate tasks** mentioned or implied in the discussion
- **Code changes** that were discussed or agreed upon
- **Files** that need to be created, modified, or reviewed
- **Dependencies** that need to be installed or configured
- **Tests** that need to be written or updated
- **Documentation** that needs updating
- **Investigations** or research tasks mentioned
- **Decisions** that need to be made before proceeding

**Look for phrases like**:
- "We should..."
- "Next, I'll..."
- "Let me..."
- "I need to..."
- "We could..."
- "First, we'll..."

**From recent context:**
- Look at the last 10-20 messages in the conversation
- Extract tasks from `/research` output if present
- Extract issues from `/code-review` output if present
- Extract action items from general discussion

---

## Step 2: Convert to Actionable Todo Items

Transform the extracted items into specific todo tasks:

**Good todo items**:
- ✅ "Add authentication middleware to routes in `/src/middleware/auth`"
- ✅ "Write unit tests for user registration in `/tests/auth_test`"
- ✅ "Install password hashing library dependency"
- ✅ "Research API schema design for user endpoints"
- ✅ "Update README.md with new authentication setup instructions"

**Bad todo items**:
- ❌ "Improve authentication" (too vague)
- ❌ "Add better error handling" (not specific)
- ❌ "Make it more secure" (not actionable)

Create a preliminary list of todo items with:
- Specific description
- File paths when relevant
- Clear success criteria
- Logical grouping (dependencies, implementation, tests, docs)

---

## Step 3: Present Extracted Items to User

Show the user what you extracted from the discussion:

```markdown
📋 EXTRACTED ACTION ITEMS

Based on our discussion, I identified these potential tasks:

### Dependencies & Setup
1. ${task_description}
2. ${task_description}

### Core Implementation
3. ${task_description}
4. ${task_description}
5. ${task_description}

### Testing
6. ${task_description}
7. ${task_description}

### Documentation
8. ${task_description}

**Total: ${count} potential tasks**

Let me help you decide which ones to tackle.
```

---

## Step 4: Let User Select Tasks to Tackle

Use `AskUserQuestion` to let user choose which tasks to add to the todo list:

**Question 1: Select tasks**
```
header: "Select tasks"
question: "Which tasks do you want to add to your todo list?"
multiSelect: true
options: [
  {
    label: "Task 1: ${short_summary}",
    description: "${full_description}"
  },
  {
    label: "Task 2: ${short_summary}",
    description: "${full_description}"
  },
  {
    label: "Task 3: ${short_summary}",
    description: "${full_description}"
  },
  ...all extracted tasks...
  {
    label: "All tasks",
    description: "Add all extracted tasks to todo list"
  }
]
```

**If user selects "All tasks":**
Include all extracted tasks.

**If user selects specific tasks:**
Only include the selected tasks.

**If user selects nothing:**
```markdown
No tasks selected. Your todo list remains unchanged.

💡 Use `/plan-next-steps` if you want to add all items without selection.
```
Exit without saving.

---

## Step 5: Prioritize Selected Tasks (Optional)

**Question 2: Prioritization**
```
header: "Priority order"
question: "How should we prioritize these ${count} tasks?"
multiSelect: false
options: [
  {
    label: "Logical order (dependencies first)",
    description: "Arrange by dependencies → implementation → tests → docs"
  },
  {
    label: "Quick wins first",
    description: "Start with easiest tasks to build momentum"
  },
  {
    label: "Critical items first",
    description: "Start with most important tasks"
  },
  {
    label: "Keep current order",
    description: "Use the order I extracted them in"
  }
]
```

Reorder tasks based on user's choice:

**Logical order:**
1. Dependencies & setup
2. Core implementation
3. Tests
4. Documentation

**Quick wins first:**
1. Simple, fast tasks first
2. Complex tasks last

**Critical items first:**
1. High-priority tasks first
2. Nice-to-have tasks last

**Keep current order:**
Don't reorder, use extraction order.

---

## Step 6: Save to Todo List with TodoWrite

Use `TodoWrite` to save the selected tasks:

```json
[
  {
    "content": "${task_description}",
    "status": "pending",
    "activeForm": "${active_form_description}"
  },
  {
    "content": "${task_description}",
    "status": "pending",
    "activeForm": "${active_form_description}"
  },
  ...
]
```

**Each task should:**
- Be specific and testable
- Include file paths when relevant
- Be completable in 15-30 minutes
- Have clear success criteria
- Start as "pending" status

---

## Step 7: Present Final Todo List

Show the developer what was saved:

```markdown
## ✅ TASKS ADDED TO TODO LIST

Based on your selection, I've added these ${count} tasks:

### Selected Tasks (In Priority Order)

1. **${task_name}**
   - ${description}
   - ${file_paths}

2. **${task_name}**
   - ${description}
   - ${file_paths}

3. **${task_name}**
   - ${description}
   - ${file_paths}

---

### Not Selected (${count} tasks)
${If any tasks weren't selected:}
- ${task_name} - ${reason_not_selected}
- ${task_name} - ${reason_not_selected}

---

**Total tasks in todo list: ${count}**

💡 **Ready to start?** Run `/implement` to work through these tasks systematically.
```

---

## Usage Examples

### Example 1: After /research

```
User: [runs /research on authentication implementation]
Research output: [Comprehensive analysis with multiple approaches]

User: /plan

AI: 📋 EXTRACTED ACTION ITEMS

Based on the research, I identified these potential tasks:

### Core Implementation
1. Create JWT authentication middleware in src/middleware/auth.ts
2. Add token validation logic using jsonwebtoken library
3. Integrate auth middleware into API routes

### Testing
4. Write unit tests for token generation
5. Write integration tests for auth flow

### Documentation
6. Update API docs with authentication endpoints

Total: 6 potential tasks

[Shows selection question]
User: Selects tasks 1, 2, 3, 4 (skips 5 and 6)

[Shows prioritization question]
User: Chooses "Logical order"

AI: ✅ TASKS ADDED TO TODO LIST

1. Create JWT authentication middleware in src/middleware/auth.ts
2. Add token validation logic using jsonwebtoken library
3. Integrate auth middleware into API routes
4. Write unit tests for token generation

Not Selected (2 tasks):
- Integration tests for auth flow
- Update API docs with authentication endpoints

Total tasks in todo list: 4

💡 Ready to start? Run /implement
```

### Example 2: After /code-review

```
User: [runs /code-review]
Review output: [Multiple issues found]

User: /plan

AI: 📋 EXTRACTED ACTION ITEMS

Based on the code review, I identified these issues to fix:

### Critical Issues
1. Fix SQL injection vulnerability in user query (src/db/users.ts:45)
2. Add input validation for API endpoints (src/routes/api.ts)

### High Priority
3. Refactor error handling to use Result types (src/services/user.ts)
4. Add missing tests for edge cases (tests/user.test.ts)

### Medium Priority
5. Update documentation for new error format (docs/errors.md)
6. Optimize database query performance (src/db/queries.ts)

Total: 6 potential tasks

[Shows selection question]
User: Selects tasks 1, 2, 3 (critical + high priority)

[Shows prioritization question]
User: Chooses "Critical items first"

AI: ✅ TASKS ADDED TO TODO LIST

1. Fix SQL injection vulnerability in user query (src/db/users.ts:45)
2. Add input validation for API endpoints (src/routes/api.ts)
3. Refactor error handling to use Result types (src/services/user.ts)

Not Selected (3 tasks):
- Add missing tests for edge cases
- Update documentation for new error format
- Optimize database query performance

Total tasks in todo list: 3

💡 Ready to start? Run /implement
```

### Example 3: After General Discussion

```
User: "I want to add dark mode support to the app"
AI: "We could add a theme provider with CSS variables..."
User: "Yeah, and we need to persist the preference..."
AI: "We should also update the color palette..."

User: /plan

AI: 📋 EXTRACTED ACTION ITEMS

Based on our discussion about dark mode, I identified:

### Core Implementation
1. Create ThemeProvider component with light/dark modes
2. Define CSS variables for light and dark color palettes
3. Add theme toggle button in settings

### Persistence
4. Store theme preference in localStorage
5. Read theme preference on app load

### Updates
6. Update existing components to use theme variables
7. Test dark mode across all pages

Total: 7 potential tasks

[Shows selection question]
User: Selects "All tasks"

[Shows prioritization question]
User: Chooses "Logical order"

AI: ✅ TASKS ADDED TO TODO LIST

1. Create ThemeProvider component with light/dark modes
2. Define CSS variables for light and dark color palettes
3. Store theme preference in localStorage
4. Read theme preference on app load
5. Add theme toggle button in settings
6. Update existing components to use theme variables
7. Test dark mode across all pages

Total tasks in todo list: 7

💡 Ready to start? Run /implement
```

---

## Command Behavior Rules

### ALWAYS Do These:
- ✅ Extract concrete action items from the discussion
- ✅ Present all extracted items to user
- ✅ Use AskUserQuestion to let user select which to tackle
- ✅ Use AskUserQuestion to let user prioritize order
- ✅ Save only selected tasks using TodoWrite
- ✅ Show what was added and what wasn't

### NEVER Do These:
- ❌ Automatically add all tasks without user selection
- ❌ Skip the selection step (that's what /plan-next-steps is for)
- ❌ Create vague or untestable tasks
- ❌ Skip showing what wasn't selected
- ❌ Forget to use TodoWrite to save the list

### Focus Areas:
- 🎯 **Extract**: Pull concrete next steps from discussion
- 🎯 **Present**: Show all options clearly
- 🎯 **Select**: Let user choose which to tackle
- 🎯 **Prioritize**: Let user decide order
- 🎯 **Save**: Use TodoWrite only for selected tasks

---

## Differences from /plan-next-steps

| Feature | /plan | /plan-next-steps |
|---------|-------|------------------|
| Extract action items | ✅ Yes | ✅ Yes |
| Show extracted items | ✅ Yes | ❌ No |
| User selects tasks | ✅ Yes | ❌ No |
| User prioritizes | ✅ Yes | ❌ No |
| Save to todos | ✅ Selected only | ✅ All items |
| Speed | Slower (interactive) | Faster (automatic) |

**When to use which:**

**Use `/plan`:**
- After `/research` or `/code-review` (lots of potential tasks)
- When you only want to tackle some items
- When you want to prioritize before starting
- When you want to see options before committing

**Use `/plan-next-steps`:**
- After discussion where you've already decided
- When you want all items added quickly
- When you trust AI to extract and prioritize
- When you want minimal interaction

---

## Edge Cases

### User Cancels Selection
If user cancels the selection dialog:
- No tasks are added to todo list
- Command exits gracefully with message
- Todo list remains unchanged
- **Suggestion**: Re-run `/plan` or use `/plan-next-steps` for automatic addition

### User Selects Nothing
If user deselects all options:
- Shows message: "No tasks selected. Your todo list remains unchanged."
- Suggests using `/plan-next-steps` for automatic addition
- Exits without saving
- **Reason**: Respects user's decision to not add tasks at this time

### No Tasks Extracted
If no actionable tasks found in discussion:
- Shows message explaining no tasks were identified
- Suggests continuing discussion or using `/research` first
- Exits without showing selection dialog
- **Common causes**: Discussion was exploratory, no concrete next steps agreed upon

### Tasks Already Exist
If extracted tasks duplicate existing todos:
- De-duplicates automatically based on content similarity
- Shows which tasks were skipped (already in list)
- Only new/unique tasks are presented for selection
- **Note**: Exact duplicates are filtered, similar tasks are shown

### Empty Discussion Context
If command run without prior discussion:
- Shows message: "No discussion context found"
- Suggests having a discussion first about what needs to be done
- Exits without extraction
- **Tip**: Use `/research` or discuss your goals first

---

## Integration with Workflow

```
Common workflows:

1. Research → Plan → Implement
   /research → /plan → /implement

2. Review → Plan → Implement
   /code-review → /plan → /implement

3. Discussion → Plan → Implement
   [discussion] → /plan → /implement

4. Quick capture (no selection)
   [discussion] → /plan-next-steps → /implement
```

---

This creates a user-controlled planning process where you see all potential tasks and choose which ones to tackle, rather than blindly adding everything to your todo list.
