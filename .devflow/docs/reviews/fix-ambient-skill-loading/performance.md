# Performance Review Report

**Branch**: fix/ambient-skill-loading -> main
**Date**: 2026-03-20

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical performance issues found.

### HIGH

No high-severity performance issues found.

### MEDIUM

**Sequential `fs.access` calls in dry-run path could use `Promise.all`** - `src/cli/commands/uninstall.ts:206-207`
**Confidence**: 82%
- Problem: Two independent `fs.access` checks (`.docs/` and `.memory/`) are awaited sequentially. Each `fs.access` is a filesystem stat call. While individually fast, the pattern is "sequential when parallel is possible" -- a textbook I/O performance anti-pattern.
- Impact: Minor in practice (two stat calls are ~1ms total on local filesystems), but this is a CLI cold path (dry-run) where user perceives latency. More importantly, it sets a precedent for sequential-when-parallel patterns.
- Fix: Use `Promise.allSettled` to parallelize the two independent checks:
  ```typescript
  const [docsResult, memoryResult] = await Promise.allSettled([
    fs.access(docsDir),
    fs.access(memoryDir),
  ]);
  if (docsResult.status === 'fulfilled') extras.push('.docs/');
  if (memoryResult.status === 'fulfilled') extras.push('.memory/');
  ```

## Issues in Code You Touched (Should Fix)

No should-fix performance issues found.

## Pre-existing Issues (Not Blocking)

No critical or high pre-existing performance issues found in changed files.

## Suggestions (Lower Confidence)

- **Redundant `Set` dedup in `formatDryRunPlan` may be unnecessary** - `src/cli/commands/uninstall.ts:62-64` (Confidence: 65%) -- `formatDryRunPlan` wraps each input array in `new Set(...)` to deduplicate, but the upstream `computeAssetsToRemove` already produces unique entries by design (skills/agents only added if not in `retainedSkills`). The dedup is defensive but allocates three extra Sets per call. Not harmful, but unnecessary work.

- **Integration tests spawn external `claude` processes with 30-60s timeouts** - `tests/integration/ambient-activation.test.ts:73-91` (Confidence: 60%) -- Two new integration test cases (`loads skills for GUIDED classification` and `loads skills for ORCHESTRATED classification`) each spawn a `claude -p` subprocess via `execFileSync`. The ORCHESTRATED variant has a 60-second timeout. These are excluded from `npm test` (manual `npm run test:integration` only), so they do not impact CI speed. However, if accidentally included in the main test suite, they would add significant latency.

- **Shell hook invokes `jq` three times per prompt** - `scripts/hooks/ambient-prompt:15,20,44` (Confidence: 70%) -- The ambient-prompt hook calls `jq` three separate times: twice to extract fields from input JSON and once to produce output JSON. These could be combined into a single `jq` invocation that extracts both `.cwd` and `.prompt` in one pass. However, this is a pre-existing pattern (only the PREAMBLE string changed in this PR), and each `jq` call is sub-millisecond on modern systems with the binary already cached.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 9/10
**Recommendation**: APPROVED

### Rationale

This PR is primarily a fix for ambient skill loading (removing the `allowed-tools` restriction from the ambient-router skill) plus a new `--dry-run` flag for uninstall and expanded test coverage. The changes are well-scoped:

- **No N+1 patterns**: No database or loop-based I/O.
- **No synchronous I/O in production paths**: The uninstall command uses async `fs` throughout.
- **No memory leak risks**: No event listeners, caches, or long-lived resources introduced.
- **No blocking operations**: The shell hook change is a single-line PREAMBLE string extension -- negligible impact.
- **Test helpers use `execFileSync`**: Appropriate for integration tests that run out-of-band.
- **Pure functions (`formatDryRunPlan`, `computeAssetsToRemove`)**: Zero I/O, trivially fast, well-tested.

The single MEDIUM finding (sequential `fs.access`) is a minor optimization opportunity in a cold CLI path. It does not warrant blocking the merge.
