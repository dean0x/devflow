# Consistency Review Report

**Branch**: feat/init-flags-viewmode -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**`applyViewMode` parameter typed as `string` instead of union type** - `src/cli/utils/flags.ts:222`
**Confidence**: 95%
- Problem: `applyViewMode(settingsJson: string, mode: string)` accepts an untyped `string` for `mode`, but every call site uses `'default' | 'verbose' | 'focus'`. In `init.ts:385`, the variable is correctly typed as `'default' | 'verbose' | 'focus'`, yet the utility function discards this safety. This deviates from the codebase's strict typing principle ("Type everything — no any types, explicit returns") and from the `ManifestData.viewMode` typing which constrains to `string | undefined` at the interface level but relies on runtime checks.
- Fix: Constrain the `mode` parameter to the expected union:
```typescript
export type ViewMode = 'default' | 'verbose' | 'focus';

export function applyViewMode(settingsJson: string, mode: ViewMode): string {
```
Then use `ViewMode` consistently in `init.ts:385` and `ManifestData.viewMode`.

**Missing JSDoc on `applyViewMode` and `stripViewMode`** - `src/cli/utils/flags.ts:222,232`
**Confidence**: 90%
- Problem: Every exported function in `flags.ts` has a JSDoc comment (`getDefaultFlags` at line 162, `applyFlags` at line 169, `stripFlags` at line 193). The two new view mode functions break this established pattern by having no JSDoc at all.
- Fix: Add JSDoc matching the existing style:
```typescript
/**
 * Apply view mode to a settings JSON string.
 * Sets the viewMode key; 'default' removes the key (Claude Code's default).
 */
export function applyViewMode(settingsJson: string, mode: ViewMode): string {

/**
 * Strip the viewMode key from a settings JSON string.
 */
export function stripViewMode(settingsJson: string): string {
```

### MEDIUM

**`ManifestData.viewMode` typed as `string` instead of union** - `src/cli/utils/manifest.ts:22`
**Confidence**: 90%
- Problem: `viewMode?: string` allows any string value to be written to the manifest. Other features in `ManifestData` are strongly typed (`scope: 'user' | 'local'`, booleans for feature flags). Using a bare `string` for `viewMode` is less strict than the pattern established by the rest of the interface.
- Fix: Use a shared `ViewMode` type:
```typescript
viewMode?: ViewMode;
```

**`--hud-only` manifest write omits `viewMode` field** - `src/cli/commands/init.ts:271`
**Confidence**: 82%
- Problem: The `--hud-only` path writes a minimal manifest at line 271 with an explicit features object that does not include `viewMode`. While `viewMode` is optional (`?`), the normal path at line 1287 always includes it. The two manifest write sites should follow the same shape for consistency. If a user later upgrades from `--hud-only` to a full install, `readManifest` will return `viewMode: undefined` which is technically correct but differs from the explicit pattern set by the full-install path.
- Fix: Either add `viewMode: undefined` explicitly to the `--hud-only` features object, or (better) keep the current behavior since `viewMode` is optional and `undefined` is the correct default. This is minor but worth noting for future maintenance.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`flags` command does not expose view mode** - `src/cli/commands/flags.ts` (Confidence: 70%) -- The `devflow flags --status` and `devflow flags --list` commands do not show or manage the view mode setting. The CLAUDE.md documentation says view mode is "Manageable via `devflow flags`" implicitly (flags section). Adding `--view-mode` to the flags command (or a dedicated `devflow view-mode` subcommand) would complete the CLI surface for this feature. However, the PR description does not claim CLI management beyond init, so this may be intentionally deferred.

- **Recommended path preserves viewMode but advanced path does not** - `src/cli/commands/init.ts:440-450 vs 696-709` (Confidence: 65%) -- The recommended path reads settings.json to preserve the user's existing view mode (lines 440-450), but the advanced path always defaults to `'default'` and prompts the user without pre-selecting the current value. For consistency, the advanced path could detect the current view mode and use it as the `initialValue` in the select prompt, matching the recommended path's preservation behavior.

- **`applyViewMode` re-parses JSON redundantly** - `src/cli/utils/flags.ts:222-230` (Confidence: 62%) -- Both `stripViewMode` and `applyViewMode` parse and re-serialize the full settings JSON. When called sequentially (lines 1107-1108 in init.ts), the settings are parsed twice. The existing `stripFlags`/`applyFlags` pair has the same pattern, so this is consistent with the codebase, but an optimization opportunity exists for a combined strip-and-apply function.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED
