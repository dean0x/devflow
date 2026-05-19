---
name: implement:triage
description: Scope assessment for IMPLEMENT — routes to GUIDED or ORCHESTRATED
user-invocable: false
allowed-tools: Read, Bash, Skill
---

# Implement Triage

Assess scope of an IMPLEMENT request and route to the appropriate workflow skill.

**Default: GUIDED.** Only escalate to ORCHESTRATED when specific signals are present.

## Orchestration Hint Override

If the user's prompt contains any of: "orchestrate", "full pipeline", "deep", "thorough" — route to ORCHESTRATED immediately.

## Scope Assessment

Check for ORCHESTRATED signals (any one is sufficient):

1. **Plan artifact exists** — Check `.devflow/docs/design/` for a plan document relevant to this task
2. **Complex GitHub issue** — If prompt references an issue (`#NNN`), peek at body: `gh issue view NNN --json body,labels --jq '{body: .body[0:500], labels: [.labels[].name]}' 2>/dev/null`. Complex = >200 chars body OR >3 labels
3. **Multi-file scope** — Prompt mentions >2 specific files or paths
4. **Multi-module language** — Prompt contains "across modules", "system-wide", "multi-service", "end to end", "full stack"

If no ORCHESTRATED signals detected, or if any check errors (e.g., `gh` fails) → GUIDED.

## Route

Emit: `Scope: GUIDED` or `Scope: ORCHESTRATED`

Load the target skill via Skill tool:
- GUIDED → `devflow:implement:guided`
- ORCHESTRATED → `devflow:implement:orch`
