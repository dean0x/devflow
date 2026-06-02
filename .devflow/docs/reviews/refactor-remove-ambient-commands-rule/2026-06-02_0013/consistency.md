# Consistency Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main (PR #233)
**Date**: 2026-06-02_0013
**Focus**: Consistency of the docs sweep — complete removal of all `commands.md` / commands-rule references, rule-count consistency (must read 12 everywhere), and naming consistency of `removeLegacyCommandsRule`.

## Scope Note

The PR deletes the ambient-managed `commands` rule (`shared/rules/commands.md`), renames `removeCommandsRule` → `removeLegacyCommandsRule`, deletes `COMMANDS_RULE_CONTENT` / `installCommandsRule`, and performs a documentation sweep across CLAUDE.md, README.md, docs/commands.md, docs/cli-reference.md, plugin README + plugin.json, plugins.ts, init.ts, and the cli-rules KNOWLEDGE.md.

Per Cross-Cycle Awareness (PRIOR_RESOLUTIONS): the three Cycle-1 fixes (fail-safe error handling, README count 13→12, removed fabricated PF-007 citation) were verified as still applied and are NOT re-raised. The README now correctly reads "12 ultra-condensed engineering principles" (README.md:56) and `removeLegacyCommandsRule` swallows all errors fail-safe (ambient.ts:65-73).

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale `referencedFiles` entry points at the deleted `shared/rules/commands.md`** — `.devflow/features/index.json:26` (committed HEAD)
**Confidence**: 90%
- Problem: This PR deletes `shared/rules/commands.md`, but the committed `cli-rules` knowledge-base index entry still lists `"shared/rules/commands.md"` in its `referencedFiles` array (HEAD:.devflow/features/index.json line 26). The `description` keyword list on line 6 also still includes `commands.md`. The companion KNOWLEDGE.md was updated correctly (its `referenced_files` frontmatter lists only the 4 core rules and the body documents the removal + the new `removeLegacyCommandsRule()` keyword), so the index and the KNOWLEDGE.md are now out of sync with each other and with the source tree.
- Impact: `referencedFiles` drives staleness detection via `git log` against those paths (per the Feature Knowledge Bases design). A deleted path can never produce a meaningful diff, so the entry is dead. More importantly, it is an internal inconsistency: every other doc artifact in the sweep was updated to reflect the deletion, but this metadata file was missed — the same class of straggler the PR set out to eliminate.
- Fix: In `.devflow/features/index.json`, remove `"shared/rules/commands.md"` from the `cli-rules.referencedFiles` array, and drop `commands.md` from the `description` keyword list (replace with `removeLegacyCommandsRule` to match KNOWLEDGE.md frontmatter line 4). Note: the uncommitted working-tree change to this file refreshes `lastUpdated` and keywords but does NOT remove the stale `referencedFiles` entry — the fix must explicitly delete line 26.

## Pre-existing Issues (Not Blocking)

None relevant to this focus.

## Suggestions (Lower Confidence)

None.

## Verification Performed (no issues found)

The following consistency checks passed — recorded so the synthesizer can see coverage:

- **Rule count = 12 everywhere**: CLAUDE.md ("Currently 12 rules: 4 core + 8 language/UI" + "shared/rules/ # 12 rules"), README.md:56 ("12 ultra-condensed engineering principles"), and KNOWLEDGE.md ("12 rules total: 4 core + 8 language/ecosystem"; "flat .md files (12 total)") all agree. No surviving "13 rules" in any tracked file outside `.devflow/docs/reviews/` (historical artifacts, out of scope).
- **No "two-component" / "command awareness" stragglers**: `git grep` for `command awareness|two-component|13 rules|command listing` across `*.md`/`*.ts`/`*.json` (excluding review/audit/bug-analysis report dirs) returned zero hits. CLAUDE.md now says "Single-component system"; docs/commands.md dropped the "two components" framing to a single "Plan auto-detection" bullet; plugin README and cli-reference both read "plan auto-detection" only.
- **Plugin metadata consistent**: `plugins/devflow-ambient/.claude-plugin/plugin.json` description = "Plan auto-detection", keywords pruned to `[ambient, plan, detection]` (removed `commands`, `awareness`); `src/cli/plugins.ts` ambient entry matches with the same description and `rules: []`. No plugin declares a `commands` rule.
- **Dead-symbol sweep clean**: `installCommandsRule` and `COMMANDS_RULE_CONTENT` have zero references in live source/tests/docs — all remaining mentions are confined to `.devflow/docs/reviews/` history.
- **Naming consistency of `removeLegacyCommandsRule`**: Follows the established verb-first `removeXxx` convention used by siblings (`removeAmbientHook`, `removeMemoryHooks`, `removeContextHook`, `removeHudStatusLine`, `removeManagedSettings`). The `Legacy` qualifier is meaningful and aligns with the existing `LEGACY_*` constant vocabulary (`LEGACY_RULE_NAMES`, `LEGACY_COMMAND_NAMES`, `LEGACY_SKILL_NAMES`, `LEGACY_HOOK_FILES`) — it correctly signals "purge a deprecated file" vs. "remove an active feature". The rename is applied consistently across `ambient.ts` (definition + 2 call sites) and `tests/ambient.test.ts` (import, describe block, comments); no old `removeCommandsRule` name survives in live code.
- **init.ts cleanup path**: init.ts has no direct commands-rule reference; legacy cleanup runs indirectly via `addAmbientHook`/`removeAmbientHook` (both call `removeLegacyCommandsRule` unconditionally before their early-return). This matches the CLAUDE.md/KNOWLEDGE.md claim that purge happens "on every `devflow ambient --enable/--disable` or `devflow init`" and preserves the Cycle-1 fail-safe fix.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 9
**Recommendation**: APPROVED_WITH_CONDITIONS

The documentation sweep is thorough and internally consistent across all prose docs, plugin metadata, source, and tests — rule count reads 12 everywhere and no "two-component" / "command awareness" / removed-symbol stragglers remain. The single condition is the stale `shared/rules/commands.md` entry in `.devflow/features/index.json` `referencedFiles` (and the `commands.md` keyword in its description), which points at a file this PR deleted and is the one place the sweep missed. Low-risk, mechanical fix.
