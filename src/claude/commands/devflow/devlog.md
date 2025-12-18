---
allowed-tools: Task, Write, TodoWrite
description: Create a development log entry capturing current project state and context
---

## Your task

Create a comprehensive development log entry that captures the current state of the project, recent work, decisions made, and what's left to do. This serves as a time capsule for any developer (including yourself) returning to this project later.

**Architecture**: Session context (inline) + Project state (agent) → Synthesized documentation

---

## Step 1: Capture Session Context

**CRITICAL**: Capture session-local data that only the main session has access to.

### 1.1 Get Current Todo List State

Use TodoWrite to get the current todo list state. This MUST be preserved for session continuity:

```json
{Current todo list with exact status of all tasks}
```

**Document**:
- All current todos with content, status, activeForm
- Summary counts (pending, in_progress, completed)
- Current active task
- Next priority

### 1.2 Analyze Current Conversation

Review the current conversation to extract:

**What We Were Working On:**
- Main feature/task being developed
- Specific goals of this session

**Problems Solved:**
- Issues encountered and how they were resolved
- Blockers that were removed
- Bugs fixed

**Decisions Made:**
- Technical decisions with rationale
- Alternatives considered and why rejected
- Architecture or design choices

**Session Metadata:**
- Estimated complexity (Simple/Medium/Complex)
- Original user request
- Approach taken

### 1.3 Extract Next Steps

From the conversation, identify:
- Immediate tasks for next session
- Short-term goals (this week)
- Long-term goals (this month)

---

## Step 2: Launch Project State Agent

Launch the `ProjectState` agent to gather comprehensive codebase analysis:

```
Task(
  subagent_type="ProjectState",
  description="Analyze project state",
  prompt="Analyze the current project state including:
  - Git history and recent commits
  - Recently modified files
  - Pending work (TODOs, FIXMEs, HACKs)
  - Documentation structure
  - Technology stack
  - Dependencies
  - Code statistics

  Return structured data for status documentation."
)
```

The agent will analyze and return:
- Git history (commits, branch, status)
- Recent file changes
- TODO/FIXME/HACK markers
- Documentation structure
- Tech stack detection
- Dependencies overview
- Code statistics

---

## Step 3: Synthesize Comprehensive Status Document

After the agent completes, synthesize session context + agent data.

### 3.1 Prepare Data

Extract from agent output:
- Git log → Recent Changes section
- File changes → Files Modified section
- TODOs → Known Issues section
- Documentation → Related Documents section
- Tech stack → Technology Stack section

Combine with session context:
- Current Focus → From conversation analysis
- Problems Solved → From session
- Decisions Made → From session
- Todo List State → From TodoWrite
- Next Steps → From conversation

### 3.2 Generate Timestamp and Paths

```bash
# Get timestamp
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
DATE=$(date +"%Y-%m-%d")
PROJECT_NAME=$(basename $(pwd))
```

Paths:
- Full: `.docs/status/${TIMESTAMP}.md`
- Compact: `.docs/status/compact/${TIMESTAMP}.md`
- Index: `.docs/status/INDEX.md`

---

## Step 4: Write Comprehensive Status Document

Create `.docs/status/${TIMESTAMP}.md` with:

```markdown
# Project Status - ${PROJECT_NAME}
**Date**: ${DATE}
**Time**: ${TIME}
**Author**: Claude (AI Assistant)
**Session Context**: {Brief description from conversation}

---

## 🎯 Current Focus

### What We Were Working On
{From conversation analysis - detailed description}

### Problems Solved Today
{From conversation - list with solutions}

### Decisions Made
{From conversation - decisions with rationale and alternatives}

---

## 📊 Project State

### Recent Changes
{From agent - git log}

### Files Modified Recently
{From agent - recent file changes with analysis}

### Current Branch
{From agent - branch name and status}

---

## 🏗️ Architecture & Design

### Key Architectural Decisions
{From conversation - patterns and decisions from session}

### Technology Stack
{From agent - detected tech stack}

### Design Patterns in Use
{From conversation + existing docs}

---

## ⚠️ Known Issues & Technical Debt

### Critical Issues
{From conversation - issues discussed}

### Technical Debt
{From conversation - debt mentioned}

### TODOs in Codebase
{From agent - TODO/FIXME/HACK analysis}

---

## 📋 Agent Todo List State

**CRITICAL**: Preserves agent's internal todo list for session continuity.

### Current Todo List (for recreation)
```json
{Exact TodoWrite JSON from Step 1}
```

### Todo Summary
- **Total tasks**: {count}
- **Pending**: {count}
- **In Progress**: {count}
- **Completed**: {count}

### Key Active Tasks
- 🔄 **In Progress**: {current active task}
- ⏳ **Next Priority**: {next pending task}

---

## 🚀 Next Steps

### Immediate (Next Session)
- [ ] **FIRST**: Recreate agent todo list using TodoWrite with preserved state above
{From conversation - immediate tasks}

### Short Term (This Week)
{From conversation - short term goals}

### Long Term (This Month)
{From conversation - long term goals}

---

## 💡 Context for Future Developer

### Things to Know
{From conversation - gotchas, conventions, non-obvious things}

### Where to Start
{Guidance for picking up this work}

### Key Files to Understand
{From conversation + agent file analysis}

### Testing Strategy
{From agent - test detection and conversation}

---

## 🔗 Related Documents

### Project Documentation
{From agent - README, CONTRIBUTING, ARCHITECTURE status}

### DevFlow Documentation
{From agent - .docs/ structure}

### Previous Status Notes
{Link to previous status documents}

---

## 📝 Raw Session Notes

### What the User Asked For
{From conversation - original request}

### Approach Taken
{From conversation - what was done}

### Challenges Encountered
{From conversation - difficulties and resolutions}

### Time Spent
- Estimated session duration: {infer from context}
- Complexity level: {Simple/Medium/Complex}

---

## 🤖 AI Assistant Metadata

### Model Used
- Model: Claude Sonnet 4.5
- Session type: {Regular/Continued/Catch-up}

### Commands/Tools Used
{From conversation - which DevFlow commands were used}

---

## 📌 Final Thoughts

{A brief paragraph from the perspective of leaving a note to future self or colleague. Written in first person with context, advice, and warnings.}

**Remember**: This is a snapshot in time. The project will have evolved since this was written. Use this as a starting point for understanding, not as gospel truth.

---
*This document was auto-generated by the `/devlog` command*
*To generate a new status report, run `/devlog` in Claude Code*
```

---

## Step 5: Write Compact Summary

Create `.docs/status/compact/${TIMESTAMP}.md`:

```markdown
# Compact Status - ${DATE}

**Focus**: {One-line summary from conversation}

**Key Accomplishments**:
{Top 3 accomplishments from session}

**Critical Decisions**:
{Top 2-3 decisions with brief rationale}

**Next Priority Actions**:
{Top 3 immediate todos}

**Critical Issues**:
{Top 2 blockers or issues}

**Key Files Modified**:
{Top 5 files from agent analysis}

**Context Notes**:
{2-3 sentences of essential context for future sessions}

---
*Quick summary of [full status](./../${TIMESTAMP}.md)*
```

---

## Step 6: Update Status Index

Update or create `.docs/status/INDEX.md`:

```markdown
# Status Document Index

## Quick Reference
- Latest session: ${DATE} ${TIME}

## Recent Status Reports

| Date | Time | Focus | Full | Compact |
|------|------|-------|------|---------|
| ${DATE} | ${TIME} | {Brief from conversation} | [Full](./${TIMESTAMP}.md) | [Quick](./compact/${TIMESTAMP}.md) |
{Keep previous 10 entries}

## Usage
- **Starting a session?** → Use `/catch-up` command
- **Ending a session?** → Use `/devlog` to document progress
- **Need full context?** → Read the full status documents
- **Quick reference?** → Use compact versions
```

---

## Step 7: Confirm Creation

Provide confirmation to user:

```markdown
📝 **Development Log Created**

**Full Status**: `.docs/status/${TIMESTAMP}.md`
**Compact**: `.docs/status/compact/${TIMESTAMP}.md`
**Index**: `.docs/status/INDEX.md`

### Captured
- ✅ Session conversation and decisions
- ✅ Current todo list state (for continuity)
- ✅ Project state analysis from agent
- ✅ {X} commits, {Y} files modified
- ✅ {Z} TODOs/FIXMEs tracked
- ✅ Next steps documented

### Next Session
Run `/catch-up` to restore context and recreate todo list.

{Brief 2-3 sentence summary of what was accomplished this session}
```

---

## Important Notes

**What Stays Inline:**
- Todo list capture (session state)
- Conversation analysis (session context)
- Document synthesis and writing

**What Agent Handles:**
- Git history analysis
- File change detection
- TODO/FIXME scanning
- Documentation structure
- Tech stack detection

**Benefits:**
- Main session stays focused on conversation
- Heavy codebase analysis offloaded to agent
- Clean separation: session context vs project state
- Agent can evolve independently

The goal is to create a time capsule that will be genuinely useful when someone (maybe you!) returns to this project after weeks or months away.
