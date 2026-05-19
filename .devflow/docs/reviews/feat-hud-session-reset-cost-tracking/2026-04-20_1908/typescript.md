# TypeScript Review Report

**Branch**: feat/hud-session-reset-cost-tracking -> main
**Date**: 2026-04-20

## Issues in Your Changes (BLOCKING)

### HIGH

**Unchecked type assertion on parsed JSON (`as SessionEntry`) lacks runtime validation** (5 occurrences) - Confidence: 90%
- `src/cli/hud/cost-history.ts:121`, `src/cli/hud/cost-history.ts:145-146`, `src/cli/hud/cost-history.ts:178`, `src/cli/hud/cost-history.ts:196`
- Problem: `JSON.parse(raw) as SessionEntry` is a type assertion with no runtime validation. The `as` keyword does not perform runtime narrowing — it silences the type checker while the actual value could have any shape. If a malformed file has `timestamp: "not-a-number"` or is missing `session_id`, the code will silently produce corrupt arithmetic or NaN comparisons in the aggregation loop (e.g., `entry.timestamp >= cutoff7d` would evaluate to `false` when timestamp is `undefined`, causing silent data loss). While lines 178-179 do a partial runtime check (`typeof entry.session_id === 'string' && typeof entry.cost_usd === 'number'`), `timestamp` and `cwd` are not validated, and the `runCleanup` path at line 121 has no validation at all.
- Fix: Add a type guard function and use it instead of bare `as` casts:

```typescript
function isSessionEntry(value: unknown): value is SessionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.session_id === 'string' &&
    typeof obj.cost_usd === 'number' &&
    typeof obj.timestamp === 'number' &&
    typeof obj.cwd === 'string'
  );
}

// Then replace:
const entry = JSON.parse(raw) as SessionEntry;
// With:
const parsed: unknown = JSON.parse(raw);
if (!isSessionEntry(parsed)) continue; // or return
const entry = parsed;
```

### MEDIUM

**`persistSessionCost` uses falsy check `!costUsd` which silently skips negative costs** - `src/cli/hud/cost-history.ts:43`
**Confidence**: 82%
- Problem: `if (!costUsd) return;` treats `NaN`, `0`, and negative values identically as "skip". While `0` is intentional (no cost to persist), negative cost values (which could arise from API bugs or data corruption) would be silently written. More critically, `NaN` would also be written — `!NaN` is `true`, so NaN is actually caught, but the intent is not clear from the code. The `aggregateCosts` function at line 207 also uses `!currentCostUsd` which has the same semantic ambiguity.
- Fix: Use explicit checks to make the intent clear:

```typescript
if (costUsd <= 0 || !Number.isFinite(costUsd)) return;
```

**`resets_at` type in `StdinData` does not distinguish epoch seconds vs milliseconds** - `src/cli/hud/types.ts:16-17`
**Confidence**: 80%
- Problem: The `resets_at` field is typed as `number` with no indication of units. The consuming code in `formatCountdown` multiplies by 1000 (treating it as epoch seconds), but the type itself carries no documentation or branded type to prevent accidentally passing milliseconds. A future contributor could easily introduce a bug by passing `Date.now()` (milliseconds) instead of `Math.floor(Date.now() / 1000)` (seconds).
- Fix: Add a JSDoc clarifying the unit, or use a branded type:

```typescript
rate_limits?: {
  five_hour?: { used_percentage?: number; /** Epoch seconds */ resets_at?: number };
  seven_day?: { used_percentage?: number; /** Epoch seconds */ resets_at?: number };
};
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`ComponentId` type still includes `'sessionDuration'` but `HUD_COMPONENTS` excludes it** - `src/cli/hud/types.ts:32`, `src/cli/hud/config.ts:12-28`
**Confidence**: 85%
- Problem: The `ComponentId` union type at `types.ts:32` still lists `'sessionDuration'`, the `COMPONENT_MAP` in `render.ts:34` still registers it, and the component module is still imported (`render.ts:16`). However, `HUD_COMPONENTS` in `config.ts` no longer includes it. This creates a divergence: the type says `sessionDuration` is a valid component ID, but the default config never enables it. The JSDoc comment in `types.ts:23` says "the 16 HUD components" but there are now 16 in the type and 15 in the array. While this is intentional for reinstatement, the stale "16" in the type-level comment is misleading.
- Fix: Update the comment at `types.ts:22-23`:

```typescript
/**
 * Component IDs — the 16 HUD components (15 active by default; sessionDuration retained for reinstatement).
 */
```

## Pre-existing Issues (Not Blocking)

No critical pre-existing issues found.

## Suggestions (Lower Confidence)

- **`trimArchive` is not atomic** - `src/cli/hud/cost-history.ts:153` (Confidence: 65%) -- `writeFileSync` directly overwrites the archive without a tmp+rename pattern, so a crash mid-write could corrupt the archive. Less critical since the outer try/catch swallows errors and the archive is reconstructable, but inconsistent with the atomic write pattern used in `persistSessionCost`.

- **`aggregateCosts` reads all session files synchronously on every HUD render** - `src/cli/hud/cost-history.ts:162-251` (Confidence: 70%) -- With many concurrent sessions over time, the sessions directory could accumulate files. Each HUD render reads every `.json` file plus the archive. This is currently bounded by the 24-hour cleanup, but worth monitoring if HUD render latency increases.

- **`sessionCost` test at line 503 asserts `result!.raw` equals `'$0.42'` but the component now joins with dot separator** - `tests/hud-components.test.ts:503` (Confidence: 65%) -- The test passes because `costHistory` is null in `makeCtx()`, so `parts` has only one element and the join produces no separator. But the test name "shows cost formatted as dollars" doesn't document this dependency on `costHistory` being null. A future change could break this silently.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The main concern is the pervasive use of `as SessionEntry` type assertions on parsed JSON without runtime type guards. This violates the TypeScript skill's core principle: "use `unknown` with type guards instead of type assertions." The `aggregateCosts` function does partial validation (checking `session_id` and `cost_usd` types) but inconsistently -- `runCleanup` has zero validation. Adding a single `isSessionEntry` type guard and using it consistently across all JSON parse sites would resolve the HIGH finding and make the code resilient to malformed data on disk.
