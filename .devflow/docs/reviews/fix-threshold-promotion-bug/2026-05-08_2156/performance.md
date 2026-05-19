# Performance Review Report

**Branch**: feat/pr-description-pipeline -> main
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

**Sequential lock acquire/release per deprecation in capacity review loop** - `src/cli/commands/decisions.ts:885-895`
**Confidence**: 82%
- Problem: The `for (const entryId of selected)` loop calls `updateDecisionsStatus` per entry, each of which acquires and releases `.decisions.lock` (mkdir + rmdir) independently. For N deprecations, this means N lock acquire/release cycles each involving filesystem operations and a file read/regex-replace/write. The comment at line 882 acknowledges this is sequential, but batching the file mutations under a single lock acquisition would reduce filesystem overhead.
- Fix: Consider a batch variant of `updateDecisionsStatus` that acquires the lock once, applies all status changes to the in-memory content, then writes once. This is a pre-existing pattern (not introduced by this PR) so it is non-blocking.

### LOW

**`execFileSync` blocks the event loop during count-active calls** - `src/cli/commands/decisions.ts:923-927`
**Confidence**: 80%
- Problem: Two `execFileSync` calls spawn `node json-helper.cjs count-active` synchronously. Each spawns a full Node process, parses a markdown file, and returns a count. Since this is an interactive CLI command (user is waiting at a prompt), blocking is acceptable here, but using `execFile` (async) with `await` would free the event loop for UI updates during the brief wait.
- Fix: Replace `execFileSync` with `util.promisify(execFile)` or `child_process.execFile` with a promise wrapper. Pre-existing pattern, non-blocking.

## Suggestions (Lower Confidence)

(none -- all findings met the 80% threshold or were dropped)

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 1 |

**Performance Score**: 9/10
**Recommendation**: APPROVED

### Rationale

This PR introduces no performance regressions. The changes are focused on:

1. **`tryImmediatePromotion` unification** (json-helper.cjs): Replaces an inline copy of promotion logic with a call to the existing function, now parameterized with `guardCreated` and `firstSeenFallback` options. The runtime cost is identical -- same conditional checks, same `Date.now()` call, same `new Date().getTime()` parsing. The destructuring of `opts` adds negligible overhead (nanoseconds). No hot-path impact.

2. **`clearCapacityNotifications` extraction** (decisions.ts): Pure extraction refactor -- iterates `Object.keys(counts)` (2 keys max: decisions + pitfalls) and performs trivial property checks/assignments. Zero measurable performance difference from the inlined version it replaces.

3. **`toDecisionsStatus` with `Set` lookup** (decisions.ts): The `VALID_STATUSES` Set with 5 entries is created once at module load. `Set.has()` is O(1) and called only during capacity review parsing (small N). Clean and efficient.

4. **`acquireMkdirLock` EEXIST guard** (learn.ts): Re-throws non-EEXIST errors instead of silently retrying. This is a correctness fix that may *improve* performance in edge cases by failing fast on permission errors or disk-full conditions rather than spinning in the retry loop for 30 seconds.

The two pre-existing observations (sequential lock cycling and synchronous child process spawns) are both in an interactive CLI path where latency is dominated by user think-time at the prompt, making them low-priority.
