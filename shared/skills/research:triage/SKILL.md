---
name: research:triage
description: Scope assessment for RESEARCH — routes to GUIDED or ORCHESTRATED
user-invocable: false
allowed-tools: Read, Bash, Skill
---

# Research Triage

Assess scope of a RESEARCH request and route to the appropriate workflow skill.

**Default: GUIDED.** Only escalate to ORCHESTRATED when specific signals are present.

## Orchestration Hint Override

If the user's prompt contains any of: "orchestrate", "full pipeline", "deep", "thorough" — route to ORCHESTRATED immediately.

## Scope Assessment

Check for ORCHESTRATED signals (any one is sufficient):

1. **Multi-type research** — Prompt asks to "compare X and Y", "evaluate alternatives", or spans multiple research dimensions (codebase + external + market)
2. **Market/competitor analysis** — Prompt mentions "market", "competitor", "landscape", "positioning"
3. **Comprehensive scope** — Prompt requests "comprehensive", "multi-perspective", "full analysis"

If no ORCHESTRATED signals detected, or if any check errors → GUIDED.

## Route

Emit: `Scope: GUIDED` or `Scope: ORCHESTRATED`

Load the target skill via Skill tool:
- GUIDED → `devflow:research:guided`
- ORCHESTRATED → `devflow:research:orch`
