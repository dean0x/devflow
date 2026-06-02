# Regression Review Report

**Branch**: refactor-remove-ambient-commands-rule (PR #233) -> main
**Date**: 2026-06-01_2352
**Diff command**: `git diff main...HEAD`

## Summary of Verification

This PR removes the ambient "commands awareness" rule feature. Regression-relevant
changes:
- Removed exports: `installCommandsRule`, `COMMANDS_RULE_CONTENT`
- Renamed export: `removeCommandsRule` → `removeLegacyCommandsRule`
- Behavior change in `addAmbientHook`: previously WROTE the rule (`installCommandsRule`),
  now DELETES the legacy rule (`removeLegacyCommandsRule`)
- Deleted source: `shared/rules/commands.md`
- Removed the corresponding test blocks (`installCommandsRule`, `COMMANDS_RULE_CONTENT`),
  renamed the `removeCommandsRule` block, added an ordering-invariant test

All five focus concerns from the review brief were verified and cleared. No regressions found.

This is a clean-break removal consistent with the project's standing philosophy
(`applies ADR-001` — no migration code for refactors; `avoids PF-001` — no backward-compat
shim/alias/deprecated-flag layer). The retained `removeLegacyCommandsRule` is a one-time
purge of a file previously written into users' `~/.claude/rules/devflow/`, not a compat shim.

## Focus-Concern Verification

1. **Removed exports have no non-test consumers** — VERIFIED.
   `grep` across `src/`, `scripts/`, `tests/` for `installCommandsRule`, `COMMANDS_RULE_CONTENT`,
   and the old `removeCommandsRule` name returns zero matches (exit 1). A repo-wide `.ts` sweep
   (excluding node_modules/dist) also returns nothing. `npm run build:cli` (tsc) compiles clean —
   confirms no dangling imports.

2. **`addAmbientHook` behavior change is safe for callers** — VERIFIED.
   Sole production caller is `src/cli/commands/init.ts:1131-1132`:
   `removeAmbientHook(content)` then conditional `addAmbientHook(cleaned, devflowDir)`.
   - When ambient enabled: both functions run; both purge the legacy rule (idempotent).
   - When ambient disabled: only `removeAmbientHook` runs; it still purges the legacy rule.
   Nothing in init.ts or the standalone command relies on the rule being *written* — the only
   downstream effect was the now-removed `commands.md` file. No consumer reads that file
   programmatically (no `rules/commands` reference exists in src/scripts/shared/plugins).

3. **Ordering invariant (cleanup before early-return)** — VERIFIED.
   In `addAmbientHook` (ambient.ts:102-105) `await removeLegacyCommandsRule()` runs *before*
   `if (!changed) return settingsJson`. In `removeAmbientHook` (ambient.ts:123-126) the purge
   likewise runs before `if (!removedPrompt && !removedClassification) return`. The standalone
   `ambient --enable` "already enabled" early-return (ambient.ts:212-215) skips only the settings
   *write*; the rule purge already executed inside `addAmbientHook` as a side effect. No no-op path
   leaves a stale file behind. A dedicated regression test now asserts this
   ("purges legacy rule even when preamble hook already present (ordering invariant)",
   tests/ambient.test.ts:94-105).

4. **`preamble` hook genuinely unchanged** — VERIFIED.
   `git diff main...HEAD --name-only | grep preamble` returns nothing; the preamble hook script
   is not in the diff.

5. **No test still expects the old write behavior** — VERIFIED.
   The `installCommandsRule` describe block and the `COMMANDS_RULE_CONTENT` describe block (which
   asserted `fs.writeFile` and content sync against `shared/rules/commands.md`) are both deleted.
   The `removeCommandsRule` block is renamed to `removeLegacyCommandsRule`. `beforeEach` stubs were
   flipped from `fs.writeFile`/`fs.mkdir` to `fs.unlink`. Full suite: `npx vitest run tests/ambient.test.ts`
   → 40 passed, 0 failed.

### Additional checks
- **Build integrity of deleting `shared/rules/commands.md`**: The CLAUDE.md build contract fails
  if a *declared* rule is missing. `devflow-ambient/.claude-plugin/plugin.json` has no `rules` array
  and no `commands` reference — the rule was managed by ambient.ts directly, not the plugin rules
  system. No other plugin.json declares `commands`. `npm run build:cli` succeeds. No build regression.
- **Doc/manifest consistency**: `plugins.ts`, plugin.json description/keywords, init.ts `--ambient`
  option text, and the ambient command help text were all updated to drop "command awareness".
  Coherent with the feature removal.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None relevant to this diff.

## Suggestions (Lower Confidence)

- **Operational rebuild/reinstall dependency** — `src/cli/commands/ambient.ts` (Confidence: 65%) —
  The legacy-rule purge only fires on ambient enable/disable/init code paths. Users who never re-run
  one of those paths will retain a stale `~/.claude/rules/devflow/commands.md` indefinitely. This is
  acceptable under the clean-break philosophy (the rule is inert and harmless), but worth a one-line
  note in release docs (relates to PF-003's rebuild-and-reinstall theme). Not a code regression.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 10
**Recommendation**: APPROVED

Decisions cited: applies ADR-001, avoids PF-001.
