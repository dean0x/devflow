# Regression Review Report

**Branch**: refactor/rename-kb-to-knowledge -> main
**Date**: 2026-05-04
**PR**: #201

## Issues in Your Changes (BLOCKING)

### CRITICAL

**Old SessionEnd hook not cleaned up on upgrade — duplicate hook execution** - `src/cli/commands/knowledge/toggle.ts:10`
**Confidence**: 95%
- Problem: The `KNOWLEDGE_HOOK_MARKER` is `'session-end-knowledge-refresh'`, so `removeKnowledgeHook()` only matches the NEW hook name. Existing user installations have `session-end-kb-refresh` in their `settings.json`. During `devflow init`, the "remove-then-add" pattern at `init.ts:953-955` calls `removeKnowledgeHook(content)` which will NOT match the old marker, then `addKnowledgeHook()` adds the new hook. Result: both old and new hooks remain in `settings.json`. Both fire on every session end with different lock files (`.kb-refresh.lock` vs `.knowledge-refresh.lock`) and different throttle files (`.kb-last-refresh` vs `.knowledge-last-refresh`), potentially spawning duplicate `claude -p` sessions for the same stale knowledge bases.
- Fix: `removeKnowledgeHook()` should also match the old marker. Add a second filter or broaden the marker:
  ```typescript
  const KNOWLEDGE_HOOK_MARKER = 'session-end-knowledge-refresh';
  const LEGACY_KB_HOOK_MARKER = 'session-end-kb-refresh';

  export function removeKnowledgeHook(settingsJson: string): string {
    const settings: Settings = JSON.parse(settingsJson);
    let changed = false;

    const matchers = settings.hooks?.SessionEnd;
    if (matchers) {
      const filtered = matchers.filter(
        (m) => !m.hooks.some((h) =>
          h.command.includes(KNOWLEDGE_HOOK_MARKER) ||
          h.command.includes(LEGACY_KB_HOOK_MARKER)
        ),
      );
      // ... rest unchanged
    }
    // ...
  }
  ```

### HIGH

**CLI command `devflow kb` removed without alias — breaks user scripts and muscle memory** - `src/cli/cli.ts:45`
**Confidence**: 92%
- Problem: The CLI command was renamed from `kb` to `knowledge` with no backward-compatible alias. `devflow kb list`, `devflow kb create <slug>`, `devflow kb --enable`, etc. will now fail with "unknown command" errors. Users who have these commands in scripts, shell history, or documentation will experience immediate breakage.
- Fix: Add a `kb` alias in `cli.ts` or register a hidden `kb` subcommand that delegates to `knowledge`:
  ```typescript
  // In knowledge/index.ts
  export const knowledgeCommand = new Command('knowledge')
    .alias('kb')  // backward compat
    .description('Manage per-feature knowledge bases')
  ```

**CLI flag `--kb`/`--no-kb` removed from `devflow init` — breaks automation** - `src/cli/commands/init.ts:152-153`
**Confidence**: 90%
- Problem: The `--kb` and `--no-kb` init flags were renamed to `--knowledge` and `--no-knowledge`. Commander rejects unknown options by default, so any script using `devflow init --kb` or `devflow init --no-kb` will error out.
- Fix: Add the old flag as a hidden alias. Commander does not natively support option aliases, but a common workaround is to register both and merge:
  ```typescript
  .option('--knowledge', 'Enable feature knowledge bases')
  .option('--no-knowledge', 'Disable feature knowledge bases')
  .option('--kb', '(deprecated alias for --knowledge)')
  .option('--no-kb', '(deprecated alias for --no-knowledge)')
  ```
  Then in the handler, fall back: `if (options.knowledge === undefined && options.kb !== undefined) knowledgeEnabled = options.kb;`

**Old hook scripts not cleaned up from install directory** - `src/cli/commands/init.ts:912`
**Confidence**: 88%
- Problem: The `LEGACY_HOOK_SCRIPTS` array only contains `['ambient-prompt']`. After upgrade, `copyDirectory` in `installer.ts` copies new files but does not delete orphaned old files. The old `session-end-kb-refresh`, `background-kb-refresh`, and `lib/feature-kb.cjs` remain at `~/.devflow/scripts/hooks/`. When combined with the duplicate hook issue above, the old scripts continue to execute and reference `devflow:feature-kb` skill (which has been uninstalled).
- Fix: Add old hook scripts to the `LEGACY_HOOK_SCRIPTS` cleanup list:
  ```typescript
  const LEGACY_HOOK_SCRIPTS = [
    'ambient-prompt',
    'session-end-kb-refresh',
    'background-kb-refresh',
  ];
  ```
  And add `lib/feature-kb.cjs` to a similar cleanup for lib files:
  ```typescript
  const LEGACY_LIB_FILES = ['feature-kb.cjs'];
  for (const legacy of LEGACY_LIB_FILES) {
    const legacyPath = path.join(hooksDir, 'lib', legacy);
    try { await fs.rm(legacyPath); } catch { /* doesn't exist */ }
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**kb.ts shim does not re-export old names — shim is incomplete** - `src/cli/commands/kb.ts:6`
**Confidence**: 85%
- Problem: The shim `kb.ts` does `export * from './knowledge/index.js'` which re-exports the NEW names (`addKnowledgeHook`, `removeKnowledgeHook`, `hasKnowledgeHook`, `knowledgeCommand`). But the OLD module (`kb/index.ts`) exported `addKbHook`, `removeKbHook`, `hasKbHook`, `kbCommand`. Any code importing the old named exports from `commands/kb.js` will get `undefined`. Currently no internal callers remain (verified: `grep -r "addKbHook" src/ tests/` returns nothing), but the shim's JSDoc says it's "preserved for callers that reference the old path" while not actually providing the old exports. This is misleading — the shim only provides path compatibility, not name compatibility.
- Fix: Either (a) add named re-exports with the old names: `export { addKnowledgeHook as addKbHook, ... } from './knowledge/index.js'`, or (b) update the JSDoc to clarify it only provides path compatibility, not export name compatibility. Since no internal callers remain, (b) is sufficient.

**Migration does not rename orphaned `.features/.kb.lock` directories on install path** - `src/cli/utils/migrations.ts:144-148`
**Confidence**: 82%
- Problem: The migration renames `.features/.kb.lock`, `.kb-last-refresh`, and `.kb-refresh.lock` within project directories. But the migration scope is `per-project` and only operates on `ctx.projectRoot` (the git root). The orphaned lock directories may also exist in the install path or other locations that are not swept. Also, the migration runs once per machine (tracked in `~/.devflow/migrations.json`), so new project clones won't be swept per the D37 edge case documented in CLAUDE.md.
- Impact: Minor — these are transient lock files that self-clean. The stale files won't cause issues but will accumulate as dead artifacts.

## Pre-existing Issues (Not Blocking)

No pre-existing issues identified.

## Suggestions (Lower Confidence)

- **Old background-kb-refresh references uninstalled `devflow:feature-kb` skill** - `scripts/hooks/background-kb-refresh` (orphan) (Confidence: 75%) — If the old hook script survives on disk and fires, the `claude -p` prompt it spawns asks the agent to load `devflow:feature-kb`, which will have been uninstalled by the LEGACY_SKILL_NAMES cleanup. The agent would fail to load the skill but might still partially function. This is a downstream consequence of the duplicate hook issue above.

- **`uninstall.ts` does not remove old `session-end-kb-refresh` hooks from settings** - `src/cli/commands/uninstall.ts:404` (Confidence: 72%) — The uninstall command calls `removeKnowledgeHook(settingsContent)` which only matches the new hook marker. If a user never ran `devflow init` after upgrade (e.g., they go straight to uninstall), the old hook entry would survive in settings.json.

- **Intent vs reality: commit says "rename" but old CLI surface has no deprecation path** - (Confidence: 68%) — The commit messages describe a pure rename/refactoring, but the changes also remove public CLI surface (`devflow kb`, `--kb`/`--no-kb` flags) without deprecation warnings or aliases. A pure rename implies no user-visible changes; this PR has user-visible breaking changes.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 1 | 3 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 4/10
**Recommendation**: CHANGES_REQUESTED

The rename is thorough across ~71 files, and the key backward compatibility mechanisms (manifest `features.kb` fallback, `LEGACY_SKILL_NAMES` for old skill cleanup) are solid. However, the upgrade path has a critical gap: the old SessionEnd hook is not removed from settings.json during upgrade, leading to duplicate hook execution. Additionally, the CLI commands and init flags were renamed without backward-compatible aliases, creating user-facing breaking changes in what the commit messages describe as a refactoring.
