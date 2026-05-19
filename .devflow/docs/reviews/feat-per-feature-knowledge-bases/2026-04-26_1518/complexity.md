# Complexity Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26

## Issues in Your Changes (BLOCKING)

### HIGH

**`kbCommand.action()` handler contains three branches (enable/disable/status) with duplicated setup and no extraction** - `src/cli/commands/kb.ts:144-247`
**Confidence**: 85%
- Problem: The `.action()` handler at line 144 is a 103-line function with three `if/else` branches that each independently resolve paths (worktreePath, claudeDir, devflowDir, settingsPath), read/write settings, and update the manifest. The enable and disable branches share 80%+ structural similarity (read settings, modify hook, update manifest) with only the operation differing. This violates the "extract shared structure" principle.
- Fix: Extract a helper like `async function toggleKbFeature(enable: boolean)` that handles the shared settings read-modify-write and manifest update, then call it from each branch. The status branch can remain inline since it only reads. Example:
  ```typescript
  async function toggleKbFeature(enable: boolean, worktreePath: string, settingsPath: string, devflowDir: string): Promise<void> {
    const featuresDir = path.join(worktreePath, '.features');
    await fs.mkdir(featuresDir, { recursive: true });
    if (enable) {
      // ... enable logic
    } else {
      // ... disable logic
    }
    // shared: update manifest
    const manifest = await readManifest(devflowDir);
    if (manifest) {
      manifest.features.kb = enable;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(devflowDir, manifest);
    }
  }
  ```

### MEDIUM

**`background-kb-refresh` for-loop body (lines 97-164) is a 67-line block with nested async process management** - `scripts/hooks/background-kb-refresh:97-164`
**Confidence**: 82%
- Problem: The for-loop body that refreshes each stale KB performs file reads, metadata parsing, prompt construction, process spawning with a watchdog timer, and exit code analysis all in a single inline block. The prompt construction alone (lines 116-139) is 23 lines of heredoc-style string building. The watchdog pattern (spawn, background sleep-kill, wait, cleanup) spans lines 142-163. This is at the boundary of the 50-line function-length warning threshold.
- Fix: Extract the per-slug refresh logic into a shell function (`refresh_single_kb`) and the prompt construction into a separate function. This also makes the watchdog pattern reusable if other background scripts need it:
  ```bash
  refresh_single_kb() {
    local slug="$1"
    local kb_path="$CWD/.features/$slug/KNOWLEDGE.md"
    # ... file read, context fetch, prompt build, claude spawn + watchdog
  }
  ```

## Issues in Code You Touched (Should Fix)

### CRITICAL

**`init.ts` `.action()` handler is 979 lines (line 159-1138) — a single monolithic function** - `src/cli/commands/init.ts:159-1138`
**Confidence**: 95%
- Problem: The `initCommand.action()` callback is a single anonymous async function spanning 979 lines. This is nearly 5x the CRITICAL threshold of 200 lines. It handles: scope selection, HUD-only flow, plugin selection, setup mode determination, feature flag collection (7 features, each with recommended/advanced/CLI-override logic), flag multiselect, claudeignore, safe-delete, security deny list, sudo confirmation, path resolution, upgrade detection, validation, plugin installation, legacy cleanup, settings configuration (ambient, memory, learning, HUD, KB, flags), memory directory creation, features directory creation, disabled sentinel management, HUD configuration, claudeignore installation, gitignore updates, safe-delete installation, managed settings, jq check, summary output, and manifest writing. This PR adds ~45 lines to this already-critical function (KB option handling, KB hook, KB directory creation, disabled sentinel management). While none of the individual additions are complex, they compound a pre-existing severity problem.
- Fix: This function should be decomposed into named phases. Each major section already has comment banners that serve as natural extraction points:
  ```typescript
  // Extraction candidates (each is a self-contained block):
  async function resolveScope(options: InitOptions): Promise<'user' | 'local'>
  async function selectPlugins(options: InitOptions): Promise<string[]>
  async function collectFeatureDecisions(options: InitOptions, useRecommended: boolean): Promise<FeatureDecisions>
  async function installComponents(decisions: FeatureDecisions): Promise<void>
  async function configureSettings(decisions: FeatureDecisions): Promise<void>
  async function writeSummary(decisions: FeatureDecisions): Promise<void>
  ```
  This is a pre-existing issue, but the PR touches it repeatedly and makes it worse. The recommended action is to file a tech-debt issue, not block this PR.

### HIGH

**`feature-kb.cjs` CLI dispatch table (lines 390-565) lacks extraction for repeated argv/validation boilerplate** - `scripts/hooks/lib/feature-kb.cjs:390-565`
**Confidence**: 80%
- Problem: The CLI dispatch table has grown to 8 subcommands, each of which independently calls `requireWorktree(argv)`, validates arguments, and calls `process.exit()`. The new `stale-slugs` and `refresh-context` subcommands (added in this PR) follow the same pattern as existing commands. The file is now 565 lines, exceeding the 500-line file-length warning threshold.
- Fix: Extract a shared entry-point wrapper that handles worktree resolution and argument validation, then pass the validated arguments to each subcommand function. This would eliminate the repeated `requireWorktree` + `process.exit` pattern.

## Pre-existing Issues (Not Blocking)

### CRITICAL

**`init.ts` `.action()` handler at 979 lines** - `src/cli/commands/init.ts:159-1138`
**Confidence**: 95%
- This is the same issue described in "Should Fix" above. The 979-line function was pre-existing; this PR adds ~45 lines to it. The function has a cyclomatic complexity well above 20 (multiple nested if/else chains for each feature, TTY detection, cancel handling, error recovery). Every new feature toggle adds another ~20-line block. The function will continue to grow with each new toggleable feature unless decomposed.

## Suggestions (Lower Confidence)

- **Magic number 7200 in session-end-kb-refresh throttle** - `scripts/hooks/session-end-kb-refresh:37` (Confidence: 65%) -- The 2-hour throttle is expressed as `7200` without a named constant. Other hook scripts in this codebase use named variables for their thresholds (e.g., `STALE_THRESHOLD=300` in `background-kb-refresh`). A `THROTTLE_SECONDS=7200` would match the convention.

- **Repeated `JSON.stringify({ version: 1, features: {} }, null, 2) + '\n'` pattern** - `src/cli/commands/kb.ts:162`, `src/cli/commands/init.ts:988` (Confidence: 70%) -- The empty index boilerplate appears in both `init.ts` and `kb.ts`. A shared constant or factory function would reduce duplication.

- **`checkStaleness` in `refresh-context` subcommand rechecks git-dir that `checkEntryFiles` already handles** - `scripts/hooks/lib/feature-kb.cjs:540` (Confidence: 62%) -- `refresh-context` calls `checkStaleness(worktreePath, slug)` which includes the git-dir check, but the caller already knows it needs staleness data. Since `refresh-context` is only invoked from `background-kb-refresh` where git is guaranteed (the hook already ran `stale-slugs` successfully), the double-check is harmless but mildly redundant.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | - | 1 | 1 | - |
| Should Fix | 1 | 1 | - | - |
| Pre-existing | 1 | - | - | - |

**Complexity Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new code added by this PR is generally well-structured -- the hook scripts follow established patterns (`background-learning`, `session-end-learning`), the feature-kb.cjs refactoring (extracting `checkEntryFiles`) reduces duplication, and tests are thorough. The primary complexity concern is the continued growth of `init.ts`'s monolithic `.action()` handler. The blocking HIGH issue (duplicated enable/disable logic in `kb.ts`) is straightforward to address. The CRITICAL pre-existing issue in `init.ts` should be tracked as tech debt but does not block this PR per the review methodology's Iron Law.
