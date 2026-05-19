# Security Review Report

**Branch**: feat/init-flags-viewmode -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**`applyViewMode` accepts unvalidated string parameter** - `src/cli/utils/flags.ts:222`
**Confidence**: 80%
- Problem: The `applyViewMode(settingsJson: string, mode: string)` function accepts any string as `mode` and writes it directly into `settings.json` via `settings[VIEW_MODE_KEY] = mode`. While current call sites in `init.ts` pass a properly typed `'default' | 'verbose' | 'focus'` value, the public API boundary is unvalidated. A future caller passing untrusted input (e.g., from manifest data or CLI args) would inject arbitrary values into the settings file. Defense in depth requires validating at the function boundary, not relying on callers.
- Fix: Constrain the parameter type and validate at the boundary:
```typescript
const VALID_VIEW_MODES = ['default', 'verbose', 'focus'] as const;
type ViewMode = typeof VALID_VIEW_MODES[number];

export function applyViewMode(settingsJson: string, mode: ViewMode): string {
  // Type system enforces valid input; runtime guard for JavaScript callers
  if (!VALID_VIEW_MODES.includes(mode)) {
    return settingsJson;
  }
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  if (mode === 'default') {
    delete settings[VIEW_MODE_KEY];
  } else {
    settings[VIEW_MODE_KEY] = mode;
  }
  return JSON.stringify(settings, null, 2) + '\n';
}
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Manifest `viewMode` accepts arbitrary string from disk** - `src/cli/utils/manifest.ts:71` (Confidence: 65%) — `readManifest` stores any string value from the JSON file as `viewMode` without validating it belongs to the set of known modes. Currently informational-only (no code path writes it back to `settings.json`), but a future consumer could inadvertently trust this value. Consider validating against an allowlist during deserialization.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changes are low-risk from a security perspective. The three new flags follow established patterns exactly and introduce no new attack surface. The view mode feature correctly uses an allowlist at the recommended-path read site (`init.ts:447` checks `=== 'verbose' || === 'focus'`) and the advanced-path uses a closed `p.select` with fixed options. The one condition is tightening the `applyViewMode` function signature to enforce valid modes at the API boundary rather than relying on callers — a straightforward defense-in-depth improvement.
