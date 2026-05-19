# Testing Review Report

**Branch**: feat/restore-companion-skill-loading -> main
**Date**: 2026-05-12

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Guided skill companion consistency not covered** - `tests/skill-references.test.ts:1007` (Confidence: 70%) — The new test validates ORCHESTRATED companion skill consistency (catalog vs orch skills vs commands) but does not cover GUIDED companion skills. The catalog's GUIDED section (lines 7-47 of skill-catalog.md) lists always-loaded companions per intent that should match the `:guided` SKILL.md files. A future test could close this gap, but it is not blocking since the guided skill format (multi-line "Always:" lists with conditional file-type tables) differs structurally from the orch single-line format.

- **Hardcoded intent-to-path maps could drift** - `tests/skill-references.test.ts:1027-1057` (Confidence: 65%) — The `intentOrchMap` and `intentCommandMap` objects are manually maintained. If a new intent with companion skills is added to the catalog table but not to these maps, the test would silently not validate it. The `expect(orchTable.size).toBeGreaterThanOrEqual(5)` assertion on line 1024 guards against the table shrinking but would not catch additions. This is mitigated by the catalog regex already parsing all 5 known intents dynamically, so it would only be an issue for entirely new intents.

- **readFileSync on command files has no try/catch** - `tests/skill-references.test.ts:1079` (Confidence: 60%) — Unlike the `code-review-teams.md` test at line 992-996 which wraps `readFileSync` in try/catch (because teams variants may not exist), the new test reads teams command files without protection. Currently all 10 command files exist, but if a teams variant were removed, the test would throw an unhandled error rather than skip gracefully. Low urgency since the test accurately reflects the current requirement that all listed command files must exist.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED

### Rationale

The new test is well-designed and follows the existing test file's patterns:

1. **Behavior-focused**: Tests the observable contract (companion skill lists must be consistent across catalog, orch skills, and commands) rather than implementation details.

2. **Rename-proof by design**: Derives expected skill lists dynamically from the catalog source-of-truth via regex parsing, rather than hardcoding expected values. Adding or removing a companion skill in the catalog automatically updates what the test considers valid.

3. **Clear AAA structure**: Arranges by parsing catalog, acts by reading each orch skill and command file, asserts with descriptive error messages that pinpoint exactly which component drifted.

4. **Descriptive failure messages**: Every `expect()` includes a custom message (e.g., `"implement:orch companions must match catalog for IMPLEMENT"`) making failures immediately actionable.

5. **The `parseCompanionLine` helper** correctly handles both orch format (`Load via Skill tool: ...`) and command format (`**Load Companion Skills** -- Load via Skill tool: ...`) using a shared regex.

6. **All 32 tests pass** including the new test, with no flaky patterns or timing dependencies.

The orch skill reordering changes (moving "Load Companion Skills" before "Worktree Support" in debug:orch and plan:orch) are documentation/ordering changes in markdown skills, not code changes -- no test coverage needed for section ordering.
