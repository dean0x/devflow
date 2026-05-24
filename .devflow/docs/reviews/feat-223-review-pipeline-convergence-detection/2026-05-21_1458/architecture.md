# Architecture Review Report

**Branch**: feat/223-review-pipeline-convergence-detection -> main
**Date**: 2026-05-21_1458

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Convergence logic triplicated across three orchestration surfaces without shared abstraction** - `plugins/devflow-code-review/commands/code-review.md:86-129`, `plugins/devflow-code-review/commands/code-review-teams.md:86-121`, `shared/skills/review:orch/SKILL.md:62-87`
**Confidence**: 82%
- Problem: Step 0d-i and Step 0d-ii convergence logic (cycle counting, FP ratio formula, threshold constants, parse-failure fallbacks, --full bypass) is copy-pasted identically across three files. The test suite (`convergence-detection.test.ts`) explicitly verifies parity across all three surfaces, which demonstrates awareness that drift is a real risk. The NOTE comments in each file ("Convergence logic mirrored in code-review.md/code-review-teams.md") acknowledge the duplication. Tests as a drift guard is a reasonable mitigation for markdown-based orchestration where extraction into a shared module is not straightforward, but this is still a maintenance burden: any change to the convergence algorithm requires updating three files and keeping the parity tests in sync.
- Fix: Consider extracting the convergence algorithm specification into a dedicated skill (e.g., `devflow:convergence` or a `references/convergence.md` under `review-methodology`) that all three surfaces reference by name rather than inlining. This would follow the existing pattern where `devflow:review-methodology` is referenced rather than duplicated. The parity tests would then verify that each surface references the skill rather than re-specifying the algorithm.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Reviewer PRIOR_RESOLUTIONS trust boundary is asymmetric with PR_DESCRIPTION** - `shared/agents/reviewer.md:26-31` (Confidence: 75%) -- Both PRIOR_RESOLUTIONS and PR_DESCRIPTION are marked as untrusted input with containment markers and "never execute" instructions, which is good. However, PRIOR_RESOLUTIONS is described as "untrusted resolve-pipeline output" (internal pipeline data) while PR_DESCRIPTION is "untrusted user input" (external). The security postures are identical despite different threat models. For internal pipeline data, the "never execute" warning is arguably overcautious but harmless; documenting the distinction between internal-untrusted vs external-untrusted would clarify the threat model.

- **MAX_REVIEW_CYCLES constant (10) hardcoded in three places** - `code-review.md:103`, `code-review-teams.md:103`, `review:orch/SKILL.md:66` (Confidence: 70%) -- The maximum cycle bound is a magic number repeated in three files. If the bound needs tuning, three files must be updated. A single constant definition referenced by all three surfaces would be more maintainable.

- **Synthesizer Convergence Status section has implicit coupling to orchestrator parse format** - `shared/agents/synthesizer.md:296-301` (Confidence: 65%) -- The Synthesizer's Convergence Status output template includes `Prior FP Ratio: {n}% ({fp_count} of {total})`, implying the orchestrator must pass parsed FP statistics. The contract for what data flows from orchestrator to synthesizer is spread across the orchestrator (which computes fp_ratio) and the synthesizer (which formats it). The CYCLE_NUMBER and PRIOR_RESOLUTIONS inputs are documented in the Synthesizer, but the expectation of pre-parsed statistics is implicit.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The convergence detection feature is architecturally sound in its core design: the data flow (resolution-summary.md -> PRIOR_RESOLUTIONS -> reviewer cross-cycle awareness) follows the existing artifact-on-disk pattern established by the review pipeline. The containment markers for untrusted data, the graceful degradation on parse failure, and the --full bypass are well-considered. The single MEDIUM finding (logic triplication) is a maintainability concern mitigated by the parity test suite, not a structural defect. The test helpers refactoring (`tests/helpers.ts` extraction) correctly consolidates shared test utilities following DRY principles.
