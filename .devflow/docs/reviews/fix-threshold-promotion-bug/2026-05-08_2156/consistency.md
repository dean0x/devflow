# Consistency Review Report

**Branch**: feat/pr-description-pipeline -> main
**Date**: 2026-05-08
**PR**: #206 — fix(decisions): update --review to deprecate in rendered markdown

## Issues in Your Changes (BLOCKING)

### HIGH

**`updateDecisionsStatus` parameter type inconsistent with new `DecisionsEntryStatus` union** - `src/cli/commands/learn.ts:389`
**Confidence**: 85%
- Problem: This PR introduces a well-defined `DecisionsEntryStatus` type union (`'Accepted' | 'Active' | 'Deprecated' | 'Superseded' | 'Unknown'`) and tightens `DecisionsEntry.status` to use it. However, `updateDecisionsStatus` — the function that actually writes status values to the rendered markdown files — still accepts `newStatus: string`. Both call sites in this PR pass the literal `'Deprecated'`, but the loose typing permits any arbitrary string to be written into the markdown Status field, which would then fail to round-trip through `toDecisionsStatus` (falling back to `'Unknown'`).
- Fix: Change the parameter type to match the new union:
```typescript
export async function updateDecisionsStatus(
  filePath: string,
  anchorId: string,
  newStatus: DecisionsEntryStatus,
): Promise<boolean> {
```
This requires importing `DecisionsEntryStatus` from `decisions.ts` into `learn.ts` (or co-locating the type in a shared module). All existing call sites already pass valid literals so no callers need changes.

### MEDIUM

**Test data objects at line 444 lack `DecisionsEntry` type annotation unlike sibling tests** - `tests/decisions/cli-subcommands.test.ts:444`
**Confidence**: 82%
- Problem: The `allEntries` array at line 444 is declared without a type annotation (`const allEntries = [...]`), while the two analogous arrays at lines 468 and 485 use explicit `DecisionsEntry[]` typing. This inconsistency means the line-444 test would not catch if the `DecisionsEntry` interface changed shape — TypeScript infers a structural type from the object literals rather than validating against the exported interface.
- Fix: Add the type annotation to match sibling tests:
```typescript
const allEntries: DecisionsEntry[] = [
  { id: 'ADR-001', pattern: 'Use X', file: 'decisions', filePath: '/tmp/decisions.md', status: 'Accepted', createdDate: '2026-01-01' },
  // ...
];
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Deprecation markdown-update logic duplicated between `learn.ts` and `decisions.ts`** - `src/cli/commands/learn.ts:1030-1046`, `src/cli/commands/decisions.ts:729-745`
**Confidence**: 82%
- Problem: The `--review` deprecation handler in `decisions.ts` (lines 729-745) and `learn.ts` (lines 1030-1046) contain nearly identical blocks: parse `artifact_path` at `#`, resolve to absolute, call `updateDecisionsStatus`, log success/warning. The decisions.ts version drops the `obs.type` guard (since all its observations are decision/pitfall), but otherwise the pattern is structurally duplicated. This was not introduced by this PR (learn.ts had the block already) but is now visible across both files.
- Fix: Consider extracting a shared helper (e.g., `deprecateRenderedEntry(obs, logPath)`) in a future PR, similar to how `clearCapacityNotifications` was extracted in this PR.

## Suggestions (Lower Confidence)

- **`VALID_STATUSES` Set could derive from the type union** - `src/cli/commands/decisions.ts:136` (Confidence: 65%) — The `VALID_STATUSES` Set and `DecisionsEntryStatus` union must be kept in sync manually. A const array + `typeof` pattern would derive one from the other, but this is a style preference and the current approach is clear.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR is a net positive for consistency: it introduces a proper status type union, tightens `DecisionsEntry` field types from loose `string` to literal unions, extracts inline logic into a testable `clearCapacityNotifications` helper (matching the project's test-behavior-not-implementation principle), unifies the `tryImmediatePromotion` code path (eliminating a duplicated inline block), and brings the TS `acquireMkdirLock` error handling in line with the existing CJS pattern (`avoids PF-001` — changes are clean-break improvements, not backward-compat shims; `applies ADR-001`). The one blocking HIGH issue is that `updateDecisionsStatus` accepts `string` while the rest of the type system now uses `DecisionsEntryStatus`, creating a gap in the otherwise consistent tightening.
