---
name: router
description: Maps intents to workflow skills. Dispatches by intent to triage or orch skills.
user-invocable: false
---

# Router

State classification: `Devflow: {INTENT}. Loading: {skill}.`
Load the skill for the classified intent via Skill tool before writing any text about the task.

## Phase Protocol

Applies to ORCHESTRATED pipelines only. GUIDED skills do not have phases.

1. **Announce** — Before executing each phase, output: `Phase N: {name}`. No phase may execute without this announcement. Skipping the announcement and doing the work anyway is a protocol violation.
2. **Produce** — Each phase declares what it `Produces:`. Capture that output by name. Subsequent phases reference it via `Requires:`.
3. **No silent skips** — If a phase's preconditions are not met (e.g., no issues found), announce the phase, state why it is being skipped, and move to the next phase. The announcement must still appear.
4. **Verify** — Before presenting final output, check the skill's Phase Completion Checklist. Every phase must show as announced. If any phase was missed, execute it before proceeding.
5. **Scoped nesting** — When a pipeline delegates to another orchestration skill (e.g., pipeline:orch → implement:orch), the inner skill's phases use a scoped prefix: `{Outer} > Phase N: {name}` (e.g., `Implement > Phase 1: Pre-flight`).

## Workflow Skills

Load the skill for the classified intent via Skill tool.

| Intent | Skill |
|--------|-------|
| IMPLEMENT | devflow:implement:triage |
| EXPLORE | devflow:explore:triage |
| DEBUG | devflow:debug:triage |
| PLAN | devflow:plan:triage |
| REVIEW | devflow:review:triage |
| RESOLVE | devflow:resolve:orch |
| PIPELINE | devflow:pipeline:orch |
| RESEARCH | devflow:research:triage |
| RELEASE | devflow:release:triage |

RESOLVE and PIPELINE have no guided variant — they go directly to orchestrated.
