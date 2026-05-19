# Regression Review Report

**Branch**: fix-suppress-quick-classification -> main
**Date**: 2026-04-19

## Issues in Your Changes (BLOCKING)

### CRITICAL

None.

### HIGH

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

None.

## Analysis

### Change Summary

This PR makes two coordinated changes:

1. **File move**: `shared/skills/router/references/classification-rules.md` -> `shared/skills/router/classification-rules.md` (R100 -- content-identical rename)
2. **Preamble wording**: Changed from "Classify this request's intent and depth, then load devflow:router via Skill tool." to "Classify this request's intent and depth. If GUIDED or ORCHESTRATED, load devflow:router via Skill tool." -- suppressing unnecessary router loading for QUICK-classified prompts
3. **Test strengthening**: Added `hasClassification(result)` assertions to 3 QUICK-tier integration tests verifying no classification tag is emitted for QUICK prompts
4. **Legacy fallback**: `session-start-classification` hook gained a legacy fallback path for the old `references/classification-rules.md` location

### Regression Checklist

| Check | Status | Notes |
|-------|--------|-------|
| No exports removed | PASS | `hasClassification` is a new export, no removals |
| Return types backward compatible | PASS | No signature changes |
| Default values unchanged | PASS | No default changes |
| Side effects preserved | PASS | Classification still happens; only the router-loading instruction for QUICK changed |
| All consumers of changed code updated | PASS | All 5 path references updated: `session-start-classification`, `tests/ambient.test.ts` (2), `tests/integration/helpers.ts`, `tests/skill-references.test.ts` |
| Migration complete across codebase | PASS | Only remaining `references/classification-rules.md` reference is the intentional legacy fallback in `session-start-classification:19` |
| CLI options preserved | N/A | No CLI changes |
| Commit message matches implementation | PASS | "suppress QUICK classification announcement and deduplicate classification rules" accurately describes both changes |
| Breaking changes documented | N/A | Non-breaking for all consumers due to legacy fallback |

### Detailed Regression Analysis

**1. File Rename (classification-rules.md)**

The file move from `references/` to the skill root is a clean R100 rename (100% content identity). All consumers were updated:
- `session-start-classification:18` -- primary path updated, legacy fallback added at line 19
- `tests/ambient.test.ts:492,597` -- both `rulesPath` declarations updated
- `tests/integration/helpers.ts:24` -- `loadRouterContext()` updated
- `tests/skill-references.test.ts:706` -- test assertion updated
- `CLAUDE.md:43` -- documentation updated

The legacy fallback in `session-start-classification` ensures existing installs that still have the old file layout continue to work during the upgrade window. This is a correct migration strategy.

**2. Preamble Behavioral Change**

The old preamble unconditionally told the model to "load devflow:router via Skill tool" for every prompt. The new preamble gates router loading on "If GUIDED or ORCHESTRATED." This is consistent with:
- `classification-rules.md` line 30: "QUICK: Respond directly. Do not display classification or load the router."
- The router SKILL.md itself, which only contains GUIDED and ORCHESTRATED tables

This change suppresses unnecessary Skill tool invocations for QUICK-classified prompts, which is the stated intent. No functionality is lost -- QUICK prompts never needed router skills.

**3. Test Changes**

Three QUICK-tier tests gained `expect(hasClassification(result)).toBe(false)` assertions. The `hasClassification` function checks for the `Devflow: INTENT/DEPTH` classification tag in text output. The classification rules already instruct "Do not display classification" for QUICK, so these assertions codify existing expected behavior. The `hasClassification` function already existed in `helpers.ts` -- only the import in the test file is new.

**4. PF-001 Check**

PF-001 (renaming Promise resolver param from `resolve`) is NOT triggered by this PR. The `tests/integration/helpers.ts` changes are limited to the `loadRouterContext()` path string (line 24) and the preamble string (line 30). The Promise resolver at line 62 (`return new Promise((resolve) => {`) remains correctly named `resolve` per project convention.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 10/10
**Recommendation**: APPROVED
