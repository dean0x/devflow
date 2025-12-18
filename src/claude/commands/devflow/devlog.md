---
description: Create a development log entry capturing current project state and context
---

Create a development log capturing session context and project state.

---

## Step 1: Capture Session Context (Main Session Only)

**CRITICAL**: Only the main session has access to this data.

### 1.1 Current Todo List
Capture current todo list state using TodoWrite - this preserves session continuity.

### 1.2 Analyze Conversation
Extract from this session:
- What we were working on (main task, goals)
- Problems solved (issues, blockers, bugs fixed)
- Decisions made (technical choices, rationale, rejected alternatives)
- Next steps (immediate, short-term, long-term)

---

## Step 2: Launch ProjectState Agent

```
Task(subagent_type="ProjectState"):

"Analyze current project state:
- Git history and recent commits
- Recently modified files
- TODOs/FIXMEs/HACKs in codebase
- Documentation structure
- Technology stack
- Code statistics

Return structured data for status documentation."
```

---

## Step 3: Synthesize and Write

After agent completes, combine session context + agent data.

### Generate Paths
```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p .docs/status/compact
```

### Write Full Status
Save to `.docs/status/${TIMESTAMP}.md`:

```markdown
# Project Status - ${PROJECT_NAME}
**Date**: ${DATE}

## Current Focus
{From conversation: what we worked on, problems solved, decisions made}

## Project State
{From agent: git history, recent files, branch status}

## Todo List State
{JSON of current todos for session continuity}

## Next Steps
{Immediate, short-term, long-term from conversation}

## Context for Future Developer
{Gotchas, where to start, key files}
```

### Write Compact Summary
Save to `.docs/status/compact/${TIMESTAMP}.md`:

```markdown
# Compact Status - ${DATE}
**Focus**: {one-line}
**Accomplishments**: {top 3}
**Next Priority**: {top 3 todos}
**Key Files**: {top 5 modified}
```

### Update Index
Update `.docs/status/INDEX.md` with new entry.

---

## Confirm

```markdown
📝 Development Log Created

- Full: `.docs/status/${TIMESTAMP}.md`
- Compact: `.docs/status/compact/${TIMESTAMP}.md`

Next session: Run `/catch-up` to restore context.
```
