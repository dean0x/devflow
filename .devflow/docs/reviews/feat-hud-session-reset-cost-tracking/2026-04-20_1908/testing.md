# Testing Review Report

**Branch**: feat/hud-session-reset-cost-tracking -> main
**Date**: 2026-04-20

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing test for `persistSessionCost` path traversal guard** - `src/cli/hud/cost-history.ts:45`
**Confidence**: 90%
- Problem: A defense-in-depth path traversal guard was added (`if (!sessionId || /[/\\]/.test(sessionId)) return;`) but there is no test validating this behavior. This is a security-sensitive boundary validation that should have explicit test coverage to prevent regression.
- Fix: Add tests to `tests/cost-history.test.ts`:
```typescript
it('skips write when sessionId contains path separator', async () => {
  const { persistSessionCost } = await importCostHistory();
  persistSessionCost('../evil', 1.00, '/cwd');
  expect(fs.existsSync(getSessionsDir())).toBe(false);
});

it('skips write when sessionId contains backslash', async () => {
  const { persistSessionCost } = await importCostHistory();
  persistSessionCost('..\\evil', 1.00, '/cwd');
  expect(fs.existsSync(getSessionsDir())).toBe(false);
});

it('skips write when sessionId is empty', async () => {
  const { persistSessionCost } = await importCostHistory();
  persistSessionCost('', 1.00, '/cwd');
  expect(fs.existsSync(getSessionsDir())).toBe(false);
});
```

### MEDIUM

**Misleading JSDoc on `formatCountdown` contradicts implementation** - `src/cli/hud/components/usage-quota.ts:33`
**Confidence**: 92%
- Problem: The JSDoc says `Format: '2h15m', '3d12h', '45m' (compact, no spaces)` but the implementation now returns `'2h 15m'`, `'3d 12h'` (with spaces). The uncommitted changes updated the format to include spaces, but the documentation was not updated. Tests match the new behavior (`(2h 15m)`), so the JSDoc is stale.
- Fix: Update the JSDoc to reflect the actual format:
```typescript
/**
 * Format seconds remaining until a reset timestamp into compact form.
 * Returns '' if the timestamp is in the past or not provided.
 * Format: '2h 15m', '3d 12h', '45m'
 */
```

**No dedicated unit tests for exported `formatCountdown` function** - `src/cli/hud/components/usage-quota.ts:35`
**Confidence**: 82%
- Problem: `formatCountdown` is a public exported function with time-dependent logic (days/hours/minutes formatting, past-timestamp handling). It is tested only indirectly through `usageQuota` component tests using `Date.now()`-relative timestamps with 30-second buffers. Dedicated unit tests with fixed inputs would be more reliable and cover edge cases (e.g., exactly 24h remaining = `1d` not `24h`, exactly 60m = `1h` not `60m`, 0 remaining = empty string).
- Fix: Add direct unit tests:
```typescript
describe('formatCountdown', () => {
  it('returns empty string for past timestamp', () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    expect(formatCountdown(past)).toBe('');
  });

  it('formats hours and minutes', () => {
    const future = Math.floor(Date.now() / 1000) + 2 * 3600 + 30 * 60 + 10;
    expect(formatCountdown(future)).toBe('2h 30m');
  });

  it('formats days and hours', () => {
    const future = Math.floor(Date.now() / 1000) + 2 * 86400 + 5 * 3600 + 10;
    expect(formatCountdown(future)).toBe('2d 5h');
  });

  it('omits zero sub-units', () => {
    const future = Math.floor(Date.now() / 1000) + 3 * 86400 + 10;
    expect(formatCountdown(future)).toBe('3d');
  });

  it('shows minutes only when under 1 hour', () => {
    const future = Math.floor(Date.now() / 1000) + 45 * 60 + 10;
    expect(formatCountdown(future)).toBe('45m');
  });
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Misleading comment in `importCostHistory` helper** - `tests/cost-history.test.ts:36`
**Confidence**: 85%
- Problem: The comment says "Use dynamic import with cache-busting to pick up env changes" but no cache-busting is actually performed. The import path `'../src/cli/hud/cost-history.js'` uses Node's default module cache. The tests work correctly because `getCostFilePaths()` reads `process.env.DEVFLOW_DIR` at call time, not at import time, so module caching is irrelevant. The misleading comment could confuse future maintainers into thinking cache-busting is necessary.
- Fix: Update the comment to accurately describe why dynamic import works:
```typescript
async function importCostHistory() {
  // Dynamic import is fine — getCostFilePaths reads DEVFLOW_DIR at call time, not import time
  const mod = await import('../src/cli/hud/cost-history.js');
  return mod;
}
```

**`runCleanup` and `trimArchive` have no test coverage** - `src/cli/hud/cost-history.ts:89-155`
**Confidence**: 80%
- Problem: The cleanup path (archiving sessions >24h, cleaning orphaned `.tmp` files >1h, trimming archive >500 entries older than 90 days) is entirely untested. The cleanup only triggers when `entry.timestamp % 50 === 0`, making it statistically unlikely to fire during tests. These are file management operations that delete data -- untested deletions are a risk.
- Fix: Consider extracting `runCleanup` as a named export (or testing it by manipulating timestamps to hit the `% 50 === 0` condition). At minimum, add one integration test:
```typescript
it('archives session files older than 24 hours on cleanup', async () => {
  const { persistSessionCost, getCostFilePaths } = await importCostHistory();
  const sessionsDir = getSessionsDir();
  const archivePath = getArchivePath();
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Write an old session file manually (>24h old timestamp)
  const nowSeconds = Math.floor(Date.now() / 1000);
  const oldEntry = JSON.stringify({
    session_id: 'old-session',
    cost_usd: 5.00,
    timestamp: nowSeconds - 2 * 86400, // 2 days ago
    cwd: '/cwd',
  });
  fs.writeFileSync(path.join(sessionsDir, 'old-session.json'), oldEntry);

  // Trigger cleanup by writing with timestamp divisible by 50
  // (or export runCleanup for direct testing)
  // ... cleanup coverage is a gap
});
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Component ID count mismatch in types.ts JSDoc** - `src/cli/hud/types.ts:23`
**Confidence**: 88%
- Problem: The JSDoc comment says "the 16 HUD components" but the `ComponentId` type lists 16 union members while `HUD_COMPONENTS` array has 15 (sessionDuration was removed). The comment and the type still reference 16 components. The test at `hud-render.test.ts:207` correctly tests for 15 and documents the discrepancy in its name, but the source type JSDoc is stale.

## Suggestions (Lower Confidence)

- **Time-dependent tests use `Date.now()` with manual buffers** - `tests/hud-components.test.ts:406` (Confidence: 65%) -- The countdown tests add `+ 30` seconds as buffer against timing drift. While pragmatic, using `vi.useFakeTimers()` would eliminate timing sensitivity entirely.

- **`cost-history.test.ts` dynamic import is unnecessary** - `tests/cost-history.test.ts:35-39` (Confidence: 70%) -- Since `getCostFilePaths` reads `process.env.DEVFLOW_DIR` at call time, a static import would work identically. The dynamic import adds async overhead to every test without benefit.

- **No test for `sessionCost` component when `monthlyCost` is present but `weeklyCost` is null** - `tests/hud-components.test.ts:549-558` (Confidence: 75%) -- Tests cover weekly-only and both-present cases, but not monthly-only. The component handles this correctly (line 16 of `session-cost.ts`), but the asymmetric coverage is a gap.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new `cost-history.test.ts` suite is well-structured with 20 tests covering the core aggregation logic, boundary cases (malformed files, deduplication, time windows), and the persistence contract. The existing HUD component tests were properly updated to match the new output format (countdown parentheses, "Context" label, component count). The primary gap is the untested path traversal guard -- a security-sensitive boundary that should have explicit regression tests before merge.
