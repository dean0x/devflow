# Complexity Review Report

**Branch**: feat/flags-init-redesign -> main
**Date**: 2026-03-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Init action handler grew from 786 to 877 lines (PF-002 regression)** - `src/cli/commands/init.ts:98-974`
**Confidence**: 95%
- Problem: The init command action handler was already flagged as a known pitfall (PF-002: "single `.action(async ...)` handler is ~765 lines with cyclomatic complexity ~176"). This PR adds 91 net lines to the monolith, growing it to 877 lines. The recommended/advanced bifurcation adds a large `if/else` block (lines 324-646, ~322 lines) that duplicates decision-making structures across both paths rather than extracting them. PF-002's resolution called for extracting into `collectInitChoices()`, `executeInstallation()`, `printSummary()` — this PR moves further from that goal by embedding another branching dimension.
- Fix: Extract the recommended/advanced choice collection into a dedicated function. A possible signature:
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

  async function collectInitChoices(
    options: InitOptions,
    scope: string,
    useRecommended: boolean,
  ): Promise<InitChoices> { ... }
  ```
  This would remove ~300 lines from the action handler and make each path independently testable.

**Safe-delete version-check logic duplicated 3 times** - `src/cli/commands/init.ts:345`, `src/cli/commands/init.ts:570`, `src/cli/commands/init.ts:923`
**Confidence**: 92%
- Problem: The 3-way `installedVersion` comparison (`=== SAFE_DELETE_BLOCK_VERSION` / `> 0` / else) appears at line 345 (recommended path), line 570 (advanced path), and line 923 (execution phase). Each occurrence is slightly different (recommended auto-installs, advanced prompts, execution acts), but the version-detection logic is identical. This triples the maintenance surface for a version scheme change.
- Fix: Extract a pure function that classifies the version state:
  ```typescript
  function classifySafeDeleteState(
    installedVersion: number,
  ): 'current' | 'outdated' | 'missing' {
    if (installedVersion === SAFE_DELETE_BLOCK_VERSION) return 'current';
    if (installedVersion > 0) return 'outdated';
    return 'missing';
  }
  ```
  Then each call site only needs a switch on the return value, reducing duplication and making the logic self-documenting.

**Cancel-check boilerplate repeated 14 times in advanced path** - `src/cli/commands/init.ts:293-643`
**Confidence**: 85%
- Problem: The pattern `if (p.isCancel(x)) { p.cancel('Installation cancelled.'); process.exit(0); }` appears 14 times in init.ts. Each is 3-4 lines of identical code. This is a readability and maintenance burden (cyclomatic complexity +14 decision points).
- Fix: Extract a helper that throws or exits on cancel:
  ```typescript
  function cancelGuard<T>(value: T | symbol): T {
    if (p.isCancel(value)) {
      p.cancel('Installation cancelled.');
      process.exit(0);
    }
    return value as T;
  }
  ```
  Usage: `const teamsChoice = cancelGuard(await p.select({...}));`

### MEDIUM

**Advanced path nesting reaches depth 7** - `src/cli/commands/init.ts:519`
**Confidence**: 90%
- Problem: The `.claudeignore` section in the advanced path nests 7 levels deep: `action -> else (advanced) -> if (earlyGitRoot) -> if (scope === 'user') -> if (discoveredProjects.length > 0) -> const overflow -> ternary`. The complexity skill's critical threshold is depth > 4. This deeply nested code is difficult to follow and modify.
- Fix: Extract `.claudeignore` prompting into a standalone function:
  ```typescript
  async function promptClaudeignore(
    scope: string,
    gitRoot: string | null,
  ): Promise<{ enabled: boolean; projects: string[] }> { ... }
  ```

**12 mutable `let` declarations in a single scope** - `src/cli/commands/init.ts:306-317`
**Confidence**: 82%
- Problem: Lines 306-317 declare 12 mutable variables (`teamsEnabled`, `ambientEnabled`, `memoryEnabled`, `learnEnabled`, `hudEnabled`, `enabledFlags`, `claudeignoreEnabled`, `discoveredProjects`, `safeDeleteAction`, `safeDeleteBlock`, `securityMode`, `managedSettingsConfirmed`) that are conditionally mutated across two large branches. This "declare everything, mutate later" pattern makes it hard to track which path sets which variable and whether any variable is left in its default state unintentionally.
- Fix: This would naturally resolve with the `collectInitChoices()` extraction suggested above. Each path returns a complete `InitChoices` object, making it impossible to forget a field.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Recommended path silently differs from advanced in safe-delete and security behavior** - `src/cli/commands/init.ts:324-369`
**Confidence**: 80%
- Problem: The recommended path auto-installs safe-delete and uses `securityMode = 'user'` (never offers managed settings). The advanced path prompts for both. This behavioral divergence is not obvious from the code because the two paths are 250+ lines apart. A reader must mentally diff the two branches to understand which features get different treatment.
- Fix: Add a comment block at the top of the recommended path explicitly listing every behavioral difference from advanced. Alternatively, a shared configuration table/object would make the divergence declarative rather than procedural.

## Pre-existing Issues (Not Blocking)

### CRITICAL

**Init action handler is an untestable monolith (PF-002)** - `src/cli/commands/init.ts:98-974`
**Confidence**: 95%
- Problem: Already documented as PF-002. The single `.action()` handler is 877 lines (was 786 on main). It handles scope selection, plugin selection, mode selection, 7+ feature prompts, file operations, settings mutation, hook installation, manifest writing, and summary output. Cyclomatic complexity is estimated at 180+. This is a pre-existing architectural issue, but this PR widens the gap.
- Fix: As documented in PF-002: extract into `collectInitChoices()`, `executeInstallation()`, `printSummary()` in a dedicated refactoring PR.

## Suggestions (Lower Confidence)

- **Flag command option dispatch uses cascading if/else** - `src/cli/commands/flags.ts:80-130` (Confidence: 65%) -- The four `if (options.X)` blocks in the flags command action handler could be refactored into a command pattern or subcommands, but at 130 total lines this is not pressing.

- **Recommended summary string building uses inline ternaries in template literals** - `src/cli/commands/init.ts:357-366` (Confidence: 60%) -- The summary-line construction uses embedded ternaries and empty-string filtering. A small helper or `Object.entries` approach could improve clarity.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 1 | 0 | 0 | 0 |

**Complexity Score**: 4/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The new `src/cli/utils/flags.ts` (112 lines) and `src/cli/commands/flags.ts` (130 lines) are well-structured -- pure functions, clean separation, good test coverage (179 lines of focused behavior tests). These files are a model of low complexity.

However, the init.ts changes move in the wrong direction relative to a known pitfall (PF-002). The action handler grows from 786 to 877 lines, adds a 322-line recommended/advanced bifurcation with duplicated logic across both paths, and introduces 12 mutable `let` variables managed across distant code blocks. The safe-delete version-check appears 3 times and the cancel-guard pattern 14 times.

The recommended path to merge: extract the choice-collection phase into a testable function (removing ~300 lines from the handler), deduplicate the safe-delete version classification, and add a cancel-guard helper. These are targeted refactors that would keep the PR's behavioral goals while reducing complexity rather than increasing it.
