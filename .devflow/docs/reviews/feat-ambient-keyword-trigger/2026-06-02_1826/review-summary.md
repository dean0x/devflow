# Code Review Summary

**Branch**: feat/ambient-keyword-trigger -> main
**Date**: 2026-06-02_1826
**Timestamp**: 2026-06-02_1826

## Merge Recommendation: CHANGES_REQUESTED

The feature is architecturally sound and well-tested, but has **one HIGH-severity performance issue** that must be fixed before merge, plus **four MEDIUM issues** (documentation accuracy, test coverage, performance comment correctness) that should be resolved. The HIGH issue is localized to a single line; the MEDIUMs are quick fixes. After these fixes, approval is straightforward.

---

## Issue Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 4 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 1 |

**Total Blocking Issues**: 5  
**Score**: 8.0/10 (after fixes)

---

## Blocking Issues (Must Fix)

### HIGH
**Trailing-`?` regex runs on the full prompt with inaccurate "efficiency" justification** — `scripts/hooks/preamble:62`
**Confidence**: 95% (Performance reviewer)
- Problem: Line 62 tests `! [[ "$PROMPT" =~ [?][[:space:]]*$ ]]` against the **entire** `$PROMPT`, not the 256-byte `$HEAD`. The inline comment (lines 60-61) asserts the `$` anchor makes this "efficient" and that "bash regex does not scan the full string for a trailing match." This is **incorrect**. POSIX ERE matching in bash 3.2 walks the whole string; a `$` anchor does NOT enable a right-to-left or tail-only scan.
- Impact: **O(n) cost on full prompt length**. Measured ~6ms per invocation on a 200KB prompt (100 iters / 0.613s, bash 3.2.57). Scales linearly — a 1MB paste would cost ~30ms. Only fires when the first word already matched a keyword (`SKILL` non-empty), so normal prompts are unaffected, but a user typing `implement <giant pasted spec>` pays the full scan. The misleading comment will propagate the wrong mental model to future maintainers.
- Fix (two parts):
  1. Correct the comment — the `$` anchor does not avoid a full scan.
  2. Bound the work by taking a bounded tail only when a keyword matched. Suggested robust approach (avoids the O(n) slice pitfall on other tail operations):
     ```bash
     # Keyword matched; reuse HEAD for the first-word parse, capture a bounded TAIL for the ? guard.
     if [[ -n "$SKILL" && -n "$REST" ]]; then
       # ${PROMPT: -32} is O(n) in bash 3.2; do it once on the matched path only.
       TAIL="${PROMPT: -32}"
       TAIL="${TAIL%%*([[:space:]])}"
       if [[ "${TAIL: -1}" != "?" ]]; then
         json_prompt_output "..."
       fi
     fi
     ```
  3. Alternatively, fix just the comment and acknowledge the cost explicitly with a note about moving it to ADR-014's performance suite.

---

### MEDIUM (Blocking Fixes)

**Stale in-file comment header — describes plan-only behavior** — `scripts/hooks/preamble:3-5`
**Confidence**: 90% (Consistency, Documentation, Regression reviewers)
- Problem: The file header comment still reads: *"Detects structured implementation plans and injects a directive to execute them. Zero overhead for normal prompts — only fires when all three plan markers are present."* The PR added first-word keyword detection, so "only fires when all three plan markers are present" is now **false**. This is documentation drift in a file the author modified.
- Fix: Update lines 3-5 to describe both detection paths:
  ```bash
  # Devflow Preamble: UserPromptSubmit Hook
  # Two coexisting detection paths: (1) first-word workflow keyword
  # (implement/explore/research/debug/plan) -> invoke devflow:<keyword>;
  # (2) structured plan (## Goal + ## Steps + ## Files) -> invoke devflow:implement.
  # Zero overhead for normal prompts — emits nothing when neither path fires.
  ```

**Directive-text style differs between the two emission paths** — `scripts/hooks/preamble:64` vs `:67`
**Confidence**: 85% (Consistency reviewer)
- Problem: The keyword path (line 64) emits a natural-language directive ("The user is invoking the `$SKILL` workflow. Briefly tell the user..."), while the plan path (line 67) uses a terse marker-style directive ("EXECUTION_PLAN detected. Invoke..."). Both invoke a `devflow:<skill>`, so the divergent phrasing is avoidable inconsistency. One announces to the user; the other leaks an internal marker token.
- Fix: Align the plan-path directive with the keyword-path phrasing, dropping the internal `EXECUTION_PLAN detected` token from user-facing text:
  ```bash
  json_prompt_output "The user supplied a structured implementation plan. Briefly tell the user you are invoking \`devflow:implement\`, then invoke it via the Skill tool to execute this plan."
  ```

**README tagline still describes plan-detection-only** — `plugins/devflow-ambient/README.md:3`
**Confidence**: 88% (Documentation reviewer)
- Problem: Line 3 reads: *"Ambient mode — plan auto-detection..."* but the PR added keyword detection. A reader skimming the top sees the old scope. This is code-doc drift in a file this PR modifies.
- Fix: Broaden the tagline:
  ```markdown
  Ambient mode — first-word keyword dispatch + structured-plan auto-detection. A `UserPromptSubmit` hook routes prompts to the matching devflow workflow.
  ```

**Multi-character trailing punctuation is unverified** — `tests/shell-hooks.test.ts:1121-1141` / `scripts/hooks/preamble:45`
**Confidence**: 88% (Testing reviewer)
- Problem: `WORD="${TOKEN%[[:punct:]]}"` strips exactly **one** trailing punctuation character. The suite asserts `debug:` matches (single punct), but never tests the boundary where multi-punct fails. I confirmed `implement... the cache` → **no match** because the token becomes `implement..` after stripping one dot. This is arguably intentional, but it's a real user-reachable branch with **no test pinning it**.
- Fix: Add one no-match case to document the contract:
  ```ts
  { prompt: 'implement... the cache', label: 'F3b: only ONE trailing punct stripped — no match' },
  ```
  (asserts empty stdout, matching current behavior). If multi-punct *should* match, that is an implementation change — flag to the author.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**ADR-013 contradicts the shipped implementation** — `.devflow/decisions/decisions.md:114-121`
**Confidence**: 90% (Consistency reviewer)
- Problem: ADR-013 states the keyword dispatch *"replaces three-marker structured-plan detection"* and lists only **four** keywords (implement/explore/research/debug). The shipped code KEEPS plan detection (coexisting `elif` path) and adds a **fifth** keyword (`plan`). The ADR is self-learning-captured and append-only, so it is informational only — but it now misdescribes this exact feature.
- Impact: Readers consulting `DECISIONS_CONTEXT` will get a stale picture.
- Fix: Append a follow-up ADR clarifying that plan detection was retained and `plan` was added as a 5th keyword, or edit ADR-013's body to match the shipped behavior (body edits are permitted under the append-only invariant). Not merge-blocking.

---

## Suggestions (Lower Confidence, 60-79%)

**Leading-whitespace / newline match path is exercised only on the no-op side** — `tests/shell-hooks.test.ts:1121-1161` / `scripts/hooks/preamble:41`
**Confidence**: 85% (Testing reviewer)
- Line 41 strips leading whitespace so `\n\nimplement the cache` still matches. No `matchCases` entry has leading whitespace, so the leading-strip is **only indirectly covered**. A regression that removed line 41 would not be caught by any *match* assertion. Add a positive case:
  ```ts
  { prompt: '\n\n  implement the cache', expectedSkill: 'implement', label: 'F1c: leading newlines/spaces still match' },
  ```

**Trailing-`?` regex scans unbounded — complexity and maintainability** — `scripts/hooks/preamble:40,62`
**Confidence**: 84% (Complexity reviewer)
- Non-obvious asymmetry: keyword detection reads `HEAD` (256-byte cap) but the `?` guard scans full `$PROMPT`. Functionally correct but the two variables silently use different scopes. A future maintainer may "optimize" it to use `$HEAD` and silently break behavior for >256-byte prompts. Add a clarifying half-line:
  ```bash
  # Guard B: skip prompts ending in '?'. Uses full $PROMPT (NOT $HEAD) because the
  # trailing '?' lives at the END of the prompt, beyond the 256-byte keyword window.
  ```

**`json_extract_cwd_prompt` forks jq/node on every prompt (pre-existing)** — `scripts/hooks/preamble:22`
**Confidence**: 85% (Performance reviewer)
- The hook forks `jq` (~5-15ms cold) or `node` (~30-60ms) on EVERY prompt before any keyword logic runs. This dwarfs the ~1ms keyword block and the ~6ms regex. Not a regression (pre-existing, not changed), but worth tracking separately for future optimization (fast-path bash-only extraction or caching the `jq`-vs-`node` decision). Do NOT block this PR on it.

**`plan` keyword vs `## Goal`/`## Steps`/`## Files` plan detection naming overlap** — `scripts/hooks/preamble:55,65`
**Confidence**: 65% (Consistency reviewer)
- Both the `plan` keyword path (-> `devflow:plan`) and the structured-plan path (-> `devflow:implement`) carry the word "plan" but route to different skills. A prompt starting `plan ...` with all three markers would take the keyword branch, routing to `devflow:plan` rather than `devflow:implement`. This is consistent with ADR-013 but the shared "plan" terminology is a latent naming trap. Add a one-line code comment.

---

## Architecture & Design Assessment

**Positive findings (no action required):**

- **LLM-vs-plumbing boundary preserved** (`applies ADR-008`): The hook performs only structural detection (whitelist match on first token) and emits a fixed directive from the validated `$SKILL` value. All judgment is delegated to the model.
- **Injection mechanism reuse**: Both detection paths terminate in the same `json_prompt_output` helper, maintaining consistent `additionalContext` injection design.
- **Clean separation of concerns**: Keyword and marker paths are mutually exclusive if/elif/else branches; `SKILL` is only consumed inside the keyword branch.
- **No user text leaks into the directive**: Built solely from the whitelisted `$SKILL` constant, never from `$REST` or user text — confirmed by security fuzz suite.
- **Security model is sound by construction**: Untrusted `$PROMPT` is never interpolated into the emitted JSON. Only validated `$SKILL` (one of five hardcoded literals) is included. Tested with hostile payloads including backticks, `$(...)`, command substitution, 200KB strings.
- **Test suite covers four risk dimensions** (`applies ADR-014`): Functionality (all 5 keywords, case-insensitivity, guards), API contract (JSON shape), security/fuzz (8 hostile payloads + 200KB), performance (length-independence). 37 tests, all passing.

---

## Convergence Status

**Cycle**: 1 (first review)
**Prior Resolution**: N/A (first cycle)
**FP Ratio**: N/A
**Assessment**: First review — no convergence data yet. Feature is well-understood and blocking issues are localized (1 HIGH + 4 MEDIUM, all low-complexity fixes). Recommend fix and re-review cycle 2.

---

## Action Plan

1. **Fix the HIGH performance issue** (line 62): Bound the trailing-`?` guard to a 32-byte tail window when a keyword matched, and correct the inaccurate comment about regex efficiency.
2. **Fix the stale in-file header** (lines 3-5): Update to describe both detection paths.
3. **Align directive phrasing** (line 67): Remove the internal `EXECUTION_PLAN detected` token from the plan-path user-facing text.
4. **Update README tagline** (line 3): Broaden to mention both keyword and plan detection.
5. **Add test case for multi-punct boundary** (test file): Pin the "one trailing punct only" contract.
6. **Optionally add leading-whitespace match test**: Cover the leading-strip on the positive side.
7. **Optionally update ADR-013**: Append a follow-up ADR or edit the body to reconcile with shipped behavior.

After these fixes, approval is straightforward. The feature is solid: architecture is clean, security is correct, tests are comprehensive, and docs are accurate (once updated). The blocking issues are all quick, local fixes.

---

## Summary by Reviewer

| Focus | Score | Status |
|-------|-------|--------|
| Security | 9/10 | APPROVED — injection threat correctly mitigated by design |
| Architecture | 9/10 | APPROVED — clean separation, LLM/plumbing boundary preserved |
| Performance | 7/10 | CHANGES_REQUESTED — fix HIGH trailing-`?` regex issue + comment |
| Complexity | 8/10 | APPROVED_WITH_CONDITIONS — fix stale scope documentation on line 62 |
| Consistency | 8/10 | APPROVED_WITH_CONDITIONS — fix stale file header + align directive style |
| Regression | 9/10 | APPROVED_WITH_CONDITIONS — fix stale header comment |
| Testing | 8/10 | APPROVED — add multi-punct boundary test case |
| Reliability | 9/10 | APPROVED — bounded work, exit-0, no-abort discipline confirmed |
| TypeScript | 9/10 | APPROVED — well-typed, correct resource cleanup |
| Documentation | 8/10 | APPROVED_WITH_CONDITIONS — fix README tagline + header comment |

</content>
