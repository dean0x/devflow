# Regression Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24

## Issues in Your Changes (BLOCKING)

### HIGH

**pipeline:orch cross-references still say "Phases 1-6" after all three orch skills were renumbered to Phases 1-7** - `shared/skills/pipeline:orch/SKILL.md:35,56,78`
**Confidence**: 95%
- Problem: The renumbering PR changed implement:orch, review:orch, and resolve:orch from 6 phases to 7 phases each (by promoting fractional phases like 1.5, 2b, 0.5 to integer phases). However, `pipeline:orch` was only updated on line 22 (the Feature Knowledge cross-reference). Lines 35, 56, and 78 still say "Phases 1-6" for each sub-orchestrator when they are now "Phases 1-7". This means the pipeline meta-orchestrator's documentation is inconsistent with its sub-orchestrators, which could cause agents to skip Phase 7 (Completion/Finalize/Report) during pipeline runs.
- Fix: Update the three references:
  - Line 35: `(Phases 1-6: pre-flight → plan synthesis → Coder → FILES_CHANGED detection → quality gates → completion)` should become `(Phases 1-7: pre-flight → load feature knowledge → plan synthesis → Coder → FILES_CHANGED detection → quality gates → completion)`
  - Line 56: `(Phases 1-6: pre-flight → incremental detection → file analysis → parallel reviewers → synthesis → finalize)` should become `(Phases 1-7: pre-flight → incremental detection → load knowledge → file analysis → parallel reviewers → synthesis → finalize)`
  - Line 78: `(Phases 1-6: target review directory → parse issues → analyze & batch → parallel resolvers → collect & simplify → report)` should become `(Phases 1-7: target review directory → load project knowledge → parse issues → analyze & batch → parallel resolvers → collect & simplify → report)`

**review:orch "Conditional reviewers" still references "Phase 3" instead of "Phase 4"** - `shared/skills/review:orch/SKILL.md:99`
**Confidence**: 92%
- Problem: After renumbering, file analysis moved from Phase 3 to Phase 4. The line "Conditional reviewers (from Phase 3 file analysis)" was not updated. Other references in the same file were correctly updated (e.g., line 62 says "Phase 4 file analysis", lines 107-108 correctly reference "Phase 3" for knowledge loading). This is an incomplete migration within the same file.
- Fix: Change line 99 from `**Conditional reviewers** (from Phase 3 file analysis):` to `**Conditional reviewers** (from Phase 4 file analysis):`.

### MEDIUM

**plan:orch GUIDED Behavior step numbering restarts at 1 after renumbering** - `shared/skills/plan:orch/SKILL.md:27-31`
**Confidence**: 90%
- Problem: The GUIDED Behavior section previously had steps numbered 0, 0.5, 1, 2, 3. The PR renumbered 0 to 1 and 0.5 to 2, but did not update the subsequent steps (which were already 1, 2, 3). The result is a sequence 1, 2, 1, 2, 3 — duplicate step numbers that break readability and could confuse agents following the GUIDED flow.
- Fix: Renumber the remaining steps:
  ```
  1. **Discover** — ...
  2. **Load Feature KBs** — ...
  3. **Spawn Skimmer** — ...
  4. **Design** — ...
  5. **Present** — ...
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **plan:orch Refinement Path phase references may confuse if phases are later reordered** - `shared/skills/plan:orch/SKILL.md:51-55` (Confidence: 65%) — The Refinement Path references Phase 5, Phase 9, and Phase 11 by number. If phases are ever reordered again, these will silently drift. Consider also including the phase name (e.g., "Phase 5 (Explore)") for resilience.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core functional changes (markStale to findOverlapping rename, directory boundary fix, lock extraction, checkAllStaleness optimization, test additions) are clean with complete migration — no residual references to old APIs remain and all 85 tests pass. The `feature-kb` skill removal from `devflow-core-skills` is correct since it remains in plugins that actually use it.

The blocking issues are all incomplete phase cross-reference updates from the bulk renumbering pass. pipeline:orch still says "Phases 1-6" in three places where the sub-orchestrators now have 7 phases, review:orch has one stale "Phase 3" reference that should say "Phase 4", and plan:orch GUIDED has duplicate step numbers. These are documentation-level regressions that could cause agent misbehavior since orchestration agents follow phase numbers literally.
