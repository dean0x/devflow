# Testing Review Report

**Branch**: feat/ambient-keyword-trigger -> main
**Date**: 2026-06-02_1826
**PR**: #235
**Focus**: testing (test coverage & quality of the new preamble keyword-detection suite)

## Summary of What Was Reviewed

The PR adds first-word workflow-keyword detection to `scripts/hooks/preamble` (+34 lines)
and a +294-line test suite in `tests/shell-hooks.test.ts` (Suites 1-4 under
`describe('preamble keyword detection')`). I ran the suite (`vitest run -t "preamble keyword
detection"` → **37 passed, 0 failed**) and exercised the hook directly against edge cases
outside the suite to confirm behavior.

**Overall the test suite is strong and behavior-focused** — it asserts exit code + parsed
JSON output (`hookSpecificOutput.additionalContext` / `hookEventName`), not implementation
internals. It maps cleanly onto the documented four-suite plan (`applies ADR-014`):
Suite 1 Functionality, Suite 2 API contract, Suite 3 Security/fuzz (C7), Suite 4 Performance.

Coverage against the review checklist:

| Requirement | Covered? | Where |
|-------------|----------|-------|
| All 5 keywords match (implement/explore/research/debug/plan) | Yes | Suite 1 `matchCases` F1a, F1b, F2a, F2b, F3 |
| Case-insensitivity | Yes (across set, via shared `nocasematch`) | F2a `Explore`, F2b `RESEARCH` |
| "requires a second word" guard | Yes | F5a, F5b (`implement` / `plan` bare → empty) |
| trailing-`?` skip guard | Yes | F6a, F6b (incl. trailing whitespace after `?`) |
| Punctuation stripping ("Debug:") | Yes (single trailing punct only) | F3 |
| Substring rejection ("implementation") | Yes | F4a–F4d |
| Precedence keyword vs plan-marker | Yes (exactly one directive) | F8 |
| Hostile/large payloads (C7) | Yes (8 payloads incl. 200KB) | Suite 3 |
| Behavior-focused (exit code + JSON) | Yes | All suites |
| Empty prompt | Yes | C3c |

The suite assertions are correct and the design choices (shared `runPreamble` helper,
table-driven match/no-match cases, fixed-template equality check in C7 to prove no injection
leak) are exactly what this hook needs. The findings below are **coverage gaps for behaviors
the code actually exhibits**, not defects in the existing tests.

## Issues in Your Changes (BLOCKING)

None. No CRITICAL or HIGH blocking issues in the added test code.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Multi-character trailing punctuation is unverified and silently fails to match** — Confidence: 88%
- `tests/shell-hooks.test.ts:1121-1141` (Suite 1 truth table) / `scripts/hooks/preamble:45`
- Problem: `WORD="${TOKEN%[[:punct:]]}"` strips exactly **one** trailing punctuation
  character. F3 (`debug: why it hangs`) proves the single-punct case, but the suite never
  asserts the boundary where this guard stops working. I confirmed directly:
  `implement... the cache` → **empty output (no match)** because the token becomes
  `implement..` after stripping one dot. This is arguably the intended (conservative)
  behavior, but it is a real, user-reachable branch (`implement!!`, `research?!`, an ellipsis
  after a keyword) with **no test pinning it**. Without a test, a future "strip all trailing
  punct" refactor (e.g. `${TOKEN%%[[:punct:]]*}` or a loop) would change behavior with a
  green suite.
- Fix: add one no-match case and document the single-strip contract:
  ```ts
  { prompt: 'implement... the cache', label: 'F3b: only ONE trailing punct stripped — no match' },
  ```
  (asserts empty stdout, matching current behavior). If multi-punct *should* match, that is an
  implementation change, not a test change — flag to the author.

**Leading-whitespace / newline match path is exercised only on the no-op side** — Confidence: 85%
- `tests/shell-hooks.test.ts:1121-1161` / `scripts/hooks/preamble:41`
- Problem: line 41 (`HEAD="${HEAD#"${HEAD%%[![:space:]]*}"}"`) strips leading whitespace and
  newlines so that `\n\nimplement the cache` still matches. I confirmed this works
  (`  implement the cache`, `\timplement the cache`, `\n\nimplement the cache` all emit the
  `implement` directive). But no `matchCases` entry has leading whitespace/newlines, so the
  leading-strip is **only indirectly covered** by the plan-body no-match cases. A regression
  that removed line 41 would not be caught by any *match* assertion.
- Fix: add a positive case:
  ```ts
  { prompt: '\n\n  implement the cache', expectedSkill: 'implement', label: 'F1c: leading newlines/spaces still match' },
  ```

## Pre-existing Issues (Not Blocking)

None relevant to the testing focus introduced by this PR.

## Suggestions (Lower Confidence)

- **Per-keyword case-insensitivity is sampled, not exhaustive** - `tests/shell-hooks.test.ts:1122-1128`
  (Confidence: 70%) — case variants are tested for `Explore` and `RESEARCH` only; `implement`,
  `debug`, `plan` are tested lowercase. The shared `nocasematch` mechanism makes per-keyword
  coverage low-value, so this is informational. A single mixed-case case per keyword (or a
  comment noting the shared mechanism) would make intent explicit.
- **Leading-quote / wrapping-punctuation no-match is undocumented** - `scripts/hooks/preamble:42`
  (Confidence: 65%) — `"implement the cache` (leading quote) yields no match because only
  *trailing* punct is stripped from the token. Reasonable behavior, but a one-line no-match
  case would pin it against future "trim surrounding punctuation" changes.
- **C7 fuzz omits a leading-`?`-bypass attempt** - `tests/shell-hooks.test.ts:1275-1284`
  (Confidence: 62%) — the hostile payloads vary the *tail* after `implement`; none probe the
  Guard-B trailing-`?` interaction with injected `?` characters mid-string (e.g.
  `implement foo? $(echo x)`), which would confirm the `[?][[:space:]]*$` anchor only
  suppresses *trailing* questions, not embedded ones. Low risk given the equality-to-template
  assertion already proves no leak.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED

The suite is behavior-focused, table-driven, runs green (37/37), and satisfies the documented
four-suite plan (`applies ADR-014`). All five keywords, case-insensitivity, the second-word
guard, the trailing-`?` guard, single-punctuation stripping, substring rejection, path
precedence, empty prompt, and C7 hostile/200KB payloads are all covered. The two MEDIUM
findings are coverage gaps (multi-char trailing punctuation boundary; leading-whitespace
*match* path) on branches the code actually exercises — worth adding while here, but neither
blocks merge. No CLAUDE.md or worktree path concerns; tests correctly exercise the source hook
at `scripts/hooks/preamble`, not an installed copy (`avoids PF-007`).
