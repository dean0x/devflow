# Regression Review Report

**Branch**: feat/hud-session-reset-cost-tracking -> main
**Date**: 2026-04-20

## Issues in Your Changes (BLOCKING)

### HIGH

**README HUD preview does not match actual component output (3 discrepancies)** - `README.md:62-64`
**Confidence**: 92%
- Problem: The README HUD preview example diverges from what the code actually renders in three ways:
  1. Line 63 shows `5h ↻2h15m ████░░░░ 45%` (recycle symbol, no space in countdown, countdown before bar) but `usage-quota.ts` renders `5h ████░░░░ 45% (2h 15m)` (parenthesized, spaced, countdown after percent).
  2. Line 63 shows `▓▓▓▓▓▓▓▓ 100%` without a label prefix, but `context-usage.ts` renders `Context ████░░░░ 42%` with a "Context" prefix.
  3. Line 64 shows `⏱ 15m` (session duration) but `sessionDuration` has been removed from `HUD_COMPONENTS` in `config.ts` and `LINE_GROUPS` in `render.ts`, so it will never render in the default configuration.
- Impact: Users reading the README will form incorrect expectations about HUD output format. The preview is the primary visual documentation of the HUD.
- Fix: Update the README preview to match the actual rendered output:
  ```
  ~/devflow · main · +2 -1 · v2.0.0+3
  Context ████░░░░ 42% · 5h ████░░░░ 45% (2h 15m) · 7d ████████ 70% (3d 12h)
  Opus 4.6 (1M) · 3 MCPs 2 rules · $1.42 · $18.50/wk · $62.30/mo
  ```
  Also update the text description on line 59 to remove "session duration" from the feature list since the component is now omitted from defaults.

### MEDIUM

**Committed `SECONDS_24_HOURS` constant equals 24 days, not 24 hours** - `src/cli/hud/cost-history.ts:10` (committed version)
**Confidence**: 95%
- Problem: In the committed version (HEAD), the constant is defined as `const SECONDS_24_HOURS = 24 * SECONDS_PER_DAY` which evaluates to `24 * 86400 = 2,073,600` seconds (24 days), not 24 hours (86,400 seconds). This constant was used in `runCleanup()` at the archival threshold: `if (age > SECONDS_24_HOURS)`, meaning session files would only be archived after 24 *days* instead of the intended 24 hours.
- Impact: Session cost files accumulate in the `sessions/` directory for 24 days instead of being archived after 24 hours. The directory grows ~24x larger than intended before cleanup triggers. The uncommitted working tree fix correctly uses `SECONDS_PER_DAY` (86400) which is the correct 24-hour threshold.
- Fix: The uncommitted changes already fix this by removing `SECONDS_24_HOURS` and using `SECONDS_PER_DAY` directly. Commit the working tree changes to ship the fix.

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

No issues found.

## Suggestions (Lower Confidence)

- **`formatCountdown` JSDoc says "no spaces" but code produces spaces** - `src/cli/hud/components/usage-quota.ts:33` (Confidence: 75%) -- The JSDoc comment on line 33 says `Format: '2h15m', '3d12h', '45m' (compact, no spaces)` but the working tree code on lines 49 and 54 produces `${days}d ${hours}h` and `${totalHours}h ${minutes}m` (with spaces). The committed version matches the JSDoc (no spaces); the uncommitted version adds spaces without updating the JSDoc.

- **`sessionDuration` import and COMPONENT_MAP entry remain as dead code** - `src/cli/hud/render.ts:16,34` (Confidence: 65%) -- `sessionDuration` is still imported and registered in `COMPONENT_MAP` but can never execute because it is absent from both `HUD_COMPONENTS` and `LINE_GROUPS`. The comment says "retained for reinstatement" which is an intentional design choice, but the import and map entry are unreachable code that will be tree-shaken in any production build regardless.

- **`costHistory` rendered as `null` when `session_id` is absent from stdin** - `src/cli/hud/index.ts:137` (Confidence: 62%) -- When `stdin.session_id` is missing (which can happen if the HUD runs before Claude Code sends a session ID), `costHistory` will be `null` and weekly/monthly cost will silently not render. This is likely intentional graceful degradation but may surprise users who expect cost tracking to always work.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core regression concern is the `SECONDS_24_HOURS` bug in committed code (24 days instead of 24 hours for session file archival). The uncommitted working tree changes already fix this correctly. The README preview documentation drift should be addressed before merge to avoid user confusion -- the HUD preview is the primary visual documentation and currently misrepresents the actual output in three distinct ways. No functional regressions were found in the migration from OAuth-based usage fetching to stdin-based extraction; all old imports (`usage-api.ts`, `credentials.ts`) are cleanly removed with no dangling references. The `sessionDuration` removal from defaults is intentional and well-documented with reinstatement instructions. All tests pass (61 component tests + 12 render tests).
