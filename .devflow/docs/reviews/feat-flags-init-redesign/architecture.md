# Architecture Review Report

**Branch**: feat/flags-init-redesign -> main
**Date**: 2026-03-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Init handler grows from 878 to 974 lines, deepening the PF-002 monolith** - `src/cli/commands/init.ts:270-644`
**Confidence**: 90%
- Problem: PF-002 already flagged init.ts as a monolith at 878 lines. This PR adds ~100 net lines by duplicating the full feature-prompting logic into two branches (`useRecommended` / advanced). The recommended path (lines 324-368) and advanced path (lines 370-643) share structural patterns (CLI flag override checks, safe-delete detection, claudeignore discovery) but are expressed as two independent inline code blocks inside the same closure. The action handler now manages 12+ mutable `let` bindings for feature decisions (lines 303-315), all declared in a shared scope and conditionally mutated by whichever branch executes. This is SRP violation -- the handler has two reasons to change (recommended defaults logic AND advanced interactive logic), plus all the installation execution logic that follows.
- Impact: Each new feature prompt or flag must be added in two places within the same function. Merge conflicts will increase. Testing the "recommended applies correct defaults" path requires mocking the entire init flow.
- Fix: Extract a `collectInitChoices(options, scope, earlyGitRoot): Promise<InitChoices>` function that encapsulates the recommended/advanced branching and returns a typed `InitChoices` object. The action handler becomes: collect choices, then execute installation. This was exactly the resolution documented in PF-002. Example structure:
  ```typescript
  interface InitChoices {
    teamsEnabled: boolean;
    ambientEnabled: boolean;
    memoryEnabled: boolean;
    learnEnabled: boolean;
    hudEnabled: boolean;
    enabledFlags: string[];
    claudeignoreEnabled: boolean;
    discoveredProjects: string[];
    safeDeleteAction: 'install' | 'upgrade' | 'skip';
    safeDeleteBlock: string | null;
    securityMode: SecurityMode;
    managedSettingsConfirmed: boolean;
  }

  async function collectInitChoices(options: InitOptions, scope: string, gitRoot: string | null): Promise<InitChoices> {
    // Recommended vs advanced branching lives here
  }
  ```

**No mutual exclusion for --recommended and --advanced flags** - `src/cli/commands/init.ts:279-282`
**Confidence**: 92%
- Problem: Both `--recommended` and `--advanced` are independent boolean options. If a user passes `devflow init --recommended --advanced`, the code silently picks `--recommended` (it is checked first at line 279). There is no validation, no error, and no documentation that `--recommended` takes precedence. This is a missing boundary validation -- the interface allows contradictory inputs.
- Impact: Confusing behavior for users who expect `--advanced` to win or an error. Subtle bugs in CI scripts that accidentally pass both flags.
- Fix: Add a conflict check at the start of the action handler:
  ```typescript
  if (options.recommended && options.advanced) {
    p.log.error('Cannot use --recommended and --advanced together.');
    process.exit(1);
  }
  ```
  Alternatively, use Commander's `.conflicts()` method if available, or model this as a single `--mode <recommended|advanced>` option.

### MEDIUM

**`resolveEnabledFlags` fallback logic may mask empty-flags-by-choice** - `src/cli/commands/flags.ts:13-19`
**Confidence**: 85%
- Problem: The function falls back to `getDefaultFlags()` when `manifest.features.flags.length === 0`. This means a user who deliberately disabled ALL flags (via `devflow flags --disable tool-search,lsp,clear-context-on-plan`) and then runs `devflow flags --status` would see the defaults re-applied rather than an empty set. The manifest stores `[]`, but `resolveEnabledFlags` interprets `[]` as "not configured" rather than "explicitly empty."
- Impact: Users cannot disable all flags. The `--disable` command appears to work but `--status` shows defaults re-applied.
- Fix: Distinguish "never configured" from "explicitly empty" by checking manifest existence separately:
  ```typescript
  async function resolveEnabledFlags(devflowDir: string): Promise<string[]> {
    const manifest = await readManifest(devflowDir);
    if (manifest) {
      return manifest.features.flags; // Trust the manifest, even if empty
    }
    return getDefaultFlags(); // No manifest = first run defaults
  }
  ```

**`parseFlagIds` calls `process.exit(1)` instead of returning a Result** - `src/cli/commands/flags.ts:52-63`
**Confidence**: 82%
- Problem: The `parseFlagIds` function calls `process.exit(1)` on validation failure. Per CLAUDE.md engineering principles, business logic should use Result types and never throw/exit. While this is in a CLI command (boundary code), it makes the function untestable without mocking `process.exit` and couples validation to process lifecycle.
- Impact: Cannot unit test the validation path. Inconsistent with the pure-function pattern established by `flags.ts` utils.
- Fix: Return a Result or throw a typed error that the command handler catches:
  ```typescript
  function parseFlagIds(input: string): { ok: true; ids: string[] } | { ok: false; invalid: string[] } {
    const ids = input.split(',').map((s: string) => s.trim());
    const invalid = ids.filter(id => !FLAG_REGISTRY.some(f => f.id === id));
    if (invalid.length > 0) return { ok: false, invalid };
    return { ok: true, ids };
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Recommended path defaults `securityMode` to 'user', bypassing managed-settings protection** - `src/cli/commands/init.ts:314`
**Confidence**: 83%
- Problem: In the recommended path, `securityMode` defaults to `'user'` (line 314) and is never changed. The recommended mode description in CLAUDE.md says "user-mode security deny list," so this is intentional. However, for new users who chose "recommended" to get the best defaults, the managed (read-only) security deny list would be the safer option. The advanced path explicitly presents managed as "Recommended" in its prompt hint (line 756). There is a tension between "recommended = quick/no-sudo" and "recommended = most secure."
- Impact: Users on the recommended path get the less secure deny list placement by default, which is editable and can be overridden.
- Fix: This is a product decision, not a bug. Document the rationale explicitly in a code comment at line 314 explaining why 'user' was chosen over 'managed' for the recommended path (avoids sudo prompt, which conflicts with the zero-interaction goal).

**Recommended path auto-installs safe-delete without user consent** - `src/cli/commands/init.ts:339-353`
**Confidence**: 80%
- Problem: The recommended path auto-installs safe-delete to the user's shell profile if a trash CLI is detected, without any prompt or explicit consent. This modifies `~/.zshrc` (or equivalent) silently. While safe-delete is beneficial, writing to shell profiles without asking is architecturally aggressive for a "recommended defaults" path that is supposed to be non-surprising.
- Impact: Users may be surprised to find their shell profile modified. If the safe-delete block has a bug, it affects all `rm` commands system-wide.
- Fix: Either (a) skip safe-delete in recommended mode (set `safeDeleteAction = 'skip'`), or (b) add a summary note explicitly calling out shell profile modification before installation proceeds, giving users a chance to review.

## Pre-existing Issues (Not Blocking)

### HIGH

**Init action handler monolith (PF-002)** - `src/cli/commands/init.ts:98-974`
**Confidence**: 95%
- Problem: The entire init command is a single 876-line `.action()` closure. This predates this PR (was 878 lines on main, now 974 lines). This PR exacerbates the issue but did not create it.
- Impact: Untestable orchestration, high merge conflict rate, impossible to reason about in isolation.
- Fix: Extract `collectInitChoices()`, `executeInstallation()`, `printSummary()` as documented in PF-002 resolution.

## Suggestions (Lower Confidence)

- **Flag registry could use a Zod schema for runtime validation** - `src/cli/utils/flags.ts:18-53` (Confidence: 65%) -- The `FLAG_REGISTRY` is a typed `readonly` array, but `readManifest` stores flag IDs as `string[]` without validating them against the registry. A Zod schema at the manifest boundary would catch stale/invalid flag IDs from old manifests.

- **Summary display in recommended mode has inconsistent formatting** - `src/cli/commands/init.ts:357-366` (Confidence: 62%) -- The summary uses template literals that produce empty strings for disabled features (e.g., `${claudeignoreEnabled ? '.claudeignore:   created' : ''}`), which are then filtered. A data-driven approach mapping feature names to states would be cleaner and more maintainable.

- **`flags.ts` and `flags` command could benefit from a shared validation module** - `src/cli/commands/flags.ts:52-63` vs `src/cli/utils/flags.ts` (Confidence: 60%) -- Validation logic in the command file duplicates knowledge of `FLAG_REGISTRY` structure. A `validateFlagIds(ids: string[]): string[]` function in the utils module would keep all flag knowledge in one place.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 1 | 0 | 0 |

**Architecture Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The new `flags.ts` utility module is well-architected: pure functions, typed registry, discriminated union for target types, clean separation between data (registry) and I/O (command). The `applyFlags`/`stripFlags` pattern correctly mirrors the existing `applyTeamsConfig`/`stripTeamsConfig` pattern, and the uninstall integration is thorough.

However, the init.ts changes introduce a large branching structure (recommended vs advanced) that further inflates the already-flagged monolith (PF-002). The two paths share enough structural similarity that extracting a `collectInitChoices()` function would reduce duplication and make the recommended defaults testable in isolation. The missing `--recommended`/`--advanced` mutual exclusion is a boundary validation gap. The `resolveEnabledFlags` fallback-to-defaults behavior has a logic error that prevents users from disabling all flags.

Positive architectural notes:
- Flag registry as a typed, extensible data structure is the right pattern
- Pure functions with no I/O in `flags.ts` enable thorough testing (179 lines of tests)
- Forward-compatibility with unknown flag IDs in `applyFlags` is well-considered
- Settings template cleanup (removing hardcoded env vars) correctly shifts ownership to the flag registry
- Manifest schema evolution with backwards-compatible defaults (`Array.isArray(features.flags) ? ... : []`)
