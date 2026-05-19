# Consistency Review Report

**Branch**: feat/flags-init-redesign -> main
**Date**: 2026-03-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing typed options interface in flags command** - `src/cli/commands/flags.ts:71`
**Confidence**: 92%
- Problem: The `flagsCommand` action handler uses untyped `(options)` parameter, while 4 of 6 other commands with `--enable/--disable/--status` options define an explicit typed interface (`AmbientOptions`, `MemoryOptions`, `LearnOptions`, `InitOptions`). The `hud.ts` command is the only other exception.
- Fix: Add a `FlagsOptions` interface and type the action parameter:
```typescript
interface FlagsOptions {
  enable?: string;
  disable?: string;
  status?: boolean;
  list?: boolean;
}

export const flagsCommand = new Command('flags')
  // ...
  .action(async (options: FlagsOptions) => {
```

**No-flag fallback uses plain log instead of intro/note/outro pattern** - `src/cli/commands/flags.ts:129`
**Confidence**: 90%
- Problem: When invoked with no arguments, `flags` prints `p.log.info('Usage: devflow flags --status | ...')`. Every other toggle command (`ambient`, `memory`, `learn`, `hud`) uses the `p.intro() + p.note('...', 'Usage') + p.outro()` pattern for the no-flag help display.
- Fix: Replace the single-line fallback with the established pattern:
```typescript
// No option -- show help
p.intro(color.bgCyan(color.black(' Claude Code Flags ')));
p.note(
  `${color.cyan('devflow flags --list')}             List all available flags\n` +
  `${color.cyan('devflow flags --status')}           Show current flag states\n` +
  `${color.cyan('devflow flags --enable <ids>')}     Enable flag(s), comma-separated\n` +
  `${color.cyan('devflow flags --disable <ids>')}    Disable flag(s), comma-separated`,
  'Usage',
);
p.outro(color.dim('Toggle with --enable / --disable'));
```

### MEDIUM

**`--enable`/`--disable` option semantics diverge from all other commands** - `src/cli/commands/flags.ts:67-68`
**Confidence**: 85%
- Problem: All 4 existing toggle commands (`ambient`, `memory`, `learn`, `hud`) use `--enable` and `--disable` as boolean flags (no argument). The new `flags` command redefines `--enable <ids>` and `--disable <ids>` to take a comma-separated string argument. While justified by the multi-flag nature, this creates a user-facing CLI inconsistency where `devflow flags --enable` fails (requires argument) but `devflow ambient --enable` succeeds.
- Fix: This is a design decision, not a bug. Document the difference in the no-flag help text with a note like `(pass comma-separated flag IDs)` or consider accepting `--enable` with no argument to enable all defaults, matching the boolean-toggle mental model. At minimum, acknowledge the deviation.

**`p.intro` color inconsistency between list and status** - `src/cli/commands/flags.ts:76,90`
**Confidence**: 82%
- Problem: Both `--list` and `--status` use `color.bgCyan(color.black(...))`, which is correct and matches `list.ts` and `init.ts`. However, `memory.ts` uses `color.bgCyan(color.white(...))` for the same class of command. The flags command is internally consistent but the codebase has a mixed pattern. Not blocking, but worth noting that `flags.ts` chose one side of the split.
- Fix: No immediate fix needed. The `bgCyan + black` choice matches the majority (`list.ts`, `init.ts`). A future cleanup could standardize all commands.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`resolveEnabledFlags` returns defaults when manifest exists but has empty flags array** - `src/cli/commands/flags.ts:14-18`
**Confidence**: 85%
- Problem: The condition `manifest && manifest.features.flags.length > 0` falls through to `getDefaultFlags()` when a manifest exists with an empty `flags` array. This means a user who deliberately disabled ALL flags via `devflow flags --disable tool-search,lsp,clear-context-on-plan` (reducing to empty list) would have their choice overridden by defaults on next `--status` or `--enable` call. The manifest truthfully stores `[]` but `resolveEnabledFlags` treats it as "no data."
- Fix: Distinguish between "manifest exists with explicit empty flags" and "no manifest":
```typescript
async function resolveEnabledFlags(devflowDir: string): Promise<string[]> {
  const manifest = await readManifest(devflowDir);
  if (manifest) {
    return manifest.features.flags;  // Trust manifest, even if empty
  }
  return getDefaultFlags();
}
```

**Recommended path silently skips security deny list prompt** - `src/cli/commands/init.ts:316-392`
**Confidence**: 80%
- Problem: The recommended path applies defaults for `teams`, `ambient`, `memory`, `learn`, `hud`, `flags`, `.claudeignore`, and `safe-delete`, but does not set `securityMode` or `managedSettingsConfirmed`. These remain at their declared defaults (`'user'` and `false`). The advanced path prompts for security mode (managed vs user). This means recommended mode always uses `'user'` security mode without informing the user, while the CLAUDE.md description says "user-mode security deny list". The behavior is correct but the inconsistency between "recommended applies sensible defaults" and "security is silently set to user-mode" could surprise users who expect managed mode as the recommended choice.
- Fix: Either explicitly set `securityMode = 'user'` with a comment explaining this is intentional for recommended mode, or consider whether managed mode should be the recommended default (matching the "Recommended" hint in the advanced prompt).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**HookEntry/HookMatcher/Settings interfaces already consolidated** - `src/cli/commands/flags.ts`
**Confidence**: 82%
- The `flags.ts` command avoids the PF-005 pitfall (duplicated hook interfaces) by not needing hook manipulation at all. It correctly delegates settings manipulation to pure functions in `utils/flags.ts`. This is a positive pattern observation -- the flags implementation avoids the known pitfall by design.

**`hud.ts` also lacks typed options interface** - `src/cli/commands/hud.ts:113`
**Confidence**: 80%
- Pre-existing: `hud.ts` uses untyped `(options)` like the new `flags.ts`. This is not introduced by this PR.

## Suggestions (Lower Confidence)

- **Manifest update not atomic with settings update in flags command** - `src/cli/commands/flags.ts:103-105` (Confidence: 65%) -- If `updateSettingsFlags` succeeds but `updateManifestFlags` fails, settings.json and manifest drift. Other commands (ambient, memory) have similar patterns, so this is a codebase-wide concern rather than a flags-specific one.

- **`updateManifestFlags` silently returns on null manifest** - `src/cli/commands/flags.ts:42` (Confidence: 70%) -- When `readManifest` returns null, `updateManifestFlags` returns silently without warning the user. Other commands typically log a message or fall back. Consider adding `p.log.warn('No manifest found, settings updated but manifest not tracked')`.

- **Template settings.json still has hardcoded Agent Teams env var** - `src/templates/settings.json` (Confidence: 62%) -- `ENABLE_TOOL_SEARCH` and `ENABLE_LSP_TOOL` were correctly removed from the template (now managed by flags), but `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` remains hardcoded. This is managed by `applyTeamsConfig`/`stripTeamsConfig` rather than the flag registry, so it is consistent with the existing teams pattern. However, it raises the question of whether Agent Teams should eventually become a flag.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new `flags` utility module (`src/cli/utils/flags.ts`) is well-designed and closely follows the `applyTeamsConfig`/`stripTeamsConfig` pattern as documented. The pure function approach, the `strip-then-apply` idiom, and the registry pattern are all clean and consistent with codebase conventions.

The main consistency gaps are in the CLI command layer (`src/cli/commands/flags.ts`): the missing typed options interface and the divergent no-flag help display pattern are straightforward fixes that bring the command in line with `ambient.ts`, `memory.ts`, and `learn.ts`. The `resolveEnabledFlags` empty-array logic is the most impactful should-fix, as it can silently override a user's explicit choice to disable all flags.

The init redesign (recommended vs advanced) is a significant structural improvement that correctly preserves all existing feature prompts in the advanced path. The recommended path's flag defaults and safe-delete auto-detection are consistent with the established non-TTY fallback patterns.
