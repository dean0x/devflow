---
name: agent-teams
description: Agent Teams patterns for peer-to-peer agent collaboration, team spawning, debate protocols, and consensus formation
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

Use `model: haiku` for validation-only teammates to control costs.

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
2. Call cleanup to release resources
3. Verify no orphaned sessions remain

---

## Anti-Patterns

| Anti-Pattern | Correct Approach |
|-------------|-----------------|
| Overlapping perspectives | Assign distinct, non-overlapping focus areas |
| Skipping debate round | Always require peer challenge before synthesis |
| Unlimited debate | Cap at 2 exchanges per topic, then escalate |
| Lead does analysis work | Lead coordinates only; teammates do analysis |
| Ignoring minority opinion | Report dissent with evidence in final output |

---

## Extended References

- `references/team-patterns.md` - Team structures for review, implement, debug workflows
- `references/communication.md` - Message protocols, broadcast patterns, debate formats
- `references/cleanup.md` - Session management, orphan detection, resource cleanup
