# Security Review Report

**Branch**: feat/ambient-keyword-trigger -> main (PR #235)
**Date**: 2026-06-02_1826
**Focus**: security
**Diff**: `git diff main...HEAD` (scripts/hooks/preamble + tests/shell-hooks.test.ts)

## Verdict (TL;DR)

The change is **safe by construction** against the primary threat (prompt injection
into the JSON directive output). The untrusted user `PROMPT` is **never interpolated**
into the emitted directive — only a validated `$SKILL` value (one of five hardcoded
literals: `implement`, `explore`, `research`, `debug`, `plan`) is interpolated. JSON
escaping is delegated to `jq --arg` / `JSON.stringify` in `json_prompt_output`. I ran
the documented hostile payloads through the live hook and confirmed exit 0, valid JSON,
and a fixed template with zero user-text leakage.

No CRITICAL or HIGH findings. Two LOW informational items below.

---

## Issues in Your Changes (BLOCKING)

None.

---

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

---

## Pre-existing Issues (Not Blocking)

None relevant to this diff.

---

## Suggestions (Lower Confidence)

- **`?`-guard regex scans the full unbounded `$PROMPT`, defeating the 256-byte bound on that path** — `scripts/hooks/preamble:62` (Confidence: 75%) — The keyword detection (lines 40-58) is correctly bounded to `HEAD="${PROMPT:0:256}"`, but Guard B `[[ "$PROMPT" =~ [?][[:space:]]*$ ]]` matches against the **full** `$PROMPT`. I measured ~190-380ms on 500k-1M char prompts. This is **linear, not ReDoS** — the anchored `[?][[:space:]]*$` ERE has no catastrophic backtracking (verified with pathological trailing-whitespace and interior-`?` payloads; all scaled linearly). It only runs after a keyword already matched in the first 256 chars, and the JSON parse already scans the full prompt anyway (the test's own P2/P3 methodology comment acknowledges this). Net DoS exposure is negligible for a local UserPromptSubmit hook. Optional hardening: anchor the question check on a bounded tail, e.g. `TAIL="${PROMPT: -16}"; [[ "$TAIL" =~ [?][[:space:]]*$ ]]`, so no path touches the full string.

- **"256 bytes" comment is actually 256 characters in a UTF-8 locale** — `scripts/hooks/preamble:37,40` (Confidence: 80%) — `${PROMPT:0:256}` slices 256 **characters**, not bytes (I confirmed 300 CJK chars -> `HEAD` length 256 under `LANG=en_US.UTF-8`, i.e. ~768 bytes). This is a documentation inaccuracy only — the slice still bounds work and errs toward scanning *more* than claimed, so there is no security impact. Reword the comment to "256 characters" to avoid future confusion.

---

## Detailed Security Analysis (verification notes)

Per ADR-014 the change ships a four-suite test plan including a security/prompt-injection
fuzz suite (`tests/shell-hooks.test.ts:1271-1306`). I verified the substance, not just
the presence:

1. **No shell injection / no command substitution on the untrusted path.** Lines 40-45
   use only bash parameter expansion (`${PROMPT:0:256}`, `%%`, `#`, `%`) — no `$(...)`,
   no backticks, no `eval`, no unquoted expansion into a command. The `case` statement
   matches against a hardcoded allowlist; the `*)` arm sets `SKILL=""`. Confirmed test
   P1 enforces absence of `awk`/`sed`/`tr`/`$(` on code lines (`:1313-1336`).

2. **No injection into output.** The directive string at `:64` interpolates only
   `$SKILL` (validated literal). The user's prompt text is intentionally NOT included —
   the model is instructed to use "the text after the leading keyword" from its own
   context, so the hook never has to embed hostile text. Live test with
   `` `rm -rf /` $(whoami) " ${IFS} `` produced the exact fixed template, valid JSON,
   exit 0.

3. **Output escaping is correct in both backends.** `json_prompt_output` uses
   `jq -n --arg ctx` (jq path) and `JSON.stringify` (node path, `json-helper.cjs:518-527`).
   Both fully escape quotes, backslashes, and control chars. Since only the trusted
   `$SKILL` literal flows in, escaping is defense-in-depth rather than the sole control
   (aligns with the project's "validate at boundaries / defense in depth" posture).

4. **`set -e` safety.** All new parameter expansions and the `case` (with `*)` default)
   return 0; the regex at `:62` runs inside an `if` condition so its non-zero result
   does not abort under `set -e`. Verified empty, whitespace-only, bare-keyword,
   `?`-terminated, mixed-case, and trailing-punct prompts all exit 0 with correct
   emit/no-emit behavior.

5. **`nocasematch` scope is correctly balanced** (`shopt -s` at :49 / `shopt -u` at :58)
   — no leakage into the later `## Goal`/`## Steps`/`## Files` substring checks.

6. **PF-007 respected** — the edit is to the source file `scripts/hooks/preamble`, not
   the installed copy under `~/.devflow/scripts/`. (avoids PF-007)

7. **ADR-013 / ADR-014 alignment** — the first-word keyword dispatch and the four-suite
   test plan match the accepted decisions. (applies ADR-013, applies ADR-014)

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |
| Suggestions | - | - | - | 2 |

**Security Score**: 9/10
**Recommendation**: APPROVED

The injection threat model is handled correctly by design (non-interpolation of
untrusted input + delegated JSON escaping). The two suggestions are a minor
performance-bound nit and a comment wording fix — neither blocks merge.
