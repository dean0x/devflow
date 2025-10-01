---
allowed-tools: Bash, Read, Grep, Glob, Write, TodoWrite, Task
description: Summarize current conversation context to help future developers understand project state
---

## Your task

Create a comprehensive "Note to Future Self" document that captures the current state of the project, recent work, decisions made, and what's left to do. This serves as a time capsule for any developer (including yourself) returning to this project later.

### Step 1: Capture Agent's Internal Todo List

**CRITICAL FIRST STEP**: Before doing anything else, capture the agent's current internal todo list state.

Use TodoWrite to dump the current todo list, then immediately document it:

```bash
# This will be the current todo list that needs to be preserved
# The agent should use TodoWrite to get their current state
```

**MANDATORY**: Document ALL current todos with their exact status:
- content (exact task description)
- status (pending/in_progress/completed)
- activeForm (present tense description)

This state MUST be preserved so future sessions can recreate the todo list exactly.

### Step 2: Gather Context

Determine the current date/time and project information:

```bash
# Get current date in DD-MM-YYYY format
DATE=$(date +"%d-%m-%Y")
TIME=$(date +"%H%M")
TIMESTAMP="${DATE}_${TIME}"

# Get project name from current directory
PROJECT_NAME=$(basename $(pwd))

# Create docs directory if it doesn't exist
mkdir -p .docs/status
```

### Step 3: Analyze Current Conversation

Review the current conversation context to understand:
- What was being worked on
- What problems were solved
- What decisions were made
- What's still pending

### Step 4: Gather Project State

Analyze the current project state:

```bash
# Recent git activity
git log --oneline -10 2>/dev/null || echo "No git history"

# Current branch and status
git branch --show-current 2>/dev/null
git status --short 2>/dev/null

# Recent file changes
find . -type f -mtime -1 -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/venv/*" -not -path "*/target/*" -not -path "*/build/*" 2>/dev/null | head -20

# Check for TODO/FIXME comments across common source file extensions
grep -r "TODO\|FIXME\|HACK\|XXX" \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --include="*.py" --include="*.go" --include="*.rs" --include="*.java" \
  --include="*.c" --include="*.cpp" --include="*.h" --include="*.hpp" \
  --include="*.rb" --include="*.php" --include="*.swift" --include="*.kt" \
  -l 2>/dev/null | head -10
```

### Step 5: Check Documentation

Look for existing project documentation to understand:
- Architecture decisions (ARCHITECTURE.md, ADR/)
- README status
- API documentation
- Any existing notes

### Step 6: Generate Comprehensive Status Document

Create `.docs/status/{timestamp}.md` with the following structure:

```markdown
# Project Status - {PROJECT_NAME}
**Date**: {DATE}
**Time**: {TIME}
**Author**: Claude (AI Assistant)
**Session Context**: {Brief description of what was being worked on}

---

## 🎯 Current Focus

### What We Were Working On
{Detailed description of the current task/feature being developed}

### Problems Solved Today
1. {Problem 1 and solution}
2. {Problem 2 and solution}
3. {Problem 3 and solution}

### Decisions Made
- **Decision**: {What was decided}
  **Rationale**: {Why this approach}
  **Alternatives Considered**: {Other options that were rejected}

---

## 📊 Project State

### Recent Changes
```
{Git log showing recent commits}
```

### Files Modified Recently
- `path/to/file1` - {What was changed and why}
- `path/to/file2` - {What was changed and why}

### Current Branch
- Branch: `{branch_name}`
- Status: {Clean/Dirty with uncommitted changes}

---

## 🏗️ Architecture & Design

### Key Architectural Decisions
1. {Pattern/Decision 1}
   - Why: {Rationale}
   - Impact: {How it affects the codebase}

2. {Pattern/Decision 2}
   - Why: {Rationale}
   - Impact: {How it affects the codebase}

### Technology Stack
- **Language**: {Primary programming language}
- **Framework**: {Main framework or runtime}
- **Data Storage**: {Database or storage system}
- **Key Dependencies**: {Critical libraries or packages}

### Design Patterns in Use
- {Pattern 1}: {Where and why}
- {Pattern 2}: {Where and why}

---

## ⚠️ Known Issues & Technical Debt

### Critical Issues
1. {Issue description}
   - Location: `file/path`
   - Impact: {High/Medium/Low}
   - Suggested Fix: {Approach}

### Technical Debt
1. {Debt item}
   - Why it exists: {Historical reason}
   - Cost of fixing: {Estimate}
   - Priority: {High/Medium/Low}

### TODOs in Codebase
```
{List of files with TODO/FIXME comments}
```

---

## 📋 Agent Todo List State

**CRITICAL**: This section preserves the agent's internal todo list state for session continuity.

### Current Todo List (for recreation)
```json
{Exact TodoWrite JSON with all current todos}
```

### Todo Summary
- **Total tasks**: {count}
- **Pending**: {count of pending tasks}
- **In Progress**: {count of in_progress tasks}
- **Completed**: {count of completed tasks}

### Key Active Tasks
- 🔄 **In Progress**: {current active task}
- ⏳ **Next Priority**: {next pending task}

---

## 🚀 Next Steps

### Immediate (Next Session)
- [ ] **FIRST**: Recreate agent todo list using TodoWrite with preserved state above
- [ ] {Task 1 from conversation}
- [ ] {Task 2 from conversation}
- [ ] {Task 3 from conversation}

### Short Term (This Week)
- [ ] {Goal 1}
- [ ] {Goal 2}

### Long Term (This Month)
- [ ] {Major milestone 1}
- [ ] {Major milestone 2}

---

## 💡 Context for Future Developer

### Things to Know
1. **Gotcha #1**: {Something non-obvious}
2. **Gotcha #2**: {Another tricky thing}
3. **Convention**: {Project-specific convention}

### Where to Start
If you're picking this up later, here's where to begin:
1. Check {specific file/area}
2. Review {documentation}
3. Run {command} to verify setup

### Key Files to Understand
- `path/to/important/file1` - {Why it's important}
- `path/to/important/file2` - {Why it's important}

### Testing Strategy
- How to run tests: `{command}`
- Test coverage: {status}
- Critical test files: {list}

---

## 🔗 Related Documents

### Project Documentation
- README.md - {Status: Updated/Outdated/Missing}
- CONTRIBUTING.md - {Status}
- ARCHITECTURE.md - {Status}

### Previous Status Notes
{Link to previous status documents if they exist}

---

## 📝 Raw Session Notes

### What the User Asked For
{Original user request}

### Approach Taken
{Step-by-step what was done}

### Challenges Encountered
{Any difficulties and how they were resolved}

### Time Spent
- Estimated session duration: {from timestamp data if available}
- Complexity level: {Simple/Medium/Complex}

---

## 🤖 AI Assistant Metadata

### Model Used
- Model: {Claude model version}
- Capabilities: {What tools were available}
- Limitations encountered: {Any AI limitations that affected work}

### Commands/Tools Used
- {Tool 1}: {How it was used}
- {Tool 2}: {How it was used}

---

## 📌 Final Thoughts

{A brief paragraph of final thoughts, advice, or warnings for whoever picks this up next. Written in first person as if leaving a note to your future self or a colleague.}

**Remember**: This is a snapshot in time. The project will have evolved since this was written. Use this as a starting point for understanding, not as gospel truth.

---
*This document was auto-generated by the `/note-to-future-self` command*
*To generate a new status report, run `/note-to-future-self` in Claude Code*
```

### Step 7: Create Compact Version

Create a compact summary at `.docs/status/compact/{timestamp}.md`:

```markdown
# Compact Status - {DATE}

**Focus**: {One-line summary of what was worked on}

**Key Accomplishments**:
- {Accomplishment 1}
- {Accomplishment 2}
- {Accomplishment 3}

**Critical Decisions**:
- {Decision 1}: {Brief rationale}
- {Decision 2}: {Brief rationale}

**Next Priority Actions**:
- [ ] {Top priority task}
- [ ] {Second priority task}
- [ ] {Third priority task}

**Critical Issues**:
- {Blocker 1}: {One-line description}
- {Blocker 2}: {One-line description}

**Key Files Modified**:
- `{file1}` - {Brief change description}
- `{file2}` - {Brief change description}
- `{file3}` - {Brief change description}

**Context Notes**:
{2-3 sentences of essential context for future sessions}

---
*Quick summary of [full status](./../{timestamp}.md)*
```

### Step 8: Create Summary Index

Also update or create `.docs/status/INDEX.md` to list all status documents:

```markdown
# Status Document Index

## Quick Reference
- [Latest Catch-Up Summary](../CATCH_UP.md) - For getting back up to speed

## Recent Status Reports

| Date | Time | Focus | Full | Compact |
|------|------|-------|------|---------|
| {DATE} | {TIME} | {Brief description} | [Full](./{timestamp}.md) | [Quick](./compact/{timestamp}.md) |
{Previous entries...}

## Usage
- **Starting a session?** → Use `/catch-up` command or check latest compact status
- **Ending a session?** → Use `/note-to-future-self` to document progress
- **Need full context?** → Read the full status documents
- **Quick reference?** → Use compact versions
```

### Step 9: Confirm Creation

After creating the document, provide confirmation:
- Full path to the created document
- Brief summary of what was captured
- Suggestion to review and edit if needed

### Important Considerations

1. **Be Honest**: Include both successes and failures
2. **Be Specific**: Use actual file paths and function names
3. **Be Helpful**: Write as if explaining to someone unfamiliar with recent work
4. **Be Concise**: Balance detail with readability
5. **Include Context**: Explain the "why" behind decisions

The goal is to create a time capsule that will be genuinely useful when someone (maybe you!) returns to this project after weeks or months away.