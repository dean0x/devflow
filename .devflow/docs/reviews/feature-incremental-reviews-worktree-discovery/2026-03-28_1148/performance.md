# Performance Review Report

**Branch**: feature/incremental-reviews-worktree-discovery -> main
**Date**: 2026-03-28_1148

## Issues in Your Changes (BLOCKING)

### HIGH

**Unbounded PR comment fetch per inline comment creates O(n*m) API overhead** - `shared/agents/git.md:190`
**Confidence**: 85%
- Problem: The new `comment-pr` process (step 6) instructs the Git agent to "fetch existing PR review comments via `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments`" to check for duplicates. However, the instruction does not specify caching this result. As written, the agent will likely fetch the full comment list before each new comment creation, resulting in O(n) API calls for deduplication where a single prefetch would suffice. Combined with the 1-second rate-limit delay per comment (step 8), a review creating 20 inline comments would add 20+ extra API round-trips (one fetch per comment) on top of the 20 creation calls.
- Fix: Restructure the process to fetch existing comments once before the creation loop:

```markdown
**Process:**
1. Get PR context (head SHA, changed files, diff)
2. Read review reports from `${REVIEW_BASE_DIR}/*.md` (exclude `review-summary.md` and `resolution-summary.md`)
3. Extract issues - only comment on blocking (CRITICAL/HIGH) and should-fix (HIGH/MEDIUM)
4. Skip pre-existing issues (these go to tech debt)
5. Deduplicate issues by file:line
6. **Fetch existing comments once**: Fetch all PR review comments via `gh api repos/{owner}/{repo}/pulls/{pr_number}/comments`. Build a lookup set of `{file}:{line}` pairs from existing comments.
7. For each new comment, skip if its `{file}:{line}` already exists in the lookup set — avoids duplicate comments across incremental reviews.
8. Create inline comments for lines in diff; consolidate others into summary comment
9. Include 1-second delay between API calls for rate limiting
```

### MEDIUM

**Sequential worktree processing for Agent Teams negates multi-worktree parallelism** - `plugins/devflow-code-review/commands/code-review-teams.md:90` (Phase 2 Note)
**Confidence**: 82%
- Problem: The teams variant states "In multi-worktree mode, process worktrees sequentially for Agent Teams (one team per session constraint)." This is an inherent platform limitation, but the document does not surface the wall-clock cost. With 5+ worktrees (explicitly called out in the edge case table), each requiring team creation, debate rounds, synthesis, and cleanup, the total review time scales linearly as `N * (single_worktree_review_time)`. For a 10-minute single-worktree review, 5 worktrees would take ~50 minutes.
- Fix: Add an explicit note warning users about the time scaling, and consider recommending `--path` for targeted reviews when many worktrees exist:

```markdown
**Note**: In multi-worktree mode, process worktrees sequentially for Agent Teams (one team per session constraint). Each worktree gets its own team lifecycle: create -> debate -> synthesize -> cleanup. **Performance warning**: With N worktrees, total review time scales as N * single-worktree time. For 5+ worktrees, consider using `--path` to target specific worktrees.
```

**Per-worktree `git status` call during discovery adds latency** - `plugins/devflow-code-review/commands/code-review.md:27` (Step 0a, item 3)
**Confidence**: 80%
- Problem: Step 0a item 3 filters worktrees by checking "Must NOT be mid-rebase or mid-merge (check `git -C {path} status` for 'rebase in progress' / 'merging')". `git status` is one of the slower git commands since it scans the working tree. With many worktrees (5+), running `git status` serially for each adds noticeable latency to the discovery phase. A lighter-weight check exists: testing for the presence of `.git/rebase-merge/` or `.git/MERGE_HEAD` files.
- Fix: Replace the `git status` check with filesystem checks that are orders of magnitude faster:

```markdown
- Must NOT be mid-rebase or mid-merge (check for `.git/rebase-merge/` or `.git/rebase-apply/` directories for rebase; check for `.git/MERGE_HEAD` file for merge — faster than `git status`)
```

## Issues in Code You Touched (Should Fix)

_No should-fix issues identified._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-006 (from pitfalls.md): Per-line jq spawning in session-start hooks** - `scripts/hooks/session-start-memory`
**Confidence**: 90% (documented known pitfall)
- Problem: While-read loops spawn 3-6 jq subprocesses per JSONL line, adding 1-3s latency on session startup. This is a documented pitfall (PF-006) and was not introduced by this PR, but is worth noting since the ambient-prompt hook (modified in this PR) runs in the same session lifecycle.
- Fix: Already documented in PF-006 — replace while-read loops with single-pass `jq -s` operations.

## Suggestions (Lower Confidence)

- **Worktree discovery could run `git worktree list` parsing and filtering in parallel** - `plugins/devflow-code-review/commands/code-review.md:24-33` (Confidence: 70%) — The 7-step discovery process is described sequentially. For repos with many worktrees, Steps 3-7 (filter, deduplicate) could be parallelized with the pre-flight spawning, but this depends on how the orchestrator interprets the instructions.

- **Incremental SHA validation adds a `git cat-file` call per worktree** - `plugins/devflow-code-review/commands/code-review.md:62` (Confidence: 65%) — Each worktree runs `git cat-file -t {sha}` to validate the last-review SHA. This is a fast git plumbing command (microseconds), so the concern is minimal, but worth noting it exists as an extra subprocess per worktree.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Performance Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The primary performance concern is the unbounded API call pattern in `comment-pr` (HIGH), where fetching existing PR comments before each new comment creation could be restructured to a single prefetch. The worktree discovery `git status` calls (MEDIUM) have a straightforward fix using filesystem checks. The sequential Agent Teams constraint is a platform limitation with no immediate fix, but should be documented with a performance warning. Overall, the incremental review design itself is a significant performance improvement — reviewing only new commits rather than the full branch diff reduces both diff size and agent processing time substantially.
