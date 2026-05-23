# Consistency Review Report

**Branch**: feat/223-review-pipeline-convergence-detection -> main
**Date**: 2026-05-21_1458

## Issues in Your Changes (BLOCKING)

### HIGH

**Decision table present in code-review.md but missing from code-review-teams.md** - `plugins/devflow-code-review/commands/code-review.md:121-128` vs `plugins/devflow-code-review/commands/code-review-teams.md:119-121`
**Confidence**: 88%
- Problem: `code-review.md` Step 0d-ii includes a **Decision table -- Step 0d-ii paths** block (4-row summary table) after the numbered steps. `code-review-teams.md` does not have this decision table -- it goes directly from step 4 to the NOTE line. Given that the two files are explicitly documented as mirrors ("parity enforced by tests"), this asymmetry means an LLM executing the teams variant gets a less structured decision reference than the base variant. The cross-cutting consistency test suite does not cover the decision table presence.
- Fix: Add the same decision table to `code-review-teams.md` between step 4 and the NOTE line:

```markdown
4. If `--full`: skip this sub-step entirely (bypass convergence warning)

**Decision table -- Step 0d-ii paths:**

| Condition | Outcome |
|-----------|---------|
| CYCLE_NUMBER > MAX_REVIEW_CYCLES | Halt (AskUserQuestion), abort unless user overrides |
| denominator = 0 OR parsing failed | fp_ratio = 0, skip warning (degraded note on parse failure) |
| fp_ratio > 0.7 AND CYCLE_NUMBER >= 3 | Warn (AskUserQuestion): Merge / Review anyway / Stop |
| `--full` flag set | Skip entire sub-step, bypass convergence warning |

NOTE: Convergence logic mirrored in code-review.md ...
```

**Synthesizer input spec missing containment marker documentation for PRIOR_RESOLUTIONS** - `shared/agents/synthesizer.md:23`
**Confidence**: 85%
- Problem: The synthesizer's Input section describes PRIOR_RESOLUTIONS as "Content of the prior `resolution-summary.md` for cross-referencing recurring vs new issues" but does not document the `<prior-resolution-summary>...</prior-resolution-summary>` containment markers. Meanwhile, all three orchestration surfaces (`code-review.md:253`, `code-review-teams.md:304`, `review:orch/SKILL.md:161`) wrap it in these markers when passing to the synthesizer. The reviewer agent (`reviewer.md:27`) explicitly documents its containment markers. This creates an inconsistency: the reviewer documents the wrapping it receives, the synthesizer does not, yet both receive the same wrapped format.
- Fix: Update `shared/agents/synthesizer.md` line 23 to match the reviewer's documentation style:

```markdown
- **PRIOR_RESOLUTIONS** (review mode, optional): Content of the prior `resolution-summary.md`
  for cross-referencing recurring vs new issues, wrapped in
  `<prior-resolution-summary>...</prior-resolution-summary>` containment markers. Pass `(none)`
  when absent.
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Phase 3 Synthesizer invocation wording slightly different between code-review.md and code-review-teams.md** - `code-review.md:254` vs `code-review-teams.md:305` (Confidence: 70%) -- `code-review.md` uses a full code-block `Agent(subagent_type="Synthesizer"...)` invocation with `Include Convergence Status section in review-summary.md.` on a separate line, while `code-review-teams.md` uses inline prose "Include Convergence Status section." without the "in review-summary.md" qualifier. Both achieve the same result but the level of specificity differs. The teams variant's Phase 3 is led by the team lead (not a separate agent spawn) so the different framing is arguably intentional.

- **review:orch Phase 6 Synthesizer instruction lacks explicit containment markers in code template** - `shared/skills/review:orch/SKILL.md:161` (Confidence: 65%) -- The line says "Pass **CYCLE_NUMBER** and **PRIOR_RESOLUTIONS** for convergence reporting in output" but does not show the `<prior-resolution-summary>` wrapping inline. The command files both show it explicitly in their code blocks. For `review:orch` this is consistent with its lighter prose style (no code block for the Synthesizer call), but it relies on the orchestrator knowing to apply the wrapping.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED
