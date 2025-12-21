---
name: devflow-research
description: Auto-launch pre-implementation research when unfamiliar features, libraries, or patterns are requested. Use when implementing new functionality that requires understanding approaches, integration strategies, or best practices.
allowed-tools: Task
---

# Research Skill - Auto-Dispatcher

**Purpose**: Detect when pre-implementation research is needed and auto-launch the Explore agent for codebase analysis.

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
2. Is this unfamiliar/complex? → Launch Explore agent
3. Are there multiple approaches? → Launch Explore agent
```

## Decision Logic

**Show existing pattern** (known):
- Pattern exists in codebase
- Similar feature already implemented
- Just need to reference existing code

**Launch Explore agent** (unknown):
- Unfamiliar feature or technology
- New library integration
- Multiple possible approaches
- Need to study docs/examples
- Integration strategy unclear

## Auto-Launch Explore Agent

When research is needed:

```
I've detected this requires pre-implementation research.

**Feature**: [what's being implemented]
**Unknowns**: [what we need to explore]

Launching Explore agent to analyze codebase patterns...
```

Then launch the Explore agent using Task tool:

```
Task(
  subagent_type="Explore",
  description="Explore implementation approaches",
  prompt="Explore the codebase to understand how to implement: [feature description].

  Find:
  1. Similar existing implementations to reference
  2. Patterns already in use (Result types, DI, error handling)
  3. Libraries/frameworks available
  4. Integration points for this feature
  5. Testing patterns to follow

  Thoroughness: very thorough

  Context: [relevant project context]"
)
```

## Post-Agent Summary

After agent completes, summarize key findings:

```markdown
**Exploration Complete**

**Existing Patterns**: [patterns found in codebase]
**Similar Implementations**: [related features to reference]
**Integration Points**: [where this connects]
**Recommended Approach**: [suggested direction based on findings]

**Next Step**: Run `/design` to create detailed implementation plan.
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
Launching Explore agent..."
[Launches Explore agent for codebase analysis]
```

**Example 3: Multiple Approaches - Launch Agent**
```
User: "Add real-time updates to dashboard"
Skill: "Multiple approaches possible (WebSockets, SSE, polling).
Launching Explore agent to find existing patterns..."
[Launches Explore agent]
```

## Quick Pattern Recognition

Before launching agent, do **minimal** codebase check:

```bash
# Only if very quick (< 5 seconds)
grep -r "similar_pattern" --include="*.ts" src/ | head -3
```

If pattern found → Show it
If not found → Launch Explore agent

## Key Points

- **Lightweight**: Skill does minimal checking
- **Smart dispatch**: Shows existing patterns vs explores codebase
- **Exploration focus**: Explore agent finds patterns, not detailed planning
- **Autonomous**: Auto-launches when research needed
- **Clean context**: Main session stays focused on implementation
- **Next step guidance**: Suggests `/design` after exploration completes

This ensures thorough exploration happens in separate context while main session remains clean. For detailed implementation planning, use `/design` after exploration.
