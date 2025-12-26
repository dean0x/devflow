---
allowed-tools: TodoWrite, Read, Write, Edit, AskUserQuestion, Bash, Grep, Glob
description: Implement pending todos efficiently with minimal interruption
---

## Your task

Implement all pending todos from the todo list. Flow through each task to completion, only stopping for genuine design decisions that require user input.

---

## Step 1: Load Pending Todos

Get current todos and display pending work:

```markdown
📋 **Implementing {N} todos**

{List each pending todo}

Starting implementation...
```

If no pending todos:
```
No pending todos. Use /breakdown or /specify to create tasks.
```

---

## Step 2: Implementation Loop

For each pending todo:

1. **Mark in_progress** using TodoWrite

2. **Find existing patterns** - Quick grep for similar implementations

3. **Implement** using Read/Edit/Write tools:
   - Read relevant files
   - Make changes following existing patterns
   - Update imports/dependencies if needed
   - Skills auto-validate (devflow-core-patterns, devflow-test-design, devflow-code-smell)

4. **Ask for design decisions only when:**
   - Multiple architectural approaches exist (event-driven vs REST, GraphQL vs REST API)
   - Security/performance trade-off requires decision
   - Framework/library choice impacts future development (Redux vs Context, Jest vs Vitest)

   **Never ask for:**
   - Which file to modify (infer from context)
   - Standard implementation details (follow existing patterns)
   - Obvious choices (use best practices)

5. **Mark completed** using TodoWrite

6. **Brief confirmation**: `✅ {todo} - {files modified}`

Move to next todo.

---

## Step 3: Summary

After all todos completed:

```markdown
✅ **Completed {N} todos**

Files modified: {list}

Next: Run /review (if major changes) or /commit
```

---

## Design Decision Guidelines

**DO ask when:**
- Architectural choice impacts future codebase structure
- Security vs performance decision with real trade-offs
- Multiple valid framework/library options exist

**DON'T ask when:**
- Existing pattern is obvious from codebase
- Standard implementation applies (CRUD, validation, tests)
- File location clear from context
- Best practices provide the answer

---

## Quality Enforcement

Skills auto-validate during implementation:
- `devflow-core-patterns` - Result types, DI, immutability
- `devflow-test-design` - Test quality and structure
- `devflow-code-smell` - Anti-pattern detection

Trust skills to handle quality enforcement automatically.
