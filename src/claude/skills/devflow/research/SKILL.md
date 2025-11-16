---
name: research
description: Auto-launch pre-implementation research when unfamiliar features, libraries, or patterns are requested. Use when implementing new functionality that requires understanding approaches, integration strategies, or best practices.
allowed-tools: Task
---

# Research Skill - Auto-Dispatcher

**Purpose**: Detect when pre-implementation research is needed and auto-launch the brainstorm agent for exploration.

## When to Activate

Auto-activates when:
- Unfamiliar features or technologies requested
- New libraries or frameworks need integration
- Multiple implementation approaches possible
- User asks "how should I implement..."
- Integration strategy unclear
- Best practices unknown for this codebase

## Lightweight Assessment

```markdown
Quick check (don't do heavy research):
1. Is this pattern already in codebase? → Show example
2. Is this unfamiliar/complex? → Launch brainstorm agent
3. Are there multiple approaches? → Launch brainstorm agent
```

## Decision Logic

**Show existing pattern** (known):
- Pattern exists in codebase
- Similar feature already implemented
- Just need to reference existing code

**Launch brainstorm agent** (unknown):
- Unfamiliar feature or technology
- New library integration
- Multiple possible approaches
- Need to study docs/examples
- Integration strategy unclear

## Auto-Launch Brainstorm Agent

When research is needed:

```
I've detected this requires pre-implementation research.

**Feature**: [what's being implemented]
**Unknowns**: [what we need to explore]

Launching brainstorm agent to explore approaches and patterns...
```

Then launch the brainstorm agent using Task tool:

```
Task(
  subagent_type="brainstorm",
  description="Explore implementation approaches",
  prompt="Explore implementation approaches for: [feature description].

  Focus on:
  - What approaches exist for this problem?
  - What are the trade-offs of each approach?
  - What patterns are already in the codebase?
  - What libraries/frameworks could help?
  - What are the risks and edge cases?

  Context: [relevant project context]"
)
```

## Post-Agent Summary

After agent completes, summarize key findings:

```markdown
**Exploration Complete**

**Approaches Found**: [list of options]
**Codebase Patterns**: [relevant existing patterns]
**Recommended Direction**: [suggested approach]
**Trade-offs**: [key considerations]
**Documentation**: `.docs/brainstorm/[topic-slug]-[timestamp].md`

**Next Step**: Run `/design` to create detailed implementation plan for chosen approach.
```

## Examples

**Example 1: Known Pattern - Show Inline**
```
User: "I need to add validation to this endpoint"
Skill: "We already use this pattern. See src/api/users.ts:45
[Shows existing validation pattern, no agent needed]
```

**Example 2: Unfamiliar - Launch Agent**
```
User: "Add OAuth authentication"
Skill: "OAuth integration requires exploration of approaches.
Launching brainstorm agent..."
[Launches brainstorm agent for approach exploration]
```

**Example 3: Multiple Approaches - Launch Agent**
```
User: "Add real-time updates to dashboard"
Skill: "Multiple approaches possible (WebSockets, SSE, polling).
Launching brainstorm agent to explore options..."
[Launches brainstorm agent]
```

## Quick Pattern Recognition

Before launching agent, do **minimal** codebase check:

```bash
# Only if very quick (< 5 seconds)
grep -r "similar_pattern" --include="*.ts" src/ | head -3
```

If pattern found → Show it
If not found → Launch brainstorm agent

## Key Points

- **Lightweight**: Skill does minimal checking
- **Smart dispatch**: Shows existing patterns vs explores new options
- **Exploration focus**: Brainstorm agent explores approaches, not detailed planning
- **Autonomous**: Auto-launches when research needed
- **Clean context**: Main session stays focused on implementation
- **Next step guidance**: Suggests `/design` after exploration completes

This ensures thorough exploration happens in separate context while main session remains clean. For detailed implementation planning, use `/design` after exploration.
