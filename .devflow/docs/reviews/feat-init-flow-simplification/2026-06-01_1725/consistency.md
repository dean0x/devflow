# Consistency Review Report

**Branch**: feat/init-flow-simplification -> main (PR #232)
**Date**: 2026-06-01 17:25
**Scope**: `src/cli/plugins.ts`, `src/cli/commands/init.ts`, `tests/plugins.test.ts`

## Summary of Assessment

The PR splits the single plugin multiselect into a two-step Workflow/Language flow, extracts
`partitionSelectablePlugins` + `WORKFLOW_ORDER` into `plugins.ts`, and adds tests. Overall the
new code is **highly consistent** with surrounding conventions: the new helper matches the
signature/style of its sibling builders, the multiselect prompts reuse the established @clack
patterns, and the new tests mirror the existing `describe`/`it`/custom-message conventions exactly.
All 39 tests in `tests/plugins.test.ts` pass. Only minor (LOW) style observations were found; none
block the merge.

### Targeted question answers

- **Does `partitionSelectablePlugins` match the sibling helpers?** Yes. It uses the same
  `(plugins: PluginDefinition[])` parameter name and type as `buildAssetMaps`/`buildRulesMap`,
  the same exported-function + JSDoc-block style, the same object-return shape (`buildAssetMaps`
  also returns a named-property object), and the same `for (const plugin of plugins)` iteration
  idiom. The JSDoc is more thorough than siblings (documents purity/exclusions), which is an
  improvement, not an inconsistency.
- **Do the new multiselect prompts match existing @clack usage?** Yes. `p.multiselect`,
  `p.isCancel`, `p.cancel('Installation cancelled.')`, `process.exit(0)` all match the prior
  single-multiselect block and the flags multiselect later in the file.
- **Does `pluginHints` extension match tone/length?** Yes — short lowercase fragments, same
  comma-separated style and brevity as existing entries (one minor ordering nit below).
- **Do the new tests match `tests/plugins.test.ts` conventions?** Yes — top-level `describe`
  per export, `expect(value, 'message')` style, fixtures derived from `DEVFLOW_PLUGINS`.
- **Naming consistency (`WORKFLOW_ORDER`, `choices`, `initialValues`)?** Consistent. `choices`
  became `workflowChoices`/`languageChoices` and `initialValues`→`workflowInitialValues`, which
  is the correct disambiguation pattern; @clack option keys (`options`, `initialValues`) unchanged.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **`pluginHints` key order diverges from `DEVFLOW_PLUGINS` registry order** — `src/cli/commands/init.ts:283-302` (Confidence: 70%) — In the registry, workflow plugins are ordered `... debug, explore, research, release, self-review, bug-analysis`. In the `pluginHints` map the new entries place `bug-analysis` before `self-review` (`... debug, explore, research, release, bug-analysis, self-review, ...`). Because `pluginHints` is a key-based lookup, order is purely cosmetic and has zero behavioral impact, but aligning it with the registry order (and with `WORKFLOW_ORDER`, which also lists `self-review` before `bug-analysis`) would keep the three lists scannable side-by-side.

- **`workflowChoices` and `languageChoices` are byte-identical `.map` bodies** — `src/cli/commands/init.ts:306-316` (Confidence: 65%) — The two `.map(pl => ({ value, label, hint }))` blocks are duplicated verbatim. A single local helper (e.g. `const toChoice = (pl) => ({...})`) would remove the duplication. This is a mild DRY/style point, not a convention violation — the existing file already inlines similar small maps — so it is optional.

- **Test re-declares the implementation's `EXCLUDED` set** — `tests/plugins.test.ts:310` (Confidence: 62%) — The `partitionSelectablePlugins` describe defines a local `EXCLUDED` set that mirrors the constant inside the function under test (`plugins.ts:723`). This is an accepted "independent restatement of the contract" testing pattern and is fine; flagging only because the rest of this test file tends to derive expectations from `DEVFLOW_PLUGINS`/getter functions rather than restating literals. If the exclusion list ever changes, both copies must be updated.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 9
**Recommendation**: APPROVED

Notes:
- `WORKFLOW_ORDER` array order matches its own JSDoc comment (`self-review -> bug-analysis -> debug`)
  and the regression test (`/bug-analysis` after `/self-review`) — internally consistent.
- The bounded `MAX_ATTEMPTS = 3` selection loop with an inline reliability-rule comment is a new
  pattern in this file but aligns with the project's reliability rule (no unbounded loops); not a
  consistency violation.
- DECISIONS_CONTEXT: PF-005 and PF-007 reviewed; neither applies to a consistency defect in this
  diff (changes correctly edit `src/cli/` source, and the new helper does not duplicate an existing
  agent capability). No citation warranted.
