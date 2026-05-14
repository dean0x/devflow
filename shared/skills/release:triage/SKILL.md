---
name: release:triage
description: Scope assessment for RELEASE — routes to GUIDED or ORCHESTRATED
user-invocable: false
allowed-tools: Read, Bash, Skill
---

# Release Triage

Assess scope of a RELEASE request and route to the appropriate workflow skill.

**Default: GUIDED.** Only escalate to ORCHESTRATED when specific signals are present.

## Orchestration Hint Override

If the user's prompt contains any of: "orchestrate", "full pipeline", "deep", "thorough" — route to ORCHESTRATED immediately.

## Scope Assessment

Check for ORCHESTRATED signals (any one is sufficient):

1. **Multi-package release** — Prompt mentions "monorepo", "all packages", "multi-package", "workspace"
2. **Complex changelog** — Prompt requests "changelog generation", "release notes from commits"
3. **Custom release process** — Prompt references "npm publish", "deploy", "CI pipeline", "release pipeline"

If no ORCHESTRATED signals detected, or if any check errors → GUIDED.

## Route

Emit: `Scope: GUIDED` or `Scope: ORCHESTRATED`

Load the target skill via Skill tool:
- GUIDED → `devflow:release:guided`
- ORCHESTRATED → `devflow:release:orch`
