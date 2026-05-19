# Regression Review Report

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**`rules --enable` does not clean stale rules from removed plugins** - `src/cli/commands/rules.ts:60-86`
**Confidence**: 82%
- Problem: When a user runs `devflow rules --enable`, the command creates the rules target directory and copies rules for currently installed plugins, but does NOT remove rule files from previously installed plugins. If a user had `typescript` plugin installed, then uninstalled it, then ran `devflow rules --enable`, the stale `typescript.md` rule file persists. The `devflow init` full-install path wipes `rules/devflow/` before reinstalling (line 143 of installer.ts), but the standalone `rules --enable` command does not.
- Impact: Users may have stale rules from plugins they no longer use, consuming token budget and applying irrelevant guidance. This is a behavior change from `init`'s clean-install semantics.
- Fix: Add a wipe step before copying rules in the `--enable` path:
```typescript
// Before copying, clean the target directory to remove stale rules
await fs.rm(rulesTarget, { recursive: true, force: true });
await fs.mkdir(rulesTarget, { recursive: true });
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`allRulesMap` module-level constant may become stale** - `src/cli/commands/rules.ts:33` (Confidence: 65%) -- The `allRulesMap` is computed once at module load time from `DEVFLOW_PLUGINS`. This is safe today since `DEVFLOW_PLUGINS` is also a module-level constant, but if plugins ever become dynamic, this would silently lag. Low-risk observation.

- **`formatFeatures` omits `learn`, `knowledge`, `decisions` but includes `rules`** - `src/cli/commands/list.ts:14-24` (Confidence: 62%) -- The pre-existing pattern already omits several features. Adding `rules` while others remain omitted is inconsistent, but the display purpose is summary-level and the omissions are deliberate (token-heavy features vs lightweight ones).

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Assessment

This PR adds a well-structured rules system that follows the established skill/agent patterns throughout the codebase. The regression review finds:

**No lost functionality**: No exports removed, no files deleted, no API signatures changed. All existing exports and interfaces are extended (not replaced). The `PluginDefinition.rules` field is optional, so all existing plugin definitions remain valid without modification.

**No broken behavior**: Return types are widened (e.g., `computeAssetsToRemove` now returns `rules` in addition to existing fields), but callers that destructure only the existing fields are unaffected. The `ManifestData.features.rules` field defaults to `true` when reading old manifests, which is the correct upgrade behavior (applies ADR-001 -- no migration code, LEGACY_RULE_NAMES starts empty per clean break philosophy; avoids PF-001 -- no backward-compat migration layer added).

**Intent matches implementation**: The commit messages describe adding a rules system and the code delivers exactly that -- 11 rule files, build-time distribution, install-time placement with shadow support, CLI management, manifest tracking, and uninstall cleanup.

**Complete migration**: All necessary touchpoints are updated -- `plugins.ts` (type + data), `init.ts` (flags, prompts, install, cleanup), `uninstall.ts` (both full and selective), `installer.ts` (file copy), `manifest.ts` (type + self-heal), `list.ts` (display), `cli.ts` (command registration), `build-plugins.ts` (distribution), plus 9 `plugin.json` manifests. Tests cover `buildRulesMap`, manifest normalization, and build validation.

**One condition**: The `rules --enable` stale-rule concern should be evaluated. If the intended behavior is that `--enable` does an additive install (documented in KNOWLEDGE.md as a known gotcha), this is fine as-is. If it should match `init`'s clean-install semantics, a wipe step is needed.

All 1381 tests pass.
