# Testing Review Report

**Branch**: feat-init-flow-simplification -> main (PR #232)
**Date**: 2026-06-01_1725
**Scope**: `src/cli/plugins.ts`, `src/cli/commands/init.ts`, `tests/plugins.test.ts`

## Executive Summary

The new tests for `partitionSelectablePlugins` are well-designed and behavior-focused. They cover
every dimension the prompt asked about: bucketing (workflow/language), exclusions, immutability,
source-order preservation, disjointness, completeness (workflow + language = all selectable), and
empty input. `npx vitest run tests/plugins.test.ts` passes 39/39.

The pure, deterministic logic (`partitionSelectablePlugins`, `WORKFLOW_ORDER`) was correctly
extracted into `plugins.ts` and is thoroughly tested. The one genuine gap is that the **interactive
two-step selection loop in `init.ts` (bounded retry, `isCancel`, empty-bucket skip, combine logic)
was NOT extracted** into a testable function — it lives inline in the command action and is only
verified statically. This is a real but MEDIUM-severity gap given the @clack interactive dependency.

There is one substantive correctness concern in the WORKFLOW_ORDER regression guard: it is
**directionally asymmetric** and would not catch every kind of "dropped command" the comment claims.

---

## Issues in Your Changes (BLOCKING)

None. No blocking test-quality defects in the changed lines.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Interactive two-step selection loop is untested — logic not extracted for testability** — `src/cli/commands/init.ts:322-373`
**Confidence**: 88%
- Problem: The new selection-loop logic — bounded retry (`MAX_ATTEMPTS = 3`), empty-bucket skip
  (`if (workflowChoices.length > 0)` / `if (languageChoices.length > 0)`), `isCancel` handling,
  and the `combined = [...workflowSelected, ...languageSelected]` / `combined.length > 0` accept
  condition — is implemented inline inside the command action, directly interleaved with
  `p.multiselect()` / `p.isCancel()` / `process.exit()` calls. None of it is unit-tested. The
  testable decision logic was not separated from the @clack I/O, so the only verification is static
  reading. `tests/init-logic.test.ts` extracts and tests sibling helpers (`parsePluginSelection`,
  `computeGitignoreAppend`, `mergeDenyList`, etc.), which sets the precedent that this logic should
  have been extracted too.
- Impact: Three behaviors carry real regression risk with zero test coverage:
  (1) the retry-then-cancel boundary (does attempt 3 with empty selection actually exit vs loop
  forever?), (2) the empty-bucket skip (if `workflowChoices` is empty, is `workflowSelected`
  correctly left `[]` rather than blocking?), and (3) the combine/accept rule. A refactor of any
  of these would not fail any test.
- Fix: Extract a pure reducer, e.g.
  `combineSelection(workflowSelected: string[], languageSelected: string[]): { plugins: string[]; accepted: boolean }`,
  and a `shouldRetry(attempt, maxAttempts, accepted)` predicate. Unit-test the accept condition
  (non-empty combine), the empty-both-buckets case, and the bounded-retry exhaustion. Leave only
  the `p.multiselect`/`isCancel`/`exit` plumbing inline. This mirrors the existing
  `parsePluginSelection` extraction pattern and keeps the @clack flow (genuinely hard to unit-test)
  as the only untested seam. Note the @clack interactive path itself is reasonably left untested —
  the issue is that the *decision* logic was not separated from it.

**WORKFLOW_ORDER regression guard is directionally asymmetric — comment overstates coverage** — `tests/plugins.test.ts:400-412`
**Confidence**: 82%
- Problem: The test labeled "every workflow plugin command appears in WORKFLOW_ORDER (regression
  guard)" iterates `workflow` plugins and asserts each plugin command is present in
  `WORKFLOW_ORDER`. This catches "command added to a plugin but forgotten in WORKFLOW_ORDER". It
  does NOT catch the symmetric case the prompt asks about — a command *dropped* from a plugin while
  also dropped from WORKFLOW_ORDER, or a stale/renamed entry left *in* WORKFLOW_ORDER that no longer
  maps to any plugin command. The set membership is one-directional (plugin commands ⊆
  WORKFLOW_ORDER), never the reverse (WORKFLOW_ORDER entries ⊆ known commands).
- Impact: For the specific `/bug-analysis` scenario: dropping it from WORKFLOW_ORDER while the
  plugin still declares it *would* be caught here (good), and is *also* caught by the explicit
  `contains('/bug-analysis')` test at line 389. But the regression guard as written cannot catch a
  WORKFLOW_ORDER entry that drifts out of sync in the reverse direction (e.g., `/audit-claude` is in
  WORKFLOW_ORDER but its plugin is excluded from the `workflow` bucket, so a typo'd or stale
  WORKFLOW_ORDER entry for an excluded/nonexistent command goes undetected).
- Fix: Add the reverse-direction assertion. Build the set of all known command strings from
  `DEVFLOW_PLUGINS.flatMap(p => p.commands)` and assert every `WORKFLOW_ORDER` entry is a known
  command. Together with the existing forward check this makes the guard bidirectional and would
  catch stale/typo'd entries. (The forward guard correctly excludes `/audit-claude` since it is not
  in the workflow bucket; the reverse guard must allow it because it is intentionally in
  WORKFLOW_ORDER — assert membership in the full command set, not the workflow-bucket set.)

---

## Pre-existing Issues (Not Blocking)

None relevant to this scope.

---

## Suggestions (Lower Confidence)

- **`partitionSelectablePlugins` immutability test is shallow** — `tests/plugins.test.ts:362-366`
  (Confidence: 70%) — `expect(DEVFLOW_PLUGINS).toEqual(inputCopy)` where `inputCopy = [...DEVFLOW_PLUGINS]`
  is a shallow copy of the same element references. It verifies the array isn't reordered/mutated but
  not that nested `commands`/`skills` arrays are untouched. The function only reads, so risk is low;
  a structural deep-equal snapshot would harden it.
- **Order-preservation test recomputes the expected order with the same predicate as the implementation**
  — `tests/plugins.test.ts:368-379` (Confidence: 65%) — The expected `registryWorkflowOrder` is derived
  with `filter(commands.length > 0)`, the exact predicate the implementation uses. This couples the test
  to the implementation's classification rule rather than asserting against an independent expected
  ordering, so a shared bug in the predicate would pass both. A hardcoded expected name sequence would
  be a stronger oracle.
- **No assertion that `workflow` and `language` together exclude duplicates across buckets at the
  element level** (Confidence: 62%) — Disjointness is tested by name (line 354-360); fine in practice
  since plugin names are unique, but an explicit total-count-vs-unique-name check would be marginally
  stronger.

---

## Coverage Assessment vs. Prompt Checklist

| Dimension asked about | Covered? | Test |
|----------------------|----------|------|
| Buckets (workflow / language) | Yes | lines 312-338 |
| Exclusions (core-skills / ambient / audit-claude in neither) | Yes | lines 340-346, 194-201 |
| Immutability (input not mutated) | Yes (shallow) | lines 362-366 |
| Source-order preservation | Yes (impl-coupled oracle) | lines 368-379 |
| Disjointness | Yes | lines 354-360 |
| Empty input | Yes | lines 381-385 |
| Completeness (workflow+language = selectable) | Yes | lines 348-352 |
| WORKFLOW_ORDER drop of /bug-analysis caught? | Partially — caught by explicit `contains` test (389) and forward guard; reverse-direction drift NOT caught (400-412) | — |
| Behavior-focused, not impl-coupled? | Mostly yes; two order/immutability tests lean toward impl coupling | — |
| Interactive loop logic testable/tested? | No — inline in init.ts, only static verification | MEDIUM finding above |

---

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The `partitionSelectablePlugins` test suite is strong and the function was properly extracted. Two
should-fix items remain: (1) extract and unit-test the interactive selection-loop decision logic
(the @clack flow itself is fairly left untested, but the bounded-retry/empty-bucket/combine logic
should not be), and (2) make the WORKFLOW_ORDER regression guard bidirectional so it catches stale
or dropped entries in both directions. Neither blocks merge.
