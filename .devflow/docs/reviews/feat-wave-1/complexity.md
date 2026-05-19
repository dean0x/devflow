# Complexity Review Report

**Branch**: feat/wave-1 -> main
**Date**: 2026-03-13

## Issues in Your Changes (BLOCKING)

### CRITICAL

_No critical complexity issues found._

### HIGH

_No high-severity complexity issues found._

### MEDIUM

**init.ts action handler continues to grow** - `/Users/dean/Sandbox/devflow/src/cli/commands/init.ts:112-627`
**Confidence**: 85%
- Problem: The `initCommand.action()` handler is a single function spanning ~515 lines. This PR adds 26 more lines (manifest read at line 296-305, manifest write at line 611-624). Cyclomatic complexity is already well above 10 with nested conditionals for scope selection, plugin selection, teams/ambient/memory toggles, security mode, safe-delete, and now upgrade detection. The function is not easy to understand in 5 minutes.
- Fix: This is not new to this PR -- the bulk of the complexity is pre-existing. However, the two new blocks (upgrade detection and manifest write) are cleanly separated and could be extracted to keep the growth trend in check:
  ```typescript
  // Extract upgrade detection to a helper
  async function logUpgradeStatus(
    devflowDir: string,
    version: string,
    spinner: ReturnType<typeof p.spinner>,
  ): Promise<ManifestData | null> {
    const existingManifest = await readManifest(devflowDir);
    if (existingManifest) {
      const upgrade = detectUpgrade(version, existingManifest.version);
      if (upgrade.isUpgrade) {
        spinner.message(`Upgrading from v${upgrade.previousVersion} to v${version}`);
      } else if (upgrade.isSameVersion) {
        spinner.message('Reinstalling same version');
      }
    }
    return existingManifest;
  }
  ```
  Similarly, the manifest write block at the end could be `async function saveManifest(...)`. This keeps each addition bite-sized and prevents the handler from growing further.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**list.ts action handler growing toward the boundary** - `/Users/dean/Sandbox/devflow/src/cli/commands/list.ts:12-65`
**Confidence**: 80%
- Problem: The `listCommand.action()` callback grew from ~15 lines to ~53 lines in this PR. It now includes manifest resolution from two scopes (lines 16-22), feature string building (lines 29-33), install status display (lines 25-43), and plugin list formatting (lines 45-56). While still under the 50-line warning threshold for a single function, it is approaching it and has 3 nesting levels in the manifest display block. The inline ternary chain on line 54 (`return \`${color.cyan(...)...`) is a 127-character expression that hinders readability.
- Fix: Extract the manifest display into a helper function to keep the action handler focused on orchestration:
  ```typescript
  function formatInstallStatus(manifest: ManifestData, isLocal: boolean): string {
    const installedAt = new Date(manifest.installedAt).toLocaleDateString();
    const updatedAt = new Date(manifest.updatedAt).toLocaleDateString();
    const scope = isLocal ? 'local' : 'user';
    const features = [
      manifest.features.teams ? 'teams' : null,
      manifest.features.ambient ? 'ambient' : null,
      manifest.features.memory ? 'memory' : null,
    ].filter(Boolean).join(', ') || 'none';

    return (
      `${color.dim('Version:')}  ${color.cyan(`v${manifest.version}`)}\n` +
      `${color.dim('Scope:')}    ${scope}\n` +
      `${color.dim('Features:')} ${features}\n` +
      `${color.dim('Installed:')} ${installedAt}` +
      (installedAt !== updatedAt ? `  ${color.dim('Updated:')} ${updatedAt}` : '')
    );
  }
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**init.ts overall function length exceeds 500 lines** - `/Users/dean/Sandbox/devflow/src/cli/commands/init.ts:112-627`
**Confidence**: 90%
- Problem: The `initCommand.action()` handler is 515 lines. This vastly exceeds the 50-line "critical" threshold for function length. It handles scope selection, plugin selection, teams configuration, ambient mode, memory mode, security mode, path resolution, plugin installation, legacy cleanup, extras configuration, settings installation, safe-delete, verbose output, and now manifest writing. At least 10 distinct responsibilities in one function.
- Impact: This is a pre-existing issue not introduced by this PR. The new code adds only 26 lines. However, each new feature (ambient, memory, manifest) adds more lines to this already oversized handler. Without decomposition, this will continue to grow.
- Note: Tracked as pre-existing. The recommended approach is to decompose into phases: `resolveScope()`, `selectPlugins()`, `selectFeatures()`, `installPlugins()`, `cleanupLegacy()`, `configureExtras()`, `installSettings()`, `writeManifest()`, `showSummary()`.

### LOW

**mergeManifestPlugins uses O(n*m) includes check** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:50-58`
**Confidence**: 65%
- Problem: `merged.includes(plugin)` inside a loop is O(n*m) where n = existing plugins and m = new plugins. For the current plugin count (~17) this is negligible, but a `Set` would be more idiomatic.
- Note: Tracked as suggestion-level due to low practical impact. See Suggestions section.

## Suggestions (Lower Confidence)

- **Set-based dedup in mergeManifestPlugins** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:50-58` (Confidence: 65%) -- Could use a `Set` for O(1) membership checks instead of `Array.includes`, but plugin lists are small enough that this has zero practical impact.

- **compareSemver could use early-return for identical strings** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:64-80` (Confidence: 60%) -- Adding `if (a === b) return 0;` before parsing would skip regex work for the common reinstall case, but the optimization is trivial.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new code added in this PR (`manifest.ts`, `list.ts` changes, `init.ts` additions) is well-structured with clear single-responsibility functions. `manifest.ts` is exemplary -- five small, focused functions each under 20 lines, clean interfaces, proper error handling. The search-first skill and evaluation-criteria reference document are well-organized with progressive disclosure. The reviewer/synthesizer agent updates add structured tables that are easy to follow.

The one blocking MEDIUM issue is that `init.ts` continues to grow without decomposition. The 26 new lines are well-isolated, but the trend is unsustainable. Extracting the two new blocks into helper functions would be a minimal effort fix that sets a better precedent for future additions.

Overall, this branch introduces low additional complexity. The manifest utility module is a model of simplicity, and the agent/skill document changes are structured and readable.
