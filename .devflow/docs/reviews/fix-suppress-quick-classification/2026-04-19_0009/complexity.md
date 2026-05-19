# Complexity Review Report

**Branch**: fix-suppress-quick-classification -> main
**Date**: 2026-04-19
**PR**: #185

## Issues in Your Changes (BLOCKING)

No blocking complexity issues found.

## Issues in Code You Touched (Should Fix)

No should-fix complexity issues found.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`runClaudeStreaming` has 5 levels of nesting and high cyclomatic complexity** - `tests/integration/helpers.ts:53-152`
**Confidence**: 85%
- Problem: The `runClaudeStreaming` function spans ~100 lines with 5 nesting levels (function -> Promise -> event handler -> for loop -> try/catch -> nested if chains at lines 111-134). The inner parsing logic combines event type checking, content array iteration, type narrowing via `as Record<string, unknown>` casts, and timer management — all within a single function. Cyclomatic complexity is approximately 12 (branching on event type, content block type, skills array length, grace timer state, settled state).
- Impact: Difficult to modify or debug the event parsing logic independently from the process lifecycle management. The function mixes two concerns: process lifecycle (spawn, timeout, kill) and event stream parsing (JSON parse, skill extraction, text fragment capture).
- Fix: Extract the inner event-parsing loop (lines 105-139) into a standalone `parseStreamEvent(event: unknown): { skills: string[]; textFragments: string[] }` function. This would reduce nesting by 2 levels and make the parsing logic independently testable.

## Suggestions (Lower Confidence)

- **Repeated `resolve` + `readFileSync` pattern across test files** - `tests/ambient.test.ts:492`, `tests/skill-references.test.ts:706`, `tests/integration/helpers.ts:24` (Confidence: 65%) — Three test files independently construct the path to `classification-rules.md` using `path.resolve` + hardcoded relative segments. A shared constant or helper would reduce the number of places that need updating when the file moves (as happened in this PR).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED

**Rationale**: This PR reduces complexity rather than adding it. The changes are straightforward: a file rename from a `references/` subdirectory to the parent directory, a preamble text change to make router loading conditional (GUIDED/ORCHESTRATED only), a cleaner legacy fallback in the session-start hook (replacing an `awk`-based SKILL.md extraction with a simple `cat` of the legacy path), and test updates to match. The session-start-classification hook went from 3 branches (new path / awk fallback / exit) to 3 cleaner branches (new path / legacy path / exit) with reduced per-branch complexity. The new `hasClassification` assertions in integration tests are simple one-line checks. No new functions exceed thresholds, no new nesting is introduced, and overall readability improves.

**PF-001 Check**: The changes to `tests/integration/helpers.ts` (lines 24, 30) are path updates only. Promise callbacks at lines 62 and 249 correctly use `resolve` as the resolver parameter name per project convention. No regression.
