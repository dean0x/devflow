# Consistency Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-31

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing `devflow-git-workflow` in LEGACY_SKILL_NAMES** - `src/cli/plugins.ts:209-318`
**Confidence**: 95%
- Problem: The `LEGACY_SKILL_NAMES` array includes `devflow-git-safety` (line 213) and `devflow-github-patterns` (line 214) for cleanup of old prefixed installs, but `devflow-git-workflow` is missing. All three old git skills (`git-safety`, `git-workflow`, `github-patterns`) were consolidated into `git` in this PR. The bare names `git-safety`, `git-workflow`, and `github-patterns` are present (lines 251-253), but the `devflow-` prefixed version of `git-workflow` was never added. Users with a `devflow-git-workflow` install directory from the old era will not get it cleaned up on reinstall.
- Fix: Add `'devflow-git-workflow'` to the legacy list, near line 214:
  ```typescript
  'devflow-git-safety',
  'devflow-git-workflow',
  'devflow-github-patterns',
  ```

**Missing `devflow:` prefixed old names for git consolidation in LEGACY_SKILL_NAMES** - `src/cli/plugins.ts:288-317`
**Confidence**: 92%
- Problem: The PR added `devflow:` prefixed old names for the 6 pattern-suffix removals (lines 312-317: `devflow:complexity-patterns`, `devflow:consistency-patterns`, etc.), following the same pattern used for the first batch (lines 289-295: `devflow:security-patterns`, etc.). However, the 3 git consolidation old names are missing their `devflow:` prefixed entries. Users who installed between the namespace migration and this PR would have `~/.claude/skills/devflow:git-safety/`, `devflow:git-workflow/`, and `devflow:github-patterns/` directories that will not be cleaned up.
- Fix: Add these entries alongside the other `devflow:` prefixed old names:
  ```typescript
  // v2.0.0 skill renames: prefixed old names for the 3 git consolidation removals
  'devflow:git-safety',
  'devflow:git-workflow',
  'devflow:github-patterns',
  ```

### MEDIUM

**Skill count "31" in file-organization.md not updated** - `docs/reference/file-organization.md:12`
**Confidence**: 85%
- Problem: The comment says "SINGLE SOURCE OF TRUTH (31 skills)" but the PR consolidated 3 git skills into 1 (net -2), making the count 29 even by the old metric. The actual on-disk count is 37 skill directories. While the base count was already stale (pre-existing), this PR modified line 13 of the file to update `git-workflow/` to `git/` without correcting the count on the adjacent line 12. When you touch a line, you should fix the immediately adjacent stale data.
- Fix: Update the count to match reality:
  ```
  │   ├── skills/                       # SINGLE SOURCE OF TRUTH (37 skills)
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none found at CRITICAL severity)

## Suggestions (Lower Confidence)

- **`migrateShadowOverrides` race condition with 3-to-1 git rename** - `src/cli/commands/init.ts:68-95` (Confidence: 65%) -- When all three old git shadows exist (`git-safety/`, `git-workflow/`, `github-patterns/`), the `Promise.all` runs all renames concurrently. The first to succeed creates `git/`; the other two will find `git/` already exists and produce warnings. This is technically correct behavior (warn, don't overwrite), but could confuse users who see 2 warnings when only 1 shadow was actually used. A deterministic priority order (serial for same-target groups) would be cleaner, but the current approach is safe.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The rename operation is extremely thorough -- all references across 71 files were updated consistently for the 6 pattern-suffix removals and the 3-to-1 git consolidation. The `tests` to `testing` focus name normalization is correctly applied across reviewer.md, code-review commands, review-orchestration, and code-review-teams. The new test for frontmatter name vs directory name alignment is a strong guardrail. The two HIGH issues are narrow gaps in the legacy cleanup list that would leave orphaned directories on upgrade for users with specific install histories.
