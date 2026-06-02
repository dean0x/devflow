# Regression Review Report

**Branch**: feat/init-flow-simplification -> main
**PR**: #232
**Date**: 2026-06-01 17:25
**Scope**: src/cli/plugins.ts, src/cli/commands/init.ts, tests/plugins.test.ts
**Diff command**: `git diff main...HEAD`

## Verdict Summary

No blocking regressions found. Every critical contract called out in the review
brief is intact. The build compiles (`npm run build:cli`) and all 39 plugins tests
pass. The one notable behavior change (interactive init can no longer choose `local`
scope) is intentional and documented in the design doc (AC1).

One important scope-accuracy note: the PR-context claim that the removed code was
"ONLY the interactive scope `p.select` else-block" is **inaccurate**. The diff also
refactors the plugin-selection multiselect into a two-step workflow/language flow
with a bounded retry loop. This is by design (design doc names "two-step plugin
selection" as an explicit goal), so it is not an accidental deletion — but reviewers
relying on the narrow scope statement should be aware the change surface is larger.

## Critical Contract Verification (from review brief)

| Contract | Status | Evidence |
|----------|--------|----------|
| `--scope user`/`--scope local` resolve | PRESERVED | init.ts:189-195 normalizes `options.scope`, unchanged |
| `--scope local` creates ./.claude + ./.devflow | PRESERVED | init.ts:914-921 `if (scope === 'local')` mkdir branch untouched |
| `options.scope` branch | PRESERVED | init.ts:189-195 |
| `!process.stdin.isTTY` non-TTY branch (default user + info log) | PRESERVED | init.ts:196-198 |
| `--hud-only` scope path | PRESERVED | init.ts:186-188 (user scope) + 202-268 (hud-only block) |
| `--plugin=<list>` / parsePluginSelection path | PRESERVED | init.ts:272-280, unchanged |
| Manifest records `scope` | PRESERVED | init.ts:1314 (`scope,` in manifestData); hud-only manifest at 257 |
| "Available commands" filters WORKFLOW_ORDER + includes /bug-analysis | PRESERVED + IMPROVED | init.ts:1256-1262 now uses imported `WORKFLOW_ORDER` (plugins.ts:701) which includes `/bug-analysis` |
| Removed code = ONLY interactive scope else-block | PARTIALLY TRUE | Scope else-block removed (intended); plugin multiselect ALSO refactored (intended per design doc) |

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **Two-step plugin loop re-prompts both steps on retry** - `init.ts:326-373` (Confidence: 65%) — On an empty-selection retry, the bounded loop re-shows BOTH Step 1 (workflow) and Step 2 (language) from scratch rather than only the empty one. Minor UX friction (a user who picked workflow plugins but skipped language, yielding a non-empty `combined`, never hits this — the loop only retries when `combined.length === 0`, so functionally correct). Not a regression; the old single multiselect had no retry at all.

- **Degenerate empty-bucket loop** - `init.ts:326-373` (Confidence: 60%) — If both `workflowChoices` and `languageChoices` were empty, the loop would spin 3 times prompting nothing then `exit(0)`. Cannot occur with the real `DEVFLOW_PLUGINS` registry (always has command-bearing + language plugins), so no practical regression. The bounded-loop guard (MAX_ATTEMPTS=3, reliability rule) is correctly applied.

## Regression-Safety Notes (informational, no action)

- **`required: true` -> `required: false` on plugin multiselects**: The old single multiselect used `required: true` (clack rejects empty + has its own cancel semantics). The new steps use `required: false` and enforce non-empty via the application-level bounded loop (init.ts:362-372), which `p.cancel` + `exit(0)` on exhaustion. Net contract — "init cannot proceed with zero plugins" — is preserved. Design doc explicitly flagged this cancel-semantics shift (§ "required: true cancel semantics").

- **`initialValues` parity**: Old flow pre-selected non-optional plugins (`preSelected`). New flow pre-selects non-optional workflow plugins (`workflowInitialValues`, init.ts:318-320). Language step has no `initialValues` — correct, since all 8 language plugins are `optional: true` (verified by existing test plugins.test.ts:170-175) and were never pre-selected before. Default-selection behavior preserved.

- **Local `WORKFLOW_ORDER` -> exported `WORKFLOW_ORDER`**: The deleted local array (init.ts old:1222-1226) omitted `/bug-analysis`. The new exported constant (plugins.ts:701-705) includes it. This is a latent-bug fix: the shipped `devflow-bug-analysis` command would previously never have rendered in the "Available commands" note. Now covered by a regression-guard test (plugins.test.ts:400-412).

- **Intentional behavior change (documented)**: Interactive `devflow init` on a TTY can no longer choose `local` scope — it silently defaults to `user`. This matches design-doc AC1 ("no longer shows the Installation scope prompt and always installs on user scope") and AC2 (`--scope local` retained for scripted use). Not flagged as a regression.

- **PF-006 awareness (silent contract shift)**: No silent external-API contract shift introduced. The clack prompt API usage (`p.multiselect`, `p.isCancel`, `p.cancel`) is consistent with existing call sites elsewhere in the file. The `required: false` change is deliberate, not an undocumented API drift.

## Validation Performed

- `npm run build:cli` — compiles clean (tsc, no errors)
- `npx vitest run tests/plugins.test.ts` — 39 passed, 0 failed, 0 skipped
- Consumer scan: `WORKFLOW_ORDER` / `partitionSelectablePlugins` imported only by init.ts and the test — no orphaned/broken consumers
- Current-state read of init.ts:183-199 confirms scope block matches the diff

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED
