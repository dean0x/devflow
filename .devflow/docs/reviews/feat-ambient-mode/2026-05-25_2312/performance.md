# Performance Review Report

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### CRITICAL
(none)

### HIGH
(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Sequential fs.rm() loop over 224+ legacy skill names** - `src/cli/commands/init.ts:979`
**Confidence**: 82%
- Problem: The `LEGACY_SKILL_NAMES` array (now 224 entries after this PR adds 16 more) is iterated sequentially with `for...await fs.rm()`. Each call is an independent filesystem operation that could run in parallel. At 224+ entries, this is ~224 sequential syscalls where the vast majority will fail with ENOENT (expected). On slow filesystems or network-mounted home directories, this adds measurable latency to `devflow init`.
- Fix: Use `Promise.allSettled` to parallelize the cleanup:
```typescript
const results = await Promise.allSettled(
  LEGACY_SKILL_NAMES.map(legacy =>
    fs.rm(path.join(skillsDir, legacy), { recursive: true })
  )
);
staleRemoved = results.filter(r => r.status === 'fulfilled').length;
```
- Note: This is pre-existing code not modified in this PR. The PR only adds 16 new entries to the array. The incremental impact of 16 additional sequential calls is negligible, but the cumulative pattern is worth noting for a future optimization pass.

## Suggestions (Lower Confidence)

- **installCommandsRule() called unconditionally in addAmbientHook** - `src/cli/commands/ambient.ts:148` (Confidence: 65%) — `installCommandsRule()` always writes the file even when the hook is already registered and settings are unchanged. A content-comparison check before writing could skip the unnecessary write, but since the file is small (~700 bytes) and this runs only during `devflow ambient --enable` or `devflow init` (not on every prompt), the impact is negligible.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Performance Score**: 9/10
**Recommendation**: APPROVED

The changes in this PR are performance-neutral. The code modifications are:
1. Extracting `installCommandsRule()`/`removeCommandsRule()` helpers — no runtime change, pure refactoring
2. Adding 16 string literals to a static array — negligible memory impact (~400 bytes)
3. Fixing classification discard logic — same number of operations, just different return semantics
4. Narrowing the ENOENT catch in `removeCommandsRule()` — identical performance, better error propagation

No N+1 patterns, no blocking I/O in hot paths, no unbounded caches, no algorithmic regressions introduced.
