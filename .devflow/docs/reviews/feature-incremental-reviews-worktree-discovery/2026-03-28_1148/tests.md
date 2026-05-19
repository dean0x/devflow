# Tests Review Report

**Branch**: feature/incremental-reviews-worktree-discovery -> main
**Date**: 2026-03-28_1148

## Issues in Your Changes (BLOCKING)

### HIGH

**No tests for new ambient-prompt MULTI_WORKTREE preamble line** - `scripts/hooks/ambient-prompt:42`
**Confidence**: 88%
- Problem: A new `MULTI_WORKTREE:` classification line was added to the ambient-prompt preamble. The existing preamble drift detection test (`tests/ambient.test.ts:250-298`) validates structural elements of the preamble (e.g., it checks for `IMPLEMENT`, `DEBUG`, `REVIEW`, `RESOLVE`, `PIPELINE`, `PLAN`) but does not verify the new `MULTI_WORKTREE` keyword. If someone later removes or corrupts the MULTI_WORKTREE line, no test will catch it. The drift detection test was specifically designed (per the `SYNC:` comment at line 38) to catch exactly this kind of regression.
- Fix: Add an assertion to the existing `preamble drift detection` test:
```typescript
// In tests/ambient.test.ts, inside 'ambient-prompt PREAMBLE contains required classification elements'
// After the line: expect(shellPreamble).toContain('PLAN');
expect(shellPreamble).toContain('MULTI_WORKTREE');
```

### MEDIUM

**No test coverage for docs-framework `get_review_path()` behavior change** - `shared/skills/docs-framework/references/patterns.md:203-213`
**Confidence**: 82%
- Problem: The `get_review_path()` shell helper function changed its contract: it previously returned a flat path like `.docs/reviews/$branch_slug/${type}-report.${timestamp}.md` and now creates a timestamped subdirectory (`ensure_docs_dir "reviews/$branch_slug/$timestamp"`) and returns a nested path `reviews/$branch_slug/$timestamp/${focus}.md`. The parameter was also renamed from `type` to `focus`. This is a behavioral contract change in a helper function, but there are no existing tests for `get_review_path()` (none found in `tests/`), and none were added in this PR. Any consumer of the old contract (flat path) would silently break.
- Fix: The `docs-helpers.sh` functions are sourced by agents at runtime; unit-testing shell helpers is lower priority than the structural tests below. However, if any TypeScript code or build script calls `get_review_path`, a test should be added. At minimum, consider adding a shell function test in `tests/shell-hooks.test.ts` that verifies the new path format:
```typescript
it('get_review_path returns timestamped nested path', () => {
  // source docs-helpers.sh and verify output format matches {focus}.md in timestamped dir
});
```

**No tests for new `--full`, `--path`, `--review` CLI flags in code-review/resolve commands** - `plugins/devflow-code-review/commands/code-review.md`, `plugins/devflow-resolve/commands/resolve.md`
**Confidence**: 80%
- Problem: Three new CLI flags were introduced (`--full`, `--path`, `--review`) across the code-review and resolve commands. These are markdown-based command specs (not TypeScript CLI code), so they cannot be unit-tested in the traditional sense. However, the project has structural validation tests (`tests/build.test.ts`) that verify plugin manifests and skill references. No equivalent structural test validates that command files contain well-formed usage blocks or that new flags are documented consistently across both the base and `-teams` variants.
- Fix: This is a lower-priority observation. The flags are documented in the markdown command files and do not have a runtime parser to test. The real risk is drift between the base (`code-review.md`) and teams (`code-review-teams.md`) variants, which is covered in the "Should Fix" section below.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Ambient preamble drift test does not verify REVIEW depth classification line** - `tests/ambient.test.ts:260-298`
**Confidence**: 85%
- Problem: The preamble drift detection test checks for keyword presence (`QUICK`, `GUIDED`, `ORCHESTRATED`, skill names) but does not validate the new `REVIEW depth:` classification line or the `RESOLVE:` and `PIPELINE:` classification lines that were added in previous PRs. The test was designed to prevent drift but only covers a subset of the preamble's structural elements. The PR added `MULTI_WORKTREE` as a new classification alongside existing ones that are also not individually checked.
- Fix: Extend the drift detection test to cover all classification lines:
```typescript
// Verify classification-specific lines
expect(shellPreamble).toContain('MULTI_WORKTREE');
expect(shellPreamble).toContain('REVIEW depth:');
expect(shellPreamble).toContain('RESOLVE: always ORCHESTRATED');
expect(shellPreamble).toContain('PIPELINE');
```

**Consistency gap between code-review.md and code-review-teams.md edge case tables** - `plugins/devflow-code-review/commands/code-review.md`, `plugins/devflow-code-review/commands/code-review-teams.md`
**Confidence**: 82%
- Problem: The base variant (`code-review.md`) has an edge case table with 11 entries including "Many worktrees (5+)" while the teams variant (`code-review-teams.md`) has 10 entries (same entry present as "Multi-worktree with Agent Teams" but missing "Many worktrees (5+)"). While both variants were updated, subtle content differences in edge case documentation could cause behavioral divergence.
- Fix: Add a structural test that validates both command variants contain the same set of edge case keys, or manually synchronize the tables. The teams variant already includes "Multi-worktree with Agent Teams" which partially covers this, but the "Many worktrees (5+)" entry is absent from the teams variant.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**No integration or behavioral tests for the code-review or resolve command flows** - `plugins/devflow-code-review/commands/`, `plugins/devflow-resolve/commands/`
**Confidence**: 85%
- Problem: The code-review and resolve commands are orchestration-only markdown specs that spawn agents. There are no tests that validate the structural integrity of these command files (e.g., that they reference valid agent types, that phase numbering is sequential, that all template variables like `{branch_slug}` and `{DIFF_RANGE}` are defined before use). This PR significantly restructured both commands (adding worktree discovery, incremental reviews, new phases), but the lack of any structural validation means regressions would only be caught during actual command execution.
- Fix: Consider adding a structural test in `tests/build.test.ts` that:
  1. Reads each command `.md` file
  2. Validates that all referenced `subagent_type` values match known agent names
  3. Checks that phase numbers are sequential
  4. Verifies that base and teams variants have matching phase counts

**Shell helper `get_review_path()` lacks automated tests** - `shared/skills/docs-framework/references/patterns.md:203-213`
**Confidence**: 80%
- Problem: The `docs-helpers.sh` script defines helper functions (`get_review_path`, `get_status_path`, etc.) that are referenced in skill documentation but have no automated tests. The `tests/shell-hooks.test.ts` file tests hook scripts with `bash -n` syntax checks and function-level unit tests, but does not cover `docs-helpers.sh`.
- Fix: Add `docs-helpers.sh` function tests to `tests/shell-hooks.test.ts` or a new `tests/docs-helpers.test.ts` file.

## Suggestions (Lower Confidence)

- **Worktree filtering logic is untested** - `plugins/devflow-code-review/commands/code-review.md:Step 0a` (Confidence: 70%) -- The worktree discovery logic (filter by named branch, exclude protected branches, skip mid-rebase/mid-merge, deduplicate by branch) is specified in markdown but has no testable implementation. If this logic were extracted into a TypeScript utility (e.g., `filterReviewableWorktrees()`), it could be unit tested with various `git worktree list --porcelain` outputs.

- **Incremental review SHA validation has no test harness** - `plugins/devflow-code-review/commands/code-review.md:Step 0c` (Confidence: 65%) -- The incremental detection logic (read `.last-review-head`, verify reachable with `git cat-file -t`, fallback on unreachable) is critical for correctness but exists only as prose instructions for agents. Edge cases like corrupted SHA files, empty files, or partial writes are not testable.

- **PF-001 (Synthesizer glob) resolution may need update** - `.memory/knowledge/pitfalls.md:PF-001` (Confidence: 62%) -- PF-001 documents that the synthesizer glob was changed from `*-report.*.md` to `*.md` with self-exclusion. With the new timestamped directory structure, the synthesizer now reads from `${REVIEW_BASE_DIR}/*.md` where REVIEW_BASE_DIR is the timestamped directory. The glob pattern still works (all files in the timestamped dir are review reports plus the summary), but the pitfall description references the old flat layout. The resolution is still functionally correct but the context is stale.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Tests Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces significant behavioral changes across 23 files (incremental reviews, worktree discovery, timestamped directories, new CLI flags, new ambient classification) but adds zero new tests. The most impactful gap is the missing `MULTI_WORKTREE` assertion in the preamble drift detection test -- this is a test that was specifically designed to catch exactly this kind of addition, and the PR failed to update it. The broader pattern of markdown-only orchestration specs without structural validation is a pre-existing concern, but the scope of changes in this PR (new phases, new edge cases, changed file paths, changed helper function contracts) amplifies the risk.
