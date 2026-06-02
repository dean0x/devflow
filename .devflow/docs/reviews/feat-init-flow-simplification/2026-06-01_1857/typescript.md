# TypeScript Review Report

**Branch**: feat/init-flow-simplification -> main (PR #232)
**Date**: 2026-06-01 18:57

## Summary of Analysis

Scope: type safety of the new init-flow helpers in `src/cli/plugins.ts` and
`src/cli/commands/init.ts` — `partitionSelectablePlugins`, `combineSelection`,
`shouldRetry`, the exported `WORKFLOW_ORDER`, and the two-step `@clack`
multiselect / `isCancel` narrowing.

Verification performed:
- `tsc --noEmit -p tsconfig.json` → clean (zero errors). `strict: true` is on.
- Confirmed `@clack` types directly (avoids PF-005 — checked rather than assumed):
  `isCancel(value: unknown): value is symbol` and
  `multiselect<Value>(opts): Promise<symbol | Value[]>`.
- Confirmed `PluginDefinition` shape and helper signatures match the documented
  `cli-rules` knowledge base (verified against current code per staleness note;
  signatures still accurate).

**Result: no blocking, should-fix, or pre-existing TypeScript issues.** The new
code is type-sound. One low-confidence stylistic suggestion below.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None within the TypeScript focus area.

## Suggestions (Lower Confidence)

- **`WORKFLOW_ORDER` could be `readonly`/`as const`** - `src/cli/plugins.ts:701` (Confidence: 65%) — Exported as mutable `string[]`. It is a canonical display-order constant consumed only via read-only operations (`.filter`, `.indexOf`, `.includes`) in `init.ts:1278-1279`. Typing it `as const` (or `readonly string[]`) would prevent accidental mutation by any importer and document intent. Not a defect — purely a hardening nicety; the current typing compiles cleanly and is used correctly.

## Notes on Verified Non-Issues

- **`@clack` narrowing is sound (no casts needed)** — In both `step1`/`step2`
  branches, the `if (p.isCancel(stepN)) process.exit(0)` guard narrows the
  `symbol | string[]` union to `string[]` (since options derive from
  `toChoice` → `value: pl.name` which is `string`, so `Value` infers as
  `string`). The subsequent `workflowSelected = step1` / `languageSelected = step2`
  assignments to `string[]` are type-safe with no `as string[]` cast. This
  confirms the prior-cycle removal of redundant `as string[]` casts was correct
  and complete — re-adding them would be redundant. (Prior FP — not re-raised.)
- **`combineSelection` / `shouldRetry` return types** — Both have explicit return
  types (`{ plugins: string[]; accepted: boolean }` and `boolean`), are pure, and
  carry no `any`. Sound.
- **`partitionSelectablePlugins` return type** — Explicit
  `{ workflow: PluginDefinition[]; language: PluginDefinition[] }`; no mutation of
  input; no `any`. Sound.
- Per Cross-Cycle Awareness: the two prior false positives (test re-declaring the
  `EXCLUDED` set as an independent oracle; the both-empty-bucket precondition
  assert) were verified against current code and are **not** re-raised.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 9/10
**Recommendation**: APPROVED
