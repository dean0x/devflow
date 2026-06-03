# Architecture Review Report

**Branch**: feat/ambient-keyword-trigger -> main
**Date**: 2026-06-02_1826
**Focus**: Architecture (PR #235)

## Summary Assessment

The change adds a first-word workflow-keyword detection path to `scripts/hooks/preamble`,
ahead of the existing 3-marker plan-detection path. Architecturally the change is **sound**.
It preserves the LLM-vs-plumbing boundary (applies ADR-008), reuses the existing
`json_prompt_output` injection mechanism for consistency with ambient-mode architecture, and
keeps the two detection concerns cleanly separated in a single mutually-exclusive if/elif/else
chain. No SOLID, coupling, or layering violations were found in the changed lines.

There are no blocking issues. Two MEDIUM observations relate to a benign divergence from
ADR-013 (stale ADR) and a minor structural duplication. One low-confidence suggestion follows.

---

## Issues in Your Changes (BLOCKING)

None.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Implementation diverges from ADR-013 (scope: 5th keyword + directive vs word-replacement)** — `scripts/hooks/preamble:36-67`
**Confidence**: 90%
- Problem: `applies ADR-013` documents the redesign as **four** keywords
  (`implement/explore/research/debug`) that "replace only that word with the corresponding
  devflow skill invocation." The shipped code instead (a) adds a **fifth** keyword `plan`
  (line 55), and (b) injects an `additionalContext` directive via `json_prompt_output`
  (line 64) rather than performing literal first-word text replacement. The directive
  approach is the architecturally correct choice — `UserPromptSubmit` hooks have no
  supported "rewrite the user's prompt" channel, so `additionalContext` injection is the
  only mechanism consistent with the existing marker path (line 67) and the broader
  ambient-mode architecture. The divergence is an improvement, not a regression.
- Impact: The decision record no longer matches the implementation, which undermines the
  value of the ADR as a source of truth. This is a documentation-consistency issue, not a
  code defect. The project CLAUDE.md and the PR description already describe the correct
  5-keyword + directive design, so only the ADR body is stale.
- Fix: Append a follow-up note or a superseding ADR clarifying that (1) `plan` was added as a
  fifth keyword, and (2) the mechanism is `additionalContext` directive injection, not literal
  word replacement. No code change required.

**Marker-detection condition is duplicated logic, now split across the diff boundary** — `scripts/hooks/preamble:65`
**Confidence**: 82%
- Problem: The 3-marker guard
  `[[ "$PROMPT" == *"## Goal"* ]] && [[ "$PROMPT" == *"## Steps"* ]] && [[ "$PROMPT" == *"## Files"* ]]`
  is a single compound predicate that encodes the "is this a structured execution plan?"
  concern. It is fine as one `elif`, but the keyword block (lines 36-58) computes
  `HEAD/TOKEN/REST/WORD/SKILL` as an inline sequence of parameter expansions directly in the
  hook body rather than in a named helper. Mixing two distinct detection strategies inline in
  the top-level control flow makes the hook body responsible for both "parse the first token"
  and "scan for plan markers" — two reasons to change (SRP pressure). As more ambient
  detection paths are added, this if/elif chain will accumulate inline parsing logic.
- Impact: Low immediate risk (the block is small, well-commented, and correct). The concern is
  future maintainability: the hook body is trending toward a god-script for ambient detection.
- Fix: Optional refactor — extract first-word keyword detection into a small sourced helper
  (e.g. `detect_workflow_keyword "$PROMPT"` setting `SKILL`) mirroring how the sidecar hooks
  source `eval-*` modules. Keeps the top-level control flow to three readable branches and
  isolates the bash-3.2 parameter-expansion details. Not required for this PR.

---

## Pre-existing Issues (Not Blocking)

None of architectural significance. The if/elif/else structure, the `set -e` discipline, the
`json_prompt_output` helper, and the CWD guard predate this change and remain correct.

---

## Suggestions (Lower Confidence)

- **Keyword whitelist will drift from the skill roster** — `scripts/hooks/preamble:50-57`
  (Confidence: 65%) — The `case` arms hardcode the five workflow skill names. If a new
  orchestration workflow skill is added (or one renamed), this list must be updated manually
  with no compile-time link to the actual `devflow:*` skill set. Consider a brief source
  comment cross-referencing the canonical workflow-skill list so the coupling is explicit.

---

## Architecture Notes (Positive Findings)

These confirm the change is architecturally consistent — no action needed:

- **LLM-vs-plumbing boundary preserved** (`applies ADR-008`): the hook performs only structural
  detection (whitelist match on the first token) and emits a fixed directive built from the
  whitelisted `$SKILL` value. All judgment — announcing the workflow, invoking the skill,
  passing the task text — is delegated to the model. No detection/authoring judgment lives in
  shell. Consistent with the KNOWLEDGE.md plumbing/LLM split.
- **Injection mechanism reuse**: both detection paths terminate in the same
  `json_prompt_output` helper (`scripts/hooks/json-parse:212`), which JSON-encodes via
  `jq --arg` / node. This is the same `additionalContext`/`UserPromptSubmit` contract the
  existing marker path uses — directive-injection design is consistent with ambient-mode
  architecture.
- **Clean separation of the two detection concerns**: keyword path and marker path are mutually
  exclusive branches of one if/elif/else; keyword wins by ordering (verified by test F8). No
  shared mutable state between the branches; `SKILL` is only consumed inside the first branch.
- **No user text leaks into the directive**: the directive is built solely from the whitelisted
  `$SKILL` constant, never from `$REST`/`$TOKEN`/free user text — so the security-fuzz suite's
  "output equals fixed template" assertion holds at the architecture level too. Defense aligns
  with `avoids PF-007`-adjacent source-first discipline (change is in `scripts/hooks/`, the
  source of truth, not an installed copy).

---

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 9
**Recommendation**: APPROVED
