# Documentation Review Report

**Branch**: fix/learning-validation-and-debug-logs -> main
**Date**: 2026-03-25
**Commit**: 8e2f451 fix: learning system empty-field validation + debug log relocation

## Issues in Your Changes (BLOCKING)

### HIGH

**README missing `--purge` command in learn CLI table** - `README.md:211-218`
**Confidence**: 95%
- Problem: The `devflow learn` command table in the README lists 6 subcommands (`--enable`, `--disable`, `--status`, `--list`, `--configure`, `--clear`) but omits the new `--purge` option added in `src/cli/commands/learn.ts:249`. Users have no way to discover this feature from the README.
- Fix: Add a row to the table:
```markdown
| `devflow learn --purge` | Remove invalid/corrupted entries from learning log |
```

**README `--configure` description does not mention debug option** - `README.md:217`
**Confidence**: 85%
- Problem: The `--configure` description says "Interactive configuration (model, throttle, daily cap)" but the PR adds a debug logging prompt to the configure wizard (`learn.ts:394-402`). Users will not know debug logging is configurable without running the wizard.
- Fix: Update the description:
```markdown
| `devflow learn --configure` | Interactive configuration (model, throttle, daily cap, debug) |
```

### MEDIUM

**CHANGELOG [Unreleased] section not updated** - `CHANGELOG.md:8-12`
**Confidence**: 85%
- Problem: The PR introduces three notable changes -- (1) observation validation with empty-field rejection, (2) debug logging with log relocation to `~/.devflow/logs/`, and (3) the `--purge` subcommand -- but the CHANGELOG `[Unreleased]` section has no entries for this PR. The existing entry is for the self-learning feature from the prior PR.
- Fix: Add entries under `[Unreleased]`:
```markdown
### Fixed
- **Learning**: reject observations with empty id/type/pattern fields (validation + auto-purge on migration)

### Added
- **Learning**: `devflow learn --purge` command to remove invalid entries from learning log
- **Learning**: debug logging mode (`devflow learn --configure`) — logs to `~/.devflow/logs/`
- **Learning**: debug logs relocated from `.memory/` to `~/.devflow/logs/{project-slug}/`
```

**Tree diagram mixes two unrelated filesystem roots in one code block** - `CLAUDE.md:95-111`, `README.md:231-246`
**Confidence**: 80%
- Problem: The `.memory/` tree and `~/.devflow/logs/{project-slug}/` tree are placed inside the same fenced code block. Since `.memory/` is project-relative and `~/.devflow/logs/` is under the user home directory, this could mislead readers into thinking they share a parent. The introductory text says "Working memory files live in a dedicated `.memory/` directory" which does not cover the `~/.devflow/logs/` section.
- Fix: Either (a) separate them into two code blocks with distinct introductory text, or (b) add a blank-line comment `# Debug logs (global, per-project slug):` before the `~/.devflow/logs/` section to make the context switch explicit.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CLAUDE.md Self-Learning paragraph outdated regarding debug and log location** - `CLAUDE.md:43`
**Confidence**: 82%
- Problem: The Self-Learning paragraph mentions "Configurable model/throttle/caps via `devflow learn --configure`" but does not mention the new debug logging capability or the `--purge` subcommand. It also does not note that debug logs now live at `~/.devflow/logs/` rather than `.memory/`. Since this PR specifically changes log locations and adds debug support, this paragraph should be updated.
- Fix: Append to the paragraph: "Debug logging configurable via `--configure`; logs stored at `~/.devflow/logs/{project-slug}/`. Use `--purge` to remove invalid observations."

**Shell script SYNC comments lack version/date anchor** - `scripts/hooks/background-learning:91-92`, `src/cli/commands/learn.ts:196-197`
**Confidence**: 80%
- Problem: Both the shell script and TypeScript file have `# SYNC: Config loading duplicated in ...` comments with a new line listing synced fields. This is good practice, but the comment does not indicate when the sync was last verified or which fields were added in this change. If a future developer adds a field to one side and forgets the other, the SYNC comment alone does not help them discover drift.
- Fix: Consider adding a field count or hash hint, e.g., `# Synced fields (4): max_daily_runs, throttle_minutes, model, debug` so a mismatch in count is immediately visible.

## Pre-existing Issues (Not Blocking)

### LOW

**`migrateMemoryFiles` success message is generic** - `src/cli/utils/post-install.ts:633`
**Confidence**: 80%
- Problem: The success message was changed from "Migrated N memory file(s) from .docs/ to .memory/" to "Migrated N file(s) to new locations" which is less specific. The original message told users where files moved; the new one does not. However, this function now handles two migration paths (.docs/ to .memory/ and .memory/ to ~/.devflow/logs/), so a single specific message would be misleading.
- Fix: Consider logging the specific migration targets, e.g., "Migrated N file(s) (.memory/ and ~/.devflow/logs/)".

## Suggestions (Lower Confidence)

- **`post-install.ts` auto-purge has no user feedback** - `src/cli/utils/post-install.ts:617-630` (Confidence: 70%) -- The migration silently purges invalid learning observations without informing the user. Consider adding a verbose log when entries are purged so users know data was cleaned.

- **`background-learning` prompt documentation could note validation expectations** - `scripts/hooks/background-learning:276-278` (Confidence: 65%) -- The new prompt rules ("Every observation MUST have...") are well-written for the LLM, but the inline script comments at the top of the file (lines 1-7) still describe only the happy path. A brief mention of validation in the file header would help maintainers.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The code changes are well-implemented with good inline comments (SYNC markers, debug guards, validation rules in prompts). However, the user-facing documentation (README command table, CHANGELOG, CLAUDE.md feature description) has not been updated to reflect the new `--purge` subcommand, the debug configuration option, or the log relocation. These are the primary gaps. The tree diagram mixing two filesystem roots in one code block is a minor clarity issue worth addressing.
