# TypeScript Review Report

**Branch**: feat/init-flags-viewmode -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**`applyViewMode` accepts unvalidated `string` — should use a constrained union type** - `src/cli/utils/flags.ts:222`
**Confidence**: 90%
- Problem: The `mode` parameter is typed as `string`, which allows any arbitrary string to be written into `settings.json`. The call site in `init.ts:385` correctly constrains `viewMode` to the union `'default' | 'verbose' | 'focus'`, but the utility function itself does not enforce this at the type level. A future caller could pass `applyViewMode(json, someUntypedString)` and silently write invalid data. This violates the boundary-validation principle (parse at boundaries, trust internally) and the TypeScript skill's guidance against loose types.
- Fix: Define a union type and use it consistently:
```typescript
export type ViewMode = 'default' | 'verbose' | 'focus';

export function applyViewMode(settingsJson: string, mode: ViewMode): string {
  // ...
}
```
Then use `ViewMode` in both `flags.ts` and `init.ts` instead of the inline union literal at line 385. Also consider exporting `ViewMode` from `flags.ts` and importing it in `init.ts` to single-source the allowed values.

### MEDIUM

**`viewMode` in `ManifestData` typed as `string` — should use the same union** - `src/cli/utils/manifest.ts:22`
**Confidence**: 85%
- Problem: `viewMode?: string` in the `ManifestData` interface allows any string to be stored in the manifest. The `readManifest` function at line 71 only checks `typeof features.viewMode === 'string'` without validating the value against the known set of view modes (`'default' | 'verbose' | 'focus'`). A corrupted or manually-edited manifest could introduce an invalid view mode that propagates silently through the system.
- Fix: Import the `ViewMode` type from `flags.ts` (once defined there) and use it in the interface:
```typescript
import type { ViewMode } from './flags.js';

export interface ManifestData {
  // ...
  features: {
    // ...
    viewMode?: ViewMode;
  };
}
```
In `readManifest`, validate the value:
```typescript
const validModes = new Set(['default', 'verbose', 'focus']);
viewMode: typeof features.viewMode === 'string' && validModes.has(features.viewMode)
  ? features.viewMode as ViewMode
  : undefined,
```

**`applyViewMode`/`stripViewMode` missing JSDoc — inconsistent with sibling functions** - `src/cli/utils/flags.ts:222-236`
**Confidence**: 82%
- Problem: The existing functions `applyFlags`, `stripFlags`, and `getDefaultFlags` all have JSDoc comments explaining their purpose and behavior. The new `applyViewMode` and `stripViewMode` functions lack JSDoc entirely. CLAUDE.md states design decisions should be documented as JSDoc D-series comments at code sites. These functions also lack `@param` and `@returns` annotations that would help callers understand the `'default'`-means-delete behavior.
- Fix: Add JSDoc matching the pattern of sibling functions:
```typescript
/**
 * Apply view mode to a settings JSON string.
 * When mode is 'default', removes the viewMode key entirely (Claude Code's default behavior).
 * Non-default modes ('verbose', 'focus') are set as the viewMode key value.
 */
export function applyViewMode(settingsJson: string, mode: ViewMode): string {

/**
 * Strip viewMode key from a settings JSON string.
 * Used before re-applying to ensure clean upgrade from any previous value.
 */
export function stripViewMode(settingsJson: string): string {
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Recommended path reads settings.json with raw `JSON.parse` and `as Record<string, unknown>` but no schema validation** - `src/cli/commands/init.ts:440-450`
**Confidence**: 80%
- Problem: The recommended path reads `settings.json` and casts it to `Record<string, unknown>`. While the `try/catch` handles file-not-found gracefully, `JSON.parse` could succeed on non-object JSON (e.g., `"hello"` or `[1,2,3]`), and then `parsed.viewMode` would be `undefined` on arrays or crash on primitives. This is a minor boundary validation gap.
- Fix: Add a guard after parsing:
```typescript
const parsed = JSON.parse(currentSettings);
if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
  if (parsed.viewMode === 'verbose' || parsed.viewMode === 'focus') {
    viewMode = parsed.viewMode;
  }
}
```

## Pre-existing Issues (Not Blocking)

_No critical pre-existing TypeScript issues identified in the reviewed files._

## Suggestions (Lower Confidence)

- **Consider extracting the `VIEW_MODE_KEY` constant and `ViewMode` type to a shared location** - `src/cli/utils/flags.ts:220` (Confidence: 65%) -- The view mode concept now spans three files (flags.ts, manifest.ts, init.ts). If more commands need to read/write view mode (e.g., `devflow flags --view-mode`), a single source of truth for the constant and type would reduce drift risk.

- **`stripViewMode` is functionally redundant when `applyViewMode('default')` already deletes the key** - `src/cli/utils/flags.ts:232-236` (Confidence: 70%) -- `stripViewMode` and `applyViewMode(json, 'default')` have identical behavior (delete the `viewMode` key). The strip function exists for symmetry with `stripFlags`, but unlike `stripFlags` which must iterate a registry of N keys, `stripViewMode` just deletes one known key. The semantic distinction is thin, though the symmetry with the flags pattern is a reasonable design choice.

- **`devflow flags` command does not expose `--view-mode` management** - `src/cli/commands/flags.ts` (Confidence: 60%) -- The `devflow flags` CLI does not appear to have any view mode subcommand. Users can only set view mode during `devflow init --advanced`. Adding `devflow flags --view-mode default|verbose|focus` would be consistent with how other flags are managed post-init.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The changes compile cleanly and follow the existing `applyFlags`/`stripFlags` pattern well. The primary concern is that the new `applyViewMode` function accepts an unconstrained `string` parameter, creating a type safety gap that the TypeScript skill's Iron Law ("unknown over any") and the project's "type everything" principle are designed to prevent. Defining a `ViewMode` union type and using it consistently across `flags.ts`, `manifest.ts`, and `init.ts` would close this gap. The manifest validation also lacks value-level checking for the new field, which could silently propagate invalid data. No issues relate to ADR-001 or PF-001 (no migration or backward-compat code is introduced -- applies ADR-001, avoids PF-001).
