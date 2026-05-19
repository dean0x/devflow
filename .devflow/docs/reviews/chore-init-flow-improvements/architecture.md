# Architecture Review Report

**Branch**: chore/init-flow-improvements -> main
**Date**: 2026-03-22
**Commit**: f23d540 feat(init): enhance flow with project discovery and improved return types

## Changes Overview

This PR restructures the `devflow init` command to collect all user prompts upfront before performing any installation actions. Key changes:

1. **Prompt/action separation**: All interactive prompts are now gathered in a first phase, with installation actions deferred to a second phase (the "prompt collector" pattern).
2. **Removed `buildExtrasOptions` and the "extras" multiselect**: Each configuration option (claudeignore, safe-delete, managed settings) now has its own dedicated prompt with contextual `p.note()` explanations.
3. **New `discoverProjectGitRoots()` function**: Reads `~/.claude/history.jsonl` to find all projects Claude has worked on, enabling batch `.claudeignore` installation.
4. **`installClaudeignore` return type change**: `void` to `boolean` to support batch progress counting.
5. **Import cleanup**: Removed unused imports (`isAlreadyInstalled`, `hasAmbientHook`, `hasMemoryHooks`, `hasHudStatusLine`).
6. **New `--hud` CLI flag**: Complements existing `--no-hud`.

Files changed: `src/cli/commands/init.ts`, `src/cli/utils/post-install.ts`, `tests/init-logic.test.ts`

## Issues in Your Changes (BLOCKING)

### HIGH

**Hardcoded `pluginHints` map duplicates and can drift from canonical `plugins.ts` descriptions** - `src/cli/commands/init.ts:218-233`
**Confidence**: 85%
- Problem: A `Record<string, string>` of plugin hints is hardcoded inside the `initCommand` action handler. The canonical descriptions live in `src/cli/plugins.ts` on each `PluginDefinition`. If a plugin is added, renamed, or its purpose changes, this map will silently fall out of sync. The fallback (`?? pl.description`) masks the drift rather than surfacing it.
- Impact: Open/Closed Principle violation -- adding a new plugin requires modifying two locations. Also violates DRY.
- Fix: Add a `shortHint` field to `PluginDefinition` in `plugins.ts` so plugin metadata stays co-located:
```typescript
// plugins.ts
interface PluginDefinition {
  name: string;
  description: string;
  shortHint?: string;  // Short hint for multiselect UI
  // ...
}

// init.ts - replace hardcoded map with:
hint: pl.shortHint ?? pl.description,
```

### MEDIUM

**`discoverProjectGitRoots` uses `os.homedir()` directly -- not injectable** - `src/cli/utils/post-install.ts:429-462`
**Confidence**: 82%
- Problem: The function hardcodes `os.homedir()` to build the path to `~/.claude/history.jsonl`. Tests work around this by mutating `process.env.HOME`, which is a global side effect. Per the project's CLAUDE.md principle "Inject dependencies -- Makes testing trivial", the home directory (or history path) should be an optional parameter.
- Impact: Dependency Inversion -- concrete dependency on OS environment. Test fragility from global env mutation.
- Fix: Accept an optional `homedir` parameter with a default:
```typescript
export async function discoverProjectGitRoots(homedir?: string): Promise<string[]> {
  const historyPath = path.join(homedir ?? os.homedir(), '.claude', 'history.jsonl');
  // ...
}
```
Tests then pass `tmpDir` directly instead of mutating `process.env.HOME`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**init.ts action handler is a 765-line monolith (749 -> 851 lines)** - `src/cli/commands/init.ts:87-851`
**Confidence**: 85%
- Problem: The entire init flow -- scope selection, plugin selection, teams/ambient/memory/HUD prompts, managed settings confirmation, claudeignore discovery, safe-delete detection, path resolution, plugin installation, cleanup, settings configuration, hook installation, extras, summary output -- is a single inline `async` callback passed to `.action()`. This PR grew it from 749 to 851 lines. The prompt-then-action refactor is a positive architectural direction, but the two phases are still interleaved in one function rather than extracted.
- Impact: Single Responsibility Principle -- the handler has at least 6 distinct responsibilities. Testability suffers because only pure re-exported helpers can be unit tested; the orchestration logic itself is untestable without a full integration harness.
- Fix: Extract the prompt collection phase and installation phase into named functions:
```typescript
interface InitChoices {
  scope: 'user' | 'local';
  selectedPlugins: string[];
  teamsEnabled: boolean;
  ambientEnabled: boolean;
  memoryEnabled: boolean;
  hudEnabled: boolean;
  securityMode: SecurityMode;
  managedSettingsConfirmed: boolean;
  claudeignoreEnabled: boolean;
  discoveredProjects: string[];
  safeDeleteAction: 'install' | 'upgrade' | 'skip';
  safeDeleteBlock: string | null;
  earlyGitRoot: string | null;
  // ...
}

async function collectInitChoices(options: InitOptions): Promise<InitChoices> { ... }
async function executeInit(choices: InitChoices, options: InitOptions): Promise<void> { ... }
```
This would make the orchestration testable and align with the "prompt collector" intent.

**Three sequential reads of `settings.json` for ambient, memory, and HUD hooks** - `src/cli/commands/init.ts:688-739`
**Confidence**: 80%
- Problem: After `installSettings` writes `settings.json`, the file is read back three separate times: once for ambient hook injection (line 690), once for memory hooks (line 703), and once for HUD status line (line 729). Each read-modify-write cycle risks race conditions (though unlikely in sequential code) and is inefficient.
- Impact: Modularity concern -- each hook modifier operates independently on the file rather than composing transformations.
- Fix: Read once, apply all transformations, write once:
```typescript
try {
  let content = await fs.readFile(settingsPath, 'utf-8');
  if (ambientEnabled) content = addAmbientHook(content, devflowDir);
  const cleaned = removeMemoryHooks(content);
  content = memoryEnabled ? addMemoryHooks(cleaned, devflowDir) : cleaned;
  content = hudEnabled ? addHudStatusLine(content, devflowDir) : removeHudStatusLine(content);
  await fs.writeFile(settingsPath, content, 'utf-8');
} catch { /* settings.json may not exist yet */ }
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Re-export barrel in init.ts for test convenience** - `src/cli/commands/init.ts:33-36`
**Confidence**: 80%
- Problem: `init.ts` re-exports functions from `ambient.js`, `memory.js`, `hud.js`, and `post-install.js` purely for test convenience (comment says "Re-export pure functions for tests"). This creates artificial coupling -- tests should import from the canonical module directly.
- Impact: Layering concern -- the command module becomes an unnecessary intermediary. Changes to ambient/memory/hud APIs ripple through init.ts imports.
- Note: The PR actually reduced some re-export usage (removed `hasAmbientHook`, `hasMemoryHooks`, `hasHudStatusLine` from direct imports), which is a positive direction. The re-exports on lines 34-36 remain pre-existing.

## Suggestions (Lower Confidence)

- **`earlyGitRoot` called before prompt collection completes** - `src/cli/commands/init.ts:422` (Confidence: 65%) -- `getGitRoot()` is called mid-prompt-phase to gate the claudeignore prompt. This mixes I/O detection with user interaction. Consider moving all detection (git root, platform, shell, safe-delete availability) to a pre-prompt detection phase.

- **`discoveredProjects` batch operation lacks concurrency** - `src/cli/commands/init.ts:744-747` (Confidence: 62%) -- The `for..of` loop over `discoveredProjects` calls `installClaudeignore` sequentially. For users with many projects, `Promise.all` or `Promise.allSettled` with a concurrency limit would be faster.

- **Removed tests for `buildExtrasOptions` not fully replaced** - `tests/init-logic.test.ts` (Confidence: 70%) -- 34 lines of `buildExtrasOptions` tests and 28 lines of re-export tests were removed. The new `discoverProjectGitRoots` tests (94 lines) and `installClaudeignore` return value tests (30 lines) cover the new functionality well, but there is no test coverage for the new prompt-phase logic (claudeignore branching based on scope, safe-delete action state machine).

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The prompt/action separation refactor is architecturally sound and moves in the right direction. The `discoverProjectGitRoots` function is well-designed with proper error handling and deduplication. However, the `pluginHints` duplication should be addressed before merge to prevent drift, and the growing monolith in the action handler warrants extraction into composable functions as a follow-up.

Conditions:
1. Move `pluginHints` to `plugins.ts` as a `shortHint` field on `PluginDefinition` (blocks merge)
2. Consider extracting prompt collection and execution into separate functions (recommended follow-up)
3. Consider consolidating settings.json read-modify-write into a single pass (recommended follow-up)
