---
name: router
description: Maps intents and depth to workflow skills (guided or orchestrated). Dispatches by intent AND depth.
user-invocable: false
---

# Router

State classification: `Devflow: INTENT/DEPTH. Loading: [skill].`
Load the skill for the classified intent and depth via Skill tool before writing any text about the task.

## Phase Protocol

Applies to ORCHESTRATED pipelines only. GUIDED skills do not have phases.

1. **Announce** — Before executing each phase, output: `Phase N: {name}`. No phase may execute without this announcement. Skipping the announcement and doing the work anyway is a protocol violation.
2. **Produce** — Each phase declares what it `Produces:`. Capture that output by name. Subsequent phases reference it via `Requires:`.
3. **No silent skips** — If a phase's preconditions are not met (e.g., no issues found), announce the phase, state why it is being skipped, and move to the next phase. The announcement must still appear.
4. **Verify** — Before presenting final output, check the skill's Phase Completion Checklist. Every phase must show as announced. If any phase was missed, execute it before proceeding.
5. **Scoped nesting** — When a pipeline delegates to another orchestration skill (e.g., pipeline:orch → implement:orch), the inner skill's phases use a scoped prefix: `{Outer} > Phase N: {name}` (e.g., `Implement > Phase 1: Pre-flight`).

## Workflow Skills

Load the skill for the classified intent and depth via Skill tool.

| Intent | GUIDED | ORCHESTRATED |
|--------|--------|--------------|
| IMPLEMENT | devflow:implement:guided | devflow:implement:orch |
| EXPLORE | devflow:explore:guided | devflow:explore:orch |
| DEBUG | devflow:debug:guided | devflow:debug:orch |
| PLAN | devflow:plan:guided | devflow:plan:orch |
| REVIEW | devflow:review:guided | devflow:review:orch |
| RESOLVE | — | devflow:resolve:orch |
| PIPELINE | — | devflow:pipeline:orch |
| RESEARCH | devflow:research:guided | devflow:research:orch |
| RELEASE | devflow:release:guided | devflow:release:orch |

If GUIDED column is `—`, load the ORCHESTRATED skill instead — the workflow does not support GUIDED depth.
