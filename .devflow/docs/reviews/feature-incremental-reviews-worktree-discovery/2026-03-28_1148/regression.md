# Regression Review Report

**Branch**: feature/incremental-reviews-worktree-discovery -> main
**Date**: 2026-03-28_1148

## Issues in Your Changes (BLOCKING)

### HIGH

**Synthesizer self-exclusion glob pattern stale after filename change** - `shared/agents/synthesizer.md:139`
**Confidence**: 92%
- Problem: The synthesizer's self-exclusion pattern on line 139 reads `exclude your own output review-summary.*.md`, but the output filename was changed from `review-summary.${TIMESTAMP}.md` to `review-summary.md` (line 164). The glob `review-summary.*.md` will NOT match the new `review-summary.md` because `*` requires at least one character in glob patterns. This means the synthesizer will read its own previously-written `review-summary.md` as input when re-running, potentially corrupting the aggregation.
- Impact: On incremental reviews where a previous `review-summary.md` already exists in the timestamped directory, the synthesizer could re-ingest its own output as a reviewer report. This is a regression of PF-001 (Synthesizer glob matched zero files) — the pattern was fixed before, and this change reintroduces a mismatch.
- Fix: Update line 139 to exclude the exact new filename:
  ```markdown
  1. Read all review reports from `${REVIEW_BASE_DIR}/*.md` (exclude `review-summary.md` and `resolution-summary.md`)
  ```
  This matches the exclusion pattern already used in `shared/agents/git.md:186` (comment-pr operation).

**Inconsistent DIFF_COMMAND between teams and non-teams variants — missing `-C` in non-teams** - `plugins/devflow-code-review/commands/code-review.md:120`
**Confidence**: 88%
- Problem: The non-teams code-review command passes `DIFF_COMMAND: git diff {DIFF_RANGE}` to reviewer agents (line 120), but does NOT include `git -C {worktree_path}` for multi-worktree scenarios. The teams variant correctly uses `git {-C worktree_path} diff {DIFF_RANGE}` (code-review-teams.md lines 125, 140, 155, 174). Since the reviewer agent's own "Worktree Support" section says to prefix git commands with `-C {WORKTREE_PATH}`, the reviewer may apply its own `-C` prefix on top. However, the explicit `DIFF_COMMAND` is presented as a ready-to-use command, creating ambiguity about whether the reviewer should apply `-C` again or use it as-is.
- Impact: In multi-worktree mode with the non-teams variant, reviewers may run `git diff {DIFF_RANGE}` in the wrong directory (cwd instead of the worktree), producing incorrect diffs. Alternatively, they may double-apply `-C` if they prefix the already-provided command, though this would be harmless since `-C` is idempotent.
- Fix: Align the non-teams variant with the teams variant. In `code-review.md:120`, change the DIFF_COMMAND to include the worktree path:
  ```
  DIFF_COMMAND: git {-C worktree_path} diff {DIFF_RANGE}  (use this instead of default base_branch...HEAD)
  ```
  Or, since WORKTREE_PATH is already provided separately, add a note:
  ```
  DIFF_COMMAND: git diff {DIFF_RANGE}  (prefix with -C {WORKTREE_PATH} if provided)
  ```

### MEDIUM

**Ambiguous `git {-C worktree_path}` template syntax in teams variant** - `plugins/devflow-code-review/commands/code-review-teams.md:125` (4 occurrences)
**Confidence**: 82%
- Locations: `code-review-teams.md:125`, `code-review-teams.md:140`, `code-review-teams.md:155`, `code-review-teams.md:174`
- Problem: The template `git {-C worktree_path} diff {DIFF_RANGE}` is ambiguous — the curly braces wrap the entire `-C worktree_path` token, making it unclear whether the `-C` flag itself is conditional or only the path value. The instruction says "WORKTREE_PATH: {worktree_path} (omit if cwd)" which implies the entire `-C worktree_path` is optional, but the syntax is inconsistent with how other template variables are presented (e.g., `{DIFF_RANGE}` wraps just the value, not the flag).
- Impact: An LLM agent might incorrectly render this as a literal string including the braces, or omit just the path but keep the `-C` flag (causing a git error). Low probability but non-zero for new agent implementations.
- Fix: Use clearer conditional syntax:
  ```
  4. Get the diff: `git [-C {worktree_path}] diff {DIFF_RANGE}` (omit -C if no WORKTREE_PATH)
  ```
  Or document inline: `git -C {worktree_path} diff {DIFF_RANGE}` (omit `-C {worktree_path}` when WORKTREE_PATH not provided).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Synthesizer `resolution-summary.md` not excluded from report ingestion** - `shared/agents/synthesizer.md:139`
**Confidence**: 85%
- Problem: The synthesizer reads `${REVIEW_BASE_DIR}/*.md` and only excludes `review-summary.*.md`. With the new timestamped directory layout, `resolution-summary.md` (written by `/resolve`) now lives in the same directory. If a user runs `/resolve` then re-runs `/code-review` targeting the same timestamp directory, the synthesizer would ingest the resolution summary as a review report.
- Impact: The resolution summary has different structure than review reports, potentially corrupting the synthesizer's aggregation. This is an edge case (most workflows create a new timestamp directory for a new review), but the defensive exclusion is cheap.
- Fix: Update synthesizer.md line 139:
  ```markdown
  1. Read all review reports from `${REVIEW_BASE_DIR}/*.md` (exclude `review-summary.md` and `resolution-summary.md`)
  ```

**Phase numbering gap in non-teams variant** - `plugins/devflow-code-review/commands/code-review.md`
**Confidence**: 80%
- Problem: The non-teams variant goes from Phase 3 (Synthesis) to Phase 4 (Write Review Head Marker & Report) to Phase 5 (Record Pitfalls). The old sequence was Phase 0-1-2-3-4-5. The new sequence is Phase 0-1-2-3-4-5, which is correct. However, the teams variant has Phases 0-1-2-3-4-5-6-7 (adding separate Phase 5 for "Write Review Head Marker" and bumping later phases). The non-teams variant combines "Write Head Marker" into Phase 4. This is intentional asymmetry but could confuse contributors comparing the two command variants — the teams variant has 8 phases, non-teams has 6.
- Impact: Documentation inconsistency between the two variants. Not a runtime regression, but increases maintenance burden. Low severity.

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing issues identified.

## Suggestions (Lower Confidence)

- **Resolve `--review` flag interaction with multi-worktree** - `plugins/devflow-resolve/commands/resolve.md:65`, `plugins/devflow-resolve/commands/resolve-teams.md:65` (Confidence: 72%) — Both resolve commands state `--review {timestamp}` is "not supported in multi-worktree mode", but neither specifies what happens if a user provides both `--review` and no `--path` while multiple worktrees exist. Should it error, warn, or silently ignore `--review`? Clarifying the error behavior would prevent confusion.

- **No guard against `.last-review-head` write race in multi-worktree** - `plugins/devflow-code-review/commands/code-review.md` (Confidence: 65%) — In multi-worktree mode, Phase 4 writes `.last-review-head` per worktree. Since each worktree has its own `.docs/` directory, there is no actual write race. However, if two reviews of the same branch happen simultaneously (different timestamps), the last writer wins. The commands do not address this edge case.

- **Ambient preamble line length after MULTI_WORKTREE addition** - `scripts/hooks/ambient-prompt:40` (Confidence: 62%) — The preamble injected into every prompt now has an additional `MULTI_WORKTREE:` line. Since the preamble is designed to be minimal (token-efficient), adding an entire line for a niche feature increases token cost for every ambient prompt. Consider whether this should be in the preamble or loaded conditionally.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The most significant regression risk is the synthesizer self-exclusion glob mismatch (HIGH), which is a re-emergence of PF-001. The PF-001 pitfall documented a glob pattern mismatch that caused the synthesizer to produce empty summaries; this change introduces a related mismatch where the exclusion pattern `review-summary.*.md` no longer matches the new output filename `review-summary.md`, meaning the synthesizer could re-ingest its own output. The DIFF_COMMAND inconsistency between teams and non-teams variants (HIGH) could produce incorrect diffs in multi-worktree mode. Both should be fixed before merge.
