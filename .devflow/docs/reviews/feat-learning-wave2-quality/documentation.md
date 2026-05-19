# Documentation Review Report

**Branch**: feat-learning-wave2-quality -> main
**Date**: 2026-03-25
**PR**: #162

## Issues in Your Changes (BLOCKING)

### HIGH

**docs/reference/file-organization.md not updated for hook rename** - `docs/reference/file-organization.md:50,157`
**Confidence**: 90%
- Problem: `file-organization.md` still references `stop-update-learning` as the learning hook in the file tree (line 50: `stop-update-learning     # Stop hook: triggers background learning`) and in the prose description (line 157: `A fourth hook (stop-update-learning) provides self-learning`). The PR renames this hook to `session-end-learning` and changes the event type from Stop to SessionEnd, but this reference doc was not updated. This is code-comment drift: the documentation actively contradicts the new behavior.
- Fix: Update both references in `docs/reference/file-organization.md`:
  - Line 50: change `stop-update-learning     # Stop hook: triggers background learning` to `session-end-learning     # SessionEnd hook: triggers background learning`
  - Line 157: change `A fourth hook (\`stop-update-learning\`) provides self-learning. Toggleable via...` to `A fourth hook (\`session-end-learning\`) provides self-learning. Toggleable via...`
  - Also update line 146 reference to `Learning Stop hook` to `Learning SessionEnd hook`

### MEDIUM

**CHANGELOG.md missing Wave 2 entries** - `CHANGELOG.md:8-13`
**Confidence**: 85%
- Problem: The `[Unreleased]` section of CHANGELOG.md does not document the significant Wave 2 changes introduced by this PR: SessionEnd batching replaces per-session Stop hook triggering, procedural threshold raised from 2 to 3, temporal spread now required for both types, max daily runs reduced from 10 to 5, artifact naming changed from `learned-*` to `self-learning:*`, and `session-end-learning` replaces `stop-update-learning`. These are user-facing behavioral changes that affect existing users who upgrade.
- Fix: Add entries under `[Unreleased]` in CHANGELOG.md:
  ```markdown
  ### Changed
  - **Learning**: SessionEnd batching — background agent runs every 3 sessions (5 at 15+ observations) instead of every Stop
  - **Learning**: procedural observations now require 3 observations with 24h+ temporal spread (was 2 with no spread)
  - **Learning**: max daily runs default reduced from 10 to 5
  - **Learning**: artifact naming changed from `learned-*` to `self-learning:*` prefix
  - **Learning**: hook moved from Stop (`stop-update-learning`) to SessionEnd (`session-end-learning`)
  ```

**`batch_size` config field undocumented** - `scripts/hooks/session-end-learning:47`
**Confidence**: 82%
- Problem: `session-end-learning` reads a `batch_size` field from `learning.json` (default 3), but this config key is not documented in CLAUDE.md, README.md, or `--configure` CLI wizard. The `LearningConfig` TypeScript interface in `learn.ts` also does not include `batch_size`. Users who want to tune batching behavior have no way to discover this option, and the TypeScript config does not validate or pass it through.
- Fix: Either (a) add `batch_size` to the `LearningConfig` interface and `--configure` wizard, or (b) document that batch size is only configurable via manual `learning.json` editing. At minimum, mention the field in the config section of CLAUDE.md.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CLAUDE.md hooks comment lists `session-end-learning` but file tree does not show it** - `CLAUDE.md:54`
**Confidence**: 85%
- Problem: Line 54 of CLAUDE.md lists hooks as `(stop, session-start, pre-compact, ambient-prompt, session-end-learning, background-learning)` but the actual `scripts/hooks/` directory still contains both `stop-update-learning` (now a deprecated stub) and `session-end-learning` (new). The parenthetical list implies these are all the hook scripts, but `stop-update-learning` still exists as a file and is not listed. While it is deprecated, its presence may confuse developers reading the file tree.
- Fix: Either add `stop-update-learning` to the list with a "(deprecated)" note, or note that the list only includes active hooks.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**docs/reference/file-organization.md hook table missing SessionEnd event type** - `docs/reference/file-organization.md:159-163`
**Confidence**: 88%
- Problem: The hooks table in `file-organization.md` lists Stop, SessionStart, and PreCompact hooks for working memory, but does not include the learning hook row. Now that learning uses SessionEnd instead of Stop, a row for the learning hook in this table would improve discoverability. This was already missing before this PR.
- Fix: Add a row to the hooks table:
  ```markdown
  | `session-end-learning` | SessionEnd | `.memory/learning-log.jsonl` | 3-session batched. Reinforces loaded artifacts, triggers background Sonnet analysis. |
  ```

### LOW

**file-organization.md `hooks/` tree missing newer files** - `docs/reference/file-organization.md:46-53`
**Confidence**: 82%
- Problem: The file tree in `file-organization.md` does not show `session-end-learning`, `log-paths`, `ensure-memory-gitignore`, or `run-hook`. These have been present since earlier PRs. The tree only shows 8 entries while the actual directory contains more.
- Fix: Update the tree listing in a docs cleanup PR.

## Suggestions (Lower Confidence)

- **Upgrade migration instructions missing** - `scripts/hooks/stop-update-learning:3` (Confidence: 72%) -- The deprecated stub says "Run `devflow learn --disable && devflow learn --enable` to upgrade" but this guidance is only visible to someone reading the shell script source. Consider adding a migration note in README.md or CHANGELOG.md for users on the old Stop hook.

- **README.md "Documentation Structure" tree could document new file semantics** - `README.md:239-240` (Confidence: 65%) -- `.learning-session-count` and `.learning-batch-ids` are listed with brief comments but users unfamiliar with batching may not understand the lifecycle (accumulate -> copy -> consume -> delete). A one-line note about the batch flow could help.

- **Shell script inline documentation could reference batch size config key** - `scripts/hooks/session-end-learning:47` (Confidence: 60%) -- The `json_field "batch_size" "3"` call has no inline comment explaining where users can configure this value or what valid ranges are.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The primary documentation concern is that `docs/reference/file-organization.md` was not updated to reflect the hook rename from `stop-update-learning` to `session-end-learning`, creating active code-comment drift. The CHANGELOG is also missing entries for the significant behavioral changes in this PR. The core docs (CLAUDE.md and README.md) were updated well and accurately describe the new batching behavior, naming, and thresholds.
