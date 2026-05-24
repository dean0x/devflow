# Regression Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-24

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Inconsistent path placeholder in resolve:orch Phase 2** - `shared/skills/resolve:orch/SKILL.md:53`
**Confidence**: 85%
- Problem: The `decisions-index.cjs` call was changed from `"."` to `"{worktree}"`, but the `feature-knowledge.cjs stale` check on line 61 still uses `"."`. resolve:orch explicitly states it excludes multi-worktree flow (line 11), so `{worktree}` is undefined in this context. The original `"."` was correct for a single-worktree skill. While an LLM agent would likely default to cwd, the inconsistency between line 53 (`{worktree}`) and line 61 (`"."`) within the same Phase 2 section creates ambiguity.
- Fix: Either revert line 53 back to `"."` (since resolve:orch is explicitly single-worktree), or update line 61 to also use `"{worktree}"` for consistency. The former is preferred since resolve:orch explicitly excludes multi-worktree flow.

## Issues in Code You Touched (Should Fix)

(No issues found at >= 80% confidence)

## Pre-existing Issues (Not Blocking)

(No pre-existing CRITICAL issues found in unchanged code)

## Suggestions (Lower Confidence)

- **Summary table format divergence between bug-analyzer and synthesizer** - `shared/agents/bug-analyzer.md:191` (Confidence: 65%) -- The bug-analyzer now uses severity-category rows (Blocking, Should Fix, Pre-existing, Suggestions) in its summary table, while the synthesizer's bug-analysis template uses focus-area rows (Security, Functional, Integration, Usability). This is not a functional regression since the synthesizer independently aggregates findings from focus reports rather than parsing the bug-analyzer's summary table, but the structural divergence could confuse humans reading both artifacts side by side.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions: Fix the path placeholder inconsistency in resolve:orch Phase 2 (MEDIUM blocking issue). All other changes are additive (new skills, new tests, documentation corrections) with no removed exports, no deleted files, no changed return types, and no incomplete migrations. The CLAUDE.md correction (bug-analysis is single-worktree only) accurately reflects the implementation and applies ADR-004. Plugin.json skills are strictly additive -- all prior skills preserved. All 67 tests pass.
