---
name: review:triage
description: Scope assessment for REVIEW — routes to GUIDED or ORCHESTRATED
user-invocable: false
allowed-tools: Read, Bash, Skill
---

# Review Triage

Assess scope of a REVIEW request and route to the appropriate workflow skill.

**Default: GUIDED.** Only escalate to ORCHESTRATED when specific signals are present.

## Orchestration Hint Override

If the user's prompt contains any of: "orchestrate", "full pipeline", "deep", "thorough" — route to ORCHESTRATED immediately.

## Depth Continuation

If a previous classification in this session was IMPLEMENT with ORCHESTRATED scope, inherit ORCHESTRATED for this review. This ensures implementation → review continuity.

## Scope Assessment

Check for ORCHESTRATED signals (any one is sufficient):

1. **Full branch review** — Prompt says "full review", "full branch", "all changes", "entire branch"
2. **High commit count** — Run `git rev-list --count HEAD ^$(git merge-base HEAD $(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)) 2>/dev/null`. If >5 commits → ORCHESTRATED
3. **Multi-module changes** — Prompt references changes across multiple modules or directories

If no ORCHESTRATED signals detected, or if any check errors → GUIDED.

## Route

Emit: `Scope: GUIDED` or `Scope: ORCHESTRATED`

Load the target skill via Skill tool:
- GUIDED → `devflow:review:guided`
- ORCHESTRATED → `devflow:review:orch`
