---
allowed-tools: TodoWrite, Read, Write, Edit, Bash, Grep, Glob
description: Extract actionable next steps from current discussion and save to todo list
---

## Your task

Analyze the current discussion and convert it into specific, actionable next steps that can be saved to the agent's internal todo list using TodoWrite. This command bridges the gap between talking about what to do and actually tracking concrete steps.

**🎯 FOCUS**: Turn discussion into trackable action items for the agent's internal todo list.

### Step 1: Extract Next Steps from Discussion

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

### Step 2: Convert to Actionable Todo Items

Transform the extracted items into specific todo tasks that can be tracked:

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

### Step 3: Save to Todo List with TodoWrite

**IMMEDIATELY** use TodoWrite to save the action items to the agent's internal todo list. Each task should:
- Be specific and testable
- Include file paths when relevant
- Be completable in 15-30 minutes
- Have clear success criteria
- Start as "pending" status

Example todo structure:
```json
[
  {
    "content": "Install password hashing library dependency",
    "status": "pending",
    "activeForm": "Installing password hashing library"
  },
  {
    "content": "Create authentication middleware in src/middleware/auth",
    "status": "pending",
    "activeForm": "Creating authentication middleware"
  },
  {
    "content": "Add password hashing to user registration in src/routes/users",
    "status": "pending",
    "activeForm": "Adding password hashing to user registration"
  },
  {
    "content": "Write unit tests for auth middleware in tests/auth_test",
    "status": "pending",
    "activeForm": "Writing unit tests for auth middleware"
  },
  {
    "content": "Update API documentation for new auth endpoints",
    "status": "pending",
    "activeForm": "Updating API documentation"
  }
]
```

### Step 4: Prioritize the Todo Items

Arrange the todo items in logical order:
1. **Dependencies first** (installations, setup)
2. **Core implementation** (main functionality)
3. **Tests and validation** (verification)
4. **Documentation** (updates, guides)
5. **Follow-up tasks** (optimizations, research)

### Step 5: Present the Todo List

Show the developer what was extracted and saved:

```markdown
## 📋 Next Steps Added to Todo List

Based on our discussion, I've identified and saved these action items:

### Immediate Tasks (Dependencies)
- [ ] {Task 1}
- [ ] {Task 2}

### Core Implementation
- [ ] {Task 3}
- [ ] {Task 4}
- [ ] {Task 5}

### Testing & Validation
- [ ] {Task 6}
- [ ] {Task 7}

### Documentation
- [ ] {Task 8}

**Total: {X} tasks added to internal todo list**
**Ready to begin? The agent can now start working through these systematically.**
```

---

## Usage Examples

### Example 1: After Feature Discussion
```
Human: "Add user authentication to our web application"
AI: "I can help with that. What type of auth do you prefer?"
Human: "Token-based auth, and we need password reset functionality"
AI: "Got it. Should I use a password hashing library?"
Human: "Yes, and integrate with our existing database"
Developer: "/standup"

Result: AI extracts action items from discussion:
- Install password hashing and token libraries
- Create user authentication middleware
- Set up password reset email functionality
- Create database migration for user auth tables
- Write unit tests for auth endpoints
- Update API documentation

📋 6 tasks added to internal todo list
```

### Example 2: After Bug Investigation
```
Human: "Users are reporting slow page loads on the dashboard"
AI: "Let me investigate the dashboard queries. I found the issue - it's doing N+1 queries on user data."
Human: "Can you fix that?"
AI: "Yes, I'll add proper joins and implement pagination."
Developer: "/plan-next-steps"

Result: AI creates specific action items:
- Add eager loading to user dashboard query
- Implement pagination for dashboard data
- Add database indexes for performance
- Write performance test for dashboard endpoint
- Update frontend to handle paginated data

📋 5 tasks added to internal todo list
```

### Example 3: After Planning Discussion
```
Human: "I want to migrate our REST API to a query-based API"
AI: "That's a big change. Should we do it gradually?"
Human: "Yes, start with user endpoints but keep REST for compatibility"
AI: "I'll create a hybrid approach with both API styles."
Developer: "/standup"

Result: AI saves implementation steps:
- Install query API framework dependencies
- Create API schema for user types
- Implement user query resolvers
- Set up query endpoint alongside REST
- Write integration tests for new API
- Update documentation for new endpoints

📋 6 tasks added to internal todo list
```

---

## Command Behavior Rules

### ALWAYS Do These:
- ✅ Extract concrete action items from the discussion
- ✅ Use TodoWrite to save tasks to internal todo list
- ✅ Break tasks into 15-30 minute chunks
- ✅ Include file paths and specific details
- ✅ Prioritize tasks in logical order

### NEVER Do These:
- ❌ Create vague or untestable tasks
- ❌ Skip obvious implementation steps
- ❌ Forget to use TodoWrite to save the list
- ❌ Make tasks too large or complex
- ❌ Ignore dependencies or prerequisites

### Focus Areas:
- 🎯 **Extract**: Pull concrete next steps from discussion
- 🎯 **Clarify**: Make each task specific and actionable
- 🎯 **Save**: Use TodoWrite to store in agent's todo list
- 🎯 **Present**: Show what was captured for verification

