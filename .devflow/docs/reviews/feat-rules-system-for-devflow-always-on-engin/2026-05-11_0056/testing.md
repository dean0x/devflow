# Testing Review Report

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11

## Issues in Your Changes (BLOCKING)

### HIGH

**No tests for `rules.ts` command (4 subcommands untested)** - `src/cli/commands/rules.ts:49-141`
**Confidence**: 95%
- Problem: The `devflow rules` command has 4 subcommands (`--enable`, `--disable`, `--status`, `--list`) with non-trivial logic (manifest read/write, shadow resolution, file I/O, plugin filtering), but zero test coverage. Every other `devflow` subcommand with comparable complexity (`flags`, `ambient`, `learn`, `decisions`, `knowledge`) has a corresponding test file. The `isShadowed()` and `formatRuleRow()` helper functions are also untested.
- Fix: Create `tests/rules.test.ts` with tests for the exported helpers (`isShadowed`, `formatRuleRow`) and integration-level tests for each subcommand using a temporary directory structure. The pure helper functions can be tested in isolation; the command action should be tested by extracting testable logic (similar to how `computeAssetsToRemove` and `formatDryRunPlan` are extracted from `uninstall.ts` for testability). At minimum, test:
  - `--enable` installs rules from manifest plugins (create temp plugin dir, verify files copied)
  - `--enable` respects shadow overrides
  - `--disable` removes rules directory and updates manifest
  - `--status` lists installed rules
  - `--list` shows all available rules with install indicators
  - `--enable` with no manifest exits with error

**No tests for `computeAssetsToRemove` rules handling** - `src/cli/commands/uninstall.ts:28-62`
**Confidence**: 92%
- Problem: `computeAssetsToRemove` was updated to return a `rules` field and compute retained rules from remaining plugins. The existing `uninstall-logic.test.ts` tests do not assert on the `rules` property at all. None of the existing tests verify that rules unique to removed plugins are included in the removal list, or that rules shared with remaining plugins are retained.
- Fix: Add tests to `tests/uninstall-logic.test.ts`:
  ```typescript
  it('removes rules unique to selected plugins', () => {
    const tsPlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-typescript')!;
    const { rules } = computeAssetsToRemove([tsPlugin], DEVFLOW_PLUGINS);
    expect(rules).toContain('typescript');
  });

  it('retains rules shared with remaining plugins', () => {
    const corePlugin = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills')!;
    // Removing only core-skills; no other plugin has 'security' etc.
    const { rules } = computeAssetsToRemove([corePlugin], DEVFLOW_PLUGINS);
    expect(rules).toContain('security');
  });

  it('returns empty rules when no plugins selected', () => {
    const { rules } = computeAssetsToRemove([], DEVFLOW_PLUGINS);
    expect(rules).toEqual([]);
  });
  ```

**No tests for `formatDryRunPlan` with rules** - `src/cli/commands/uninstall.ts:69-92`
**Confidence**: 90%
- Problem: `formatDryRunPlan` was updated to accept and display a `rules` field, but the existing tests in `uninstall-logic.test.ts` never pass a `rules` array. The existing tests still pass objects without `rules`, which works because the type is `rules?: string[]` (optional), but this means the new output path is never exercised.
- Fix: Add tests to `tests/uninstall-logic.test.ts`:
  ```typescript
  it('includes rules section in dry-run output', () => {
    const plan = formatDryRunPlan({
      skills: [], agents: [], commands: [],
      rules: ['security', 'engineering'],
    });
    expect(plan).toContain('Rules (2)');
    expect(plan).toContain('security');
  });
  ```

### MEDIUM

**No orphan detection test for rules in `build.test.ts`** - `tests/build.test.ts:85-93`
**Confidence**: 85%
- Problem: The `build.test.ts` file has an `"all skills in shared/skills/ are referenced by at least one plugin"` test and an equivalent for agents, but there is no corresponding orphan detection test for rules. If a rule file exists in `shared/rules/` but is not declared in any `plugin.json` `rules` array, it will be silently ignored during build and install. The existing `"every rule referenced in plugins exists in shared/rules/"` test covers only one direction (declared-but-missing); the reverse (present-but-undeclared) is untested.
- Fix: Add to `tests/build.test.ts`:
  ```typescript
  it('all rules in shared/rules/ are referenced by at least one plugin', async () => {
    const ruleFiles = await fs.readdir(path.join(ROOT, 'shared', 'rules'));
    const referencedRules = new Set(getAllRuleNames());
    for (const file of ruleFiles) {
      if (!file.endsWith('.md')) continue;
      const name = path.basename(file, '.md');
      expect(referencedRules.has(name), `shared/rules/${file} is not referenced by any plugin`).toBe(true);
    }
  });
  ```

**`formatFeatures` tests do not cover the `rules` feature** - `tests/list-logic.test.ts:10-63`
**Confidence**: 88%
- Problem: The `formatFeatures` function was updated to include `rules` in its output, but none of the existing tests in `list-logic.test.ts` pass a `features` object with `rules: true`. The tests use partial `ManifestData['features']` objects that lack the `rules` field. When `rules: true` is set, the output should include `"rules"` in the comma-separated list, but this is never verified.
- Fix: Add a test to `tests/list-logic.test.ts`:
  ```typescript
  it('includes rules when enabled', () => {
    const features: ManifestData['features'] = {
      teams: false, ambient: false, memory: false, hud: false, learn: false,
      knowledge: false, decisions: false, rules: true, flags: [],
    };
    expect(formatFeatures(features)).toBe('rules');
  });
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`normalizes old manifest without hud/learn to defaults` test does not assert `rules` field** - `tests/manifest.test.ts:104-121`
**Confidence**: 82%
- Problem: The test `"normalizes old manifest without hud/learn to defaults"` writes a minimal features object `{ teams: false, ambient: true, memory: true }` and then asserts specific defaults for `hud`, `learn`, `knowledge`, `decisions`, and `flags`. It does not assert what the `rules` field defaults to in this scenario. While a separate test (`"normalizes old manifest without rules to default true"`) covers the explicit rules-only case, the comprehensive normalization test should also verify rules alongside the other fields for completeness.
- Fix: Add `expect(result!.features.rules).toBe(true);` to the existing assertion block at line 120.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`allRulesMap` computed at module scope in `rules.ts`** - `src/cli/commands/rules.ts:33` (Confidence: 65%) -- The module-level `const allRulesMap = buildRulesMap(DEVFLOW_PLUGINS)` is computed eagerly at import time. If `DEVFLOW_PLUGINS` changes shape in future, or if tests need to mock plugin definitions, this will be difficult to override. Consider lazy initialization or dependency injection for testability.

- **Missing integration test for shadow resolution during install** - `src/cli/utils/installer.ts:258-284` (Confidence: 70%) -- The rules shadow path in `installViaFileCopy` is untested at any level. If a shadow file exists at `~/.devflow/rules/{name}.md`, it should override the plugin source, but this behavior has no test coverage. A targeted integration test with a temp directory would prevent regressions.

- **`computeAssetsToRemove` custom-plugins test omits `rules`** - `tests/uninstall-logic.test.ts:63-74` (Confidence: 72%) -- The custom plugin test creates synthetic `PluginDefinition` objects without the `rules` field. Adding `rules: ['shared-rule', 'only-a-rule']` to the synthetic plugins would exercise the retention/removal logic for rules in isolation.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 4/10
**Recommendation**: CHANGES_REQUESTED

The rules system implementation follows existing patterns well (applies ADR-001 -- LEGACY_RULE_NAMES starts empty with no migration code), but the test coverage has significant gaps. The core logic in `rules.ts` (141 lines, 4 subcommands) has zero test coverage. The uninstall changes (`computeAssetsToRemove` rules field, `formatDryRunPlan` rules section) are exercised by existing tests only in the default (no-rules) path. The manifest normalization test for rules is present and good, as are the `buildRulesMap` tests and the build-time rule-reference validation. However, the testing gap ratio (3 HIGH blocking findings on new untested paths vs 4 test files that were updated) indicates the test effort was concentrated on data-layer functions while command-layer behavior went untested.
