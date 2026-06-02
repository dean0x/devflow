# TypeScript Review Report

**Branch**: feat/init-flow-simplification -> main
**Date**: 2026-06-01_1725
**Scope**: src/cli/plugins.ts, src/cli/commands/init.ts, tests/plugins.test.ts
**PR**: #232

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None.

The TypeScript quality of this change is strong. `tsc --noEmit -p tsconfig.json`
passes cleanly with `strict: true`. No `any` types were introduced, no unsafe
runtime casts, and the new public function carries an explicit, correct return
type with a thorough doc comment.

## Issues in Code You Touched (Should Fix)

### MEDIUM
**Redundant `as string[]` casts on @clack multiselect results (2 occurrences)** — Confidence: 88%
- `src/cli/commands/init.ts:342` (`workflowSelected = step1 as string[]`)
- `src/cli/commands/init.ts:357` (`languageSelected = step2 as string[]`)
- Problem: `p.multiselect<Value>` is typed as `Promise<symbol | Value[]>`, and
  `p.isCancel(value): value is symbol` is a proper type guard. After the
  `if (p.isCancel(step1)) { ...process.exit(0); }` block, TypeScript already
  narrows `step1` from `symbol | string[]` to `string[]` (the option `value`s
  are `pl.name`, a `string`, so `Value` infers to `string`). The `as string[]`
  assertion is therefore redundant — it asserts a type the compiler has already
  proven. Redundant assertions are a mild code smell: they suppress future
  compiler help if the option value type ever changes (e.g., to a union or
  branded type), silently masking a real mismatch instead of erroring.
- Impact: Low runtime risk (the cast is correct today), but it weakens the
  type-narrowing guarantee and trains readers that the cast is necessary when
  it is not.
- Fix: Drop the assertions and let `isCancel` narrowing do the work:
  ```typescript
  // step1 is narrowed to string[] after the isCancel guard above
  workflowSelected = step1;   // was: step1 as string[]
  ...
  languageSelected = step2;   // was: step2 as string[]
  ```
- Note: This pattern matches the **pre-existing** convention in the same file
  (`pluginSelection as string[]` in the old code; `flagSelection as string[]`
  at init.ts:710, `viewModeChoice as ...`, `teamsChoice as boolean`, etc.).
  Because the new casts are consistent with established local style and are
  type-correct, this is a should-fix consistency-with-best-practice item, not a
  blocker. If the team prefers to keep the codebase-wide cast convention,
  leaving these is defensible — but the cleaner direction is to remove them
  (and ideally the pre-existing ones in a follow-up).

## Pre-existing Issues (Not Blocking)
None within the reviewed scope that meet the CRITICAL bar for pre-existing code.
(The `as boolean` / `as 'user' | 'local'` cast convention on @clack `select`
results predates this PR and is out of scope.)

## Suggestions (Lower Confidence)

- **`WORKFLOW_ORDER` could be `readonly`/`as const`** - `src/cli/plugins.ts:701`
  (Confidence: 65%) — Typed as mutable `string[]`. Since it is a fixed canonical
  display order consumed read-only (`.filter`/`.indexOf`/`Set` in init.ts and
  tests), `as const` or `readonly string[]` would express immutability in the
  type and enable literal narrowing. Held below threshold because the existing
  codebase convention in plugins.ts is plain mutable arrays
  (`DEVFLOW_PLUGINS: PluginDefinition[]`, `LEGACY_RULE_NAMES: string[]`) with no
  `as const` usage anywhere in the file — so `string[]` is the consistent choice
  here, and changing it would diverge from local style.

- **`EXCLUDED` Set is duplicated between source and test** - `src/cli/plugins.ts:723`
  and `tests/plugins.test.ts:310` (Confidence: 60%) — The exclusion set is
  re-declared verbatim in the test rather than imported/exported, so the two can
  drift. Minor; arguably intentional to keep the test as an independent oracle.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

### What is correct (positive findings)
- `partitionSelectablePlugins` return type is **explicit and correct**:
  `{ workflow: PluginDefinition[]; language: PluginDefinition[] }`
  (plugins.ts:719-722). Function is pure, non-mutating, deterministic — and the
  test suite verifies all of these (`does not mutate the input array`,
  `buckets are disjoint`, `preserves ordering`, `empty input` edge case).
- `Set` is used appropriately for O(1) exclusion membership (`EXCLUDED.has`)
  and elsewhere (`installedSet`, `workflowOrderSet`).
- `isCancel` symbol-result narrowing is handled correctly at every call site —
  the `symbol` branch always `process.exit`s, so subsequent code sees the
  narrowed value type.
- No `any` types; `JSON.parse` results are typed `unknown` and guarded
  (`typeof parsed === 'object'`, `!Array.isArray`) before access (init.ts:1133).
- Explicit return type present on the new exported function. `WORKFLOW_ORDER`
  has an explicit type annotation.
- `import type { PluginDefinition }` correctly uses a type-only import.

**TypeScript Score**: 9/10
**Recommendation**: APPROVED
