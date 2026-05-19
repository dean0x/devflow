# TypeScript Review Report

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### MEDIUM

**`DecisionsEntry.status` uses `string` instead of a string literal union** - `src/cli/commands/decisions.ts:139`
**Confidence**: 85%
- Problem: The `status` field on `DecisionsEntry` is typed as `string`, but the codebase only uses a fixed set of status values (`'Accepted'`, `'Active'`, `'Deprecated'`, `'Superseded'`, `'Unknown'`). The capacity review code already filters on specific status strings (line 769: `status === 'Deprecated' || status === 'Superseded'`), so a plain `string` type loses compile-time exhaustiveness checking and allows nonsensical status values to pass silently.
- Fix: Use a discriminated union:
```typescript
export interface DecisionsEntry {
  id: string;
  pattern: string;
  file: string;
  filePath: string;
  status: 'Accepted' | 'Active' | 'Deprecated' | 'Superseded' | 'Unknown';
  createdDate: string | null;
}
```

**`DecisionsEntry.file` uses `string` instead of a string literal union** - `src/cli/commands/decisions.ts:137`
**Confidence**: 82%
- Problem: The `file` field is typed as `string` but only ever set to `'decisions'` or `'pitfalls'` (line 778). A literal union type would catch misuse at compile time.
- Fix:
```typescript
  file: 'decisions' | 'pitfalls';
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Lock release uses raw `fs.rmdir` instead of reusing `acquireMkdirLock` pattern** - `src/cli/commands/decisions.ts:729`
**Confidence**: 85%
- Problem: The lock acquisition was correctly hardened by switching from raw `fs.mkdir` + boolean to `acquireMkdirLock` (with stale detection and timeout), but the release side still uses a bare `await fs.rmdir(decisionsLockDir)`. The `learn.ts` module from which `acquireMkdirLock` is imported does not export a matching `releaseMkdirLock`. This asymmetry means the review observations path now has robust acquisition but ad-hoc release, while `json-helper.cjs` has a dedicated `releaseLock()` function. If a future change needs release-side logic (e.g., logging), every call site must be updated independently.
- Fix: Consider exporting a `releaseMkdirLock` companion from `learn.ts` and using it here, or accept the current pattern with a code comment noting the intentional asymmetry. This is a consistency concern, not a correctness bug.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Notification clearing tests replicate inline logic instead of testing the exported function** - `tests/decisions/cli-subcommands.test.ts:505-565`
**Confidence**: 82%
- Problem: The new `capacity review notification clearing (D28)` test suite (3 tests) copies the inline notification-clearing logic from the command handler rather than calling an extracted, exported function. This is the same pattern the PR correctly fixed for `filterEligibleEntries` and `sortByLeastUsed`. The notification-clearing logic at `decisions.ts:894` is still inline, so the tests cannot actually validate the production code path -- they validate a copy of it. If the production logic diverges, the tests will still pass.
- Fix: Extract the notification-clearing logic into an exported function (e.g., `clearCapacityNotifications`) analogous to `filterEligibleEntries`, then test that function directly.

## Suggestions (Lower Confidence)

- **`tryImmediatePromotion` in CJS file is untyped** - `scripts/hooks/json-helper.cjs:515` (Confidence: 65%) -- The extracted helper mutates `entry` in place with no JSDoc `@typedef` or `@returns` annotation for the mutation side-effect. Adding `@returns {void}` and a `@typedef` for the entry shape would improve self-documentation in a pure-JS file.

- **Date comparison via string `<=` for protection window** - `src/cli/commands/decisions.ts:151` (Confidence: 62%) -- `e.createdDate <= sevenDaysAgo` relies on ISO date strings sorting lexicographically, which works for `YYYY-MM-DD` but is fragile if the format ever changes. A numeric comparison via `Date.parse` would be more robust.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**TypeScript Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is a clean refactoring that extracts duplicated logic into named helpers (`tryImmediatePromotion`, `filterEligibleEntries`, `sortByLeastUsed`), hardens lock acquisition with stale-detection via `acquireMkdirLock`, and reuses `formatStaleReason` across modules. The TypeScript-specific concerns are around missed opportunities for stricter typing on the new `DecisionsEntry` interface -- `status` and `file` fields should use literal unions rather than plain `string` to match the discriminated-union patterns this codebase follows (applies ADR-001 -- no migration needed for tightening types on new interfaces). No blocking issues found. The notification-clearing tests validate logic copies rather than production code, which should be addressed as a follow-up.
