# Security Review Report

**Branch**: feat/flags-init-redesign -> main
**Date**: 2026-03-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Recommended mode defaults to `securityMode: 'user'` -- skips security deny list prompt entirely** - `src/cli/commands/init.ts:314`
**Confidence**: 85%
- Problem: In the recommended path (`useRecommended = true`), the variable `securityMode` is initialized to `'user'` (line 314) and never reassigned. The security deny list prompt only exists in the `else` (advanced) branch (line 592). This means recommended-mode installations always get the weaker `'user'` security mode. In the previous code, this prompt was always shown for `scope === 'user' && process.stdin.isTTY`. The recommended mode was intended to apply "sensible defaults" but silently downgrades security posture by skipping the managed-settings option entirely.
- Impact: Users who choose "Recommended" (or run in non-TTY CI environments) never get the opportunity to install the read-only managed security deny list. The `'user'` mode places the deny list in the editable `settings.json`, which Claude Code itself can modify -- undermining the deny list's purpose as a security boundary.
- Fix: Either default `securityMode` to `'managed'` in recommended mode (with `managedSettingsConfirmed = true` so it actually executes), or explicitly document that recommended mode uses user-level security. The most secure default would be:
```typescript
if (useRecommended) {
  // ...existing defaults...
  // Security: default to user mode (managed requires sudo confirmation)
  // Users can upgrade via: devflow init --advanced
  securityMode = 'user';
}
```
This is already the behavior, but a comment documenting the deliberate choice would confirm this is intentional rather than an oversight. If managed mode is the recommended security posture, it should be the default.

### MEDIUM

**`applyFlags` and `stripFlags` crash on malformed JSON input** - `src/cli/utils/flags.ts:69,93`
**Confidence**: 85%
- Problem: Both `applyFlags` and `stripFlags` call `JSON.parse(settingsJson)` without try/catch. If `settings.json` contains invalid JSON (corrupt file, partial write, manual user edit error), these functions throw an unhandled `SyntaxError` that propagates up and crashes the CLI.
- Impact: A corrupted `settings.json` would make `devflow flags`, `devflow init`, and `devflow uninstall` all crash with an unhelpful stack trace. The `flags.ts` command handler does handle read errors (falls back to `'{}'` at line 29-31), but the pure functions themselves are fragile. Since `settings.json` is a user-editable file, malformed content is a realistic scenario.
- Fix: Either wrap `JSON.parse` in both functions with try/catch that returns the input unchanged (or `'{}\n'` for strip), or document in the JSDoc that callers must ensure valid JSON. The defensive approach:
```typescript
export function applyFlags(settingsJson: string, flagIds: string[]): string {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(settingsJson) as Record<string, unknown>;
  } catch {
    settings = {};
  }
  // ...rest unchanged
}
```

**`parseFlagIds` does not filter empty strings from comma-separated input** - `src/cli/commands/flags.ts:53`
**Confidence**: 82%
- Problem: `input.split(',').map(s => s.trim())` does not filter out empty strings. Input like `"tool-search,"` or `",lsp"` or just `","` produces entries like `['tool-search', '']` or `['', 'lsp']`. The empty string `''` fails the registry lookup and triggers the "Unknown flag(s)" error exit, which is confusing for the user. More importantly, if the registry were ever to contain an empty-id flag (defensive concern), it could match unintentionally.
- Fix: Add `.filter(Boolean)` after `.map()`:
```typescript
function parseFlagIds(input: string): string[] {
  const ids = input.split(',').map((s: string) => s.trim()).filter(Boolean);
  // ...rest unchanged
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`updateSettingsFlags` has a TOCTOU window between read and write** - `src/cli/commands/flags.ts:24-35`
**Confidence**: 80%
- Problem: The function reads `settings.json`, strips flags, applies new flags, then writes back. If another process (e.g., Claude Code itself, another `devflow` invocation) modifies the file between read and write, those changes are silently overwritten. This same pattern exists in the `init.ts` settings pipeline (lines 800-830) but is pre-existing.
- Impact: Low probability in normal usage but possible during concurrent `devflow flags --enable` and `devflow init` invocations, or when Claude Code writes to its own settings simultaneously. Data loss is limited to the overwritten settings keys.
- Fix: This is an inherent limitation of JSON file-based config without file locking. Consider adding advisory file locking (e.g., `proper-lockfile` or `mkdir`-based lock) for settings writes, or at minimum document the constraint. Not blocking since this is consistent with the existing pattern used elsewhere in the codebase.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Manifest `flags` field stores arbitrary strings without schema validation** - `src/cli/utils/manifest.ts:57`
**Confidence**: 80%
- Problem: The `readManifest` function accepts `features.flags` as `string[]` via `Array.isArray` check but does not validate that the strings correspond to known flag IDs. A manually edited or corrupted manifest could contain arbitrary flag IDs that persist across invocations.
- Impact: Unknown flag IDs are safely ignored by `applyFlags` (it skips unknown IDs), so this does not lead to injection. However, stale or invalid IDs accumulate in the manifest without cleanup, which could confuse `--status` output (the `resolveEnabledFlags` function returns manifest flags directly without filtering against the registry).
- Fix: Filter against `FLAG_REGISTRY` when reading:
```typescript
flags: Array.isArray(features.flags)
  ? (features.flags as string[]).filter(id => FLAG_REGISTRY.some(f => f.id === id))
  : [],
```

## Suggestions (Lower Confidence)

- **Flag values are not sanitized before JSON serialization** - `src/cli/utils/flags.ts:78` (Confidence: 65%) -- Flag target values come from the hardcoded `FLAG_REGISTRY`, so there is no user-controlled injection vector today. However, if the registry were ever populated from external sources (config file, API), the `value` field would be written directly into `settings.json` without sanitization. Worth noting for future extensibility.

- **Non-TTY recommended mode auto-installs safe-delete without consent** - `src/cli/commands/init.ts:324-365` (Confidence: 70%) -- When `!process.stdin.isTTY`, `useRecommended` defaults to `true`, which auto-detects and auto-installs the safe-delete shell alias to the user's profile without any interactive confirmation. The safe-delete block modifies the user's shell profile file (e.g., `.zshrc`). In CI environments this is likely a no-op (no trash CLI), but in non-interactive terminal contexts it could be surprising.

- **`resolveEnabledFlags` fallback logic may mask explicit empty flags** - `src/cli/commands/flags.ts:15` (Confidence: 62%) -- If a user explicitly disables all flags (`devflow flags --disable tool-search,lsp,clear-context-on-plan`), the manifest stores `flags: []`. On next read, `resolveEnabledFlags` sees `length === 0` and falls back to `getDefaultFlags()`, re-enabling the defaults. This means "disable all flags" is not a stable state.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The flags system itself is well-designed from a security perspective: pure functions, typed registry, no user-controlled values injected into settings. The primary concern is the recommended-mode init path silently defaulting to the weaker security deny list mode, and the `resolveEnabledFlags` fallback that prevents users from fully disabling all flags. The JSON parse crash risk in `applyFlags`/`stripFlags` should be addressed given that `settings.json` is a user-editable file.
