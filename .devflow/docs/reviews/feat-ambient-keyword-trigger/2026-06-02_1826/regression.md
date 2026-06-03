# Regression Review Report

**Branch**: feat/ambient-keyword-trigger -> main
**PR**: #235
**Date**: 2026-06-02_1826
**Focus**: regression
**Diff command**: `git diff main...HEAD`

## Scope

Changed files reviewed for regression risk:
- `scripts/hooks/preamble` (logic change — keyword detection added, plan path moved to `elif`)
- `tests/shell-hooks.test.ts` (new test suites 1-4)
- `CLAUDE.md`, `plugins/devflow-ambient/README.md`, `.devflow/decisions/decisions.md`, `.devflow/features/index.json` (docs/metadata — no runtime behavior)

The central regression risk flagged by the orchestrator: the existing 3-marker
plan-detection path (`## Goal` / `## Steps` / `## Files` → `devflow:implement`) was
moved into an `elif` branch behind the new first-word keyword path. I verified this
empirically by extracting the exact branch logic and running it under bash 3.2.57
(the macOS system bash this hook targets).

## Verification Performed

Ran all relevant branch combinations against the real preamble logic in bash 3.2:

| Input | Result | Pre-PR behavior | Regression? |
|-------|--------|-----------------|-------------|
| Pure marker plan, no keyword first word | `PLAN` → devflow:implement | `PLAN` → devflow:implement | No — preserved (test F7) |
| `implement it` + plan markers | keyword → devflow:implement | `PLAN` → devflow:implement | No — same skill (test F8) |
| `explore …` + plan markers | keyword → devflow:explore | `PLAN` → devflow:implement | Behavior change, intentional per ADR-013 |
| keyword-prefixed plan ending in `?` | falls through to `elif` → `PLAN` | `PLAN` → devflow:implement | No — `?` guard correctly defers to marker path |
| `explore A or B?` (no markers) | NO-OUTPUT | NO-OUTPUT (no markers pre-PR) | No |
| all-whitespace / empty prompt | NO-OUTPUT | NO-OUTPUT | No |
| leading whitespace + keyword | keyword fires | n/a (new) | No |

Also verified `set -e` does not abort on the no-match path (exit 0 preserved), and
that the bash 3.2 parameter expansions (`${HEAD%%[![:space:]]*}`, `${TOKEN%[[:punct:]]}`,
`nocasematch`) behave as intended on the target interpreter.

## Issues in Your Changes (BLOCKING)

None. The plan-detection path is preserved as an `elif` fallback and continues to
fire for every input that produced output before this PR. The only behavior changes
are intentional and documented in ADR-013.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale file-header comment after behavior change** — `scripts/hooks/preamble:3-5`
**Confidence**: 90%
- Problem: The header still reads "Detects structured implementation plans and injects
  a directive to execute them. Zero overhead for normal prompts — only fires when all
  three plan markers are present." After this PR the hook ALSO fires on first-word
  keywords (`implement`/`explore`/`research`/`debug`/`plan`), and keyword dispatch is
  now the primary path. The comment now describes only the secondary `elif` branch.
- Impact: Documentation drift (devflow:documentation / regression category 3). A future
  maintainer reading the header would not know the keyword path exists, raising the risk
  of an incorrect "dead code" removal or a mismatched edit. This is the exact source-of-truth
  file (PF-007 applies — edits must land here, not the installed copy), so accuracy matters.
- Fix: Update the header to describe both detection paths, e.g.:
  ```bash
  # Devflow Preamble: UserPromptSubmit Hook
  # Two coexisting detection paths (single toggle):
  #  1. First-word keyword dispatch (implement/explore/research/debug/plan + a second word,
  #     not ending in '?') → announce + invoke devflow:<keyword>.
  #  2. Structured plan markers (## Goal + ## Steps + ## Files) → devflow:implement (elif fallback).
  # Zero overhead for normal prompts — emits nothing unless one path matches.
  ```

## Pre-existing Issues (Not Blocking)

None identified within the changed file beyond the header noted above.

## Suggestions (Lower Confidence)

- **Keyword-prefixed plans no longer reach `devflow:implement` when the first word is
  `explore`/`research`/`debug`/`plan`** — `scripts/hooks/preamble:62-67` (Confidence: 70%)
  — A structured plan body whose first word happens to be `explore`/`plan`/etc. now routes
  to that keyword's skill instead of `devflow:implement`. This is consistent with ADR-013
  ("first-word keyword dispatch replaces three-marker structured-plan detection") and the
  `?`-suppressed case still falls through to the plan path, so it is almost certainly
  intentional. Flagged only so the precedence choice is a conscious one — no action needed
  if the keyword-wins ordering is the desired UX.

## Decisions Applied

- `applies ADR-013` — The keyword-over-marker precedence (keyword path first, plan path as
  `elif`) directly implements ADR-013's "first-word keyword dispatch replaces three-marker
  structured-plan detection." The implementation is slightly more conservative than ADR-013's
  literal wording (it RETAINS the marker path as a fallback rather than fully removing it),
  which is backward-compatible and reduces regression risk — a strict improvement over the
  documented decision. Test F8 codifies the precedence; no conflict.
- `avoids PF-007` — Change correctly lands in `scripts/hooks/preamble` (source of truth),
  not the installed `~/.devflow/scripts/hooks/` copy.

## Test Coverage Assessment

The new test suites directly cover the regression-critical paths:
- **F7** asserts the marker path still fires for a plan body with no leading keyword (the
  core "previously-passing behavior preserved" guarantee).
- **F8** asserts keyword + markers yields exactly ONE directive (keyword wins, no double-fire).
- **F4a–F11 / C2** assert no-output prompts still produce zero bytes (no false-positive
  regression for normal prompts).
- Security fuzz (Suite 3) confirms the fixed-template directive equals the expected string —
  no user-text leakage through the new `json_prompt_output` call.

Coverage gap (minor, non-blocking): no test asserts the directive TEXT for a keyword-prefixed
plan ending in `?` falls through to the `EXECUTION_PLAN` marker branch. The logic is correct
(verified manually above), but a test would lock in that the `?` guard defers to the marker
path rather than emitting nothing.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The plan-detection path is preserved and fires for every input that produced output
before this PR; the only behavior changes are intentional and documented in ADR-013.
No functional regression. The single MEDIUM (stale header comment) should be fixed
while in this file but does not block merge.
