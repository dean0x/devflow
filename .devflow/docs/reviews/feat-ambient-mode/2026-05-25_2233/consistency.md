# Consistency Review Report

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### HIGH

**Dual-source content: `COMMANDS_RULE_CONTENT` constant in `ambient.ts` duplicates `shared/rules/commands.md`** - `src/cli/commands/ambient.ts:26-52`, `shared/rules/commands.md:1-27`
**Confidence**: 90%
- Problem: The rule content exists in two locations: as a TypeScript template literal (`COMMANDS_RULE_CONTENT`) and as the canonical `shared/rules/commands.md` file. The CLAUDE.md correctly notes the rule is "managed by ambient.ts directly, NOT by the rules plugin system", but keeping identical content in two files creates a consistency drift risk. Every other rule in the system has a single source of truth in `shared/rules/`, which the build system distributes. This rule is the only one that bypasses that pattern with an inline constant. If someone edits `shared/rules/commands.md` (e.g., adding a new command), the `COMMANDS_RULE_CONTENT` constant will silently diverge.
- Fix: Read `shared/rules/commands.md` at install time from the package root (similar to how `installViaFileCopy` reads from `pluginsDir`) instead of embedding content in a constant. Alternatively, remove `shared/rules/commands.md` and make `ambient.ts` the sole source, since the build system does not distribute this rule via `plugin.json` anyway. The key is one source, not two.

### MEDIUM

**`addAmbientHook` performs file I/O but early-return path skips it** - `src/cli/commands/ambient.ts:125-131`
**Confidence**: 82%
- Problem: When the preamble hook already exists, `addAmbientHook` still writes the commands rule file (line 126-127) but then returns the unchanged `settingsJson` string (line 129). This is functionally correct for the rule file write but creates inconsistency: the function's return value signals "nothing changed" while it did perform a side effect (file write). The caller in `ambient.ts:232-235` prints "Ambient mode already enabled" and returns early, but the comment on line 234 acknowledges the discrepancy. This pattern deviates from the established convention in this codebase where functions either return a changed value (signaling work done) or return unchanged input (signaling no-op). Mixing return semantics with silent side effects breaks that convention.
- Fix: Either (a) separate the rule file write into its own function called independently of the settings mutation, or (b) always return the settings JSON when the rule was written even if the hook was already present, so the return value accurately reflects whether any work was done.

**`removeAmbientHook` silently cleans stale SessionStart hooks but return value ignores it** - `src/cli/commands/ambient.ts:144-154`
**Confidence**: 85%
- Problem: `removeAmbientHook` calls `filterHookEntries(settings, 'SessionStart', isClassification)` on line 145 without capturing its return value. The result of `filterHookEntries` (which returns `true` if entries were removed) is discarded. On line 154, the function only checks `removedPrompt` to decide whether to return changed JSON. This means if a user has a stale classification hook but no preamble hook, calling `removeAmbientHook` will mutate the `settings` object in memory (removing the stale hook) but return the original `settingsJson` string since `removedPrompt` is false. The in-memory mutation is lost. The function's JSDoc says "Removes preamble + legacy from UserPromptSubmit. Also removes stale SessionStart classification hook" but it silently fails to persist the SessionStart cleanup in this edge case.
- Fix: Capture the return value: `const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);` and change the guard on line 154 to `if (!removedPrompt && !removedClassification) return settingsJson;`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`hasAmbientHook` no longer checks SessionStart but callers may rely on full-detection semantics** - `src/cli/commands/ambient.ts:161-168`
**Confidence**: 80%
- Problem: Before this PR, `hasAmbientHook` returned `true` if either the preamble/legacy hook OR the classification hook was present. Now it only checks UserPromptSubmit. This is correct for the new architecture, but creates a consistency gap: a user who enabled ambient mode with a prior version has both hooks. After upgrading but before running `devflow init` or `devflow ambient --enable`, `hasAmbientHook` correctly returns `true` (the preamble hook is still there). However, a user who only has the stale classification SessionStart hook (e.g., from a partial install that added SessionStart but not UserPromptSubmit) would now get `false`, which is the correct answer for the new semantics. This is acceptable behavior -- flagging it as should-fix level only because the edge case is narrow and the behavior is defensible.
- Fix: No code change needed if this edge case is acceptable. Add a comment to `hasAmbientHook` noting that it intentionally does not detect stale SessionStart-only configurations, for future readers.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`shared/rules/commands.md` exists in git but is not declared in any plugin's `rules` array** - `plugins/devflow-ambient/.claude-plugin/plugin.json` (Confidence: 72%) -- The file sits in `shared/rules/` alongside all other rules, but no plugin claims it. The build system validates that declared rules exist but does not detect undeclared rules. This orphan file could confuse future developers who expect the build-distribute pattern to cover all rules. Consider either adding a comment in `shared/rules/commands.md` noting it is ambient-managed, or removing it from `shared/rules/` entirely since `ambient.ts` is the true source.

- **Plugin `devflow-ambient` still ships 14 agents and 29 skills but ambient mode now only uses 1 hook and 1 rule** - `plugins/devflow-ambient/.claude-plugin/plugin.json:18-63` (Confidence: 65%) -- The agent/skill lists in plugin.json remain from the old 4-layer architecture where ambient mode could spawn any agent. With the new plan-detection-only hook, ambient mode itself never invokes these agents or skills. They remain installed because "universal skill installation" installs all skills from all plugins, and the agents are needed when the user invokes `/devflow:<name>` commands post-plan-detection. This is architecturally correct but the plugin manifest now overstates what ambient mode does. A future cleanup pass could move these to the plugins that actually orchestrate them.

- **CLAUDE.md workflow skills count says 9 but Skill tool list shows `implement:orch` through `release:orch` as available skills alongside the deleted triage/guided skills** - `CLAUDE.md:221` (Confidence: 60%) -- The skill count update to 9 is correct for the codebase, but the installed Claude Code environment may still have the old guided/triage skill directories until the user runs `devflow init` to clean them up. Not a code issue -- just a deployment consideration. The `LEGACY_SKILL_NAMES` array in `plugins.ts` should include the deleted skill names for automatic cleanup.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR achieves a clean simplification (applies ADR-001 clean break philosophy) and the terminology updates are thorough -- descriptions, docs, tests, CLAUDE.md, and README.md all consistently use the new "plan auto-detection and command awareness" framing. The old "four-layer", "GUIDED/ORCHESTRATED", "classification", "triage", and "router" terminology is comprehensively removed from changed files with no stale references found in the remaining codebase.

The blocking HIGH issue is the dual-source content between `COMMANDS_RULE_CONTENT` and `shared/rules/commands.md`. This is a consistency pattern violation (two sources of truth for identical content) that will cause future drift. The two MEDIUM issues in the return-value semantics of `addAmbientHook`/`removeAmbientHook` are less urgent but represent deviations from the established pure-function conventions in this codebase where return values accurately reflect mutation state.
