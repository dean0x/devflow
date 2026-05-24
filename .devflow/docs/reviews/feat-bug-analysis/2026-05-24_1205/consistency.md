# Consistency Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-24

## Issues in Your Changes (BLOCKING)

### HIGH

**resolve:orch uses undefined `{worktree}` variable -- inconsistent with its own scope** - `shared/skills/resolve:orch/SKILL.md:53`
**Confidence**: 92%
- Problem: The `decisions-index.cjs` invocation was changed from `"."` to `"{worktree}"`, but resolve:orch explicitly excludes multi-worktree flow (line 11: "Excluded: ... multi-worktree flow"). There is no `{worktree}` variable defined anywhere in this skill -- no Phase 0 worktree discovery, no `WORKTREE_PATH` input. The full `/resolve` command defines `{worktree}` in Step 0a via `git worktree list`, but resolve:orch is a lightweight single-worktree variant.
- Impact: Agents executing this skill will encounter an undefined placeholder `{worktree}` in the bash command, which will either be interpreted as a literal string or left unresolved, causing `decisions-index.cjs` to fail or search the wrong path.
- Fix: Revert to the original `"."` since resolve:orch operates in cwd only:
```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "." 2>/dev/null || echo "(none)")
```

**resolve:orch feature-knowledge stale-check still uses `"."` while decisions-index was changed to `"{worktree}"` -- internal inconsistency** - `shared/skills/resolve:orch/SKILL.md:61`
**Confidence**: 90%
- Problem: Within the same Phase 2 of resolve:orch, the `decisions-index.cjs` call on line 53 now uses `"{worktree}"` while the `feature-knowledge.cjs stale` call on line 61 still uses `"."`. Both calls serve the same purpose (loading project-scoped data for the current worktree) and should use the same path argument. This creates an internal inconsistency in the same phase of the same skill.
- Impact: If one call is correct, the other is wrong. Since resolve:orch is single-worktree (no `{worktree}` variable), both should use `"."`. The inconsistency signals an incomplete edit.
- Fix: Since resolve:orch is single-worktree, both should use `"."`. The decisions-index call should be reverted (see finding above), making them consistent again.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**bug-analyzer.md `Suggestions` row in summary table maps to LOW column -- inconsistent with reviewer agent format** - `shared/agents/bug-analyzer.md:196`
**Confidence**: 82%
- Problem: The bug-analyzer summary table now has a `Suggestions` row with the count placed in the `LOW` column. The reviewer agent template (which the bug-analyzer was aligned to in this PR) does not include a `Suggestions` row in its summary matrix -- suggestions are a separate section, not a table row. The reviewer template's summary table has only `Blocking`, `Should Fix`, and `Pre-existing` rows. Adding `Suggestions` as a row conflates the confidence-based filtering (Suggestions = 60-79% confidence) with the severity-based summary matrix.
- Impact: The `/resolve` pipeline parses these summary tables. An extra `Suggestions` row that does not exist in the reviewer format creates a format divergence between the two agent types that this PR specifically aimed to align (applies ADR-004 -- separate workflow, but compatible format for resolve parsing).
- Fix: Remove the `Suggestions` row from the summary table. Suggestions are already listed in their own `## Suggestions (Lower Confidence)` section with a max-3-items cap. The summary table should only contain the three standard category rows:
```markdown
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | {n} | {n} | - | - |
| Should Fix | - | - | {n} | - |
| Pre-existing | - | - | - | {n} |
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **bug-analysis.md Phase 4 still shows `CHANGED_FILES=$(git diff ...)` in the prose despite removing it from Step 2b** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:170` (Confidence: 72%) -- Phase 4 says "using `CHANGED_FILES` (already computed in Step 2b -- do not re-run `git diff`)" which is correct, but Step 2b stores the variable with `CHANGED_FILES=$(git diff --name-only {DIFF_RANGE})` while Phase 4 previously had its own `CHANGED_FILES=` assignment that was removed. The prose is consistent, but a reader comparing the two code blocks might question whether `CHANGED_FILES` is a shell variable (Step 2b) or a conceptual placeholder (Phase 4 prose). Minor clarity issue only.

- **plugin.json skills array in ascending alpha order but code-review plugin.json is not fully alphabetized** - `plugins/devflow-bug-analysis/.claude-plugin/plugin.json:26-34` (Confidence: 65%) -- The bug-analysis plugin.json skills array is alphabetically sorted, which is a good pattern. The code-review plugin.json skills array is also largely alphabetical but includes `review-methodology` and `worktree-support` at the end naturally. Both are consistent enough, but `apply-feature-knowledge` appears after `apply-decisions` in bug-analysis but after all review skills in code-review. This is a minor ordering observation.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED
