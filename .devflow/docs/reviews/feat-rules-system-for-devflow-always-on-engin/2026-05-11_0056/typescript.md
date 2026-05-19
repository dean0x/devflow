# TypeScript Review Report

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Module-level side effect: `buildRulesMap(DEVFLOW_PLUGINS)` executed at import time** - `src/cli/commands/rules.ts:33`
**Confidence**: 85%
- Problem: `const allRulesMap = buildRulesMap(DEVFLOW_PLUGINS);` runs at module load, not lazily. Every `import` of `rules.ts` (even if the `rules` command is never invoked) pays the cost of iterating all plugins and building the map. More importantly, if `DEVFLOW_PLUGINS` is modified at runtime or in tests, the map is stale. This pattern makes the module harder to test in isolation.
- Fix: Move the computation inside `formatRuleRow` or use a lazy initializer:
```typescript
let _allRulesMap: Map<string, string> | null = null;
function getAllRulesMap(): Map<string, string> {
  if (!_allRulesMap) _allRulesMap = buildRulesMap(DEVFLOW_PLUGINS);
  return _allRulesMap;
}
```

**`devflow rules --enable` does not clean stale rules before installing** - `src/cli/commands/rules.ts:69`
**Confidence**: 88%
- Problem: The `--enable` path creates the `rulesTarget` directory and copies rules into it, but never removes rules that were previously installed from plugins that are no longer in the manifest. If a user had `devflow-typescript` installed, ran `--enable`, then uninstalled `devflow-typescript` and ran `--enable` again, the `typescript.md` rule would persist as an orphan. Compare with `installViaFileCopy` in `installer.ts:143` which wipes the entire `rules/devflow` directory on full install.
- Fix: Add a clean step before the install loop:
```typescript
// Clean existing rules before re-installing
try {
  await fs.rm(rulesTarget, { recursive: true, force: true });
} catch { /* ignore */ }
await fs.mkdir(rulesTarget, { recursive: true });
```

### MEDIUM

**`rules` field on `PluginDefinition` is optional but accessed inconsistently** - `src/cli/plugins.ts:40`, `src/cli/commands/uninstall.ts:41,56`
**Confidence**: 82%
- Problem: The `rules` field is declared as `rules?: string[]`, requiring `(plugin.rules ?? [])` at every access site. This creates a maintenance burden and risk of forgetting the nullish coalescing. Other array fields (`commands`, `agents`, `skills`) are required `string[]` and default to `[]` in plugin definitions. Following the same pattern for `rules` would eliminate all the `?? []` guards.
- Fix: Make `rules` a required field with default `[]` in the interface and in all `DEVFLOW_PLUGINS` entries that lack rules:
```typescript
// In PluginDefinition:
rules: string[];  // not optional

// In DEVFLOW_PLUGINS entries without rules:
rules: [],
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`formatFeatures` omits `learn`, `knowledge`, and `decisions` from display** - `src/cli/commands/list.ts:15-23`
**Confidence**: 90%
- Problem: The `formatFeatures` function displays `teams`, `ambient`, `memory`, `hud`, `rules`, and `flags` but omits `learn`, `knowledge`, and `decisions`. Since this PR added `rules` to the list without adding the other missing features, the omission becomes more visible. Users running `devflow list` see an incomplete feature summary.
- Fix: Add the missing feature flags:
```typescript
const parts = [
  features.teams ? 'teams' : null,
  features.ambient ? 'ambient' : null,
  features.memory ? 'memory' : null,
  features.learn ? 'learn' : null,
  features.hud ? 'hud' : null,
  features.knowledge ? 'knowledge' : null,
  features.decisions ? 'decisions' : null,
  features.rules ? 'rules' : null,
  features.flags?.length ? `flags: ${features.flags.length}` : null,
].filter(Boolean);
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`isShadowed` variable name shadows the function import pattern** - `src/cli/utils/installer.ts:242,267` (Confidence: 65%) -- The local `let isShadowed` variable in both the skills and rules install loops reuses the same name as the helper function in `rules.ts`. While technically separate scopes and no actual name conflict, it could confuse readers scanning across files. Consider `isRuleShadowed` / `hasShadow` for clarity.

- **`getAllRuleNames` returns `string[]` from `Set` without deterministic ordering** - `src/cli/plugins.ts:590-598` (Confidence: 70%) -- `Set` iteration follows insertion order, which depends on `DEVFLOW_PLUGINS` array order. This is stable today but fragile if plugins are reordered. For `--list` display, consider sorting the result explicitly: `return [...rules].sort()`.

- **`--enable` success message may overcount** - `src/cli/commands/rules.ts:91` (Confidence: 62%) -- The message reports `rulesMap.size` as the count of installed rules, but some rules may have been skipped via the `catch { continue; }` path when the source file is missing. The actual count could be lower than reported.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The implementation follows existing codebase patterns closely (applies ADR-001 -- `LEGACY_RULE_NAMES` starts empty with no migration compat code). Type safety is solid throughout: the `ManifestData` interface is properly extended, `PluginDefinition` has the new field, and all call sites handle the optional `rules` field correctly. The `readManifest` self-heal default of `true` for missing `rules` field is a reasonable choice for upgrade paths.

The two HIGH findings are both about stale state: `--enable` not cleaning orphan rules, and the module-level `buildRulesMap` call creating an immutable map at import time. The MEDIUM interface consistency issue (`rules?: string[]` vs required `string[]` for sibling fields) is a minor ergonomic concern that creates defensive-coding overhead across multiple files.
