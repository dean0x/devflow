# Documentation Review Report

**Branch**: feature/incremental-reviews-worktree-discovery -> main
**Date**: 2026-03-28_1148

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Inconsistent git -C syntax in reviewer prompt templates** - `plugins/devflow-code-review/commands/code-review-teams.md:137`, `plugins/devflow-code-review/commands/code-review.md:115`
**Confidence**: 90%
- Problem: The reviewer spawn prompts use `git {-C worktree_path} diff {DIFF_RANGE}` with curly braces around the `-C worktree_path` flag. This mixes placeholder syntax (`{DIFF_RANGE}` for variable substitution) with what appears to be a conditional flag (`{-C worktree_path}`). The intent is that `-C worktree_path` should be omitted when not in a worktree, but the syntax `{-C worktree_path}` is ambiguous — it could be read as a literal brace-wrapped flag or as a placeholder variable named `-C worktree_path`.
- Fix: Use explicit conditional notation consistent with the rest of the document. The other agent prompts already use `WORKTREE_PATH: {worktree_path}  (omit if cwd)` as a separate line. The diff command should similarly document this as:
  ```
  4. Get the diff: `git diff {DIFF_RANGE}` (prefix with `-C {worktree_path}` if WORKTREE_PATH provided)
  ```
  Or adopt the pattern used in the Git agent's Worktree Support section: "Prefix git commands: `git -C {WORKTREE_PATH} ...`" and keep the diff command clean:
  ```
  4. Get the diff using DIFF_RANGE (apply worktree prefix per Worktree Support instructions above)
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Redundant backwards compatibility entries in resolve.md** - `plugins/devflow-resolve/commands/resolve.md:243-244`
**Confidence**: 82%
- Problem: The Backwards Compatibility section in `resolve.md` (non-teams variant) has two bullet points that say essentially the same thing:
  ```
  - **Legacy flat layout**: If `.docs/reviews/{branch-slug}/` contains flat `*.md` files (no timestamped subdirectories), reads from flat directory (existing behavior).
  - **No timestamped directories**: Falls back to reading flat `*.md` files from branch-slug directory.
  ```
  These describe identical behavior. The teams variant (`resolve-teams.md`) has only one bullet for this, keeping it concise.
- Fix: Consolidate into a single entry:
  ```markdown
  - **Legacy flat layout**: If `.docs/reviews/{branch-slug}/` contains flat `*.md` files (no timestamped subdirectories), reads them directly (existing behavior).
  ```

**Phase numbering mismatch between code-review.md and code-review-teams.md** - `plugins/devflow-code-review/commands/code-review.md` vs `plugins/devflow-code-review/commands/code-review-teams.md`
**Confidence**: 85%
- Problem: The non-teams variant (`code-review.md`) has 6 phases (0-5), ending with Phase 5: Record Pitfalls. The teams variant (`code-review-teams.md`) has 8 phases (0-7), with Phase 5 being "Write Review Head Marker" and Phase 6 being "Record Pitfalls". In the non-teams variant, the `.last-review-head` write is bundled into Phase 4 ("Write Review Head Marker & Report"), while in the teams variant it gets its own Phase 5. This structural divergence between the two variants makes it harder to cross-reference and maintain them in sync.
- Fix: This is a design choice, not a bug. The teams variant has more phases due to the debate round. The documentation accurately reflects each variant's flow. However, consider adding a brief note in one or both files that references the other variant's phase mapping, e.g., "(See code-review-teams.md for the Agent Teams variant with debate phases)".

**Missing `WORKTREE_PATH` documentation for `setup-task` and `fetch-issue` operations** - `shared/agents/git.md:30-36`
**Confidence**: 80%
- Problem: The operations table shows `WORKTREE_PATH` as optional for `ensure-pr-ready`, `validate-branch`, `comment-pr`, and `manage-debt`, but not for `setup-task`, `fetch-issue`, or `create-release`. While `setup-task` and `fetch-issue` may not need worktree support (they operate on the current repo), the omission is not explicitly documented. Given that the Worktree Support section at the top says "If `WORKTREE_PATH` is provided" generically, readers may wonder whether it applies to all operations.
- Fix: Add a brief note in the operations table or the Worktree Support section clarifying which operations support `WORKTREE_PATH`:
  ```markdown
  **Note**: Only review/resolve operations support WORKTREE_PATH. Task setup and release operations always use cwd.
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`code-review-teams.md` Edge Cases table has an entry not in `code-review.md`** - `plugins/devflow-code-review/commands/code-review-teams.md:309` vs `plugins/devflow-code-review/commands/code-review.md`
**Confidence**: 82%
- Problem: The teams variant includes "Many worktrees (5+) | Report count and proceed" in the Edge Cases table, but the non-teams variant does not. Since both commands handle worktree discovery identically, this edge case applies to both.
- Fix: Add the "Many worktrees (5+)" row to the non-teams variant's Edge Cases table for consistency.

### LOW

**Worktree Support section is identical boilerplate across 8 agents** - `shared/agents/coder.md`, `git.md`, `resolver.md`, `reviewer.md`, `scrutinizer.md`, `shepherd.md`, `simplifier.md`, `synthesizer.md`, `validator.md`
**Confidence**: 85%
- Problem: The "Worktree Support (Optional)" section is copy-pasted nearly identically across all 8 agent files, with only minor variations (some include `.docs/` path resolution, others do not). This is a documentation maintenance burden per the project's convention against duplication (PF-005 already flags interface duplication in CLI code).
- Fix: This is informational only. The duplication is intentional — each agent is a standalone markdown file loaded independently. A shared skill or include mechanism would reduce duplication but is not available in the current architecture.

## Suggestions (Lower Confidence)

- **No documentation for `--full` flag interaction with `--review`** - `plugins/devflow-resolve/commands/resolve.md` (Confidence: 65%) -- If a user passes both `--full` (on code-review) and `--review {timestamp}` (on resolve), the interaction is not documented. These are on separate commands so likely not an issue, but could confuse users who mentally link them.

- **Ambient prompt preamble line is very long** - `scripts/hooks/ambient-prompt:40` (Confidence: 62%) -- The newly added `MULTI_WORKTREE:` line extends the preamble further. The preamble is already quite dense. Consider whether this single long injection could be split for readability, though the single-line format may be intentional for token efficiency.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 3 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Documentation Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The documentation changes are thorough and well-executed. The PR adds significant new feature documentation (incremental reviews, worktree discovery, timestamped directories) consistently across 23 files: CLAUDE.md, 4 command files, 8 agent files, 4 skill files, and their references. Directory structures, naming conventions, edge case tables, backwards compatibility sections, and architecture diagrams are all updated in lockstep. The one blocking issue (ambiguous `{-C worktree_path}` syntax in reviewer prompts) is a clarity fix that prevents agent misinterpretation. The should-fix items are minor consistency improvements.
