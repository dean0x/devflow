# Consistency Review Report

**Branch**: fix/ambient-skill-loading -> main
**Date**: 2026-03-20
**Commits**: 3 (`7630bad`, `8800f7b`, `e7aa588`)

## Issues in Your Changes (BLOCKING)

### HIGH

**PREAMBLE string duplicated between hook and test helper** - `scripts/hooks/ambient-prompt:42`, `tests/integration/helpers.ts:18-19`
**Confidence**: 85%
- Problem: The ambient preamble text is defined identically in two separate files — once in the shell hook (`scripts/hooks/ambient-prompt:42`) and once as a TypeScript constant in `tests/integration/helpers.ts:18-19`. This branch modified the preamble in the hook (adding the `If GUIDED or ORCHESTRATED, you MUST load...` sentence) and also introduced the matching copy in `helpers.ts`. These two sources can drift independently with no compile-time or test-time guarantee they stay in sync. This is a pattern violation: the codebase generally avoids cross-language duplication of magic strings.
- Fix: Add a comment in both locations pointing to the other copy, or extract the preamble to a shared location (e.g., a `constants.ts` file that the test reads, and a build step that emits it for the shell hook). At minimum, add a comment like `// Keep in sync with scripts/hooks/ambient-prompt PREAMBLE` in helpers.ts and vice versa.

### MEDIUM

**Unit test imports from integration helper module** - `tests/ambient.test.ts:3`
**Confidence**: 82%
- Problem: The unit test file `tests/ambient.test.ts` imports helper functions from `./integration/helpers.js`. This breaks the boundary convention in this codebase where unit tests (`tests/*.test.ts`) are self-contained or import from source, and integration tests (`tests/integration/*.test.ts`) have their own helpers. No other unit test file imports from `tests/integration/`. The classification and skill-loading helpers (`hasClassification`, `extractIntent`, `extractDepth`, `hasSkillLoading`, `extractLoadedSkills`) are pure functions that could live in a shared test utility or even in the source code itself.
- Fix: Either move these pure helper functions to a shared `tests/helpers.ts` (not under `integration/`) or into the source code (e.g., `src/cli/utils/ambient-helpers.ts`) and import from there in both test files. This preserves the unit vs. integration boundary.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No issues found._

## Suggestions (Lower Confidence)

- **`formatDryRunPlan` deduplicates but `computeAssetsToRemove` does not** - `src/cli/commands/uninstall.ts:62-64` (Confidence: 65%) -- `formatDryRunPlan` wraps each array in `new Set()` to deduplicate, suggesting the input may contain duplicates. Yet `computeAssetsToRemove` (the upstream producer) does not deduplicate. This creates an inconsistency about which layer is responsible for uniqueness. Consider deduplicating in `computeAssetsToRemove` instead.

- **Integration test `KNOWN LIMITATION` comment block is unusually large** - `tests/integration/ambient-activation.test.ts:13-27` (Confidence: 62%) -- The 15-line comment block explaining `-p` mode limitations is more verbose than comparable test documentation in the codebase (most test files have 0-2 lines of file-level comments). This is a style observation, not a functional concern. Consider extracting the known limitation to a separate document if it applies to multiple test files.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The branch changes are generally consistent with existing codebase patterns. The `allowed-tools` removal from the ambient-router SKILL.md is the first skill to omit this field -- but this is explicitly documented in the updated CLAUDE.md and `skills-architecture.md`, making it a justified and well-documented deviation rather than an inconsistency. The `--dry-run` flag on uninstall follows Commander conventions used by other options in the same file. The new `formatDryRunPlan` function follows the same pure-function-with-tests pattern as `computeAssetsToRemove`.

The two actionable items are: (1) the PREAMBLE string duplication across shell and TypeScript without a sync mechanism, and (2) the unit test importing from the integration helper directory, breaking the test boundary convention. Neither is blocking, but both should be addressed to maintain the codebase's consistency standards.
