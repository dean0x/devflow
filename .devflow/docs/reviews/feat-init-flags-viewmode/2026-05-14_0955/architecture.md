# Architecture Review Report

**Branch**: feat/init-flags-viewmode -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**`applyViewMode` accepts unvalidated `string` — no type narrowing at boundary** - `src/cli/utils/flags.ts:222`
**Confidence**: 90%
- Problem: `applyViewMode(settingsJson: string, mode: string)` accepts an unbounded `string` for `mode`. The `ManifestData.viewMode` field is also typed as `string | undefined`. While `init.ts` locally narrows via `'default' | 'verbose' | 'focus'`, the utility functions and manifest interface have no such constraint. Any consumer of `applyViewMode` or `ManifestData.viewMode` can pass arbitrary strings — `'invalid'`, `''`, `'Default'` (wrong case) — and they will be silently written to `settings.json`. This violates the project's boundary validation principle (parse, don't validate) and the `flags.ts` module's own pattern where `FLAG_REGISTRY` provides an exhaustive, typed source of truth. The other flags utilities (`applyFlags`/`stripFlags`) use `FLAG_REGISTRY` to validate and type-narrow; `applyViewMode` bypasses this pattern entirely.
- Fix: Define a const tuple or union type for valid view modes and validate in `applyViewMode`:
```typescript
export const VIEW_MODES = ['default', 'verbose', 'focus'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export function applyViewMode(settingsJson: string, mode: ViewMode): string {
  // ...
}
```
  Update `ManifestData.viewMode` to use `ViewMode | undefined` instead of `string | undefined`. The `readManifest` deserializer should validate against `VIEW_MODES` (return `undefined` for unknown values).

**View mode is architecturally distinct from flags but colocated without separation** - `src/cli/utils/flags.ts:220-236`
**Confidence**: 82%
- Problem: `flags.ts` is documented as the "Claude Code flag registry" with a clear responsibility: managing feature flags through `FLAG_REGISTRY`. The view mode utilities (`applyViewMode`/`stripViewMode`) manage a top-level `settings.json` key but do not participate in the flag registry pattern — they have no `ClaudeCodeFlag` entry, no presence in `FLAG_REGISTRY`, no `getDefaultFlags()` coverage, and no integration with `devflow flags --enable/--disable/--list/--status`. This is a shallow module (Ousterhout) bolted onto a module with a different concern. The CLAUDE.md documentation says "Manageable via `devflow flags --enable/--disable/--status/--list`" for flags, but view mode has no CLI management path at all (no `devflow flags --view-mode` or separate subcommand). This violates SRP: `flags.ts` now has two reasons to change (flag registry changes AND view mode changes).
- Fix: Either (a) model view mode as a flag entry in `FLAG_REGISTRY` if it fits the env/setting pattern (it does — it is a `type: 'setting'` with key `viewMode`), which would give it CLI management for free via `devflow flags`, or (b) extract to a separate `view-mode.ts` utility module if view mode needs its own lifecycle. Option (a) is simpler and consistent with the existing architecture.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Recommended path reads `settings.json` with raw path construction, diverging from existing path resolution** - `src/cli/commands/init.ts:441-450`
**Confidence**: 85%
- Problem: The recommended path constructs the settings path manually (`path.join(os.homedir(), '.claude')` for user scope, `path.join(earlyGitRoot ?? '.', '.claude')` for local scope) to read the existing `viewMode`. However, the rest of `init.ts` uses `getInstallationPaths(scope)` to resolve `claudeDir` (line 866). This path resolution happens later in the flow, after the recommended-vs-advanced decision. If `getInstallationPaths` ever changes its resolution logic (e.g., respects `CLAUDE_CONFIG_DIR`), the early manual path construction will drift. Additionally, the fallback `earlyGitRoot ?? '.'` in local scope is fragile — `'.'` could be wrong if the CWD is not the git root.
- Fix: Extract the settings-path resolution into a lightweight helper (or call `getInstallationPaths` earlier, since it is already called at line 866 and the result could be hoisted). This keeps the path resolution DRY.

**`readManifest` does not validate `viewMode` against known values** - `src/cli/utils/manifest.ts:71`
**Confidence**: 82%
- Problem: The manifest reader accepts any string for `viewMode` (`typeof features.viewMode === 'string'`). If a manifest contains `"viewMode": "garbage"`, it will be deserialized and propagated. Other feature fields have explicit fallback defaults (e.g., `rules` defaults to `true`, `flags` defaults to `[]`). `viewMode` should either validate against known modes or default to `undefined`/`'default'` for unknown values. Applies ADR-001 tangentially — while this is not migration code, it is a graceful-degradation concern for manifests written by future versions.
- Fix: Validate against the const tuple of known modes:
```typescript
const knownModes = new Set(['default', 'verbose', 'focus']);
viewMode: typeof features.viewMode === 'string' && knownModes.has(features.viewMode)
  ? features.viewMode as ViewMode
  : undefined,
```

## Pre-existing Issues (Not Blocking)

_No critical pre-existing issues identified in reviewed files._

## Suggestions (Lower Confidence)

- **No `--view-mode` CLI flag on `devflow init`** - `src/cli/commands/init.ts` (Confidence: 72%) — Other features (teams, ambient, memory, etc.) all have `--feature/--no-feature` CLI flags for non-interactive use. View mode has no equivalent `--view-mode <mode>` flag, meaning it can only be set via interactive advanced prompt or preserved from existing settings. This limits scripted/CI usage.

- **`devflow flags` command unaware of view mode** - `src/cli/commands/flags.ts` (Confidence: 68%) — The `devflow flags --status` and `--list` commands show all managed flags but have no awareness of view mode. Users who set view mode via init have no `devflow` CLI path to change it later without re-running `devflow init --advanced`.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The three new flags (`disable-adaptive-thinking`, `always-thinking`, `disable-git-instructions`) are clean additions that follow the established `FLAG_REGISTRY` pattern exactly — correct types, correct placement, correct documentation. No issues there.

The view mode feature is functionally correct but architecturally inconsistent with the existing flags system. The primary concerns are: (1) the `applyViewMode` function accepts an unbounded `string` when the domain is a fixed set of three values, violating the project's boundary validation principles, and (2) the utilities are colocated in `flags.ts` without participating in the flag registry pattern, creating a module with two distinct responsibilities. These are straightforward to address: either promote view mode into `FLAG_REGISTRY` (preferred, since it is a `type: 'setting'` like other flags) or extract it to its own module with proper type constraints.
