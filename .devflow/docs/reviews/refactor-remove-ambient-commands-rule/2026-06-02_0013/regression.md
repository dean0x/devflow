# Regression Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-02_0013

## Scope

Refactor removing the legacy ambient "commands awareness" rule. Removed exports
`COMMANDS_RULE_CONTENT` and `installCommandsRule`; renamed `removeCommandsRule` →
`removeLegacyCommandsRule`; deleted `shared/rules/commands.md`. Reviewed against the
PR's stated intent (exports removed, rename, signatures of `addAmbientHook`/
`removeAmbientHook` unchanged, build now reports 12 rules) — all claims verified.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None.

## Verification Performed

All four orchestrator-flagged regression vectors were investigated by grepping the
full repo beyond the diff, inspecting `main` state, and running the build + tests.

1. **Remaining importers of removed/renamed exports** — `grep -rn` across `src/` and
   `tests/` for `installCommandsRule`, `COMMANDS_RULE_CONTENT`, `removeCommandsRule\b`
   returns ZERO matches. No dangling consumers. The renamed `removeLegacyCommandsRule`
   is correctly consumed in `src/cli/commands/ambient.ts:107,128` and imported in
   `tests/ambient.test.ts:4`. (Confidence: 99%)

2. **Deleting `commands.md` breaks build / plugin manifests** — No regression.
   - `scripts/build-plugins.ts:230` (`Found ${availableRules.size} rules`) is an
     informational count over a directory scan, NOT a hard assertion. Live build run
     succeeds and prints "Found 12 rules in shared/rules/" (was 13).
   - The build's only failure path for rules (`build-plugins.ts:189`,
     `Rule "X" not found`) fires only for rules *declared* in a plugin's `rules` array.
     No plugin ever declared `commands`: `src/cli/plugins.ts` shows `devflow-ambient`
     with `rules: []`, and the only `commands` token in any plugin.json on `main` was a
     `keywords` entry (line 15), removed in this diff — never a rules-array entry.
   - The rules installer is plugin-declaration-driven (`plugins.ts` PluginDefinition.rules),
     so the orphan `commands.md` in `shared/rules/` was never installed by the rules
     feature. CLAUDE.md already documents "12 rules: 4 core + 8 language/UI" — consistent
     with the post-deletion state; no doc drift introduced. (Confidence: 97%)

3. **Rename breaks callers in init.ts/uninstall.ts** — No regression. `init.ts:24,39`
   imports and re-exports only `addAmbientHook, removeAmbientHook, hasAmbientHook` —
   none of the removed/renamed symbols. `addAmbientHook`/`removeAmbientHook` signatures
   and return types are unchanged (verified in diff). (Confidence: 98%)

4. **Cleanup preserved for upgrading users with `commands.md` on disk** — Preserved on
   ALL paths. `removeLegacyCommandsRule()` runs *before* every early-return:
   - `addAmbientHook` (ambient.ts:107) — purges before the `if (!changed) return` guard,
     so even when the hook already exists the stale file is removed.
   - `removeAmbientHook` (ambient.ts:128) — purges before the `if (!removedPrompt...)` guard.
   - `init.ts:1130-1132` uses remove-then-add unconditionally, so `removeAmbientHook`
     (and thus the purge) executes on every `init` regardless of ambient on/off.
   Test `tests/ambient.test.ts:94` ("purges legacy rule even when preamble hook already
   present (ordering invariant)") explicitly asserts this. The error handling was
   widened to fail-safe (swallows EACCES/EPERM/EROFS, not just ENOENT) per the prior
   resolve cycle — confirmed best-effort cleanup never aborts the primary operation.
   (Confidence: 97%)

## Cross-Cycle Awareness

PRIOR_RESOLUTIONS (cycle 1) fixed: fail-safe error handling, README count→12, removed
fabricated citation. None re-raised — verified current code retains all three fixes
(ambient.ts:65-72 swallows all errors; CLAUDE.md/README report 12 rules).

## Decisions Applied

- `applies ADR-001` (clean-break): removed exports outright with no deprecation shims —
  consistent with the clean-break decision. No consumers remain, so no migration needed.
- `avoids PF-001` (no migration code for rename refactors): the rename
  `removeCommandsRule → removeLegacyCommandsRule` ships no back-compat alias; all call
  sites updated in the same change. Correct per the pitfall.

## Suggestions (Lower Confidence)

None.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 10
**Recommendation**: APPROVED
