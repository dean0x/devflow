---
name: router
description: This skill should be used after ambient classification to load the relevant skills for the classified intent and depth. Maps GUIDED and ORCHESTRATED classifications to domain and orchestration skills.
user-invocable: false
---

# Router

State classification: `Devflow: INTENT/DEPTH. Loading: [skills].`
Load all listed skills via Skill tool before writing any text about the task.
GUIDED: work directly in main session. Spawn Simplifier after code changes.
- GUIDED EXPLORE: spawn Skimmer + Explore agents, then analyze directly.
- GUIDED PLAN: spawn Skimmer for orientation, then plan directly.
ORCHESTRATED: follow the loaded orchestration skill's pipeline.

## GUIDED

| Intent | Skills |
|--------|--------|
| IMPLEMENT | devflow:test-driven-development, devflow:patterns, devflow:research |
| EXPLORE | — |
| DEBUG | devflow:test-driven-development, devflow:software-design, devflow:testing |
| PLAN | devflow:test-driven-development, devflow:patterns, devflow:software-design, devflow:security, devflow:design-review |
| REVIEW | devflow:quality-gates, devflow:software-design |

## ORCHESTRATED

| Intent | Skills |
|--------|--------|
| IMPLEMENT | devflow:implement:orch, devflow:patterns |
| EXPLORE | devflow:explore:orch |
| DEBUG | devflow:debug:orch |
| PLAN | devflow:plan:orch, devflow:patterns, devflow:software-design, devflow:security, devflow:design-review |
| REVIEW | devflow:review:orch |
| RESOLVE | devflow:resolve:orch |
| PIPELINE | devflow:pipeline:orch, devflow:patterns |

## Secondary Skills (GUIDED IMPLEMENT + DEBUG only, load all that match)

| Pattern | Skill |
|---------|-------|
| .ts, .tsx | devflow:typescript |
| .tsx, .jsx | devflow:react |
| .go | devflow:go |
| .java | devflow:java |
| .py | devflow:python |
| .rs | devflow:rust |
| CSS/UI/styling | devflow:ui-design |
| Forms/API/input | devflow:boundary-validation |
| Auth/crypto/secrets | devflow:security |
| Git operations | devflow:git |
