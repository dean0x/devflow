# Regression Review Report

**Branch**: feat/flags-init-redesign -> main
**Date**: 2026-03-27
**PR**: #164

## Issues in Your Changes (BLOCKING)

### HIGH

**resolveEnabledFlags treats explicit empty flags as "no preference", re-enabling defaults** - `src/cli/commands/flags.ts:15-17`
**Confidence**: 95%
- Problem: `resolveEnabledFlags` checks `manifest.features.flags.length > 0` to decide whether to return manifest flags or fall back to `getDefaultFlags()`. When a user explicitly disables all default-ON flags (resulting in `flags: []` in the manifest), the function ignores the explicit empty array and returns defaults. This causes `--status` to show disabled flags as enabled, and `--enable <new-flag>` to silently re-enable all previously disabled flags.
- Impact: User intent is lost after disabling all default-ON flags. Any subsequent `devflow flags --enable brief` would also re-enable `tool-search`, `lsp`, and `clear-context-on-plan` without the user's knowledge.
- Fix: Distinguish "no manifest / legacy manifest" from "manifest with explicit empty flags". The manifest reader already normalizes missing `flags` to `[]`, so presence of a manifest with the `flags` field is sufficient signal:
```typescript
async function resolveEnabledFlags(devflowDir: string): Promise<string[]> {
  const manifest = await readManifest(devflowDir);
  if (manifest) {
    // Explicit empty array means user disabled all flags — respect it
    return manifest.features.flags;
  }
  return getDefaultFlags();
}
```

### MEDIUM

**--advanced in non-TTY loses per-feature fallback defaults** - `src/cli/commands/init.ts:~410-475`
**Confidence**: 85%
- Problem: On main, each feature prompt (teams, ambient, memory, learn, hud) has a `} else if (!process.stdin.isTTY) { ... = true/false; }` fallback that applies sensible defaults in CI/scripted environments. The new code removes these per-feature non-TTY guards from the advanced path. If a user runs `devflow init --advanced` in a non-TTY environment (e.g., CI) without explicitly passing every `--teams`/`--ambient`/`--memory`/`--learn`/`--hud` flag, the interactive prompts will hang or throw.
- Impact: Edge case -- only affects `--advanced` in non-TTY without all flags. The recommended path (non-TTY default) is not affected. Existing CI scripts using `devflow init` without `--advanced` will hit the recommended path instead.
- Fix: Either add a TTY guard at the top of the advanced block that rejects non-TTY usage, or restore per-feature non-TTY fallbacks:
```typescript
// Option A: Guard at the top of advanced block
if (!process.stdin.isTTY) {
  p.log.error('Advanced mode requires an interactive terminal. Use --recommended or pass explicit flags.');
  process.exit(1);
}

// Option B: Restore per-feature fallbacks (matches old behavior)
if (options.teams !== undefined) {
  teamsEnabled = options.teams;
} else if (!process.stdin.isTTY) {
  teamsEnabled = false;
} else {
  // interactive prompt...
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**formatFeatures in list.ts does not display flags** - `src/cli/commands/list.ts:14-21`
**Confidence**: 82%
- Problem: `devflow list` calls `formatFeatures()` which renders teams, ambient, memory, and hud -- but not `learn` (pre-existing omission on main) or the new `flags` count. Since `flags` is a new field in `ManifestData.features` and `devflow flags` is a new command, users may expect `devflow list` to show flag status.
- Impact: Informational gap. Users cannot see enabled flags count from `devflow list`. The `learn` omission is pre-existing and not blocking.
- Fix: Add flags summary to `formatFeatures`:
```typescript
export function formatFeatures(features: ManifestData['features']): string {
  return [
    features.teams ? 'teams' : null,
    features.ambient ? 'ambient' : null,
    features.memory ? 'memory' : null,
    features.hud ? 'hud' : null,
    features.learn ? 'learn' : null,
    features.flags.length > 0 ? `flags(${features.flags.length})` : null,
  ].filter(Boolean).join(', ') || 'none';
}
```

### MEDIUM

**Recommended mode defaults securityMode to 'user', skipping managed-settings offer** - `src/cli/commands/init.ts:~306`
**Confidence**: 80%
- Problem: In the old code, user-scope TTY installs were always prompted about security deny list placement (managed vs user). In the new recommended path, `securityMode` defaults to `'user'` with no prompt. This means recommended-mode users never get the managed-settings option, which was previously labeled "Recommended" in the prompt. This is an intentional design choice but represents a behavior change for users who previously selected managed mode.
- Impact: Users upgrading via `devflow init` (recommended mode) who previously chose managed settings will now get user-mode deny lists. The managed-settings file from their prior install remains in place (not removed), so the deny list is effectively duplicated in both locations.
- Fix: No code fix needed if intentional. Document this behavior change in release notes. Consider adding `--security-mode managed|user` CLI flag for non-interactive override.

## Pre-existing Issues (Not Blocking)

### LOW

**HUD-only install writes manifest with empty flags array but installSettings uses old template** - `src/cli/commands/init.ts:~200-210`
**Confidence**: 80%
- Problem: The `--hud-only` path creates a manifest with `flags: []` and calls a separate `installSettings` flow that is not followed by the flag-applying read-modify-write pass. This means HUD-only installs get no Claude Code flags applied to settings.json. However, HUD-only installs also don't get ambient, memory, or learn hooks, so this is consistent with the minimal-install intent.
- Impact: None for HUD-only users. Flags are not relevant to HUD-only installs.

## Suggestions (Lower Confidence)

- **Template still contains AGENT_TEAMS env var but teams are rarely enabled** - `src/templates/settings.json:43` (Confidence: 65%) -- The template still hardcodes `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` despite teams defaulting OFF. `stripTeamsConfig` handles removal, but this could be moved to the flag registry for consistency.

- **No migration path for existing users' manually-set ENABLE_TOOL_SEARCH/ENABLE_LSP_TOOL** - `src/cli/utils/flags.ts` (Confidence: 70%) -- Users who manually added these env vars to settings.json before DevFlow managed them will have them stripped by `stripFlags` and re-applied only if in `enabledFlags`. Since defaults include both, this is safe for most users, but if a user had set `ENABLE_TOOL_SEARCH: "false"` manually, the flag system will override it to `"true"`.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core flag registry (`flags.ts`) is well-designed with clean pure functions, solid test coverage (20 tests), and proper roundtrip validation. The two-mode init redesign correctly preserves all existing feature prompts in the advanced path and applies sensible defaults in the recommended path.

The blocking HIGH issue (`resolveEnabledFlags` ignoring explicit empty flags) is a real logic bug that will cause user-facing confusion when all default flags are disabled then any flag is subsequently enabled. The non-TTY regression in advanced mode is a narrower edge case but represents a behavior change from main.

All 508 tests pass. No exports were removed. No files were deleted. The `ManifestData` interface extension is backward-compatible (old manifests gracefully normalize to `flags: []`). The settings template migration (removing hardcoded env vars in favor of flag registry) is correctly compensated by the `applyFlags` call in the init flow.
