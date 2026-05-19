# Documentation Review Report

**Branch**: feat/hud-session-reset-cost-tracking -> main
**Date**: 2026-04-20

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**README HUD preview will contradict actual rendering after uncommitted changes are committed** - `README.md:63`
**Confidence**: 92%
- Problem: The committed README HUD preview shows countdown format `5h ↻2h15m ████░░░░ 45%` (recycle symbol, no spaces, countdown before bar). The uncommitted changes to `usage-quota.ts` change this to `5h ████░░░░ 45% (2h 15m)` (parentheses, with spaces, countdown after percent). Once uncommitted changes are committed, the README becomes actively misleading about the HUD's appearance.
- Additionally, the README preview line 64 shows `⏱ 15m` (sessionDuration), but `sessionDuration` is being removed from `HUD_COMPONENTS` and `LINE_GROUPS` in the uncommitted changes.
- Fix: Update README.md line 63-64 to match the new rendering:
```
Context ████████ 100% · 5h ████░░░░ 45% (2h 15m) · 7d ████████ 70% (3d 12h)
Opus 4.6 (1M) · 3 MCPs 2 rules · $1.42 · $18.50/wk · $62.30/mo
```

### MEDIUM

**JSDoc on `formatCountdown` contradicts implementation after uncommitted changes** - `src/cli/hud/components/usage-quota.ts:33`
**Confidence**: 95%
- Problem: The JSDoc says `Format: '2h15m', '3d12h', '45m' (compact, no spaces)` but the uncommitted code now produces `'2h 15m'`, `'3d 12h'` (with spaces). The comment actively misleads about the function's output format.
- Fix: Update the JSDoc to match:
```typescript
/**
 * Format seconds remaining until a reset timestamp into compact form.
 * Returns '' if the timestamp is in the past or not provided.
 * Format: '2h 15m', '3d 12h', '45m'
 */
```

**types.ts ComponentId JSDoc says "16 HUD components" but HUD_COMPONENTS now has 15** - `src/cli/hud/types.ts:22`
**Confidence**: 90%
- Problem: The `ComponentId` type's JSDoc says "the 16 HUD components" but `HUD_COMPONENTS` in `config.ts` now has 15 entries (sessionDuration removed). While the `ComponentId` union type itself still lists 16 IDs (since sessionDuration code is retained), the "16" in the JSDoc refers to the active count which is now 15. This creates confusion about whether there are 15 or 16 components.
- Fix: Update the JSDoc to be count-agnostic:
```typescript
/**
 * Component IDs — all HUD component identifiers.
 * Not all may be enabled by default (see HUD_COMPONENTS in config.ts).
 */
```

**`sessionCost` component lacks JSDoc** - `src/cli/hud/components/session-cost.ts:4`
**Confidence**: 82%
- Problem: The `sessionCost` component was enhanced with weekly/monthly cost aggregation but has no JSDoc at all. Other components in this codebase (`contextUsage`) have JSDoc describing their behavior. The new cost aggregation logic (`costHistory.weeklyCost`, `costHistory.monthlyCost`) is non-obvious -- readers cannot tell from the code alone what `/wk` and `/mo` represent (rolling 7-day vs. calendar week? rolling 30-day vs. calendar month?).
- Fix: Add JSDoc explaining the component:
```typescript
/**
 * Session cost component with optional weekly/monthly aggregation.
 * Shows current session cost, plus rolling 7-day (/wk) and 30-day (/mo) totals
 * when costHistory data is available.
 */
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`renderQuotaWindow` helper has no JSDoc** - `src/cli/hud/components/usage-quota.ts:60`
**Confidence**: 80%
- Problem: The new `renderQuotaWindow` function is a refactoring that encapsulates the quota window rendering logic (label, bar, countdown). It has no documentation explaining its purpose or that the countdown appears in parentheses after the percent value. While internal, documenting the rendering format helps future maintainers understand the expected output shape.
- Fix: Add a brief JSDoc:
```typescript
/**
 * Render a single quota window: "5h ████░░░░ 45% (2h 15m)"
 * Countdown is omitted when resetsAt is null or in the past.
 */
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`trimArchive` function has no JSDoc** - `src/cli/hud/cost-history.ts:135` (Confidence: 70%) -- Unlike `runCleanup` and the other exported functions which all have JSDoc, `trimArchive` is undocumented. A brief description of the 90-day retention policy would be helpful since the threshold logic is split between `trimArchive` (90-day cutoff) and `ARCHIVE_TRIM_THRESHOLD` (line count gate).

- **README HUD description mentions "session duration" but feature is being removed** - `README.md:59` (Confidence: 75%) -- The README feature description says "context usage, model, session duration, cost with weekly/monthly totals" but `sessionDuration` is being removed from the default component list. The text should either drop "session duration" or clarify it is optional/retained.

- **`SECONDS_24_HOURS` removal leaves no named constant for the 24-hour archival threshold** - `src/cli/hud/cost-history.ts:123` (Confidence: 62%) -- The uncommitted change removes `SECONDS_24_HOURS` and replaces its usage with `SECONDS_PER_DAY`, which is semantically correct but the comment still says "Archive session files older than 24 hours". This is fine since `SECONDS_PER_DAY === 24 * 3600`, but the existence of both `SECONDS_PER_DAY` (for time calculations) and a comment saying "24 hours" is mildly inconsistent.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 3 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The code documentation within `cost-history.ts` is well done -- JSDoc on all exported functions, inline comments explaining the atomic write pattern, cleanup strategy, and deduplication logic. The main gaps are: (1) the README HUD preview and feature description will contradict actual behavior once the uncommitted refactoring changes (countdown format, sessionDuration removal) are committed, and (2) the `formatCountdown` JSDoc directly contradicts its implementation after the spacing change.
