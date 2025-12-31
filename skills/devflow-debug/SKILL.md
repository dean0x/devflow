---
name: devflow-debug
description: Auto-launch systematic debugging when errors, crashes, or failures occur. Use when encountering exceptions, failed tests, build errors, or unexpected behavior that needs investigation.
allowed-tools: Task
---

# Debug Skill - Auto-Dispatcher

**Purpose**: Detect when systematic debugging is needed and auto-launch the debug agent.

## Iron Law

> **NO FIXES WITHOUT ROOT CAUSE INVESTIGATION**
>
> Gather evidence BEFORE hypothesizing. "Just try this" is forbidden. Every fix must
> be preceded by: (1) reproduction, (2) evidence gathering, (3) hypothesis formation.
> Guessing at fixes wastes time and introduces new bugs.

## When to Activate

Auto-activates when:
- Errors or exceptions encountered
- Tests failing
- Build/compilation errors
- Application crashes
- Unexpected behavior needs investigation
- User mentions "broken", "not working", "failing"

## Lightweight Assessment

```markdown
Quick check (don't do heavy analysis):
1. Is this a simple typo/syntax error? → Fix inline
2. Is this a complex/unclear issue? → Launch debug agent
3. Are there multiple potential causes? → Launch debug agent
```

## Decision Logic

**Fix inline** (simple issues):
- Syntax errors with clear fix
- Typos in variable names
- Missing imports
- Simple logic errors

**Launch debug agent** (complex issues):
- Unknown root cause
- Multiple symptoms
- Intermittent failures
- Performance degradation
- System-level issues
- Requires investigation

## Auto-Launch Debug Agent

When debugging is needed:

```
I've detected [error type] that requires systematic debugging.

**Issue**: [brief description]
**Symptoms**: [what's happening]

Launching debug agent for systematic investigation...
```

Then launch the debug agent using Task tool:

```
Task(
  subagent_type="debug",
  description="Debug systematic analysis",
  prompt="Systematically debug the following issue: [issue description].

  Current symptoms: [symptoms]
  Error messages: [if any]
  Context: [relevant context]"
)
```

## Post-Agent Summary

After agent completes, summarize key findings:

```markdown
🔍 **Debug Session Complete**

**Root Cause**: [from agent findings]
**Fix Applied**: [solution]
**Prevention**: [how to avoid]
**Documentation**: `.docs/debug/[session-id].md`
```

## Examples

**Example 1: Simple - Fix Inline**
```
User: "Getting error: Cannot find module 'fs'"
Skill: "Missing import. Adding: import fs from 'fs'"
[Fixes inline, no agent needed]
```

**Example 2: Complex - Launch Agent**
```
User: "Tests passing locally but failing in CI"
Skill: "This requires investigation of environment differences.
Launching debug agent..."
[Launches debug agent for systematic analysis]
```

**Example 3: Unclear - Launch Agent**
```
User: "App crashes randomly after 5 minutes"
Skill: "Intermittent crash requires systematic debugging.
Launching debug agent to investigate..."
[Launches debug agent]
```

## Key Points

- **Lightweight**: Skill does minimal assessment (~20 lines)
- **Smart dispatch**: Knows when to fix vs investigate
- **No heavy analysis**: Delegates to debug agent
- **Autonomous**: Auto-launches without asking
- **Clean context**: Main session stays focused

This keeps the main session clean while ensuring systematic debugging happens when needed.
