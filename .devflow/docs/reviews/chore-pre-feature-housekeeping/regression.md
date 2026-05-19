# Regression Review Report

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20
**PR**: #153

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Incomplete "skim" to "rskim" migration in visual diagrams (4 occurrences)** -- Confidence: 90%
- `plugins/devflow-implement/commands/implement.md:363`, `plugins/devflow-implement/commands/implement-teams.md:550`, `plugins/devflow-specify/commands/specify.md:140`, `plugins/devflow-specify/commands/specify-teams.md:273`
- Problem: The Skimmer agent prompt text in Phase 2 of these commands was updated to reference "rskim" (lines ~55-56 of each file), but the ASCII pipeline diagrams at the bottom of each file still say `Skimmer agent (codebase overview via skim)` and `Skimmer agent (codebase context via skim)`. The `shared/agents/skimmer.md` description was changed to `using rskim`, but these diagram references were left behind.
- Impact: Documentation inconsistency within the same files that were modified. While this does not break runtime behavior (the diagrams are informational), it creates a confusing signal for developers reading the commands -- the top says "rskim" and the bottom says "skim".
- Fix: Update the 4 diagram lines to match the new terminology:
  ```
  # implement.md:363 and implement-teams.md:550
  │  └─ Skimmer agent (codebase overview via rskim)

  # specify.md:140 and specify-teams.md:273
  │  └─ Skimmer agent (codebase context via rskim)
  ```

## Issues in Code You Touched (Should Fix)

### LOW

**README description not updated for skimmer rename** -- Confidence: 82%
- `plugins/devflow-specify/README.md:32`
- Problem: The specify plugin README still reads `skimmer - Codebase orientation using skim for file/function discovery`. The shared agent was renamed from "skim" to "rskim" throughout, but this README was not updated.
- Impact: Minor documentation drift in a file within the specify plugin, which was modified in this PR (the specify commands were changed).
- Fix: Update line 32 to: `- \`skimmer\` - Codebase orientation using rskim for file/function discovery`

## Pre-existing Issues (Not Blocking)

### MEDIUM

**macOS-only `stat -f %m` in hook scripts (3 occurrences)** -- Confidence: 85%
- `scripts/hooks/background-memory-update:38`, `scripts/hooks/session-start-memory:34`, `scripts/hooks/stop-update-memory:42`
- Problem: The CHANGELOG for this PR documents fixing `stat -f %m` portability in the statusline script by introducing a portable `get_mtime()` helper. However, the three hook scripts in `scripts/hooks/` still use the macOS-only `stat -f %m` directly without the portable helper.
- Impact: These hooks will fail on Linux, which is the same problem being fixed in the statusline. The fix is already implemented (the `get_mtime()` pattern) but was not applied to the hooks. Not blocking since these files were not modified in this PR.
- Fix: Consider a follow-up PR to either extract `get_mtime()` to a shared shell helper and source it from all scripts, or inline the same portable logic in each hook.

## Suggestions (Lower Confidence)

- **Skimmer tool restriction removes fallback capability** - `shared/agents/skimmer.md:4` (Confidence: 65%) -- Adding `tools: ["Bash", "Read"]` is an intentional hardening, but the new escalation boundary says "If `npx rskim` fails, report the error (do not attempt manual fallbacks with other tools)". If `rskim` is unavailable or broken (e.g., npm registry down, npx cache corrupt), the Skimmer becomes completely non-functional with no degraded mode. The old agent could at least fall back to Grep/Glob. This is a tradeoff, not a bug -- worth monitoring in production.

- **`get_mtime()` runs `stat` twice on macOS (probe + actual call)** - `scripts/statusline.sh:15-22` (Confidence: 62%) -- The helper calls `stat -f %m` once in the `if` condition (output discarded to /dev/null) and again to produce the value. On the hot path of the statusline (called every prompt), this doubles filesystem stat calls. Minor performance impact, likely negligible.

- **`sort -V` portability on minimal Linux distributions** - `scripts/statusline.sh:192` (Confidence: 60%) -- `sort -V` (version sort) is a GNU coreutils extension. While available on most Linux distros and macOS (via GNU coreutils or recent macOS), it may not be present on Alpine or BusyBox-based systems. Given the statusline already requires `jq`, this is a reasonable assumption.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 1 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Regression Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is well-structured housekeeping with good test coverage for the new changes. The main regression concern is an incomplete migration: the "skim" to "rskim" rename was applied to agent prompts and frontmatter but missed 4 visual diagram references and 1 README reference in files that were otherwise modified. These are documentation-only inconsistencies and do not affect runtime behavior, but they should be cleaned up before merge to avoid confusion. No exports were removed, no return types changed, no deleted files, and no new TODOs introduced. The commit messages accurately reflect their implementations.
