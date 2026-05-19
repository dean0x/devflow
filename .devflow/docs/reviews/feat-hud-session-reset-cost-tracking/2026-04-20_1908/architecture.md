# Architecture Review Report

**Branch**: feat/hud-session-reset-cost-tracking -> main
**Date**: 2026-04-20

## Issues in Your Changes (BLOCKING)

### HIGH

**Side effect (filesystem write) coupled into render pipeline** - `src/cli/hud/index.ts:133-134`
**Confidence**: 85%
- Problem: `persistSessionCost()` performs synchronous filesystem I/O (mkdir, write, rename) directly inside the `run()` function -- the same function responsible for gathering data and rendering the HUD. This mixes a write-side-effect (cost persistence) into what is otherwise a read-then-render pipeline. Every HUD render now writes to disk, even when the sessionCost component is disabled. The `if (sessionId && costUsd)` guard runs unconditionally regardless of `needsSessionCost`.
- Impact: Violates SRP -- `run()` now has two responsibilities: render HUD output and persist cost history. The persistence runs even when the user has disabled the sessionCost component, performing unnecessary disk writes.
- Fix: Guard `persistSessionCost` behind the same `needsSessionCost` check, and consider extracting cost persistence into a separate lifecycle concern:
```typescript
// Minimal fix: guard persistence with the same check
if (needsSessionCost && sessionId && costUsd) {
  persistSessionCost(sessionId, costUsd, cwd);
}
```

### MEDIUM

**`cost-history.ts` mixes three distinct responsibilities in one module** - `src/cli/hud/cost-history.ts`
**Confidence**: 82%
- Problem: `cost-history.ts` combines three concerns: (1) atomic file persistence (`persistSessionCost`), (2) cleanup/archival lifecycle management (`runCleanup`, `trimArchive`), and (3) cost aggregation/querying (`aggregateCosts`). This is a new module at 253 lines that handles write, maintenance, and read paths in one file. Cleanup is triggered probabilistically from the write path (`timestamp % 50 === 0`), which couples the maintenance concern to the persistence concern.
- Impact: As cost tracking evolves (daily costs, per-project costs, cost alerts), this module will grow in all three directions simultaneously. The probabilistic cleanup trigger means maintenance depends on write frequency, which creates an implicit coupling.
- Fix: This is manageable at current size but worth noting as a modularity concern. If cost tracking expands, consider splitting into `cost-persistence.ts` (write + atomic safety), `cost-cleanup.ts` (archival + trimming), and `cost-aggregation.ts` (read + computation). The current approach is acceptable for a v1 feature.

**`Date.now()` hardcoded throughout `cost-history.ts` -- limits testability** - `src/cli/hud/cost-history.ts:54,92,214,225`
**Confidence**: 80%
- Problem: Four call sites use `Date.now()` directly, making it impossible to test time-dependent logic (weekly/monthly cutoffs, archival age checks) without real clock manipulation or writing archive entries with manually computed timestamps. The test suite works around this by pre-computing timestamps relative to `Date.now()`, but this prevents testing edge cases like "exactly at the 7-day boundary."
- Impact: The existing tests are functional but fragile for boundary conditions. Injecting a clock function would follow the DIP pattern used elsewhere in the codebase.
- Fix: Accept an optional `nowMs?: number` parameter in `aggregateCosts` and `runCleanup` (defaulting to `Date.now()`). This follows the dependency injection principle without changing the public API for callers that don't need it:
```typescript
export function aggregateCosts(
  currentSessionId: string,
  currentCostUsd: number,
  nowMs: number = Date.now(),
): CostAggregation | null {
  // ...
  const nowSeconds = Math.floor(nowMs / 1000);
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale JSDoc comment "16 HUD components" in `types.ts`** - `src/cli/hud/types.ts:22`
**Confidence**: 90%
- Problem: The JSDoc comment on the `ComponentId` type says "Component IDs -- the 16 HUD components" but `HUD_COMPONENTS` in `config.ts` now has 15 entries (sessionDuration omitted). The `ComponentId` union type itself still has 16 members (correct -- the type covers all possible component IDs including retained-but-disabled ones), but the comment is misleading.
- Fix: Update the comment to avoid hardcoding a count:
```typescript
/**
 * Component IDs -- all registered HUD components.
 * Not all are enabled by default (see config.ts HUD_COMPONENTS).
 */
```

**`formatCountdown` JSDoc says "compact, no spaces" but implementation adds spaces** - `src/cli/hud/components/usage-quota.ts:33`
**Confidence**: 95%
- Problem: The JSDoc on `formatCountdown` says `Format: '2h15m', '3d12h', '45m' (compact, no spaces)` but the uncommitted changes add spaces: `2h 15m`, `3d 12h`. The JSDoc and implementation are out of sync.
- Fix: Update the JSDoc to match the implementation:
```typescript
/**
 * Format seconds remaining until a reset timestamp into compact form.
 * Returns '' if the timestamp is in the past or not provided.
 * Format: '2h 15m', '3d 12h', '45m'
 */
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`sessionDuration` remains in `COMPONENT_MAP` and imports despite being disabled** - `src/cli/hud/render.ts:22,37`
**Confidence**: 82%
- Problem: The `sessionDuration` component is imported and registered in `COMPONENT_MAP` in `render.ts` even though it is removed from `HUD_COMPONENTS` and `LINE_GROUPS`. This is intentional per the comments ("retained for reinstatement"), but it means dead code is loaded on every HUD render. The component file, import, and map entry all remain.
- Impact: Minor -- adds one unused import and one unused map entry. The "retained for reinstatement" pattern is documented but creates ongoing maintenance cost.

### LOW

**`getCostFilePaths` duplicates the DEVFLOW_DIR resolution pattern** - `src/cli/hud/cost-history.ts:25-27`
**Confidence**: 70% (below threshold for main sections -- moved to Suggestions)
- The `DEVFLOW_DIR` resolution logic (`process.env.DEVFLOW_DIR || path.join(process.env.HOME || homedir(), '.devflow')`) is repeated across `cost-history.ts`, `index.ts`, `config.ts`, and other modules. A shared `getDevflowDir()` utility would reduce duplication. However, the pattern is simple and module-level independence has value for a HUD system.

## Suggestions (Lower Confidence)

- **Shared `getDevflowDir()` utility** - across `cost-history.ts:25`, `index.ts:76`, `config.ts:32` (Confidence: 70%) -- the DEVFLOW_DIR resolution pattern is repeated in three files; a shared utility would be cleaner but is not urgent at current scale.

- **`aggregateCosts` reads all session files + full archive on every render** - `cost-history.ts:162-251` (Confidence: 65%) -- for users with many sessions, reading all `.json` files in `sessions/` plus parsing the full archive JSONL on every HUD render could become a performance concern. The current approach is acceptable given the ARCHIVE_TRIM_THRESHOLD of 500 and periodic cleanup, but caching the aggregation result with a short TTL (using the existing `cache.ts`) would be a natural optimization if needed.

- **No `timestamp` validation on archive entries during aggregation** - `cost-history.ts:178-179` (Confidence: 60%) -- `aggregateCosts` validates `session_id` is string and `cost_usd` is number, but does not validate `timestamp` is a reasonable number. A negative or far-future timestamp would silently affect weekly/monthly totals.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The overall architecture of this change is sound. Replacing the OAuth API fetch with stdin extraction is a clear win -- it removes credentials handling, network I/O, caching complexity, and the `usage-api.ts` + `credentials.ts` modules entirely. The new `cost-history.ts` module follows established patterns (atomic writes, fire-and-forget errors, DEVFLOW_DIR testability). The `renderQuotaWindow` extraction in `usage-quota.ts` is a good DRY improvement.

The primary concern is the side-effect coupling: `persistSessionCost` runs unconditionally in the render pipeline even when the sessionCost component is disabled. This is a straightforward fix (guard with `needsSessionCost`). The stale JSDoc issues are minor but should be cleaned up before merge.
