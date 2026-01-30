---
allowed-tools: Task, Write, TodoWrite
description: Create a development log entry capturing current project state and context
---

# Devlog Command

Create a comprehensive development log that captures session context, project state, and next steps. Serves as a time capsule for returning to this project later.

## Usage

```
/devlog              (create full status document)
/devlog --compact    (quick summary only)
```

## Input

No arguments required. Command analyzes current conversation and project state.

## Phases

### Phase 1: Capture Session Context

Extract from current conversation (inline, not delegated):
- Current todo list state (for session continuity)
- What we were working on (main feature/task)
- Problems solved and how
- Decisions made with rationale
- Next steps identified

### Phase 2: Analyze Project State

Spawn Devlog agent for codebase analysis:

```
Task(subagent_type="Devlog"):
"Analyze the current project state including:
- Git history and recent commits
- Recently modified files
- Pending work (TODOs, FIXMEs, HACKs)
- Documentation structure
- Technology stack
- Code statistics

Return structured data for status documentation."
```

### Phase 3: Synthesize and Write

Combine session context (Phase 1) with agent analysis (Phase 2).

Write documents:
- Full: `.docs/status/{timestamp}.md`
- Compact: `.docs/status/compact/{timestamp}.md`
- Update: `.docs/status/INDEX.md`

### Phase 4: Confirm

Report files created with summary of what was captured.

## Output Format

**Full Status Document** includes:
- Current Focus (from conversation)
- Project State (from agent: git, files, TODOs)
- Architecture & Design (decisions from session)
- Known Issues & Technical Debt
- Agent Todo List State (JSON for recreation)
- Next Steps (immediate, short-term, long-term)
- Context for Future Developer
- Related Documents

**Compact Summary** includes:
- Focus (one-line)
- Key Accomplishments (top 3)
- Critical Decisions (top 3)
- Next Priority Actions (top 3)
- Key Files Modified (top 5)

## Architecture

```
/devlog (orchestrator)
│
├─ Phase 1: Capture Session Context (inline)
│  ├─ Read current todo list state
│  ├─ Analyze conversation for work/decisions/blockers
│  └─ Extract next steps
│
├─ Phase 2: Analyze Project State
│  └─ Devlog agent (git, files, TODOs, tech stack)
│
├─ Phase 3: Synthesize and Write
│  ├─ Full: .docs/status/{timestamp}.md
│  ├─ Compact: .docs/status/compact/{timestamp}.md
│  └─ Index: .docs/status/INDEX.md
│
└─ Phase 4: Confirm creation
```

## Principles

1. **Session continuity** - Preserve todo list state for next session
2. **Two audiences** - Full for deep context, compact for quick reference
3. **Inline + agent** - Session context inline, codebase analysis delegated
4. **Time capsule** - Document for returning after weeks away
5. **Enable /catch-up** - Output must be parseable for context restoration

## Related

- `/catch-up` - Restore context from status documents
- Devlog agent - Handles codebase analysis
