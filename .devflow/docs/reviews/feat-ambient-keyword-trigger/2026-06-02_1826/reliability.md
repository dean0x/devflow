# Reliability Review Report

**Branch**: feat/ambient-keyword-trigger -> main
**Date**: 2026-06-02_1826
**Focus**: reliability (NASA "Power of Ten" lens — bounded work, termination, defensive guards, no-abort discipline)
**Scope**: `scripts/hooks/preamble` (first-word workflow-keyword detection block, lines 36-70)

## Executive Summary

The added keyword-detection block is **defensively sound**. It is bounded to a fixed
256-byte window, performs only pure-bash parameter expansions plus one anchored regex
(no subprocess, no unbounded scan), and exits 0 on every path I could construct —
including empty, all-whitespace, single-word, question-form, punctuation-only, and
200KB inputs. I empirically reproduced the exact block under `set -e` against 11
adversarial prompts and all returned `rc=0` with correct fire/no-fire decisions. The
existing test suite (37 preamble tests, all passing) independently confirms exit-0 on
empty prompt (C3c), no-match (C3b), keyword match (C3a), missing cwd (C3d), and bounded
wall-time on a 200KB payload (P2/P3). This directly fulfills `applies ADR-014`'s
four-suite test plan.

The `shopt nocasematch` state is correctly reset: line 58 (`shopt -u nocasematch`) runs
unconditionally with no `return`/`exit`/`continue` between the set (line 49) and unset,
so the case-insensitivity flag cannot leak. No CRITICAL or HIGH reliability issues found.

`avoids PF-007`: this change correctly edits the source hook (`scripts/hooks/preamble`),
not the installed copy. `applies ADR-013`: implements the documented first-word
keyword-dispatch redesign.

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence. Bounded-iteration, termination, and no-abort properties all hold.

## Pre-existing Issues (Not Blocking)

None relevant to reliability in the touched region.

## Suggestions (Lower Confidence)

- **`shopt -u nocasematch` unconditionally disables an inherited flag** — `scripts/hooks/preamble:58` (Confidence: 65%) — Line 58 turns `nocasematch` OFF regardless of whether it was already set in the inherited environment. Because the hook is a standalone short-lived process (no further case/regex matching depends on the prior state, and the process exits at line 72), this has no observable effect today. If future edits add case-sensitive matching after line 58 while the hook is ever sourced rather than executed, the reset could surprise. A save/restore (`local _ncm; shopt -q nocasematch && _ncm=1; ... ; [[ -n "$_ncm" ]] && shopt -s nocasematch`) would be strictly correct but is almost certainly over-engineering for an `exec`'d hook. Note only.

- **No explicit assertion that `SKILL` maps to a real installed skill** — `scripts/hooks/preamble:50-57` (Confidence: 60%) — The `case` arms hard-code the five skill names (`implement/explore/research/debug/plan`). There is no runtime guard that `devflow:$SKILL` actually exists; a typo in an arm would silently emit a directive for a nonexistent skill. The directive is advisory (the model handles a missing skill gracefully), so impact is low, and the closed `case` set makes drift unlikely. Per the reliability "assertion density" guideline this is a minor gap, not a defect. Note: ADR-013 documents only four keywords (implement/explore/research/debug) while the code adds a fifth (`plan`, also tested as F1b/F5b) — that is a decisions/consistency divergence, out of scope for reliability, flag for the consistency reviewer.

## Reliability Verification Detail

| Property | Status | Evidence |
|----------|--------|----------|
| Bounded work | PASS | `HEAD="${PROMPT:0:256}"` caps all subsequent expansions to 256 bytes; verified 1MB input yields `HEAD` length exactly 256. Regex on line 62 is `$`-anchored so it does not scan the full prompt body. |
| Always exits 0 | PASS | No `exit`/`return` non-zero in the new block; case default arm returns 0; `! [[ regex ]]` negation returns 0 under `set -e`; `execSync`-based tests C3a-C3d would throw on non-zero and do not. |
| Empty PROMPT | PASS | `HEAD=""` -> `TOKEN=""` -> `WORD=""` -> case `*)` -> `SKILL=""` -> no fire. Tested (C3c, my harness "empty"). |
| All-whitespace / tabs / newlines | PASS | Leading-whitespace strip (line 41) reduces `HEAD` to `""`; same no-fire path. Tested in my harness. |
| Single keyword, no following word | PASS | `REST=""` after strip -> guard `-n "$REST"` fails -> no fire. Tested (F5a/F5b). |
| Question-form suppression | PASS | `[?][[:space:]]*$` anchored regex suppresses `debug?` and `debug this?  ` (trailing ws). Tested (F6a/F6b). |
| Punctuation-only token | PASS | `"???"` -> strips one trailing punct -> `"??"` -> no case match -> no fire. |
| Huge / hostile input (200KB, backticks, IFS) | PASS | 256-byte cap + fixed-template output (no user text interpolated into directive) -> bounded and injection-free. Tested (C7, P2/P3). |
| `shopt nocasematch` always reset | PASS | Line 58 runs unconditionally; no branch exits between line 49 and 58. |
| No-abort discipline under `set -e` | PASS | All 11 adversarial prompts in the reproduced block returned `rc=0`; `set -e` does not abort on the failing-match expansions because none of the parameter expansions or the negated regex return non-zero in a way `set -e` traps. |
| `set -u` safety | N/A | The hook does not enable `set -u`; all referenced vars (`HEAD/TOKEN/REST/WORD/SKILL/PROMPT`) are assigned before use, so it would be `set -u`-safe regardless. |

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Reliability Score**: 9
**Recommendation**: APPROVED
