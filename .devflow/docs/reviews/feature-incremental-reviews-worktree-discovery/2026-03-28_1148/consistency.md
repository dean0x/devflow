# Consistency Review Report

**Branch**: feature/incremental-reviews-worktree-discovery -> main
**Date**: 2026-03-28_1148

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent git command syntax in reviewer prompt templates** - `plugins/devflow-code-review/commands/code-review-teams.md:125,140,155,174`
**Confidence**: 92%
- Problem: The reviewer prompt templates in `code-review-teams.md` use `git {-C worktree_path} diff {DIFF_RANGE}` which is syntactically different from the pattern established in every agent's Worktree Support section: `git -C {WORKTREE_PATH} ...`. The curly-brace-wrapping-the-flag pattern `{-C worktree_path}` suggests the entire flag is optional/templated, but this is inconsistent with how every other file in this PR (and the agents) express the same concept. The base variant `code-review.md` uses a different approach: `DIFF_COMMAND: git diff {DIFF_RANGE}` passed as a parameter, avoiding the issue entirely.
- Fix: Align the teams variant with the base variant's approach. Instead of inlining the worktree-aware git command in each reviewer prompt, pass `DIFF_COMMAND` as a parameter (matching `code-review.md`'s pattern at line 116):
  ```markdown
  4. Get the diff: `git -C {worktree_path} diff {DIFF_RANGE}`
  ```
  Or better, match the base file's approach and use a `DIFF_COMMAND` parameter.

**Missing "Backwards Compatibility" section in `resolve-teams.md`** - `plugins/devflow-resolve/commands/resolve-teams.md`
**Confidence**: 90%
- Problem: The base variant `resolve.md` has a `## Backwards Compatibility` section (lines 249-253), but `resolve-teams.md` does not have one at all. All four command files in this PR (both code-review variants and both resolve variants) should have this section since they all introduce the same backwards-incompatible directory layout change. The two `code-review` variants both have it; only `resolve-teams.md` is missing.
- Fix: Add a `## Backwards Compatibility` section to `resolve-teams.md` after the Edge Cases table, matching the content from `resolve.md`:
  ```markdown
  ## Backwards Compatibility

  - **Single worktree**: Auto-discovery finds only one worktree -> proceeds exactly as before. Zero behavior change.
  - **Legacy flat layout**: If `.docs/reviews/{branch-slug}/` contains flat `*.md` files (no timestamped subdirectories), reads from flat directory (existing behavior).
  ```

### MEDIUM

**Inconsistent edge case tables between base and teams variants (3 divergences)** - `plugins/devflow-code-review/commands/code-review.md:207-221`, `plugins/devflow-code-review/commands/code-review-teams.md:330-344`
**Confidence**: 88%
- Problem: The edge case tables between the base and teams variants of `code-review` have three unnecessary differences:
  1. `code-review.md` has `Many worktrees (5+)` edge case (line 220); `code-review-teams.md` does not.
  2. `code-review-teams.md` has `Multi-worktree with Agent Teams` edge case (line 343); `code-review.md` does not (expected, since base doesn't use teams).
  3. `Duplicate PR comments` handling text differs: base says "before creating" at the end, teams does not.
  Items 1 and 3 are inconsistencies that should be aligned. Item 2 is intentionally teams-only and is fine.
- Fix: Add the `Many worktrees (5+)` edge case to `code-review-teams.md`. Align the `Duplicate PR comments` text to consistently include "before creating" (the more descriptive version).

**Inconsistent wording: "Prefix git commands" vs "Prefix all git commands"** - `shared/agents/git.md:21`
**Confidence**: 85%
- Problem: The git agent's Worktree Support section says "Prefix **all** git commands" while all other 8 agents say "Prefix git commands" (without "all"). This is a minor wording divergence introduced in this PR across 9 agent files.
- Fix: Either use "Prefix all git commands" consistently across all agents (more explicit), or remove "all" from `git.md` to match the other 8 agents. The former is better since the intent is universal prefixing.

**Inconsistent table column header between base and teams variants** - `plugins/devflow-code-review/commands/code-review-teams.md:72`, `plugins/devflow-code-review/commands/code-review.md:72`
**Confidence**: 85%
- Problem: The Phase 1 file-type detection table uses different column headers. The teams variant says `Adds Perspective` while the base variant says `Adds Review`. These tables describe the same thing -- which conditional reviewers get added based on file types in the diff.
- Fix: Align to a single term. "Adds Review" is more accurate since the conditional additions are the same regardless of teams mode. Change `code-review-teams.md` line 72 to `Adds Review`.

**Redundant backwards compatibility bullets in `resolve.md`** - `plugins/devflow-resolve/commands/resolve.md:252-253`
**Confidence**: 82%
- Problem: The `## Backwards Compatibility` section has two bullets that say the same thing:
  - "Legacy flat layout": Falls back to reading flat `*.md` files from branch-slug directory
  - "No timestamped directories": Falls back to reading flat `*.md` files from branch-slug directory
  The code-review variants have only two bullets (single worktree + legacy layout). The third bullet in resolve.md is redundant.
- Fix: Remove the third bullet ("No timestamped directories") as it duplicates the "Legacy flat layout" bullet.

**Inconsistent legacy flat layout descriptions across commands** - `plugins/devflow-code-review/commands/code-review-teams.md:349`, `plugins/devflow-code-review/commands/code-review.md:226`
**Confidence**: 82%
- Problem: The "Legacy flat layout" backwards compatibility description varies across the four command files:
  - `code-review.md`: "If `.docs/reviews/...` contains flat `*.md` files (no timestamped subdirectories), new runs create timestamped subdirectories. Old flat files remain untouched."
  - `code-review-teams.md`: "New runs create timestamped subdirectories. Old flat files remain untouched." (abbreviated, missing the conditional clause)
  - `resolve.md`: "If `.docs/reviews/...` contains flat `*.md` files (no timestamped subdirectories), reads from flat directory (existing behavior)."
  - `resolve-teams.md`: missing entirely (covered above)
  The code-review variants and resolve variants describe different behavior (code-review creates new dirs alongside old files; resolve reads old files), which is likely correct behavior-wise. But the teams variants are less detailed than the base variants.
- Fix: Ensure teams variants have the same level of detail as their base counterparts. `code-review-teams.md` should include the conditional clause from `code-review.md`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Skimmer agent missing Worktree Support section** - `shared/agents/skimmer.md`
**Confidence**: 80%
- Problem: All 9 other shared agents (`coder.md`, `git.md`, `resolver.md`, `reviewer.md`, `scrutinizer.md`, `shepherd.md`, `simplifier.md`, `synthesizer.md`, `validator.md`) received a `## Worktree Support (Optional)` section in this PR. The `skimmer.md` agent did not. The Skimmer is used by `plan-orchestration`, which DID receive a `## Worktree Support` passthrough section. If `plan-orchestration` passes `WORKTREE_PATH` through to spawned agents but Skimmer doesn't document how to handle it, the chain is incomplete.
- Fix: Add the standard Worktree Support section to `shared/agents/skimmer.md`:
  ```markdown
  ## Worktree Support (Optional)

  If `WORKTREE_PATH` is provided:
  - Prefix git commands: `git -C {WORKTREE_PATH} ...`
  - Resolve source files: `{WORKTREE_PATH}/{file}`
  - If omitted, use cwd (default behavior unchanged).
  ```

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **Worktree Support bullet list variance across agents** - multiple agents (Confidence: 70%) -- Some agents include 3 bullets (git prefix, source files, default fallback) while others include 4 (adding `.docs/` path resolution). The agents with `.docs/` awareness (coder, git, reviewer, resolver, synthesizer) vs without (scrutinizer, shepherd, simplifier, validator) may be intentional based on which agents interact with `.docs/`, but the rationale is not documented.

- **Phase numbering divergence between base and teams code-review** - `code-review.md` vs `code-review-teams.md` (Confidence: 65%) -- The base `code-review.md` has 6 phases (0-5) while the teams variant has 8 phases (0-7). The teams variant splits out "Write Review Head Marker" as Phase 5 and "Record Pitfalls" as Phase 6, while the base variant combines "Write Review Head Marker" into Phase 4 and keeps "Record Pitfalls" as Phase 5. This makes cross-referencing between variants harder. Phase semantics are different, which could confuse agents or documentation that references phase numbers.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 4 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces a well-structured, comprehensive feature across 23 files. The worktree support sections across 9 agents are remarkably consistent, and the new patterns (timestamped directories, incremental reviews, `.last-review-head` markers) are applied uniformly. The main consistency gaps are between the base and teams variants of the same commands -- edge case tables, backwards compatibility sections, and wording details that drifted during parallel editing. These should be aligned before merge to prevent future confusion about canonical behavior.
