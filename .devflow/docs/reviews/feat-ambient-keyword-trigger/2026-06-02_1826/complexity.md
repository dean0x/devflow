# Complexity Review Report

**Branch**: feat/ambient-keyword-trigger -> main
**Date**: 2026-06-02_1826
**PR**: #235
**Focus**: Complexity / maintainability
**Diff**: `git diff main...HEAD`

Scope reviewed: `scripts/hooks/preamble` (+34 lines, keyword detection block) and `tests/shell-hooks.test.ts` (+294 lines, 4 test suites). Applies ADR-013 (keyword-dispatch redesign) and ADR-014 (four-suite test plan); avoids PF-007 (source edited, not installed copy).

## Issues in Your Changes (BLOCKING)

None. The added code stays within complexity thresholds: the `case` dispatch is flat (5 arms, no nesting), the guard chain is a single 3-condition `if` plus an `elif`, and no function exceeds 30 lines. Nesting depth is 1. Cyclomatic complexity of the dispatch + guard block is roughly 8 decision points spread across a `case` and one `if/elif/else` — within acceptable range for a hook entry point. Nothing here blocks the PR.

## Issues in Code You Touched (Should Fix)

### MEDIUM
**Non-obvious asymmetry: keyword detection reads `HEAD` (256-byte cap) but the `?` guard scans full `$PROMPT`** — `scripts/hooks/preamble:40,62`
**Confidence**: 84%
- Problem: Lines 40-45 deliberately bound all keyword parsing to the first 256 bytes (`HEAD="${PROMPT:0:256}"`) for performance, but the question-mark suppression guard on line 62 (`[[ "$PROMPT" =~ [?][[:space:]]*$ ]]`) operates on the full, unbounded `$PROMPT`. This is functionally *correct* (a trailing `?` lives at the end, not the start, so it must scan the tail), but the two variables silently use different scopes within the same `if`. A future maintainer reading line 62 may "optimize" it to use `$HEAD` and silently break the question-suppression behavior for prompts longer than 256 bytes. The comment on lines 60-61 explains the `$`-anchor efficiency but never states *why* this check intentionally uses `$PROMPT` and not `$HEAD`.
- Impact: Maintainability — the load-bearing reason for the variable choice is undocumented, inviting a regression. This is exactly the "comments explain what, not why" gap the complexity Iron Law warns about.
- Fix: Add a half-line clarifying the scope choice, e.g.:
  ```bash
  # Guard B: skip prompts ending in '?'. Uses full $PROMPT (NOT $HEAD) because the
  # trailing '?' lives at the END of the prompt, beyond the 256-byte keyword window.
  if [[ -n "$SKILL" && -n "$REST" ]] && ! [[ "$PROMPT" =~ [?][[:space:]]*$ ]]; then
  ```

## Pre-existing Issues (Not Blocking)

None of note. The pre-existing plan-marker branch (now the `elif` on line 65) was moved verbatim from the old top-level `if` and carries no new complexity.

## Suggestions (Lower Confidence)

- **Densest parameter expansion is the whitespace-trim idiom** - `scripts/hooks/preamble:41` (Confidence: 70%) — `HEAD="${HEAD#"${HEAD%%[![:space:]]*}"}"` is the one line that genuinely requires bash expertise to parse (nested `#` + `%%` with a negated character class). The trailing comment "strip leading whitespace/newlines" tells the reader the intent, which is the right call. Optional: a one-line block comment noting this is the canonical "ltrim" idiom would let a reader skip decoding it. Not worth blocking — the comment already covers the *what*, and the pattern recurs on lines 43-44 so a maintainer learns it once.

- **P2/P3 timing assertion is mildly flaky-prone** - `tests/shell-hooks.test.ts:1338-1370` (Confidence: 68%) — The performance test asserts `delta < 500ms` and `ratio < 5×` using wall-clock `Date.now()` deltas across 5 runs. The comment honestly acknowledges these are "intentionally generous" and that tighter bounds "belong in a dedicated benchmark." The `ratio < 5×` check divides two small medians (a fast small-prompt run can make `largeMs/smallMs` spike on a loaded CI box). The methodology is sound (length-independence per ADR-014) and the `> 0` guard prevents divide-by-zero, but consider dropping the `ratio` assertion and keeping only the absolute `delta` bound to reduce CI noise. Not over-complex — just the one assertion most likely to produce a spurious failure.

## Assessment of Specifically-Requested Concerns

| Concern | Verdict |
|---------|---------|
| Readability of chained expansions (HEAD/TOKEN/REST/WORD) | Acceptable. Each step has a `what` comment; only line 41's ltrim idiom is genuinely dense, and it is annotated. |
| Comments explain non-obvious bash idioms | Mostly yes. Gap: the HEAD-vs-PROMPT scope asymmetry on line 62 (the one *why* that is missing — see MEDIUM finding). |
| Cyclomatic complexity of if/elif/else guard | Within range (~8 decisions across `case` + `if/elif/else`, nesting depth 1). No CRITICAL/HIGH. |
| Test suite over/under-complex | Appropriately complex. Four data-driven suites map 1:1 to ADR-014's four risk dimensions. Table-driven `matchCases`/`noMatchCases`/`hostilePayloads` keep it DRY. No boilerplate explosion. Only soft spot is the timing assertion (suggestion above). |

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The change is clean and well-tested. The single MEDIUM finding (documenting the intentional `$PROMPT` vs `$HEAD` scope asymmetry on line 62) is a one-line comment fix worth doing while here to prevent a future regression. The two suggestions are optional polish.
