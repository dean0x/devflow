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

## Phase Protocol

All ORCHESTRATED pipelines follow this protocol:

1. **Announce** — Before executing each phase, output: `Phase N: {name}`. No phase may execute without this announcement. Skipping the announcement and doing the work anyway is a protocol violation.
2. **Produce** — Each phase declares what it `Produces:`. Capture that output by name. Subsequent phases reference it via `Requires:`.
3. **No silent skips** — If a phase's preconditions are not met (e.g., no issues found), announce the phase, state why it is being skipped, and move to the next phase. The announcement must still appear.
4. **Verify** — Before presenting final output, check the skill's Phase Completion Checklist. Every phase must show as announced. If any phase was missed, execute it before proceeding.
5. **Scoped nesting** — When a pipeline delegates to another orchestration skill (e.g., pipeline:orch → implement:orch), the inner skill's phases use a scoped prefix: `{Outer} > Phase N: {name}` (e.g., `Implement > Phase 1: Pre-flight`).

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
