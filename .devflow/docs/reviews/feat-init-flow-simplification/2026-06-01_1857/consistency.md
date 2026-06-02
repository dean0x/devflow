# Consistency Review Report

**Branch**: feat/init-flow-simplification -> main
**PR**: #232
**Date**: 2026-06-01_1857

## Summary of Analysis

Reviewed the init-flow simplification against existing `init.ts` / `plugins.ts` conventions
(clack prompt patterns, helper naming, export style, JSDoc style). The changes are
notably consistent with the surrounding codebase — the new code reads like the old code.

Cross-referenced against `DECISIONS_CONTEXT`: both relevant decisions directly bless this PR.
- **applies ADR-010** — scope-prompt removal keeps `--scope` flag + non-TTY auto-detection (diff `init.ts` retains both `options.scope` and `!process.stdin.isTTY` branches, only the interactive `p.select` scope prompt was deleted).
- **applies ADR-011** — two-step workflow/language multiselect partitioned by the pure `partitionSelectablePlugins` helper, exactly as the decision specifies.

Cross-referenced against feature knowledge `cli-rules/KNOWLEDGE.md` (verified current, not stale
in the touched areas): the helper placement (`combineSelection`/`shouldRetry` in `init.ts`,
`partitionSelectablePlugins`/`WORKFLOW_ORDER` in `plugins.ts`) matches the documented convention verbatim.

Cross-cycle awareness (PRIOR_RESOLUTIONS, cycle 2): the two prior false positives — (1) the test
re-declaring the `EXCLUDED` set as an independent oracle, and (2) a precondition assert for the
both-empty buckets case — were NOT re-raised. Verified neither was re-introduced by new code.

### Consistency checks passed

- **Naming** — `combineSelection`, `shouldRetry`, `partitionSelectablePlugins` are camelCase, matching existing helpers `buildAssetMaps`, `buildRulesMap`, `getAllRuleNames`, `isValidRuleName`.
- **Export style** — `export const WORKFLOW_ORDER: string[]` carries an explicit `string[]` annotation, matching the sibling exports `LEGACY_COMMAND_NAMES: string[]`, `LEGACY_SKILL_NAMES: string[]`, `LEGACY_RULE_NAMES: string[]`. (Note: the old inline `const WORKFLOW_ORDER` had no annotation — the moved/exported version is *more* consistent with module conventions, not less.)
- **clack prompt patterns** — both new `p.multiselect` steps follow the identical `isCancel → p.cancel(...) → process.exit(0)` shape used by every other prompt in the file.
- **pluginHints ordering** — Record key order (plan, implement, code-review, resolve, debug, explore, research, release, self-review, bug-analysis) exactly mirrors `DEVFLOW_PLUGINS` declaration order, which is what actually drives display via `partitionSelectablePlugins` (order-preserving). Functionally correct; not WORKFLOW_ORDER-keyed, and does not need to be.
- **WORKFLOW_ORDER `/bug-analysis` placement** — inserted after `/self-review`, consistent with the JSDoc-described pipeline order and asserted by the new regression-guard tests.
- **Test conventions** — new `describe`/`it` blocks match existing structure, message style, and `expect` assertion patterns in both test files.

### Justified deviation (not a finding)

- The two new multiselects use `required: false` whereas the removed single multiselect used `required: true`. This is a necessary and intentional change: empty-selection enforcement moved into the bounded retry loop via `combineSelection().accepted` + `shouldRetry`. It also aligns with the existing flags multiselect, which already uses `required: false`. Justified per the Iron Law (deviation has explicit rationale, documented inline and in ADR-011).

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None at CRITICAL severity (per Iron Law, only CRITICAL pre-existing issues are reported).

## Suggestions (Lower Confidence)

- **JSDoc "pure function" tagline phrasing varies slightly** — `src/cli/commands/init.ts:127` and `:142` say "Pure function — no I/O, no side effects; extracted for testability." while `src/cli/plugins.ts:716` says "Pure function — does not mutate the input array; ... deterministic; no I/O." (Confidence: 65%) — Same intent, minor wording drift across the three new pure helpers. Harmonizing the phrasing would marginally improve consistency, but this is style-preference territory and below the bar for a tracked finding.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 9/10
**Recommendation**: APPROVED
