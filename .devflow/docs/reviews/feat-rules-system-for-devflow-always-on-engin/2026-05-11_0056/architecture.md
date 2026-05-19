# Architecture Review Report

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11

## Issues in Your Changes (BLOCKING)

### HIGH

**Module-level eager evaluation of `allRulesMap` in rules.ts** - `src/cli/commands/rules.ts:33`
**Confidence**: 85%
- Problem: `const allRulesMap = buildRulesMap(DEVFLOW_PLUGINS);` executes at module load time, not lazily. This means importing the `rulesCommand` for any reason (e.g., registering it in `cli.ts`) eagerly iterates all plugins and builds the map, even when the user runs an entirely different subcommand (e.g., `devflow flags --list`). While the cost is trivial today (20 plugins, 11 rules), it sets a pattern precedent that violates lazy initialization principles. Other commands in this codebase (e.g., `init.ts`, `uninstall.ts`) compute their maps inside the action handler, not at module scope.
- Fix: Move `allRulesMap` inside `formatRuleRow` as a lazily-initialized closure variable, or compute it once inside the action handler and pass it through:
```typescript
let _allRulesMap: Map<string, string> | null = null;
function getAllRulesMapCached(): Map<string, string> {
  if (!_allRulesMap) _allRulesMap = buildRulesMap(DEVFLOW_PLUGINS);
  return _allRulesMap;
}
```

### MEDIUM

**Duplicated shadow-check + copy logic across three locations** - `src/cli/commands/rules.ts:73-86`, `src/cli/utils/installer.ts:266-283`, `src/cli/commands/init.ts` (via rulesMap)
**Confidence**: 82%
- Problem: The shadow-check-then-copy pattern for rules is implemented independently in three places: (1) `installViaFileCopy` in installer.ts, (2) `--enable` handler in rules.ts, and (3) implicitly through the installer again via init.ts. The installer and the `--enable` command both contain the same inline logic: check `~/.devflow/rules/{name}.md` with `fs.access`, then either copy shadow or source. This violates DIP/SRP -- when the shadow logic changes (e.g., adding content validation like skills do with `entries.length > 0`), it must be updated in multiple places.
- Fix: Extract a shared `installRule(ruleName, ownerPlugin, pluginsDir, devflowDir, rulesTarget)` helper into `installer.ts` and call it from both locations. This mirrors how `copyDirectory` is already shared.

**`rules` field is optional on `PluginDefinition` but inconsistently handled** - `src/cli/plugins.ts:40`, `src/cli/commands/uninstall.ts:41,56`
**Confidence**: 80%
- Problem: `rules` is declared as `rules?: string[]` on `PluginDefinition`, which means every consumer must use the `plugin.rules ?? []` fallback pattern. Currently 5 call sites use `plugin.rules ?? []`. This is a minor ISP concern -- the field semantically means "no rules" when absent vs. when empty, but both cases are identical. More importantly, it creates inconsistency with `skills` and `agents` which are required `string[]` fields (never optional). Plugins without rules already omit the field by convention (per KNOWLEDGE.md: "do not set `rules: []`"), so the optionality is intentional -- but it forces defensive coding at every consumer.
- Fix: This is a design trade-off that was made deliberately (avoiding empty arrays on plugins that predate rules). Acceptable as-is, but document the convention in a JSDoc comment on the field explaining why it differs from `skills`/`agents`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`--enable` does not clean stale rules before installing** - `src/cli/commands/rules.ts:69`
**Confidence**: 83%
- Problem: When `devflow rules --enable` is called, it creates the target directory and copies rules from the manifest's plugins, but it does not first remove existing rule files in `~/.claude/rules/devflow/`. If the user previously had `devflow-typescript` installed, then removed it and ran `--enable`, the `typescript.md` rule file persists because `--enable` only adds, never removes. This is the same gotcha documented in the feature knowledge ("Rules are not cleaned between partial installs") but it applies to the `--enable` command itself, not just init. The `--disable` + `--enable` workaround exists but is not obvious.
- Fix: Add `await fs.rm(rulesTarget, { recursive: true, force: true });` before `await fs.mkdir(rulesTarget, { recursive: true });` in the `--enable` path, mirroring how the build script clears and recreates the rules directory.

**`formatFeatures` in list.ts omits several features from display** - `src/cli/commands/list.ts:14-24`
**Confidence**: 80%
- Problem: The `formatFeatures` function now includes `rules` in its output, which is correct. However, it omits `learn`, `knowledge`, and `decisions` -- three features that existed before this PR. This is a pre-existing omission that this PR perpetuates by adding `rules` to the same pattern without addressing the gap. The feature display line shows an incomplete picture of what is enabled.
- Fix: Add `learn`, `knowledge`, and `decisions` to the `formatFeatures` output array. (Pre-existing, noted as context for the rules addition.)

## Pre-existing Issues (Not Blocking)

_No critical pre-existing architecture issues found in the reviewed files._

## Suggestions (Lower Confidence)

- **`devflow rules --enable` silently skips missing rule source files** - `src/cli/commands/rules.ts:82-84` (Confidence: 70%) -- When `fs.access(ruleSource)` fails, the `catch { continue; }` silently skips that rule with no user feedback. A missing rule source likely indicates a build was not run after modification. A `p.log.warn` would help the user diagnose the issue.

- **No mutual exclusivity enforcement on `--enable`/`--disable`/`--status`/`--list`** - `src/cli/commands/rules.ts:55` (Confidence: 65%) -- Running `devflow rules --enable --disable` would execute only the `--enable` branch due to the `if/else if` chain, but the user may expect an error. Other commands in this codebase have similar patterns, so this is consistent, but it could be surprising.

- **Module-level `allRulesMap` in rules.ts uses `DEVFLOW_PLUGINS` (all plugins), while `--enable` correctly uses manifest plugins** - `src/cli/commands/rules.ts:33,67` (Confidence: 72%) -- The `allRulesMap` at line 33 maps ALL rule names to their owners (for display purposes), while the `--enable` handler at line 67-68 correctly scopes to installed plugins only. This is intentionally different (display vs. install), but the comment "Reverse map of all rule names to their owning plugin" could be clearer about why it uses all plugins rather than manifest plugins.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The rules system is architecturally well-designed. It follows the existing skill/agent pipeline pattern faithfully (applies ADR-001 -- no migration code, clean break with empty `LEGACY_RULE_NAMES`), maintains clear separation between build-time distribution and install-time placement, and correctly scopes rules to selected plugins only. The four-stage pipeline (author, build, install, activate) is clean and well-documented in the feature knowledge base.

The main architectural concern is the duplicated shadow-check-then-copy logic across installer.ts and rules.ts, which will become a maintenance burden if the shadow resolution logic evolves. The module-level eager evaluation is a minor pattern violation. Neither is blocking -- the overall design is consistent with the existing codebase patterns and the feature is well-integrated across init, uninstall, list, and manifest tracking.
