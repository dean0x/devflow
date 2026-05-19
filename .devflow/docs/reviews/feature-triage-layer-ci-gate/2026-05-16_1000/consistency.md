# Consistency Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

### HIGH

**Context hook utilities placed in init.ts instead of colocated with their hook** - `src/cli/commands/init.ts:103-186`
**Confidence**: 85%
- Problem: The `addContextHook`/`removeContextHook`/`hasContextHook` utilities are defined in `init.ts`, while every other hook utility follows the pattern of living in the command file that owns the feature: `addMemoryHooks`/`removeMemoryHooks`/`hasMemoryHooks` in `memory.ts`, `addLearningHook`/`removeLearningHook`/`hasLearningHook` in `learn.ts`, `addDecisionsHook`/`removeDecisionsHook`/`hasDecisionsHook` in `decisions.ts`. The context hook has no `devflow context` command, which explains why it landed in `init.ts`, but it breaks the "one feature, one file for its utilities" pattern. Both `init.ts` and `uninstall.ts` import from it, so the coupling is already cross-file.
- Fix: This is a judgment call -- the always-on nature of the context hook means there is no standalone command file for it. Placing utilities in `init.ts` is defensible since init is the only command that registers it. Alternatively, a standalone `src/cli/utils/context-hook.ts` file would keep `init.ts` focused on orchestration. No change required if the team accepts this placement rationale.

### MEDIUM

**CLAUDE.md says "Five shell-script hooks" but then says "all four memory hooks check this sentinel"** - `CLAUDE.md:44`
**Confidence**: 88%
- Problem: The updated Working Memory paragraph opens with "Five shell-script hooks" but later says "all four memory hooks check this sentinel at startup" and "Disabling memory removes the four memory hooks". The count mismatch (five vs four) is confusing. The fifth hook is `session-start-context`, which is always-on and not a memory hook, so the opening "five" is incorrect in this context.
- Fix: The paragraph describes the Working Memory subsystem. The context hook is not a memory hook (it is always-on and independent). Change the opening to "Four shell-script hooks" or explicitly distinguish: "Four memory hooks plus one always-on cross-feature hook (`session-start-context`)..."

**`removeContextHook` does not accept `Settings` object, breaking pattern** - `src/cli/commands/init.ts:150`
**Confidence**: 83%
- Problem: The `hasContextHook` function accepts `string | Settings` (matching `hasDecisionsHook`, `hasMemoryHooks`, `hasLearningHook`). However, `removeContextHook` only accepts `string`, while the pattern established by `removeMemoryHooks` in `memory.ts:71` accepts `string | Settings`. The `addContextHook` also only accepts `string`, matching `addDecisionsHook` which also only accepts `string`. So `remove` is actually the inconsistent one -- `removeMemoryHooks` is the outlier that accepts both types, and the context/decisions/learning hooks all accept only `string` for `remove`. On closer analysis, `removeMemoryHooks` is the exception rather than the rule.
- Fix: No change needed -- the context hook utilities actually match the majority pattern (decisions, learning). The `removeMemoryHooks` dual-signature is the outlier.

## Issues in Code You Touched (Should Fix)

_No issues found in this category._

## Pre-existing Issues (Not Blocking)

_No issues meeting the CRITICAL threshold were found in unchanged code._

## Suggestions (Lower Confidence)

- **Sentinel naming inconsistency: `.working-memory-disabled` vs `.learning-disabled`** - `.memory/` directory (Confidence: 72%) -- The memory sentinel uses a feature-qualified prefix (`working-memory-disabled`) while the learning sentinel uses a shorter name (`learning-disabled`). The decisions feature uses `decisions/.disabled` (a file inside a subdirectory). Three different naming conventions for the same concept (disable sentinel). Not blocking because the names are documented in CLAUDE.md and each works correctly in isolation.

- **Decisions manifest reconciliation still runs when learning disabled** - `scripts/hooks/session-start-context:38-41` (Confidence: 65%) -- The comment on line 38 says "still done here even if decisions disabled -- manifest is learning's" but the learning-disabled guard on line 33 already skips this block. The code is correct (reconciliation only runs when learning is enabled), but the comment could be clearer about why decisions manifest reconciliation is gated by the learning sentinel rather than the decisions sentinel.

- **`addContextHook` hardcodes timeout value 10** - `src/cli/commands/init.ts:131` (Confidence: 62%) -- The timeout of 10 seconds matches `addDecisionsHook` (line 74 in decisions.ts) and is consistent with other hook registrations. No real issue, but if timeouts ever diverge, a shared constant would prevent drift.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates strong consistency discipline overall. The new `addContextHook`/`removeContextHook`/`hasContextHook` utilities follow the same structural pattern as their counterparts in `decisions.ts` and `learn.ts` (marker constant, idempotent add, filter-based remove, `string | Settings` for `has`). The sentinel-based disable guards are applied consistently across all memory hooks (same one-liner pattern: `[ -f "$CWD/.memory/.working-memory-disabled" ] && exit 0`). The CI status gate PATTERN blocks are verified identical across steps 2-6 in all four consuming files (implement:orch, resolve:orch, resolve.md, resolve-teams.md), with only step 1 varying per context as designed. The `session-start-context` hook correctly mirrors the code it extracted from `session-start-memory` with per-feature sentinel gating added. The enable/disable CLI flows in `memory.ts` and `learn.ts` both follow the same pattern: manage hook registration AND write/remove sentinel file (applies ADR-001 -- no migration code, just sentinel files).

The CLAUDE.md "five hooks" count discrepancy is the most actionable item for documentation accuracy.
