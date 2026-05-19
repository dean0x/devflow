# TypeScript Review Report

**Branch**: feat/pr-description-pipeline -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**VALID_STATUSES Set typed as `Set<string>` instead of `Set<DecisionsEntryStatus>` allows silent drift** - `src/cli/commands/decisions.ts:136`
**Confidence**: 85%
- Problem: The `VALID_STATUSES` set is typed as `Set<string>` while it is meant to mirror the `DecisionsEntryStatus` union. If a new status is added to the union type but not to the set (or vice versa), the compiler will not flag the mismatch. The `toDecisionsStatus` function relies on this set as the single runtime source of truth for valid statuses, so a drift means some statuses could silently be normalized to `'Unknown'`.
- Fix: Type the set as `Set<DecisionsEntryStatus>` so the compiler enforces that every element is a valid status:
  ```typescript
  const VALID_STATUSES: Set<string> = new Set<DecisionsEntryStatus>([
    'Accepted', 'Active', 'Deprecated', 'Superseded', 'Unknown',
  ]);
  ```
  The set still needs to be checked with `.has(raw)` where `raw` is `string`, so the variable type stays `Set<string>`, but the constructor argument uses `Set<DecisionsEntryStatus>` to enforce the values at the definition site. Alternatively, derive both from a single source:
  ```typescript
  const VALID_STATUSES_ARRAY = ['Accepted', 'Active', 'Deprecated', 'Superseded', 'Unknown'] as const;
  export type DecisionsEntryStatus = (typeof VALID_STATUSES_ARRAY)[number];
  const VALID_STATUSES = new Set<string>(VALID_STATUSES_ARRAY);
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`updateDecisionsStatus` accepts `newStatus: string` instead of `DecisionsEntryStatus`** - `src/cli/commands/learn.ts:389`
**Confidence**: 82%
- Problem: The `updateDecisionsStatus` function (imported and used in the changed capacity review block at `decisions.ts:889`) accepts `newStatus: string`, allowing any arbitrary string to be written as a status in the markdown files. Now that `DecisionsEntryStatus` is a well-defined union type, the parameter could use it for compile-time safety. All three callers pass `'Deprecated'` which is a valid `DecisionsEntryStatus` value.
- Fix: Narrow the parameter type:
  ```typescript
  export async function updateDecisionsStatus(
    filePath: string,
    anchorId: string,
    newStatus: DecisionsEntryStatus,
  ): Promise<boolean> {
  ```
  This requires importing `DecisionsEntryStatus` in `learn.ts` (or co-locating the type). Since `learn.ts` is already imported by `decisions.ts`, a re-export or a shared types module avoids circular dependencies.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Test data at line 444-449 uses inferred `string` types for `status` instead of `DecisionsEntryStatus`** - `tests/decisions/cli-subcommands.test.ts:444` (Confidence: 65%) -- The `allEntries` array in the "excludes deprecated and superseded entries" test creates objects with string literal `status` fields without a `DecisionsEntry[]` type annotation. This means the test does not validate that the status values it uses are valid `DecisionsEntryStatus` values. Since this test exercises a raw `.filter()` rather than the typed `filterEligibleEntries`, it is not strictly incorrect but could miss drift if status enum values change.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR introduces well-structured TypeScript improvements: a proper `DecisionsEntryStatus` discriminated union, narrowed `file` field to `'decisions' | 'pitfalls'`, and clean extraction of `clearCapacityNotifications` with correct typing. The `toDecisionsStatus` normalizer with `'Unknown'` fallback is a sound boundary validation pattern. The type assertion in `toDecisionsStatus` (`raw as DecisionsEntryStatus`) is guarded by the `VALID_STATUSES.has()` check, making it safe. The `(err as NodeJS.ErrnoException).code` pattern in the `acquireMkdirLock` fix follows established codebase convention. The two MEDIUM items (drift-prone set definition, loose `updateDecisionsStatus` parameter) are minor improvements that would strengthen the type safety story but do not risk runtime correctness.
