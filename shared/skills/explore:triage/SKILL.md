---
name: explore:triage
description: Scope assessment for EXPLORE — routes to GUIDED or ORCHESTRATED
user-invocable: false
allowed-tools: Read, Bash, Skill
---

# Explore Triage

Assess scope of an EXPLORE request and route to the appropriate workflow skill.

**Default: GUIDED.** Only escalate to ORCHESTRATED when specific signals are present.

## Orchestration Hint Override

If the user's prompt contains any of: "orchestrate", "full pipeline", "deep", "thorough" — route to ORCHESTRATED immediately.

## Scope Assessment

Check for ORCHESTRATED signals (any one is sufficient):

1. **Cross-module mapping** — Prompt asks to "map", "trace across", or "architecture" spanning multiple modules or the whole system
2. **Flow tracing across boundaries** — "how does X interact with Y", "data flow from A to B" where A and B are in different modules
3. **System-level exploration** — "full architecture", "complete overview", "all hooks", "every module"

If no ORCHESTRATED signals detected, or if any check errors → GUIDED.

## Route

Emit: `Scope: GUIDED` or `Scope: ORCHESTRATED`

Load the target skill via Skill tool:
- GUIDED → `devflow:explore:guided`
- ORCHESTRATED → `devflow:explore:orch`
