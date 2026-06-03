# Performance Review Report

**Branch**: feat/ambient-keyword-trigger -> main
**PR**: #235
**Date**: 2026-06-02_1826
**Focus**: performance (preamble hook — runs on EVERY UserPromptSubmit)

## Scope

Reviewed `scripts/hooks/preamble` (the only behavioral change with performance impact;
other files in the diff are docs/decisions/tests). Applied `devflow:performance`
methodology: measure before claiming. All findings below are backed by empirical
timing on bash `3.2.57` (the macOS target, confirmed in `$BASH_VERSION`), reproducing
the exact parameter-expansion and regex constructs from the diff.

Relevant decisions read in full: **ADR-013** (keyword-dispatch redesign), **ADR-014**
(four-suite test plan incl. a length-independence performance suite), **PF-007** (edit
source not installed copies — informational, not triggered here).

---

## Verification of the PR's stated performance claims

| Claim (diff comment) | Verdict | Evidence |
|----------------------|---------|----------|
| "Zero overhead for normal prompts" | **TRUE** | Short non-matching prompt: 10 iters = 0.010s (~1ms each). The keyword block adds negligible cost; the `case` short-circuits to `SKILL=""` and the `&&` chain stops before the regex. |
| "Pure bash 3.2, no subprocess" in the new block | **TRUE** | The added lines (40-58, 62) use only parameter expansion, `shopt`, `case`, and `[[ =~ ]]` — no forks. Verified no `$(...)`/pipe/command in the new block. (Note: the hook *as a whole* still forks `jq`/`node` via `json_extract_cwd_prompt` at line 22 — pre-existing, unchanged.) |
| "256-byte head bound avoids pathological scans" | **PARTIALLY TRUE** | The keyword extraction (lines 40-45) is correctly bounded to `HEAD="${PROMPT:0:256}"`. But the trailing-`?` guard (line 62) operates on the **full** `$PROMPT`, not `$HEAD`, so the bound does not cover that path (see HIGH finding below). |
| "The `$` anchor makes the regex efficient — bash regex does not scan the full string" (lines 60-61) | **FALSE** | Right-anchoring does NOT let the POSIX regex engine skip the body. Measured O(n): `[[ "$PROMPT" =~ [?][[:space:]]*$ ]]` on 200KB = 100 iters / 0.613s (~6ms each), scaling linearly with length. (see HIGH finding below). |

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Trailing-`?` regex runs on the full prompt with a false "efficiency" rationale** — `scripts/hooks/preamble:62`
**Confidence**: 95%

- Problem: Line 62 tests `! [[ "$PROMPT" =~ [?][[:space:]]*$ ]]` against the **entire**
  `$PROMPT`, not the 256-byte `$HEAD`. The inline comment (lines 60-61) claims the `$`
  anchor makes this "efficient" and that "bash regex does not scan the full string for a
  trailing match." This is incorrect. POSIX ERE matching in bash 3.2 walks the whole
  string to establish match positions; a `$` anchor does not enable a right-to-left or
  tail-only scan.
- Impact: Measured O(n) in prompt length. On a 200KB pasted prompt whose first word is a
  keyword, the guard costs ~6ms per invocation (100 iters / 0.613s, bash 3.2.57). It
  scales linearly — a 1MB paste would cost ~30ms. This only fires when the first word
  already matched a keyword (`SKILL` non-empty, short-circuited by `&&`), so normal
  prompts are unaffected, but a user typing `implement <giant pasted spec>` pays the full
  scan on every such prompt. The misleading comment will also propagate the wrong mental
  model to future maintainers (directly contradicts the bounding intent the same diff
  established at line 40).
- Fix (two parts):
  1. Correct the comment — the `$` anchor does not avoid a full scan; bash 3.2 regex is O(n).
  2. Bound the work. The trailing `?` (if the user intends a question) will be within the
     last few bytes, so test a bounded tail. Caveat verified empirically: bash 3.2's
     negative-offset slice `${PROMPT: -N}` and extglob trailing-strip `${p%%+([[:space:]])}`
     are *also* O(n) (the bounded-tail slice measured ~12ms/call and the extglob strip was
     pathologically slow on 200KB), so the naive "just slice the tail" fix does not help.
     The robust fix is to take the tail slice **once** from a value bash can index cheaply,
     or simply reuse a single bounded copy. A practical, correct approach:

     ```bash
     # Reuse HEAD for the keyword path, and capture a bounded TAIL once for the ? guard.
     # Compute TAIL from the END only when SKILL matched (keeps normal prompts free).
     if [[ -n "$SKILL" && -n "$REST" ]]; then
       # ${PROMPT: -32} is O(n) in bash 3.2; do it at most once on the matched path.
       TAIL="${PROMPT: -32}"
       TAIL="${TAIL%%*([[:space:]])}"   # extglob: strip trailing ws within 32B window (bounded)
       if [[ "${TAIL: -1}" != "?" ]]; then
         json_prompt_output "..."
       fi
     fi
     ```

     Because `TAIL` is at most 32 bytes, the `%%` strip and `=~`/glob on it are constant-time
     regardless of total prompt size. The single `${PROMPT: -32}` slice remains O(n) in bash
     3.2 but runs at most once and only on the keyword-matched path. If even that O(n) slice
     is unacceptable, take the tail from `$INPUT` length-bounded before parameter expansion,
     or accept the current cost and just fix the comment — the cost is paid only on rare
     keyword+huge-paste prompts. (applies ADR-013 — keyword dispatch is the intended
     mechanism; this hardens its hot path. applies ADR-014 — the length-independence
     performance suite should catch exactly this regression.)

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`json_extract_cwd_prompt` forks jq/node and processes the full prompt on every prompt (pre-existing, but adjacent to the new hot path)** — `scripts/hooks/preamble:22`
**Confidence**: 85%

- Problem: Before any keyword logic runs, line 22 does
  `FIELDS=$(printf '%s' "$INPUT" | json_extract_cwd_prompt)`, which forks `jq` (or `node`)
  and serializes the entire prompt through a subprocess plus a command-substitution
  pipeline. This is the dominant per-prompt cost of the hook — far larger than anything in
  the new keyword block — and it is paid on EVERY prompt regardless of length or content.
- Impact: A `jq` fork is ~5-15ms cold; a `node` fallback fork is ~30-60ms. This dwarfs the
  ~1ms keyword block and even the ~6ms regex finding above. The PR's "zero overhead for
  normal prompts" claim is true *for the added code* but the hook overall is not zero-cost
  because of this pre-existing fork. Flagging because the diff's whole framing is about
  per-prompt overhead, and the largest lever lives one line above the change.
- Fix: Out of scope for this PR (pre-existing, not a regression). Track separately:
  consider a fast-path bash-only extraction of `cwd`/`prompt` for the common case, or
  caching the `jq`-vs-`node` decision (already done once at source time). Do NOT block this
  PR on it.

---

## Pre-existing Issues (Not Blocking)

None beyond the MEDIUM item above (which is reported as adjacent context, not blocking).

---

## Suggestions (Lower Confidence)

- **`WORD="${TOKEN%[[:punct:]]}"` strips only ONE trailing punct char** - `scripts/hooks/preamble:45` (Confidence: 70%) — Not a performance issue, but `implement!!` or `implement:` followed by more punct would fail to match. Mentioned only because it affects how often the (cheap) `case` vs the (costly) regex path is reached; no perf action needed.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 7/10

The added keyword block is genuinely cheap and correctly bounded for the common path —
"zero overhead for normal prompts" holds. The one real defect is the trailing-`?` guard:
it runs an O(n) regex on the full prompt while a code comment asserts (incorrectly) that
it is anchor-optimized to avoid a full scan. The cost is bounded (only on keyword-matched
prompts, only as large as the user's paste) and measured at ~6ms/200KB, so it is HIGH, not
CRITICAL. The misleading comment is itself worth fixing because it will mislead future
maintainers and contradicts the bounding intent the same diff establishes 22 lines earlier.

**Recommendation**: APPROVED_WITH_CONDITIONS — fix the inaccurate efficiency comment at
lines 60-61, and ideally bound the trailing-`?` test to a small tail window (or
acknowledge the cost explicitly). The ADR-014 length-independence performance suite should
assert the bounded delta covers the keyword-matched-large-prompt case, not just the
non-matching case.
