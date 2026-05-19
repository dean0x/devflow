# Regression Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14_1759

## Issues in Your Changes (BLOCKING)

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none)

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

### CHAT Removal from CLASSIFICATION_PATTERN (Confidence: 95% — NOT a regression)

The `CHAT` variant was removed from the `CLASSIFICATION_PATTERN` regex in `tests/integration/helpers.ts`. This is explicitly correct: `CHAT` intents are always classified as `QUICK` (per `shared/skills/router/classification-rules.md` line 20: "CHAT intent — always QUICK") and QUICK intents never emit the `Devflow: INTENT.` marker (they respond directly without displaying classification, per line 41). Therefore `CHAT` was a dead branch in the regex that could never match in practice. No CHAT references remain anywhere in the codebase, confirming the removal is clean. Applies ADR-001 (clean break philosophy — dead code removed without backward-compat shims).

### Old INTENT/DEPTH Format Rejection Test (Confidence: 95% — NOT a regression)

A new negative test asserts the old `INTENT/DEPTH` slash format (e.g., `Devflow: IMPLEMENT/ORCHESTRATED`) is rejected by `hasClassification()`. This is correct behavior: the regex requires a period `.` after the intent keyword (`\s*[.]`), while the old slash format (`/ORCHESTRATED`) lacks this terminator. The test documents and enforces the clean break. Applies ADR-001.

### CI Status Classification Priority Change (Confidence: 90% — Intentional behavioral fix, NOT a regression)

The `check-ci-status` operation in `shared/agents/git.md` changed the classification priority from "SUCCESS first → FAILURE second → PENDING last" to "PENDING first → FAILURE second → SUCCESS last". This is a **correctness fix**: the old ordering could classify a PR as `FAILING` even when some checks were still `IN_PROGRESS`, which would trigger premature fix attempts. The new priority order means pending checks take precedence (wait for them to finish), which is the correct operational behavior for CI gates.

### Phase Number Corrections (Confidence: 95% — All verified consistent)

Reviewed all cross-file phase references after the CI Status Gate insertion as Phase 7:

- **implement:orch**: Phases 1-9 correct. Phase 8 (Completion) and Phase 9 (Feature Knowledge) properly numbered. OVERLAPPING_SLUGS correctly reference Phase 8.
- **resolve:orch**: Phases 1-8 correct. Phase 7 (CI Status Gate) and Phase 8 (Report) properly numbered. Phase Completion Checklist matches.
- **resolve.md** (command): Phases 0-9 correct. Phase 5 writes resolution-summary (not Phase 9). Phase 7 proceeds to Phase 8. Phase 9 Report references Phase 5.
- **resolve-teams.md** (command): Phases 0-9 correct. Phase 5 → Phase 9 citation reference updated. Output Artifact says Phase 9.
- **pipeline:orch**: implement:orch "Phases 1-9" (correct — 9 phases), resolve:orch "Phases 1-8" (correct — 8 phases), review:orch "Phases 1-7" (unchanged, correct). Phase 8 handoff cleanup reference updated correctly.
- **plan:orch**: Output format updated from `IMPLEMENT/ORCHESTRATED` to `IMPLEMENT (ORCHESTRATED)` — cosmetic, no behavioral change.
- **test-driven-development**: All 9 ambient mode integration lines updated from slash format to parenthetical format. Semantics preserved exactly.

### SYNC Markers (Confidence: 95% — Correctly applied)

All four CI Status Gate sections (implement:orch, resolve:orch, resolve.md, resolve-teams.md) now carry `<!-- SYNC: ci-status-gate -->` / `<!-- /SYNC: ci-status-gate -->` markers with a new budget line (item 6: max 10 polls + max 2 fix attempts). Content within SYNC blocks is consistent across all four files (modulo expected differences: implement:orch has `PR_URL` requires vs `RESOLUTION_RESULTS`, resolve commands add worktree-specific language).

### Total Budget Addition (Confidence: 90% — Additive, no regression)

Item 6 ("Total budget: max 10 polls and max 2 fix attempts across all check/fix cycles combined") is purely additive — it makes the existing implicit limits explicit and adds a combined cap. No existing behavior is removed or altered; this prevents unbounded retry loops in edge cases where a check/fix cycle restarts polling.

### Migration Completeness Check

Verified no remnants of old patterns across the entire repo:
- Zero matches for `INTENT/DEPTH`, `IMPLEMENT/GUIDED`, `IMPLEMENT/ORCHESTRATED`, `DEBUG/GUIDED`, `DEBUG/ORCHESTRATED`, `PLAN/GUIDED`, `PLAN/ORCHESTRATED`, `RESOLVE/ORCHESTRATED`, `PIPELINE/ORCHESTRATED` format in any `.md` or `.ts` file.
- Zero matches for `CHAT` in any `.md` or `.ts` file.
- All tests pass (59/59 in ambient.test.ts).

### No Removed Exports, Signatures, or CLI Options

No TypeScript source code was modified beyond `tests/integration/helpers.ts` (regex update) and `tests/ambient.test.ts` (new test added). No exports were removed, no function signatures changed, no CLI options altered.
