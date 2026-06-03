# Documentation Review Report

**Branch**: feat/ambient-keyword-trigger -> main
**Date**: 2026-06-02_1826
**Focus**: documentation (accuracy vs. `scripts/hooks/preamble` behavior)

## Verdict on the core request

The two changed docs — `CLAUDE.md` (Ambient Mode section, line 49) and
`plugins/devflow-ambient/README.md` ("How It Works" section) — **accurately** describe the
new first-word keyword detection. Every specific claim was verified against the actual hook:

| Doc claim | Hook reality | Verdict |
|-----------|--------------|---------|
| 5 keywords: implement/explore/research/debug/plan | `case` arms lines 51-55 | Accurate |
| Case-insensitive matching | `shopt -s nocasematch` line 49 | Accurate |
| Requires ≥1 word after keyword (`plan` alone does nothing) | `-n "$REST"` guard line 62 | Accurate |
| Prompt ending in `?` is suppressed | `! [[ "$PROMPT" =~ [?][[:space:]]*$ ]]` line 62 | Accurate |
| Keyword path takes precedence over 3-marker plan path | keyword `if` / plan `elif` lines 62/65 | Accurate |
| Model announces then invokes `devflow:<keyword>` w/ text after keyword | directive text line 64 | Accurate |
| Plan path still requires all three `## Goal`/`## Steps`/`## Files` | line 65 | Accurate |

All five README example triggers were traced through the hook and **all fire correctly**,
including the non-obvious `debug: why the tests fail` (the `WORD="${TOKEN%[[:punct:]]}"`
strip on line 45 turns `debug:` into `debug`, and `REST` is non-empty). The
`explore A or B?` "no output" claim is also correct (whole-prompt `?` suffix → suppressed).

No drift, overstatement, or factual error found in the changed lines. The changed docs do
not need correction.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

### MEDIUM
**README tagline still describes plan-detection-only — now contradicts the documented feature** — `plugins/devflow-ambient/README.md:3`
**Confidence**: 88%
- Problem: Line 3 (the file's one-line summary) reads: *"Ambient mode — plan auto-detection. A `UserPromptSubmit` hook detects structured implementation plans and invokes the implement workflow automatically."* The PR rewrote the entire "How It Works" section (lines 15-58) to add keyword detection, but the tagline directly above it still claims the hook only does plan auto-detection. A reader skimming the top of the README is told the wrong scope. This is code-doc drift in a file this PR modifies heavily.
- Fix: Broaden the tagline, e.g.: `Ambient mode — first-word keyword dispatch + structured-plan auto-detection. A `UserPromptSubmit` hook routes prompts to the matching devflow workflow.`

### MEDIUM
**`preamble` hook header comment is stale — describes plan-only behavior** — `scripts/hooks/preamble:3-5`
**Confidence**: 90%
- Problem: The PR added the keyword-detection block (lines 36-58) but left the file's top comment unchanged: *"Detects structured implementation plans and injects a directive to execute them. Zero overhead for normal prompts — only fires when all three plan markers are present."* The hook now also fires on first-word keywords, so "only fires when all three plan markers are present" is now factually wrong. This is exactly the code-comment drift the documentation Iron Law targets ("comments that contradict code"). The file is in this PR's diff, so it is in-scope as Should-Fix.
- Fix: Update lines 3-5 to mention both paths, e.g.: `# Detects first-word workflow keywords (implement/explore/research/debug/plan) and structured implementation plans, injecting a Skill-invocation directive. Zero overhead for normal prompts.`

## Pre-existing Issues (Not Blocking)

None of CRITICAL severity.

## Suggestions (Lower Confidence)

- **CLAUDE.md omits the trailing-punctuation tolerance** - `CLAUDE.md:49` (Confidence: 62%) — The doc says "first word ... is one of ...", but the hook strips one trailing punctuation char so `debug:` matches. This is an implementation detail and "first word" is defensible; mention only if precision is wanted.
- **ADR-013 is now stale relative to shipped behavior** - `.devflow/decisions/decisions.md:114` (Confidence: 70%) — ADR-013 records the design as **four** keywords (omits `plan`) and says keyword dispatch *"replaces"* three-marker detection. The shipped code uses **five** keywords and *coexists* both paths (the docs correctly describe the shipped behavior, not ADR-013). The changed docs are right; ADR-013 is the out-of-date artifact. Worth an `applies ADR-013` follow-up to reconcile the decision record, but this is not a doc-vs-code defect in the reviewed docs and does not block.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Documentation Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changed documentation is accurate and complete for the new keyword feature. The two
MEDIUM Should-Fix items are stale summary/comment lines adjacent to the change (README
tagline and the `preamble` header comment) that now contradict the shipped behavior — quick
one-line fixes that keep the file internally consistent.
