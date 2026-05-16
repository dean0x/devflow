---
name: debug:triage
description: Scope assessment for DEBUG — routes to GUIDED or ORCHESTRATED
user-invocable: false
allowed-tools: Read, Bash, Skill
---

# Debug Triage

Assess scope of a DEBUG request and route to the appropriate workflow skill.

**Default: GUIDED.** Only escalate to ORCHESTRATED when specific signals are present.

## Orchestration Hint Override

If the user's prompt contains any of: "orchestrate", "full pipeline", "deep", "thorough" — route to ORCHESTRATED immediately.

## Scope Assessment

Check for ORCHESTRATED signals (any one is sufficient):

1. **Non-deterministic failure** — Prompt contains "intermittent", "flaky", "race condition", "sometimes", "random"
2. **Multiple suspected modules** — Prompt references 2+ distinct modules, services, or subsystems
3. **No clear error** — Prompt describes symptoms without a specific error message or stack trace
4. **Cross-boundary** — Prompt mentions failures spanning "queue", "worker", "API and database", or similar multi-layer scope

If no ORCHESTRATED signals detected, or if any check errors → GUIDED.

## Route

Emit: `Scope: GUIDED` or `Scope: ORCHESTRATED`

Load the target skill via Skill tool:
- GUIDED → `devflow:debug:guided`
- ORCHESTRATED → `devflow:debug:orch`
