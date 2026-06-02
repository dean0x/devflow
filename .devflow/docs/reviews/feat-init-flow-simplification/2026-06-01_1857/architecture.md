# Architecture Review Report

**Branch**: feat/init-flow-simplification -> main
**PR**: #232
**Date**: 2026-06-01_1857

## Summary Assessment

This is a clean, well-factored refactor. The two new pure helpers (`combineSelection`,
`shouldRetry` in init.ts; `partitionSelectablePlugins`, `WORKFLOW_ORDER` in plugins.ts) follow
good separation-of-concerns: pure decision logic is extracted from the I/O-bound prompt loop,
making it independently testable. The implementation faithfully matches the documented decisions
(applies ADR-010, applies ADR-011) and the `cli-rules` feature knowledge partition assumptions.
Prior-cycle false positives (test re-declaring EXCLUDED; both-empty precondition assert) are not
re-raised — verified still correct against current code.

No blocking architectural issues found.

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

## Pre-existing Issues (Not Blocking)

None of CRITICAL severity in untouched lines. The `init` action handler is a very large function
(~1150 lines), which is a pre-existing god-function concern, but the diff does not meaningfully
worsen it — the new logic was extracted into pure helpers rather than inlined, which slightly
improves the situation. Informational only; not blocking per the Iron Law.

## Suggestions (Lower Confidence)

- **Duplicated `EXCLUDED` exclusion set across modules** - `src/cli/plugins.ts:723` (Confidence: 65%)
  — `partitionSelectablePlugins` defines `EXCLUDED = {core-skills, ambient, audit-claude}` as the
  authoritative selectable-plugin filter, but downstream init logic re-derives core-skills/ambient
  membership separately (e.g. `init.ts:964`, `init.ts:969` re-`find` those plugins to force-install
  them). These are conceptually the same "always-installed / not-user-selectable" classification
  expressed in two places. Consider a single `category` or `selectable` field on `PluginDefinition`
  as the single source of truth (the helper's own comment at plugins.ts:732-735 anticipates exactly
  this). Lower confidence because the two uses serve different purposes (selection filtering vs.
  forced-install) and consolidating is a broader change than this PR's scope. avoids PF-005 (the
  capability — a category field — does not yet exist, so verify before assuming).

- **`partitionSelectablePlugins` couples "language" semantics to "command-less"** -
  `src/cli/plugins.ts:729` (Confidence: 62%) — The bucket predicate is `commands.length > 0 ?
  workflow : language`, which is a structural proxy for a semantic category. The inline comment
  (plugins.ts:732-735) already documents this as an intentional, acknowledged simplification and
  flags the future-proofing path. Matches the `cli-rules` KNOWLEDGE.md documented pattern
  (workflow plugins carry commands; language plugins carry only rules). Noted as a watch-item, not
  a defect — flagging only because the "language" label will silently mis-bucket any future
  command-less non-language plugin. The code already calls this out, so no action needed now.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 1 |

**Architecture Score**: 9
**Recommendation**: APPROVED

## Decision Alignment Notes

- **applies ADR-010** — Interactive scope prompt removed; `scope` hardcoded to `'user'` for the
  interactive TTY path (init.ts:210), `--scope` flag retained and validated (init.ts:215-221),
  non-TTY auto-detection unchanged (init.ts:222-224). Implementation matches decision intent.
- **applies ADR-011** — Plugin selection split into two sequential `p.multiselect` calls (Step 1
  Workflow init.ts:355, Step 2 Language init.ts:371), partitioned by the pure
  `partitionSelectablePlugins` helper. Combined non-empty validation via `combineSelection`
  + bounded re-prompt (`MAX_ATTEMPTS = 3`, `shouldRetry`) — no custom grid. Matches decision intent.
- Bounded loop satisfies the reliability rule (no unbounded `while(true)`); exit-on-exhaustion is
  handled by `shouldRetry` before the `while` condition re-evaluates, so there is no silent
  fall-through with an empty `selectedPlugins` (verified init.ts:349-395).
- `WORKFLOW_ORDER` is exported and consumed read-only (`.filter`/`.indexOf`/Set membership only) —
  no shared-mutable-state coupling risk. Bidirectional regression guards in tests are solid.
