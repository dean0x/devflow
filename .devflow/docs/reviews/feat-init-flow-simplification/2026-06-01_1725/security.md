# Security Review Report

**Branch**: feat/init-flow-simplification -> main (PR #232)
**Date**: 2026-06-01_1725
**Scope**: `src/cli/plugins.ts`, `src/cli/commands/init.ts`, `tests/plugins.test.ts`
**Focus**: Input validation (plugin selection / `--plugin`), path handling, injection surface, secrets

## Summary of Assessment

This is a CLI refactor of the `devflow init` flow. The changes are: (1) removal of the
interactive scope `p.select()` prompt, (2) a new exported `WORKFLOW_ORDER` array (adds
`/bug-analysis`, moved from a function-local const), and (3) a new pure
`partitionSelectablePlugins()` function plus splitting one plugin multiselect into two
sequential multiselects wrapped in a bounded retry loop.

I traced the security-relevant data flows the prompt called out:

- **`--plugin` parsing** (`parsePluginSelection`, init.ts:108) — unchanged by this PR, but it
  is the upstream validator for the only user-controlled string that reaches plugin selection.
  It splits on `,`, normalizes, and **validates against an allowlist** (`validNames.includes`).
  Invalid names trigger `process.exit(1)`. The downstream consumer
  (`DEVFLOW_PLUGINS.filter(p => selectedPlugins.includes(p.name))`, init.ts:938-940) only ever
  yields registry plugin objects — no user string is interpolated into a path. Safe.
- **Interactive selection** — `partitionSelectablePlugins` returns slices of the static,
  hardcoded `DEVFLOW_PLUGINS` registry. The multiselect `value` fields are registry `pl.name`
  strings, never free-form user input. `selectedPlugins` therefore can only contain known
  plugin names. No injection surface introduced.
- **Path handling** — all `fs.mkdir`/path joins in the touched code (`claudeDir`, `devflowDir`,
  `pluginsDir`) derive from `getInstallationPaths(scope)` and `__dirname`, not from plugin
  selection. The `--scope local` mkdir path is computed from scope resolution, which is
  validated (`/^(user|local)$/i` at the Commander layer plus the explicit recheck at
  init.ts:190-195). Not affected by this refactor.
- **Secrets** — none introduced. No credentials, tokens, or `Math.random()` for security values
  in the diff.
- **`WORKFLOW_ORDER`** — a static array of literal command-name strings consumed only for
  display ordering (`p.note`). No injection or trust-boundary concern.

The refactor is security-neutral. The new `partitionSelectablePlugins` is a pure, side-effect-free
function operating on a trusted in-process registry. No new trust boundary, no new external input,
no new filesystem path derived from user data. The author also added a bounded retry loop
(`MAX_ATTEMPTS = 3`) which avoids an unbounded re-prompt loop (aligns with the reliability rule,
though that is a robustness rather than security property).

`avoids PF-005` — verified actual code rather than assuming the validator behavior:
`parsePluginSelection` was read directly to confirm allowlist enforcement.

## Issues in Your Changes (BLOCKING)

None. No security defects with >=80% confidence were found in the added/modified lines.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None at CRITICAL severity. (Per methodology, pre-existing non-critical issues in untouched lines
are not reported.) The `--plugin` validator and scope mkdir handling were reviewed as adjacent
trust boundaries and found sound.

## Suggestions (Lower Confidence)

None meeting the 60-79% bar. The change is a clean, well-tested refactor with strong unit
coverage for the new pure function (disjointness, completeness, no-mutation, ordering, empty
input) and `WORKFLOW_ORDER` (membership, dedup, regression guard against orphan commands).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 10
**Recommendation**: APPROVED
