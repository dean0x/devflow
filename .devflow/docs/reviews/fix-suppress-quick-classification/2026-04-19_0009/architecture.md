# Architecture Review Report

**Branch**: fix/suppress-quick-classification -> main
**Date**: 2026-04-19

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **Legacy fallback omits cleanup of old `references/` install artifact** - `scripts/hooks/session-start-classification:19-23` (Confidence: 65%) -- The legacy fallback correctly handles the upgrade window where `references/classification-rules.md` still exists at the old install path. However, after the new version is installed, the old `references/classification-rules.md` at `~/.claude/skills/devflow:router/references/classification-rules.md` will persist as an orphan because the installer's `fs.rm` removes the entire `devflow:router` prefixed directory before re-copying (line 163 of `installer.ts`), so this is actually a non-issue -- the old directory gets cleaned on next `devflow init`. No action needed.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 9/10
**Recommendation**: APPROVED

## Analysis

### Changes Summary

This PR makes two cohesive architectural changes:

1. **File relocation**: Moves `classification-rules.md` from `shared/skills/router/references/` to `shared/skills/router/` (the skill root). This is architecturally sound -- classification rules are not a "reference" document but rather the primary artifact consumed by the `session-start-classification` hook at every session start. Promoting it to the skill root correctly reflects its role as a first-class input, consistent with the convention that `SKILL.md` lives at the skill root.

2. **Conditional router loading**: The preamble instruction changes from unconditional ("...then load devflow:router via Skill tool") to conditional ("If GUIDED or ORCHESTRATED, load devflow:router via Skill tool"). This aligns the preamble with the classification rules which already state: "QUICK: Respond directly. Do not display classification or load the router." The change eliminates a contradiction between the preamble instruction and the classification rules, making the layering cleaner.

### Architectural Quality Assessment

**Separation of Concerns**: Clean. The session-start hook injects classification rules (data), the preamble injects the behavioral instruction (action), and the router skill provides lookup tables (mapping). Each layer has a single responsibility.

**Backward Compatibility**: The `session-start-classification` hook includes a proper legacy fallback path (`CLASSIFICATION_RULES_LEGACY`) that checks the old `references/` location. This handles the upgrade window where a user has old installed files but the hook has been updated. The installer's `fs.rm` of the entire prefixed skill directory before re-copying means the orphan is cleaned on next `devflow init`.

**Test Alignment**: All path references across 4 test files are updated consistently. The new `hasClassification(result)` assertions in QUICK-tier tests enforce the behavioral contract that QUICK prompts should not produce visible classification output -- a regression guard for the suppression behavior.

**Layering**: No violations. Dependencies still point in the correct direction: hooks read skill files (infrastructure reads domain), tests read source files (test reads source). No circular dependencies introduced.

### Knowledge Check (PF-001)

PF-001 concerns renaming Promise resolver params from `resolve` in `tests/integration/helpers.ts`. The changes to `helpers.ts` in this PR only modify a path string and a preamble string -- no Promise callback params are touched. PF-001 is not relevant to this diff.
