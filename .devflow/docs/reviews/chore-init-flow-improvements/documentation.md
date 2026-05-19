# Documentation Review Report

**Branch**: chore/init-flow-improvements -> main
**Date**: 2026-03-22

## Issues in Your Changes (BLOCKING)

### MEDIUM

**CHANGELOG not updated for init flow improvements** - `CHANGELOG.md:[Unreleased]`
**Confidence**: 85%
- Problem: The `[Unreleased]` section is empty, but this branch introduces multiple user-facing changes to the init flow: project discovery via `discoverProjectGitRoots`, batch `.claudeignore` installation, `p.note()` explanations before each feature prompt, removal of the extras multiselect, and addition of the `--hud` flag. These are notable UX changes that users and contributors rely on the CHANGELOG to discover.
- Fix: Add entries under `[Unreleased]` covering at minimum:
  - `Changed`: Init flow replaces extras multiselect with individual feature prompts with explanatory notes
  - `Added`: `--hud` flag for explicitly enabling HUD during init
  - `Added`: Project discovery — user-scope `.claudeignore` install scans `~/.claude/history.jsonl` for all known projects
  - `Removed`: `buildExtrasOptions` / extras multiselect (internal, but breaking for any external consumers of the export)

**README missing `--hud` flag in CLI options table** - `README.md:248-253`
**Confidence**: 88%
- Problem: This branch adds `.option('--hud', 'Enable HUD (git info, context usage, session stats)')` to the Commander definition (`init.ts:84`), but the README's CLI options table only lists `--hud-only` and `--no-hud`. The new `--hud` flag is undocumented for users.
- Fix: Add a row to the init flags table in `README.md`:
  ```
  | `--hud` / `--no-hud` | Enable/disable HUD status line (default: on) |
  ```
  And remove the separate `--no-hud` row to match the paired format used by `--teams`, `--ambient`, and `--memory`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**New `discoverProjectGitRoots` function missing `@returns` JSDoc** - `src/cli/utils/post-install.ts:426-462`
**Confidence**: 82%
- Problem: The existing codebase documents return values for functions like `installClaudeignore` ("Returns true if a new file was created, false if it already existed or on error") and `migrateMemoryFiles` ("Returns count of migrated files"). The new `discoverProjectGitRoots` has a brief summary ("Discover git repository roots from Claude's project history") and notes the data source, but does not document what it returns (sorted array of absolute paths to git roots) or edge cases (returns empty array if history file missing, skips non-git directories).
- Fix: Expand the JSDoc:
  ```typescript
  /**
   * Discover git repository roots from Claude's project history.
   * Parses ~/.claude/history.jsonl for unique project paths that are valid git repos.
   * @returns Sorted array of absolute paths to git repository roots. Empty if history is missing or contains no valid repos.
   */
  ```

## Pre-existing Issues (Not Blocking)

No pre-existing documentation issues identified in the reviewed files.

## Suggestions (Lower Confidence)

- **Inline comment for prompt/install phase separation** - `src/cli/commands/init.ts:524-526` (Confidence: 70%) -- The ASCII box comment separating prompts from installation is a good addition. Consider adding a similar brief comment at the top of the prompt collection section (around line 106, after the scope determination) to make the two-phase structure explicit (e.g., `// === Prompt phase: collect all user choices ===`), matching the `// === Settings & hooks ===` and `// === Summary ===` section markers already present.

- **Removed exports may break downstream consumers** - `src/cli/commands/init.ts` (Confidence: 65%) -- The `buildExtrasOptions`, `ExtraId`, and `ExtraOption` types were previously exported from `init.ts`. While these are internal types unlikely to have external consumers, the removal is undocumented. If any downstream code imports these, the removal is a breaking change. A note in the CHANGELOG would make this explicit.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The code changes themselves are well-structured with good inline comments explaining the prompt/install phase separation. The `p.note()` additions before each feature prompt are a strong documentation improvement for users. However, the CHANGELOG and README have not been updated to reflect the user-facing changes (new `--hud` flag, removal of extras multiselect, project discovery feature), and the new `discoverProjectGitRoots` utility function lacks complete JSDoc.
