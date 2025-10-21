---
allowed-tools: TodoWrite, Read, Write, Edit, AskUserQuestion, Bash, Grep, Glob
description: Smart implementation orchestrator - triages todos, seeks clarification, and implements tasks iteratively with continuous user interaction
---

## Your task

Orchestrate intelligent implementation of planned tasks from the todo list. This command provides interactive guidance through the implementation process, asking for clarification when needed and ensuring quality through existing skills.

**Philosophy**: Pair programming with AI - you decide priorities and provide clarification, I implement with your guidance.

---

## Step 1: Load and Display Current Todos

Get the current todo list and show it to the user:

```
Fetch current todos using TodoWrite to get state.
```

Display todos grouped by status:

```markdown
📋 **Current Todo List**

### 🔄 In Progress ({count})
- {todo 1}
- {todo 2}

### ⏳ Pending ({count})
- {todo 1}
- {todo 2}
- {todo 3}

### ✅ Completed ({count})
- {todo 1}
- {todo 2}
```

If no pending or in-progress todos:
```
No todos found. Run /plan-next-steps to create actionable tasks, or use TodoWrite to add tasks manually.
```

---

## Step 2: Todo Triage

Use AskUserQuestion to let the user manage their todo list:

**Question 1: Remove unnecessary todos?**
```
header: "Remove todos"
question: "Are there any todos you want to remove from the list?"
multiSelect: true
options: [List all pending/in-progress todos]
```

Update TodoWrite to remove selected todos.

**Question 2: Defer todos for later?**
```
header: "Defer todos"
question: "Any todos you want to discuss/plan later instead of implementing now?"
multiSelect: true
options: [List remaining pending/in-progress todos]
```

For deferred todos, add note to todo content: "(Deferred - discuss later)" and mark as pending.

**Question 3: Prioritize implementation order**
```
header: "Priority order"
question: "Which todo should we implement FIRST?"
multiSelect: false
options: [List remaining pending/in-progress todos with complexity indicators]
```

Reorder todos based on selection. Present final implementation queue:

```markdown
🎯 **Implementation Queue**

1. {todo 1} - {complexity: Simple/Medium/Complex}
2. {todo 2} - {complexity}
3. {todo 3} - {complexity}

Total: {count} todos to implement
```

---

## Step 3: Iterative Implementation

For each todo in priority order:

### 3.1 Analyze Todo

**Check clarity**:
- Is the task clear and specific?
- Are there multiple possible approaches?
- Is there missing context (file paths, specific requirements)?

**Assess complexity**:
- **Simple**: Single file change, clear approach (< 50 lines)
- **Medium**: Multiple files, standard patterns (50-150 lines)
- **Complex**: Architectural changes, new patterns (> 150 lines)

### 3.2 Seek Clarification (if needed)

**Only if genuinely unclear**, ask ONE question using AskUserQuestion:

```
header: "Clarification"
question: "For '{todo}': {specific question about the unclear aspect}?"
multiSelect: false
options: [
  {option 1 with explanation},
  {option 2 with explanation},
  {option 3 with explanation}
]
```

**Examples of when to ask**:
- Multiple valid approaches (REST vs GraphQL, Redux vs Context)
- Missing specifics (which file? which component?)
- Architectural decision needed (new pattern vs existing)
- Security/performance trade-off

**Examples of when NOT to ask**:
- Standard implementation (follow existing patterns)
- Clear from context
- Developer best judgment applies

**If user provides clarification**, update todo content with the decision and proceed.

### 3.3 Pre-Implementation Analysis

Before coding, quickly check:

```bash
# Find relevant existing code
grep -r "similar_pattern" --include="*.ts" --include="*.js" src/ | head -5

# Check for related files
find . -name "*related*" -type f | head -10
```

Identify:
- **Files to modify**: List specific files
- **Existing patterns**: Reference similar code
- **Dependencies**: Any new imports needed

**Share plan** with user:

```markdown
📝 **Implementation Plan for**: {todo}

**Approach**: {chosen approach}
**Files to modify**:
- {file1} - {what changes}
- {file2} - {what changes}

**Pattern**: Following {existing pattern from file:line}
**Estimated complexity**: {Simple/Medium/Complex}

Proceeding with implementation...
```

### 3.4 Implement

Implement the todo step-by-step:

1. **Read relevant files** using Read tool
2. **Make changes** using Edit or Write tool
3. **Follow existing patterns** (skills will auto-validate)
4. **Update imports/dependencies** if needed
5. **Verify changes** with quick grep/read

**During implementation**:
- Pattern-check skill auto-validates architecture
- Test-design skill auto-validates test quality
- Error-handling skill auto-validates Result types
- Code-smell skill detects anti-patterns

### 3.5 Pause for Unexpected Issues

If issues arise during implementation:

**Question: How to proceed?**
```
header: "Issue found"
question: "Found {issue description}. How should we proceed?"
multiSelect: false
options: [
  {Approach 1 with trade-offs},
  {Approach 2 with trade-offs},
  {Defer this todo for later discussion}
]
```

If deferred, mark todo status and move to next.

### 3.6 Mark Complete

Once implemented successfully:

```bash
# Update todo status
TodoWrite: Mark current todo as "completed"
```

**Brief confirmation**:
```
✅ Completed: {todo}
Files modified: {list}
Pattern used: {pattern}
```

Move to next todo.

---

## Step 4: Implementation Summary

After all todos processed, provide comprehensive summary:

```markdown
## 🎉 Implementation Session Complete

### ✅ Completed ({count})
- {todo 1} - {files modified}
- {todo 2} - {files modified}
- {todo 3} - {files modified}

### ⏸️ Deferred ({count})
- {todo 1} - {reason deferred}
- {todo 2} - {reason deferred}

### 📊 Session Stats
- **Files modified**: {count}
- **Files created**: {count}
- **Pattern compliance**: {skills flagged X issues, addressed inline}
- **Time estimate**: {based on complexity}

### 🔍 Code Changes

{Brief summary of what was implemented}

### 📝 Next Steps

**Immediate**:
- [ ] Run tests to verify implementations
- [ ] Review changed files: {list}
- [ ] Consider committing: `git add {files}` && `/commit`

**Deferred Todos**:
{If any todos were deferred, list them with notes}

**Recommended**:
- Run `/code-review` before committing for comprehensive quality check
- Use `/devlog` to document this implementation session
```

---

## Step 5: Recommend Next Action

Based on what was implemented:

```
💡 **Recommended Next Action**:

{Smart recommendation based on context:}

- If major changes: "Run `/code-review` to ensure quality across all changes"
- If tests written: "Run test suite: `npm test` (or relevant command)"
- If ready to commit: "Review changes and use `/commit` to create atomic commit"
- If complex changes: "Use `/devlog` to document implementation decisions"
- If deferred todos: "Use `/plan-next-steps` to refine deferred todos"
```

---

## Best Practices

### When to Ask Questions

**DO ask when**:
- Multiple valid approaches with different trade-offs
- Missing critical context (which file, which approach)
- Architectural decision impacts future code
- Security or performance implications
- User preference matters

**DON'T ask when**:
- Following obvious existing pattern
- Developer best judgment applies
- Standard implementation approach
- Clear from todo description
- Existing codebase shows the way

### Smart Implementation

**Simple todos** (< 50 lines):
- Quick grep for patterns
- Implement directly
- Mark complete

**Medium todos** (50-150 lines):
- Analyze existing patterns
- Share plan with user
- Implement with pattern compliance
- Mark complete

**Complex todos** (> 150 lines):
- Break into smaller steps
- Check for clarification
- Implement incrementally
- Validate along the way
- Mark complete

### Quality Enforcement

**Let skills do their job**:
- pattern-check enforces Result types, DI, immutability
- test-design validates test quality
- error-handling ensures consistency
- code-smell detects anti-patterns

**Don't re-validate** what skills already check.

### User Interaction Style

**Be efficient**:
- Ask ONE question at a time (not multiple)
- Only ask when genuinely needed
- Provide clear options with trade-offs
- Recommend the best option

**Be transparent**:
- Share implementation plan before coding
- Explain pattern choices
- Report issues as they arise
- Keep user informed of progress

---

## Example Session

```
User: /implement
AI: Loading current todo list...

📋 **Current Todo List**

### ⏳ Pending (5)
- Add authentication middleware to API routes
- Write unit tests for user registration
- Update README with auth setup instructions
- Refactor error handling to use Result types
- Add rate limiting to public endpoints

[Shows AskUserQuestion: "Remove todos?"]
User: None

[Shows AskUserQuestion: "Defer todos?"]
User: "Update README" and "Add rate limiting"

[Shows AskUserQuestion: "Which todo first?"]
User: "Add authentication middleware"

AI: 🎯 **Implementation Queue**

1. Add authentication middleware to API routes - Medium
2. Write unit tests for user registration - Simple
3. Refactor error handling to use Result types - Complex

Deferred for later:
- Update README with auth setup instructions
- Add rate limiting to public endpoints

---

AI: 📝 **Implementation Plan for**: Add authentication middleware

Checking existing patterns...
Found similar auth pattern in src/middleware/cors.ts:12

**Approach**: Create JWT middleware following existing pattern
**Files to modify**:
- src/middleware/auth.ts (create new)
- src/routes/api.ts (add middleware)

**Pattern**: Following middleware pattern from cors.ts
**Estimated complexity**: Medium

Proceeding with implementation...

[AI implements the changes using Edit/Write tools]
[pattern-check skill auto-validates Result types]
[error-handling skill validates error handling]

✅ Completed: Add authentication middleware to API routes
Files modified: src/middleware/auth.ts, src/routes/api.ts
Pattern used: Middleware pattern from cors.ts:12

---

AI: 📝 **Implementation Plan for**: Write unit tests for user registration

[Question appears: "Testing library preference?"]
User: Select "Use existing Jest setup"

[AI implements tests following existing patterns]
[test-design skill auto-validates test quality]

✅ Completed: Write unit tests for user registration
Files modified: tests/auth/register.test.ts
Pattern used: Test pattern from existing auth tests

---

AI: 📝 **Implementation Plan for**: Refactor error handling to use Result types

This is complex - will require changes across multiple files.
Analyzing impact...

[Question: "Approach?"]
Options:
1. Incremental refactor (start with one module, expand)
2. Full refactor now (all error handling at once)  
3. Defer for deeper planning

User: Option 1

[AI implements incrementally for one module]
[error-handling skill validates Result type usage]

✅ Completed: Refactor error handling to use Result types
Files modified: src/services/user.ts, src/types/result.ts
Pattern used: Result<T, E> type, incremental refactor

---

## 🎉 Implementation Session Complete

### ✅ Completed (3)
- Add authentication middleware - src/middleware/auth.ts, src/routes/api.ts
- Write unit tests - tests/auth/register.test.ts
- Refactor error handling (user module) - src/services/user.ts

### ⏸️ Deferred (2)
- Update README - deferred for documentation session
- Add rate limiting - deferred for later discussion

### 📊 Session Stats
- **Files modified**: 5
- **Files created**: 2
- **Skills auto-validated**: pattern-check, test-design, error-handling
- **Complexity**: 1 Simple, 1 Medium, 1 Complex

### 📝 Next Steps

**Immediate**:
- [ ] Run test suite: `npm test`
- [ ] Review changes: src/middleware/auth.ts, src/routes/api.ts, src/services/user.ts
- [ ] Consider committing changes

**Remaining error refactor**:
- Continue incremental refactor to other modules

💡 **Recommended Next Action**:
Run `/code-review` to validate all changes before committing.
```

---

## Key Features

**Smart Triage**:
- Remove unnecessary todos
- Defer todos for later discussion
- Prioritize implementation order

**Continuous Clarification**:
- Asks ONE question at a time
- Only when genuinely needed
- Provides clear options with trade-offs

**Pattern-Driven Implementation**:
- Finds and follows existing patterns
- Shares implementation plan
- Validates through skills

**Quality by Default**:
- Skills auto-enforce patterns
- Result types checked automatically
- Test quality validated inline

**Transparent Progress**:
- Updates todos as work completes
- Shows what's done vs deferred
- Recommends next actions

This creates a smooth implementation flow where the user stays in control while the AI handles the implementation details with quality enforced through existing skills.
