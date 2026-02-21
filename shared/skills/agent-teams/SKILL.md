---
name: agent-teams
description: This skill should be used when the user asks to "create an agent team", "spawn teammates", "set up debate protocol", "coordinate agents", or discusses peer-to-peer agent collaboration, consensus formation, or team-based workflows. Provides patterns for team spawning, message passing, adversarial debate, and quality gates driven by multi-agent consensus.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Agent Teams Patterns

Patterns for collaborative multi-agent workflows using Claude Code's Agent Teams feature. Teams enable peer-to-peer communication between agents, replacing one-way subagent reporting with adversarial debate and consensus.

## Iron Law

> **TEAMMATES CHALLENGE EACH OTHER**
>
> Every finding must survive peer scrutiny. No unchallenged claims reach the final
> report. A single agent's opinion is a hypothesis; consensus from debate is a finding.

---

## When This Activates

- Creating agent teams for review, implementation, or debugging
- Spawning teammates with distinct perspectives
- Coordinating multi-agent debate rounds
- Forming consensus from conflicting findings

## Core Patterns

### Team Spawning

Size team to task complexity. Assign distinct, non-overlapping perspectives.

| Task Complexity | Team Size | Rationale |
|----------------|-----------|-----------|
| Simple review | 2-3 | Security + architecture sufficient |
| Full review | 4-5 | Core perspectives covered |
| Debug investigation | 3-5 | One per hypothesis |
| Implementation | 2-4 | Domain-separated work units |
| Specification | 3-4 | Debate requirements before user gates |
| Resolution | 2-4 | Cross-validate fixes across batches |

**Model guidance**: Explorers/Reviewers inherit parent model. Validators use `model: haiku`.

### Detection and Fallback

Attempt `TeamCreate`. If it fails or the tool is unavailable, fall back to parallel subagents:

```
try TeamCreate → success → proceed with team workflow
                → failure → fall back to parallel Task() calls
```

Always document which mode was used in the final report.

### Task List Coordination

Use `TaskCreate` to give each teammate a trackable work unit. Lead checks `TaskList` for structured progress visibility beyond ad-hoc messages:

```
1. Lead creates tasks for each teammate's work unit
2. Teammates claim tasks via TaskUpdate (owner: self)
3. Teammates mark tasks completed when done
4. Lead checks TaskList before proceeding to next phase
```

### Challenge Protocol

1. **Initial work**: Each teammate completes independent analysis
2. **Exchange**: Lead broadcasts "Share findings and challenge others"
3. **Direct debate**: Teammates message each other with evidence
4. **Resolution**: Contradictions resolved through 1-2 exchanges
5. **Escalation**: Unresolved after 2 exchanges → report disagreement to lead

### Consensus Formation

| Agreement Level | Confidence | Report As |
|----------------|------------|-----------|
| Unanimous | HIGH | Confirmed finding |
| Majority (>50%) | MEDIUM | Finding with noted dissent |
| Split (50/50) | LOW | Disagreement with both perspectives |

### Team Cleanup

Lead MUST always handle cleanup:
1. Ensure all teammates have completed or been shut down
2. Call `TeamDelete` to release resources
3. Verify no orphaned sessions remain
4. **CRITICAL**: Confirm cleanup completed before creating next team

---

## Limitations

| Limitation | Impact | Guidance |
|-----------|--------|----------|
| One team per session | Cannot run two teams concurrently | Shut down and verify cleanup before creating next team |
| No nested teams | Teammates cannot spawn sub-teams | Keep hierarchy flat; only lead creates teams |
| No session resumption | Teammate state lost if interrupted | Start fresh; don't rely on teammate state persistence |
| Shutdown can be slow | Cleanup may take several seconds | Wait for confirmation; don't race to create next team |
| Task status may lag | Task list updates aren't instant | Use direct messages for time-sensitive coordination |
| Permissions inherited | Teammates get lead's permissions at spawn | Cannot escalate permissions mid-session |

---

## Anti-Patterns

| Anti-Pattern | Correct Approach |
|-------------|-----------------|
| Overlapping perspectives | Assign distinct, non-overlapping focus areas |
| Skipping debate round | Always require peer challenge before synthesis |
| Unlimited debate | Cap at 2 exchanges per topic, then escalate |
| Lead does analysis work | Lead coordinates only; teammates do analysis |
| Ignoring minority opinion | Report dissent with evidence in final output |
| Creating team before prior cleanup | Wait for TeamDelete confirmation, then create |
| Messaging-only coordination | Use task list for structured progress tracking |

---

## Extended References

- `references/team-patterns.md` - Team structures for review, implement, debug, specify, resolve workflows
- `references/communication.md` - Message protocols, broadcast patterns, debate formats
- `references/cleanup.md` - Session management, orphan detection, resource cleanup
