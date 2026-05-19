# Regression Review Report

**Branch**: feat/init-flags-viewmode -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**Uninstall does not strip viewMode from settings.json** - `src/cli/commands/uninstall.ts:414`
**Confidence**: 90%
- Problem: The init flow writes `viewMode` to `settings.json` via `applyViewMode()` (init.ts:1107-1108), and the uninstall flow strips flags via `stripFlags()` (uninstall.ts:414), but `stripViewMode()` is never called during uninstall. After uninstalling Devflow, the `viewMode` key will remain orphaned in the user's settings.json. This is a regression in the uninstall cleanup contract: every Devflow-managed key written to settings.json must be removable by uninstall.
- Fix: In `src/cli/commands/uninstall.ts`, import `stripViewMode` from `../utils/flags.js` and add `settingsContent = stripViewMode(settingsContent);` after the `stripFlags` call at line 414:
```typescript
import { stripFlags, stripViewMode } from '../utils/flags.js';
// ...
settingsContent = stripFlags(settingsContent);
settingsContent = stripViewMode(settingsContent);
```

### MEDIUM

**viewMode type in manifest is unvalidated `string` -- any value accepted** - `src/cli/utils/manifest.ts:22,71`
**Confidence**: 82%
- Problem: `ManifestData.features.viewMode` is typed as `string | undefined`, and `readManifest` accepts any string value (`typeof features.viewMode === 'string'`). The init flow constrains it to `'default' | 'verbose' | 'focus'` at the UI level, but `applyViewMode(settingsJson, mode)` in flags.ts accepts `mode: string` with no validation. A corrupted or hand-edited manifest could inject an arbitrary string as the `viewMode` value in settings.json. The init.ts local variable is correctly typed as `'default' | 'verbose' | 'focus'` (line 385), but that constraint is lost when round-tripping through the manifest (which stores it as `string`).
- Fix: Either narrow the manifest type to `viewMode?: 'default' | 'verbose' | 'focus'` and validate in `readManifest`, or add a guard in `applyViewMode`:
```typescript
const VALID_VIEW_MODES = new Set(['default', 'verbose', 'focus']);

export function applyViewMode(settingsJson: string, mode: string): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  if (mode === 'default' || !VALID_VIEW_MODES.has(mode)) {
    delete settings[VIEW_MODE_KEY];
  } else {
    settings[VIEW_MODE_KEY] = mode;
  }
  return JSON.stringify(settings, null, 2) + '\n';
}
```

**No tests for `applyViewMode` / `stripViewMode`** - `tests/flags.test.ts`
**Confidence**: 85%
- Problem: The existing test file covers `applyFlags`, `stripFlags`, and `getDefaultFlags` thoroughly (roundtrip, edge cases, preservation of unrelated keys). The new `applyViewMode` and `stripViewMode` functions are exported from the same module but have zero test coverage. This is a regression in test coverage relative to the pattern established for the sibling functions. Missing tests include: default mode deletes key, non-default writes key, strip removes key, roundtrip preservation, preservation of unrelated settings.
- Fix: Add test cases to `tests/flags.test.ts`:
```typescript
describe('applyViewMode', () => {
  it('removes viewMode key when mode is default', () => {
    const input = JSON.stringify({ viewMode: 'verbose', hooks: {} }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'default'));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('sets viewMode for non-default modes', () => {
    const input = JSON.stringify({}, null, 2);
    expect(JSON.parse(applyViewMode(input, 'verbose')).viewMode).toBe('verbose');
    expect(JSON.parse(applyViewMode(input, 'focus')).viewMode).toBe('focus');
  });

  it('preserves existing settings', () => {
    const input = JSON.stringify({ hooks: {}, tui: 'fullscreen' }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'verbose'));
    expect(result.hooks).toEqual({});
    expect(result.tui).toBe('fullscreen');
    expect(result.viewMode).toBe('verbose');
  });
});

describe('stripViewMode', () => {
  it('removes viewMode key', () => {
    const input = JSON.stringify({ viewMode: 'focus', hooks: {} }, null, 2);
    const result = JSON.parse(stripViewMode(input));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('is safe when viewMode not present', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(stripViewMode(input));
    expect(result).toEqual({ hooks: {} });
  });
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`--hud-only` manifest omits `viewMode` field** - `src/cli/commands/init.ts:271`
**Confidence**: 80%
- Problem: The `--hud-only` code path writes a minimal manifest at line 271 with a hardcoded features object that does not include the `viewMode` field. While `ManifestData.features.viewMode` is optional (`?`), this creates an inconsistency: the normal install path always writes `viewMode` to the manifest (line 1287), but the `--hud-only` path does not. A subsequent `readManifest` will return `viewMode: undefined` for hud-only installs, which is technically correct but inconsistent with the full install path. If any future code reads `manifest.features.viewMode` expecting it to reflect the actual settings.json state, hud-only installs will be silently wrong.
- Fix: No code change strictly required (the field is optional). But for consistency, consider adding `viewMode: undefined` or omitting it explicitly via a comment explaining the intentional gap.

## Pre-existing Issues (Not Blocking)

_No critical pre-existing issues found in the regression review scope._

## Suggestions (Lower Confidence)

- **Recommended path does not restore viewMode from manifest on re-init** - `src/cli/commands/init.ts:440-450` (Confidence: 65%) -- The recommended path reads viewMode from `settings.json` directly but does not check the manifest. If settings.json was reset/deleted but the manifest still has viewMode, the preference is lost. Low risk since settings.json is the source of truth for Claude Code.

- **`devflow flags --status` does not show viewMode** - `src/cli/commands/flags.ts:98-106` (Confidence: 70%) -- The `devflow flags --status` command iterates `FLAG_REGISTRY` but viewMode is managed outside the registry. Users have no CLI way to check/change viewMode after init except re-running `devflow init --advanced`. This is a feature gap rather than a regression, but it breaks the discoverability pattern.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The uninstall cleanup gap (HIGH) is a clear regression -- every Devflow-managed settings.json key must have a matching cleanup path (applies ADR-001: clean break philosophy means installs/uninstalls should be complete, not leave orphaned keys). The unvalidated viewMode type and missing tests are medium-severity regressions in existing quality patterns. The three new flags (disable-adaptive-thinking, always-thinking, disable-git-instructions) are clean additions that follow the established FLAG_REGISTRY pattern with no regression risk -- they use unique keys, correct types, and are default-OFF.
