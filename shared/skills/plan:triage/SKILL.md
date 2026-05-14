---
name: plan:triage
description: Scope assessment for PLAN — routes to GUIDED or ORCHESTRATED
user-invocable: false
allowed-tools: Read, Bash, Skill
---

# Plan Triage

Assess scope of a PLAN request and route to the appropriate workflow skill.

**Default: GUIDED.** Only escalate to ORCHESTRATED when specific signals are present.

## Orchestration Hint Override

If the user's prompt contains any of: "orchestrate", "full pipeline", "deep", "thorough" — route to ORCHESTRATED immediately.

## Scope Assessment

Check for ORCHESTRATED signals (any one is sufficient):

1. **Multi-module scope** — Prompt mentions multiple modules, services, or "system-level"
2. **Complex issue** — If prompt references an issue (`#NNN`), peek at body: `gh issue view NNN --json body --jq '.body[0:500]' 2>/dev/null`. Complex = >3 acceptance criteria (checkbox items)
3. **Architectural scope** — Prompt contains "redesign", "rearchitect", "migration", "multi-service"

If no ORCHESTRATED signals detected, or if any check errors → GUIDED.

## Route

Emit: `Scope: GUIDED` or `Scope: ORCHESTRATED`

Load the target skill via Skill tool:
- GUIDED → `devflow:plan:guided`
- ORCHESTRATED → `devflow:plan:orch`
