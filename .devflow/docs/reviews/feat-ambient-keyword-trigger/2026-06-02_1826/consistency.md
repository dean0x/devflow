# Consistency Review Report

**Branch**: feat/ambient-keyword-trigger -> main
**PR**: #235
**Date**: 2026-06-02_1826

## Scope

First-word workflow-keyword detection added to `scripts/hooks/preamble`. Evaluated for consistency
with existing hook conventions (dbg logging, `json_prompt_output`, `hook-bootstrap` sourcing), naming
(SKILL var, directive wording), directive-text consistency between keyword path and plan-detection
path, and doc accuracy (CLAUDE.md / README / in-file comment header). Verified the 5 keywords map to
real `devflow:<skill>` names.

## Verification Summary (passing consistency checks)

- Hook conventions are followed cleanly: `dbg() { :; }` safe no-op declared before `set -e` and
  before `hook-bootstrap`, `source "$SCRIPT_DIR/hook-bootstrap" "preamble"`, `devflow_debug_set_cwd`,
  CWD existence guard, and the `=== HOOK COMPLETE ===` trailer all match the sibling `sidecar-dispatch`
  hook pattern.
- `json_prompt_output` is used for BOTH detection paths — consistent with how the existing plan path
  emitted output, and the correct helper for `UserPromptSubmit` (verified against `json-parse:212`).
- The 5 keywords (`implement`, `explore`, `research`, `debug`, `plan`) all map to real installed skills
  (`devflow:implement/explore/research/debug/plan`) and to real command plugins. No dead keyword.
- The `SKILL` variable name is descriptive and the `case` arms canonicalize to the lowercase skill name,
  matching the `devflow:<skill>` install naming.
- README and CLAUDE.md prose both describe the **actual** coexisting-paths behavior (keyword path +
  plan path, 5 keywords, `?`-guard, "at least one word after keyword") accurately and consistently
  with each other and with the code.
- Test directive expectation (`tests/shell-hooks.test.ts:1111`) mirrors the hook's directive string
  verbatim and asserts the correct `devflow:<skill>` names — test/source consistency holds.

## Issues in Your Changes (BLOCKING)

None. The shipped code, README, and CLAUDE.md are internally consistent.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale in-file comment header — describes plan-only behavior** — `scripts/hooks/preamble:3-5`
**Confidence**: 95%
- Problem: The file header comment still reads: "Detects structured implementation plans and injects
  a directive to execute them. Zero overhead for normal prompts — only fires when all three plan
  markers are present." After this PR the hook ALSO fires on first-word keywords, so "only fires when
  all three plan markers are present" is now false. The PR updated CLAUDE.md and the README to describe
  two coexisting paths but left the in-file documentation describing the old single path. This is
  documentation drift in a file the author modified (violates the consistency rule that touched-code
  docs stay accurate).
- Fix: Update lines 3-5 to describe both paths, e.g.:
  ```bash
  # Devflow Preamble: UserPromptSubmit Hook
  # Two coexisting detection paths: (1) first-word workflow keyword
  # (implement/explore/research/debug/plan) -> invoke devflow:<keyword>;
  # (2) structured plan (## Goal + ## Steps + ## Files) -> invoke devflow:implement.
  # Zero overhead for normal prompts — emits nothing when neither path fires.
  ```

### MEDIUM

**Directive-text style differs between the two emission paths** — `scripts/hooks/preamble:64` vs `:67`
**Confidence**: 85%
- Problem: The two paths emit stylistically inconsistent directives for the same purpose (instruct the
  model to invoke a `devflow:<skill>`). Keyword path (line 64) uses a natural-language directive ("The
  user is invoking the `$SKILL` workflow. Briefly tell the user you are invoking `devflow:$SKILL`,
  then invoke it..."). Plan path (line 67) uses a terse marker-style directive ("EXECUTION_PLAN
  detected. Invoke `devflow:implement` via the Skill tool to execute this plan."). One announces to the
  user first, the other does not; one leads with an internal marker token (`EXECUTION_PLAN detected`)
  that leaks into model-facing context. Since both paths now live in the same hook and both invoke a
  devflow skill, the divergent phrasing is an avoidable inconsistency.
- Fix: Align the plan-path directive with the keyword-path phrasing (announce-then-invoke, drop the
  internal `EXECUTION_PLAN detected` token from the user-facing string — keep it only in the `dbg`
  line). Example: `json_prompt_output "The user supplied a structured implementation plan. Briefly tell the user you are invoking \`devflow:implement\`, then invoke it via the Skill tool to execute this plan."`
  Low risk: no test asserts the exact plan-path string except `:1182` which checks the keyword path does
  NOT contain `EXECUTION_PLAN detected` — removing the token from user-facing text is compatible.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**ADR-013 contradicts the shipped implementation** — `.devflow/decisions/decisions.md:114-121`
**Confidence**: 90%
- Problem: `applies ADR-013` — the decision record added in this PR states the keyword dispatch
  *"replaces three-marker structured-plan detection"* and lists only **four** keywords
  (implement/explore/research/debug). The shipped code KEEPS plan detection (coexisting `elif` path,
  confirmed in README/CLAUDE.md) and adds a **fifth** keyword (`plan`). It also describes the mechanism
  as "replace only that word with the corresponding devflow skill invocation," whereas the code emits a
  directive instructing the model to invoke the skill (it does not rewrite the prompt). The ADR is
  self-learning-captured (`Source: self-learning:obs_preamble1`), not hand-authored, so it is
  informational and append-only by policy — but it now misdescribes this exact feature. Readers
  consulting decisions context for this area (`DECISIONS_CONTEXT`) will get a stale picture.
- Fix: Decisions are append-only (status changes allowed, deletions prohibited). Either append a
  follow-up ADR clarifying that plan detection was retained and `plan` was added as a 5th keyword, or
  edit ADR-013's body to match the shipped behavior (text edits to context/decision lines are permitted
  under the append-only invariant since no entry is deleted). Not merge-blocking — the ADR is captured
  metadata, not executable code.

## Suggestions (Lower Confidence)

- **`plan` keyword vs `## Goal`/`## Steps`/`## Files` plan detection naming overlap** —
  `scripts/hooks/preamble:55,65` (Confidence: 65%) — Both the `plan` keyword path (-> `devflow:plan`)
  and the structured-plan path (-> `devflow:implement`) carry the word "plan" but route to different
  skills. A prompt beginning `plan ...` with all three markers would take the keyword branch (it fires
  first), routing to `devflow:plan` rather than `devflow:implement`. This is plausibly intended, but the
  shared "plan" terminology across two paths that resolve differently is a latent naming-consistency
  trap worth a one-line code comment.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 0 |

**Consistency Score**: 8
**Recommendation**: APPROVED_WITH_CONDITIONS

The implementation follows hook conventions faithfully and the user-facing docs (README, CLAUDE.md) are
accurate and mutually consistent. The conditions are two should-fix MEDIUMs in the touched file: the
stale in-file comment header (lines 3-5) and the divergent directive-text style between the two paths.
The ADR-013 contradiction is informational.
