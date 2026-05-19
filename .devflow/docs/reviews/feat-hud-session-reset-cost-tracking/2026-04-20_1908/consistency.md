# Consistency Review Report

**Branch**: feat/hud-session-reset-cost-tracking -> main
**Date**: 2026-04-20

## Issues in Your Changes (BLOCKING)

### HIGH

**JSDoc format string contradicts actual output** - `src/cli/hud/components/usage-quota.ts:33`
**Confidence**: 95%
- Problem: The JSDoc for `formatCountdown` states `Format: '2h15m', '3d12h', '45m' (compact, no spaces)` but the uncommitted changes on the same line add spaces: `'2h 15m'`, `'3d 12h'`. The JSDoc now directly contradicts the runtime behavior. The committed version (no spaces) matched the JSDoc, but the working tree changes broke that consistency without updating the comment.
- Fix: Update the JSDoc to match the actual output format:
```typescript
/**
 * Format seconds remaining until a reset timestamp into compact form.
 * Returns '' if the timestamp is in the past or not provided.
 * Format: '2h 15m', '3d 12h', '45m'
 */
```

### MEDIUM

**`sessionDuration` formatting style inconsistency with `formatCountdown`** - `src/cli/hud/components/session-duration.ts:13` vs `src/cli/hud/components/usage-quota.ts:49`
**Confidence**: 82%
- Problem: Both `sessionDuration` (line 13) and the updated `formatCountdown` (line 49, working tree) produce human-readable time durations, but they use different formatting patterns. `sessionDuration` uses a space separator (`${hours}h ${minutes % 60}m`), while the committed version of `formatCountdown` uses no space (`${totalHours}h${totalMinutes}m`). The uncommitted changes fix `formatCountdown` to add spaces, aligning with `sessionDuration`. However, `sessionDuration` omits minutes when hours is 0 (`${minutes}m`) while `formatCountdown` does the same correctly. This is currently consistent, but the codebase now has two separate time-formatting functions that could be consolidated.
- Fix: Consider extracting a shared `formatDuration(seconds: number): string` utility used by both components to ensure formatting stays consistent. Low urgency since the uncommitted changes already align the two patterns.

**types.ts JSDoc says "16 HUD components" but array has 15** - `src/cli/hud/types.ts:23`
**Confidence**: 92%
- Problem: The `ComponentId` type JSDoc comment reads `Component IDs -- the 16 HUD components` but `sessionDuration` was removed from the default `HUD_COMPONENTS` array (now 15 entries). The `ComponentId` union type itself still includes `sessionDuration` (which is correct since the type is retained), but the count in the comment is misleading. The type union has 16 members, so the comment is technically accurate for the type, but since `config.ts` now says 15, this creates confusion about the canonical count.
- Fix: Update the JSDoc to clarify:
```typescript
/**
 * Component IDs -- all 16 HUD component types.
 * sessionDuration is defined but omitted from HUD_COMPONENTS defaults.
 */
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Redundant constant `SECONDS_24_HOURS` removed but inconsistently** - `src/cli/hud/cost-history.ts:6-7`
**Confidence**: 88%
- Problem: The committed version of `cost-history.ts` defined both `SECONDS_PER_DAY = 86400` and `SECONDS_24_HOURS = 24 * SECONDS_PER_DAY` (which equals 24 days, not 24 hours -- a latent bug). The cleanup in the uncommitted diff removes `SECONDS_24_HOURS` and the line `const SECONDS_24_HOURS = 24 * SECONDS_PER_DAY;` and replaces the usage at line 123 with `SECONDS_PER_DAY`. This is the correct fix. However, the committed version on the branch (before working tree changes) still has the `SECONDS_24_HOURS` bug: `24 * 86400 = 2,073,600` seconds (24 days) was being used as the archival threshold instead of the intended 24 hours (`86400` seconds). Sessions would only archive after 24 days, not 24 hours.
- Fix: The working tree changes correctly address this. Ensure these uncommitted changes are committed.

**Countdown format changed from `recycle-arrow` prefix to parenthesized suffix** - `src/cli/hud/components/usage-quota.ts:60-73`
**Confidence**: 85%
- Problem: The committed version uses `\u21BB` (recycle arrow) as a prefix before the countdown (`5h \u21BB2h15m ████...`). The uncommitted changes switch to parenthesized suffix after the bar (`5h ████... 45% (2h 15m)`). This is a deliberate layout change, but the README preview at line 63 still shows the old `\u21BB` prefix format: `5h \u21BB2h15m ████░░░░ 45%`. This creates a documentation inconsistency.
- Fix: Update the README HUD preview to match the new layout format if the parenthesized suffix is the intended design.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Duplicated bar-rendering logic across context-usage and usage-quota** - `src/cli/hud/components/context-usage.ts:26-36` and `src/cli/hud/components/usage-quota.ts:6-28`
**Confidence**: 80%
- Problem: Both `contextUsage` and `usageQuota` implement identical bar-rendering logic: same `BAR_WIDTH = 8`, same 3-tier color thresholds (50/80), same filled/empty Unicode characters. `usage-quota.ts` extracted this into a `renderBar` function, but `context-usage.ts` still has the logic inline. This violates DRY and means a change to bar appearance must be made in two places.
- Fix: Extract `renderBar` to a shared utility (e.g., `src/cli/hud/bar.ts`) and import in both components.

## Suggestions (Lower Confidence)

- **`persistSessionCost` uses `!costUsd` guard instead of explicit `=== 0` check** - `src/cli/hud/cost-history.ts:43` (Confidence: 65%) -- The guard `if (!costUsd) return;` is falsy-based, which correctly handles `0`, `undefined`, `NaN`, and `null`. However, the codebase's `CLAUDE.md` prefers explicit checks. The explicit form `if (costUsd === 0 || costUsd == null) return;` would be more self-documenting. Minor style point.

- **`extractUsageFromStdin` uses two validation patterns for `resets_at`** - `src/cli/hud/index.ts:37-40` vs `src/cli/hud/index.ts:28-35` (Confidence: 70%) -- The committed version used `fiveHour?.resets_at ?? null` (nullish coalescing) while the working tree changes switched to `typeof fiveHour?.resets_at === 'number' ? ... : null` (explicit type guard). The type-guard pattern matches how `used_percentage` is validated on lines 28-35. The uncommitted version is more consistent. Ensure these changes are committed.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The branch is well-structured with consistent patterns overall. The main blocking issue is the JSDoc that directly contradicts the runtime behavior. The should-fix items (the `SECONDS_24_HOURS` bug fix and README preview drift) appear addressed in working tree changes but need to be committed. The duplicated bar-rendering logic is pre-existing and non-blocking.
