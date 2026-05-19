# Regression Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Pipeline:orch references stale implement:orch phase numbers** - `shared/skills/pipeline:orch/SKILL.md:35`
**Confidence**: 92%
- Problem: Pipeline:orch line 35 says "execute its full pipeline (Phases 1-7: pre-flight ... completion)" but implement:orch now has 9 phases after this PR (Phase 7: CI Status Gate, Phase 8: Completion, Phase 9: Feature Knowledge). Line 39 also references "Phase 7 normally removes it" — that cleanup is now in Phase 8. This is a documentation mismatch that will cause the pipeline orchestrator to announce incorrect phase counts and reference the wrong phase for handoff cleanup.
- Fix: Update `shared/skills/pipeline:orch/SKILL.md` line 35 to say "Phases 1-9" and line 39 to say "Phase 8 normally removes it".

**Pipeline:orch references stale resolve:orch phase numbers** - `shared/skills/pipeline:orch/SKILL.md:78`
**Confidence**: 92%
- Problem: Pipeline:orch line 78 says resolve:orch has "Phases 1-7" but resolve:orch now has 8 phases (new Phase 7: CI Status Gate, Phase 8: Report). This will cause the pipeline meta-orchestrator to believe it has completed resolve:orch's pipeline when Phase 7 (CI gate) and Phase 8 (Report) remain.
- Fix: Update `shared/skills/pipeline:orch/SKILL.md` line 78 to say "Phases 1-8".

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale `INTENT/DEPTH` format references in test-driven-development skill** - `shared/skills/test-driven-development/SKILL.md:154,193-201`
**Confidence**: 85%
- Problem: The TDD skill documents the old `INTENT/DEPTH` classification format throughout its "Ambient Mode Integration" section (lines 154, 193-201): `IMPLEMENT/GUIDED`, `IMPLEMENT/ORCHESTRATED`, `IMPLEMENT/QUICK`, `DEBUG/GUIDED`, `DEBUG/ORCHESTRATED`, etc. This PR changes the classification format from `INTENT/DEPTH` to `INTENT` (with depth now determined by triage skills, not classification). While these are documentation strings that won't break execution, they create confusion for agents loading this skill — the format described no longer matches what the router and triage layer produce. This file is not directly touched by the PR but is in the same skill ecosystem that was restructured.
- Fix: Update `shared/skills/test-driven-development/SKILL.md` lines 154-201 to use the new format. Replace `IMPLEMENT/GUIDED` with `IMPLEMENT (GUIDED scope)`, `IMPLEMENT/ORCHESTRATED` with `IMPLEMENT (ORCHESTRATED scope)`, etc. Or simplify to just reference intent names since depth is now an internal triage concern.

**Stale `PIPELINE/ORCHESTRATED` format in pipeline:orch cost communication** - `shared/skills/pipeline:orch/SKILL.md:27`
**Confidence**: 90%
- Problem: The cost communication template says `Devflow: PIPELINE/ORCHESTRATED. This runs implement...` but the router now emits `Devflow: {INTENT}. Loading: {skill}.` without the `/DEPTH` suffix. The classification output format has changed but pipeline:orch's hardcoded example was not updated.
- Fix: Update to `Devflow: PIPELINE. Loading: devflow:pipeline:orch. This runs implement -> review -> resolve (15+ agents across stages).`

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Old `INTENT/DEPTH` references in plan:orch** - `shared/skills/plan:orch/SKILL.md:251`
**Confidence**: 80%
- Problem: Plan:orch references `IMPLEMENT/ORCHESTRATED` in its output template. Pre-existing, not touched by this PR.
- Fix: Update to use new format in a follow-up.

## Suggestions (Lower Confidence)

- **No `## Depth Criteria` removal assertion in tests covers GUIDED/ORCHESTRATED presence in classification-rules.md** - `tests/ambient.test.ts:636-637` (Confidence: 65%) — The test correctly asserts `## Depth Criteria` heading is absent, but the old test also asserted GUIDED and ORCHESTRATED strings were present in classification-rules.md (lines 684-685, now removed). The new test does not assert these terms are absent, which means a partial revert that re-adds depth terminology to classification-rules.md would not be caught. Minor concern since the `## Depth Criteria` absence check provides reasonable coverage.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The triage layer introduction is well-executed overall — the core router/classification/triage architecture is consistent and fully tested (58 tests pass). The new triage skills correctly reference both guided and orch targets, the classification format change is propagated through tests and helpers, the LEGACY_SKILL_NAMES array includes triage cleanup entries (applies ADR-001 clean-break philosophy), and the CI status gate is properly integrated into implement:orch and resolve:orch.

The blocking issues are documentation-level regressions in `pipeline:orch/SKILL.md` where phase number references are stale after implement:orch grew from 7 to 9 phases and resolve:orch grew from 7 to 8 phases. These will cause the pipeline meta-orchestrator to miscount phases and reference wrong phase numbers during execution. The should-fix items are stale `INTENT/DEPTH` format references in adjacent skills that were not updated as part of the format migration.
