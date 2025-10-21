---
name: research
description: Auto-launch pre-implementation research when unfamiliar features, libraries, or patterns are requested. Use when implementing new functionality that requires understanding approaches, integration strategies, or best practices.
allowed-tools: Task
---

# Research Skill - Auto-Dispatcher

**Purpose**: Detect when pre-implementation research is needed and auto-launch the research agent.

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
2. Is this unfamiliar/complex? → Launch research agent
3. Are there multiple approaches? → Launch research agent
```

## Decision Logic

**Show existing pattern** (known):
- Pattern exists in codebase
- Similar feature already implemented
- Just need to reference existing code

**Launch research agent** (unknown):
- Unfamiliar feature or technology
- New library integration
- Multiple possible approaches
- Need to study docs/examples
- Integration strategy unclear

## Auto-Launch Research Agent

When research is needed:

```
I've detected this requires pre-implementation research.

**Feature**: [what's being implemented]
**Unknowns**: [what we need to research]

Launching research agent to analyze approaches and create implementation plan...
```

Then launch the research agent using Task tool:

```
Task(
  subagent_type="research",
  description="Pre-implementation research",
  prompt="Conduct comprehensive research for implementing: [feature description].

  Research focus:
  - Evaluate implementation approaches
  - Study official documentation and examples
  - Analyze existing codebase patterns
  - Design integration strategy
  - Create actionable implementation plan

  Context: [relevant project context]"
)
```

## Post-Agent Summary

After agent completes, summarize key findings:

```markdown
🔬 **Research Complete**

**Recommended Approach**: [chosen solution]
**Integration Points**: [where it fits]
**Implementation Plan**: [step-by-step]
**Key Considerations**: [risks/trade-offs]
**Documentation**: `.docs/research/[session-id].md`
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
Skill: "OAuth integration requires research of approaches and patterns.
Launching research agent..."
[Launches research agent for comprehensive analysis]
```

**Example 3: Multiple Approaches - Launch Agent**
```
User: "Add real-time updates to dashboard"
Skill: "Multiple approaches possible (WebSockets, SSE, polling).
Launching research agent to evaluate options..."
[Launches research agent]
```

## Quick Pattern Recognition

Before launching agent, do **minimal** codebase check:

```bash
# Only if very quick (< 5 seconds)
grep -r "similar_pattern" --include="*.ts" src/ | head -3
```

If pattern found → Show it
If not found → Launch agent

## Key Points

- **Lightweight**: Skill does minimal checking (~20 lines)
- **Smart dispatch**: Shows existing patterns vs researches new
- **No heavy analysis**: Delegates comprehensive research to agent
- **Autonomous**: Auto-launches when research needed
- **Clean context**: Main session stays focused on implementation

This ensures thorough research happens in separate context while main session remains clean.
