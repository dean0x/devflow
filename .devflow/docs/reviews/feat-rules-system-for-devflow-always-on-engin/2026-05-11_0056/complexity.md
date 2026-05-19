# Complexity Review Report

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11

## Issues in Your Changes (BLOCKING)

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### HIGH

**init.ts action handler exceeds complexity thresholds** - `src/cli/commands/init.ts:165-1236`
**Confidence**: 95%
- Problem: The `initCommand.action()` handler is a single function spanning ~1070 lines (line 165 to 1236). It contains two major branches (recommended vs advanced paths), deeply nested TTY/non-TTY conditionals, 10+ feature toggle prompt blocks, plugin resolution, migration orchestration, file installation, hook configuration, safe-delete handling, and summary output -- all in one closure. Cyclomatic complexity is well above 20. This is a pre-existing issue significantly worsened by this PR adding ~40 lines of rules-related logic (rules prompt in advanced path, rulesEnabled wiring, summary line, legacy cleanup, post-install removal).
- Impact: Each new feature toggle (rules, decisions, knowledge, flags, etc.) compounds the complexity of this function linearly. The function is not testable in isolation -- only integration tests exercise it. New contributors cannot understand the full flow in under 5 minutes.
- Fix: This is a pre-existing architectural concern. The recommended path would be to extract feature prompt blocks into a `collectFeatureChoices()` helper, extract the installation phase into `executeInstallation()`, and extract cleanup/summary into their own functions. The rules addition follows the existing pattern correctly -- the problem is the pattern itself.

### MEDIUM

**plugins.ts LEGACY_SKILL_NAMES array is 197 entries long** - `src/cli/plugins.ts:277-473`
**Confidence**: 85%
- Problem: The `LEGACY_SKILL_NAMES` array spans ~197 entries across 7 version-era sections. While this PR does not modify this array, the adjacent `LEGACY_RULE_NAMES` (currently empty) follows the same pattern. As rules evolve through renames, this array will grow unboundedly, mirroring the skill legacy list.
- Impact: The array itself is not computationally complex, but it is a maintenance burden -- each rename requires adding entries to multiple arrays, and the lack of a programmatic rename registry means the only documentation is inline comments.
- Fix: Informational. The PR correctly starts `LEGACY_RULE_NAMES` empty (`applies ADR-001` -- no migration code for new features, clean break). The pruning comment ("entries can be removed after 2 major versions") is a good convention. No action needed now.

## Suggestions (Lower Confidence)

- **Duplicated isShadowed pattern** - `src/cli/commands/rules.ts:23-29`, `src/cli/utils/installer.ts:268-271` (Confidence: 70%) -- The `isShadowed` check (fs.access on shadow path, catch to false) appears in both rules.ts and installer.ts. Currently low-impact with only 2 occurrences, but if more asset types add shadow support, extracting to a shared utility (`isShadowedFile(devflowDir, category, name)`) would reduce duplication.

- **rules.ts action handler has 4 branches at same nesting level** - `src/cli/commands/rules.ts:55-141` (Confidence: 65%) -- The `if/else if/else if/else if/else` chain for enable/disable/status/list is readable at 4 branches but would benefit from a command map or strategy pattern if a 5th subcommand is added. Current complexity is within acceptable bounds.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 1 | 1 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED

The rules system introduces well-structured, low-complexity code across all new and modified files. The `rules.ts` command is 141 lines with clean separation between subcommands. Helper functions (`isShadowed`, `formatRuleRow`, `buildRulesMap`, `getAllRuleNames`) are extracted at appropriate granularity. The build script extension follows the existing skill/agent pattern exactly, keeping each asset type handler under 30 lines. The `computeAssetsToRemove` function in `uninstall.ts` was extended cleanly with rules following the skills/agents pattern.

The only complexity concern is pre-existing: `init.ts` continues to grow with each new feature toggle, and this PR adds ~40 more lines to the monolithic action handler. However, the rules additions are consistent with every other feature's integration pattern, and the PR itself does not introduce any new complexity anti-patterns.

`applies ADR-001` -- LEGACY_RULE_NAMES starts empty, no migration code added for the new rules feature, consistent with the clean-break philosophy.
