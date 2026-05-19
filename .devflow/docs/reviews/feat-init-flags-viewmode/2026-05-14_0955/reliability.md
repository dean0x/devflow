# Reliability Review Report

**Branch**: feat/init-flags-viewmode -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Unbounded `viewMode` string accepted in `applyViewMode` — no validation against known values** - `src/cli/utils/flags.ts:222`
**Confidence**: 85%
- Problem: `applyViewMode(settingsJson: string, mode: string)` accepts any arbitrary string and writes it directly to `settings.json`. While the `init.ts` callers constrain the value to `'default' | 'verbose' | 'focus'`, the function signature is `string` with no assertion or guard. Any future caller (e.g., `devflow flags --set-view-mode`) could pass an invalid value that Claude Code silently ignores or misinterprets. The manifest type (`ManifestData.features.viewMode?: string`) also stores the value without validation, so a corrupted manifest round-trips an invalid mode back into settings on re-init.
- Fix: Add a precondition assertion in `applyViewMode` and constrain the manifest type:
```typescript
// flags.ts
const VALID_VIEW_MODES = ['default', 'verbose', 'focus'] as const;
export type ViewMode = typeof VALID_VIEW_MODES[number];

export function applyViewMode(settingsJson: string, mode: ViewMode): string {
  // ...existing logic
}
```
```typescript
// manifest.ts — readManifest viewMode line
viewMode: features.viewMode === 'verbose' || features.viewMode === 'focus'
  ? features.viewMode : undefined,
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**All `JSON.parse` calls in `flags.ts` are unguarded — corrupt `settings.json` throws** - `src/cli/utils/flags.ts:175,199,223,233`
**Confidence**: 80%
- Problem: `applyFlags`, `stripFlags`, `applyViewMode`, and `stripViewMode` all call `JSON.parse()` without a try/catch. If `settings.json` contains invalid JSON (manually edited, race between concurrent sessions), the parse throws a `SyntaxError`. The caller in `init.ts` wraps the entire block in `try/catch`, which prevents a crash, but the catch suppresses all errors silently — a corrupt settings file would be silently left as-is with no user feedback.
- Note: This is a pre-existing pattern that predates this PR. The new `applyViewMode`/`stripViewMode` follow the same convention.

## Suggestions (Lower Confidence)

- **Recommended path reads `settings.json` twice** - `src/cli/commands/init.ts:445` and `src/cli/commands/init.ts:1074` (Confidence: 65%) — The recommended path reads `settings.json` at line 445 to preserve `viewMode`, then the entire settings block reads it again at line 1074 for the modify-write pass. Could consolidate into a single read, though the cost is negligible for a CLI init command.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Reliability Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changes are well-structured, following the established `strip-then-apply` pattern used by the flag registry. The `viewMode` preservation in the recommended path is correctly guarded with try/catch. The one blocking finding is a boundary validation gap — `applyViewMode` accepts an unbounded `string` rather than a constrained union type. This is low-risk today (callers are type-safe at the call site in `init.ts`) but violates defense-in-depth: the function itself should enforce its invariant. Tightening the type signature and adding manifest-level validation would close the gap.

Decisions context: ADR-001 (clean break philosophy) and PF-001 (migration compat avoidance) were reviewed. Neither applies directly to this PR — no migration or backward-compat code is being introduced; the `viewMode` field self-heals to `undefined` on old manifests, which is the correct minimal approach.
