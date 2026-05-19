# Performance Review Report

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Sequential subprocess spawning for count-active in capacity review** - `src/cli/commands/decisions.ts:878-899`
**Confidence**: 82%
- Problem: The capacity review handler spawns `execFileSync('node', [jsonHelperPath, 'count-active', ...])` twice in a sequential loop (once for decisions, once for pitfalls). Each spawn pays full Node.js process startup cost (~50-100ms). These two calls are independent and could run in parallel.
- Impact: Adds ~100-200ms of unnecessary latency to the interactive `--review capacity` flow. Not critical since this is a user-interactive CLI command, but noticeable.
- Fix: Not blocking since this is pre-existing code and an interactive CLI path. Could be improved by either (a) importing `countActiveHeadings` directly into the TS CLI instead of shelling out, or (b) running both `execFileSync` calls via `Promise.all` with `execFile` (async). The current architecture deliberately shells out to json-helper.cjs as a "single source of truth" bridge (D23), which is a valid design trade-off.

## Suggestions (Lower Confidence)

- **Lock timeout regression in --review observations** - `src/cli/commands/decisions.ts:646` (Confidence: 72%) -- The old code used a single `fs.mkdir()` attempt that failed instantly if the lock was held. The new code calls `acquireMkdirLock(decisionsLockDir)` with default 30-second timeout and 100ms polling interval. For an interactive CLI command where the user is waiting, spinning up to 30 seconds before showing the "currently running" error adds latency in the contention case. This is likely intentional (to handle transient locks from stale background agents), but worth confirming the default timeout is appropriate for interactive use. Consider passing a shorter timeout like `acquireMkdirLock(decisionsLockDir, 5_000)`.

- **`tryImmediatePromotion` creates a `new Date()` on every call** - `scripts/hooks/json-helper.cjs:518` (Confidence: 65%) -- The extracted helper calls `new Date(entry.first_seen).getTime()` followed by `Date.now()` each invocation. The `first_seen` field was just set to `nowIso` moments earlier, so parsing it back from ISO string is redundant work. Could pass the timestamp directly. Micro-optimization -- negligible unless processing thousands of observations per batch (current cap is 100).

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Performance Score**: 9/10
**Recommendation**: APPROVED

The changes are a clean refactoring pass: extracting `tryImmediatePromotion` as a helper, exporting `acquireMkdirLock`/`formatStaleReason` for reuse, and promoting inline logic (`filterEligibleEntries`, `sortByLeastUsed`) into testable exported functions. No new algorithmic complexity, no new I/O operations, no memory leaks introduced, and no N+1 patterns. The `[...entries].sort()` in `sortByLeastUsed` creates a defensive copy which is correct (avoids mutating the caller's array) and negligible at the scale these collections operate (max ~100 entries). The lock acquisition change from instant-fail to spin-wait is a behavioral improvement for robustness, with a minor trade-off in the contention case noted in Suggestions.
