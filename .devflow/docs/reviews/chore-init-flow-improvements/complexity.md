# Complexity Review Report

**Branch**: chore/init-flow-improvements -> main
**Date**: 2026-03-22

## Issues in Your Changes (BLOCKING)

### CRITICAL

**Monolithic action handler exceeds all complexity thresholds** - `src/cli/commands/init.ts:87-851`
**Confidence**: 95%
- Problem: The single `.action(async ...)` handler is ~765 lines with an estimated cyclomatic complexity of ~176. On main it was already problematic (~631 lines, complexity ~145), but this PR increases it further (+134 lines, +31 complexity points). The function handles prompt collection, path resolution, plugin installation, settings configuration, file extras, safe-delete, and summary output all in one closure. By every standard metric (function length >200 lines = CRITICAL, complexity >20 = CRITICAL), this is severely over threshold.
- Fix: Extract the handler into named phases. The PR already introduces a clear architectural boundary with the `// All prompts collected -- installation begins` comment. This naturally splits into at least 3 extractable functions:
  ```typescript
  // Phase 1: Collect all user choices
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
  }
  async function collectInitChoices(options: InitOptions, version: string): Promise<InitChoices> { ... }

  // Phase 2: Execute installation
  async function executeInstallation(choices: InitChoices, version: string): Promise<void> { ... }

  // Phase 3: Print summary
  function printSummary(choices: InitChoices, ...): void { ... }
  ```

### HIGH

**Repetitive cancel-check boilerplate (12 occurrences)** - `src/cli/commands/init.ts:128`, `:254`, `:282`, `:310`, `:336`, `:359`, `:383`, `:413`, `:446`, `:457`, `:475`, `:517`
**Confidence**: 92%
- Problem: The identical 3-line pattern `if (p.isCancel(x)) { p.cancel('Installation cancelled.'); process.exit(0); }` is repeated 12 times (was 10 on main, this PR adds 2 more). This is boilerplate duplication that inflates both line count and cyclomatic complexity.
- Fix: Extract a helper that wraps prompt calls:
  ```typescript
  function cancelGuard<T>(result: T | symbol): T {
    if (p.isCancel(result)) {
      p.cancel('Installation cancelled.');
      process.exit(0);
    }
    return result as T;
  }

  // Usage:
  const selected = cancelGuard(await p.select({ ... }));
  ```

### MEDIUM

**Claudeignore prompt section has 3-way branching with duplicated confirm logic** - `src/cli/commands/init.ts:421-483`
**Confidence**: 85%
- Problem: The newly added claudeignore prompt section (lines 421-483, ~62 lines) has 3 branches (user scope with discovered projects, user scope without, local scope) that each contain nearly identical `p.confirm` + `p.isCancel` + assignment logic. The nesting reaches 6 levels deep (the deepest point in the file). This is new code added in this PR.
- Fix: Extract the prompt logic:
  ```typescript
  async function promptClaudeignore(
    scope: 'user' | 'local',
    discoveredProjects: string[],
  ): Promise<boolean> {
    // scope-specific note display...
    const message = discoveredProjects.length > 0
      ? `Install .claudeignore to ${discoveredProjects.length} projects? (Recommended)`
      : 'Create .claudeignore? (Recommended)';
    return cancelGuard(await p.confirm({ message, initialValue: true }));
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**File length exceeds threshold** - `src/cli/commands/init.ts` (851 lines)
**Confidence**: 88%
- Problem: The file grew from 749 lines (main) to 851 lines. The complexity patterns guideline flags files >500 lines as critical. The file contains a pure function (`parsePluginSelection`), an interface, the Command builder, and the massive action handler -- the handler alone accounts for ~90% of lines.
- Fix: Move prompt-collection and installation-execution phases to separate modules (e.g., `init-prompts.ts`, `init-install.ts`), keeping the command definition file as a thin orchestrator.

## Pre-existing Issues (Not Blocking)

### CRITICAL

**Action handler was already severely over complexity thresholds on main** - `src/cli/commands/init.ts:87`
**Confidence**: 95%
- Problem: The action handler on main was already ~631 lines with ~145 estimated cyclomatic complexity -- far exceeding the CRITICAL thresholds of >200 lines and >20 complexity. This PR makes it worse but did not introduce the root issue.
- Note: This pre-existing debt is the primary reason the new changes score poorly. A separate refactoring PR to decompose the handler would make future changes like this one much cleaner.

## Suggestions (Lower Confidence)

- **`pluginHints` map could be co-located with plugin definitions** - `src/cli/commands/init.ts:218-233` (Confidence: 70%) -- The inline `Record<string, string>` duplicates plugin names that already exist in `plugins.ts`. Could add a `hint` field to `PluginDefinition` instead of maintaining a separate map that may drift out of sync.

- **Settings file read-modify-write repeated 3 times without abstraction** - `src/cli/commands/init.ts:689-739` (Confidence: 65%) -- The pattern of `readFile(settingsPath) -> transform -> writeFile(settingsPath)` with try/catch is repeated for ambient hook (688-699), memory hooks (702-715), and HUD (728-739). A shared `updateSettingsFile(path, transformer)` helper would reduce duplication.

- **Safe-delete status messages section is a 4-branch conditional tree** - `src/cli/commands/init.ts:791-813` (Confidence: 62%) -- The nested if/else if tree for safe-delete status messages after the spinner could be simplified with early returns or a status-to-message mapping.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 1 | 1 | 1 | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | 1 | - | - | - |

**Complexity Score**: 3/10
**Recommendation**: CHANGES_REQUESTED

The PR's stated goal -- improving the init flow UX by moving all prompts before the installation spinner -- is a good architectural direction. The "collect all choices, then execute" pattern is sound and makes the UX noticeably better. However, the implementation adds 100+ net lines to an already critically oversized function without extracting any phases into separate functions. The newly introduced `discoverProjectGitRoots` function (in `post-install.ts`) and `installClaudeignore` return-type change are well-structured. The test coverage additions are thorough and well-organized. The core issue is that the action handler needs decomposition -- ideally in this PR since it's already restructuring the flow into distinct phases.
