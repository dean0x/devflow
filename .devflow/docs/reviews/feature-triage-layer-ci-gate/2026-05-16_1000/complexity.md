# Complexity Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

### HIGH

**Repetitive sentinel management pattern (4 occurrences)** — Confidence: 90%
- `src/cli/commands/init.ts:1226-1269`
- Problem: Four nearly identical sentinel management blocks were added in init.ts, each following the exact same pattern: `if (gitRoot) { const sentinel = ...; if (featureEnabled) { try unlink } else { mkdir + writeFile } }`. The blocks for knowledge (.features/.disabled), decisions (.memory/decisions/.disabled), memory (.memory/.working-memory-disabled), and learning (.memory/.learning-disabled) are structurally identical with only the path differing. This adds ~44 lines of duplicated control flow inside a function that is already 1,159 lines long.
- Fix: Extract a reusable helper:
```typescript
async function manageSentinel(
  gitRoot: string,
  sentinelPath: string,
  parentDir: string,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    try { await fs.unlink(sentinelPath); } catch { /* doesn't exist */ }
  } else {
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(sentinelPath, '', 'utf-8');
  }
}
```
Then the four blocks reduce to:
```typescript
if (gitRoot) {
  await manageSentinel(gitRoot, path.join(gitRoot, '.features', '.disabled'), path.join(gitRoot, '.features'), knowledgeEnabled);
  await manageSentinel(gitRoot, path.join(gitRoot, '.memory', 'decisions', '.disabled'), path.join(gitRoot, '.memory', 'decisions'), decisionsEnabled);
  await manageSentinel(gitRoot, path.join(gitRoot, '.memory', '.working-memory-disabled'), path.join(gitRoot, '.memory'), memoryEnabled);
  await manageSentinel(gitRoot, path.join(gitRoot, '.memory', '.learning-disabled'), path.join(gitRoot, '.memory'), learnEnabled);
}
```

**Duplicated sentinel enable/disable pattern across CLI commands (3 occurrences)** — Confidence: 85%
- `src/cli/commands/memory.ts:333-337` (--enable), `src/cli/commands/memory.ts:351-356` (--disable)
- `src/cli/commands/learn.ts:933-938` (--enable), `src/cli/commands/learn.ts:950-956` (--disable)
- Problem: The `--enable` and `--disable` handlers in both `memory.ts` and `learn.ts` repeat the same sentinel management logic (unlink on enable, mkdir+writeFile on disable). This is a third copy of the pattern already present in `init.ts`. All three sites use identical fs operations with different sentinel file paths.
- Fix: Move the `manageSentinel` helper proposed above to a shared utility (e.g., `src/cli/utils/sentinel.ts`), then call it from init.ts, memory.ts, and learn.ts. This centralizes the create/remove logic and eliminates the risk of divergent behavior if the pattern evolves.

### MEDIUM

**session-start-context: dual-path jq/node logic adds branching complexity** — Confidence: 82%
- `scripts/hooks/session-start-context:90-104`
- Problem: The learned behaviors section (Section 1.75) has a 14-line `if/else` block that duplicates the JSON extraction logic in both a jq path and a node fallback path. Both branches produce identical output (LEARNED_COMMANDS, LEARNED_SKILLS), but the node fallback uses inline JavaScript strings inside bash heredocs, creating a maintenance burden when the extraction logic changes.
- Fix: This is a pre-existing pattern inherited from session-start-memory, so not a regression. However, the extraction could be pushed entirely into `json-parse` or `json-helper.cjs` as a single function that abstracts over the jq/node choice. This would reduce the branching in the hook itself.

## Issues in Code You Touched (Should Fix)

### HIGH

**init.ts .action() handler: 1,159 lines** — Confidence: 95%
- `src/cli/commands/init.ts:251-1409`
- Problem: The `.action()` handler for the init command is 1,159 lines long -- exceeding the CRITICAL threshold of 200 lines by 5.8x. While this PR only added ~112 lines to it (sentinel management + context hook wiring), each addition increases the cognitive load of an already unwieldy function. The function handles scope detection, HUD-only mode, plugin selection, setup mode branching (recommended vs advanced), feature prompting (8 features), flag selection, installation, cleanup, settings configuration, sentinel management, and summary display.
- Fix: This is too large for a single PR fix, but the new sentinel blocks (this PR's additions) should be extracted immediately. A follow-up could decompose the handler into phases: `collectOptions()`, `resolveInstallPaths()`, `installAssets()`, `configureSettings()`, `manageSentinels()`, `writeSummary()`.

### MEDIUM

**learn.ts .action() handler: 700 lines** — Confidence: 88%
- `src/cli/commands/learn.ts:261-960`
- Problem: The learn command handler is 700 lines, organized as a linear chain of `if (options.X) { ... return; }` blocks. While each block is self-contained and the early-return pattern keeps nesting low, the overall length makes it hard to find any given subcommand's implementation. This PR added sentinel management to --enable/--disable and --status, further extending the function.
- Fix: Each `--flag` handler could be extracted to a named async function (e.g., `handleLearnEnable()`, `handleLearnStatus()`), leaving the `.action()` as a thin dispatcher. This is not blocking for this PR.

## Pre-existing Issues (Not Blocking)

### CRITICAL

**init.ts overall file length: 1,409 lines** — Confidence: 95%
- `src/cli/commands/init.ts`
- Problem: At 1,409 lines, this file is nearly 3x the warning threshold (500 lines) for file length. The file contains exports for 7+ modules' functions (re-exports for tests), utility functions, the InitOptions interface, and the massive .action() handler. This is a pre-existing issue but worth flagging because the PR adds to it.
- Fix: Separate concerns: move `addContextHook`/`removeContextHook`/`hasContextHook` to a dedicated `context-hook.ts` (matching the pattern of `ambient.ts`, `memory.ts`, `learn.ts`). Move sentinel management to `sentinel.ts`. Move `parsePluginSelection`, `classifySafeDeleteState`, `runMigrationsWithFallback` to their own utility files.

## Suggestions (Lower Confidence)

- **session-start-context CONTEXT accumulation pattern** - `scripts/hooks/session-start-context:65-73,139-145` (Confidence: 70%) -- The `if [ -n "$CONTEXT" ]; then CONTEXT="..."; else CONTEXT="..."; fi` pattern repeats twice for appending sections. A bash helper function `append_section()` could reduce this, but the two-branch pattern is idiomatic in shell scripts.

- **Test file structure mixing integration and unit tests** - `tests/sentinel.test.ts` (Confidence: 65%) -- The 434-line test file mixes shell integration tests (execSync-based hook tests) with unit tests (TypeScript function imports). Separating these would improve test isolation, but the grouping by feature (sentinel guards) is coherent.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 1 | 1 | 0 |
| Pre-existing | 1 | 0 | 0 | 0 |

**Complexity Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The new code (context hook utilities, sentinel guards, session-start-context hook) is individually well-structured -- each function is short, well-documented, and follows established patterns. The blocking issues are about duplication: four identical sentinel blocks in init.ts and the same pattern repeated in memory.ts/learn.ts. Extracting a shared `manageSentinel()` utility would eliminate ~50 lines of duplicated logic across three files and make the sentinel contract explicit. The pre-existing init.ts monolith (1,159-line handler) is the elephant in the room; while not caused by this PR, each addition makes the eventual refactor harder. The context hook utilities (`addContextHook`/`removeContextHook`/`hasContextHook`) correctly follow the established add/remove/has pattern from memory.ts and learn.ts.
