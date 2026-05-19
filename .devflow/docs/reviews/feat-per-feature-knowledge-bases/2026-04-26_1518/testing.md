# Testing Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26
**PR**: #193

## Issues in Your Changes (BLOCKING)

### HIGH

**`try/catch` boolean pattern instead of `expect(...).toThrow()` in CLI tests** (5 occurrences) - `tests/feature-kb/feature-kb.test.ts:509`, `tests/feature-kb/feature-kb.test.ts:525`, `tests/feature-kb/feature-kb.test.ts:538`, `tests/feature-kb/feature-kb.test.ts:549`, `tests/feature-kb/feature-kb.test.ts:561`
**Confidence**: 85%
- Problem: Five new CLI tests use a manual `try/catch` with a `threw` boolean flag to verify that a subprocess exits non-zero. This pattern is fragile because if the `execFileSync` call succeeds unexpectedly, the test silently passes with `threw = false` but the final `expect(threw).toBe(true)` catches it. However, the test provides no descriptive failure message and it cannot distinguish between the expected exit code (1) and other failures (e.g., ENOENT from a missing node binary). Additionally, the pattern requires 7 lines where 1-2 would suffice with `expect(...).toThrow()`, which is already used successfully in `tests/feature-kb/kb-command.test.ts:38-40` and `tests/feature-kb/kb-command.test.ts:61-63` for the same kind of assertion.
- Fix: Replace with the idiomatic pattern already established in the same test suite:
```typescript
// Before (5 occurrences):
let threw = false;
try {
  execFileSync('node', [FEATURE_KB_CJS, 'stale-slugs'], { encoding: 'utf8', stdio: 'pipe' });
} catch (e: unknown) {
  threw = true;
  expect((e as NodeJS.ErrnoException & { status?: number }).status).toBe(1);
}
expect(threw).toBe(true);

// After:
expect(() =>
  execFileSync('node', [FEATURE_KB_CJS, 'stale-slugs'], { encoding: 'utf8', stdio: 'pipe' })
).toThrow();
```
If verifying the specific exit code is needed (beyond just "it threw"), consider a helper like `expectExitCode(fn, 1)` to avoid the 7-line pattern repeating.

### MEDIUM

**Duplicate test coverage across `feature-kb.test.ts` and `kb-command.test.ts` for new CLI subcommands** - `tests/feature-kb/feature-kb.test.ts:458-571`, `tests/feature-kb/kb-command.test.ts:82-120`
**Confidence**: 82%
- Problem: The `stale-slugs` and `refresh-context` CLI subcommands are tested in both files with substantially overlapping assertions. For instance, `feature-kb.test.ts` lines 459-464 and `kb-command.test.ts` lines 82-88 both test "stale-slugs outputs nothing for non-stale index (non-git repo)" with nearly identical logic. The same overlap exists for `refresh-context` metadata output, missing slug, and unknown slug exit cases. This increases maintenance surface without adding meaningful additional coverage.
- Fix: Consolidate CLI subcommand tests into a single location (either `kb-command.test.ts` which already tests all other CLI subcommands, or `feature-kb.test.ts` for the integration-level tests that require a real git repo). The `feature-kb.test.ts` "stale-slugs (git repo with changes)" test adds genuine value (real git history); the rest of the `feature-kb.test.ts` CLI tests are duplicates of `kb-command.test.ts`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Non-null assertions (`!`) after `loadIndex` without narrowing in pre-existing tests** (6 occurrences) - `tests/feature-kb/feature-kb.test.ts:178`, `tests/feature-kb/feature-kb.test.ts:195`, `tests/feature-kb/feature-kb.test.ts:215`, `tests/feature-kb/feature-kb.test.ts:260`, `tests/feature-kb/feature-kb.test.ts:278`, `tests/feature-kb/feature-kb.test.ts:289`
**Confidence**: 83%
- Problem: Several tests that existed before this branch used `index!.features[...]` without checking that `index` was non-null first. This PR added `expect(index).not.toBeNull()` assertions before the non-null accesses, which is good defensive practice. However, the fix was applied inconsistently: the added assertions guard the non-null access but the non-null operator `!` is still used, meaning a type assertion masks what should be a narrowing check. This is a minor improvement but leaves the pattern half-corrected.
- Fix: This is acceptable as-is (the `expect().not.toBeNull()` will fail the test if null, making the `!` safe). No blocking change needed, but for consistency, could use `if (!index) throw ...` or `assert(index)` for proper TypeScript narrowing.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**No tests for `session-end-kb-refresh` hook behavior** - `scripts/hooks/session-end-kb-refresh`
**Confidence**: 85%
- Problem: The new `session-end-kb-refresh` shell hook (57 lines) has no behavioral test coverage. It was added to the `HOOK_SCRIPTS` array in `shell-hooks.test.ts` for syntax checking (`bash -n`), but none of its core behaviors are tested: the `DEVFLOW_BG_KB_REFRESH` guard, the throttle logic (2-hour check), the `.disabled` sentinel check, the stale-slugs check, or the background spawn. Other hooks in the project (e.g., `stop-update-memory`, `prompt-capture-memory`, `preamble`) have extensive behavioral tests in `shell-hooks.test.ts`.
- Fix: Add behavioral tests similar to the existing `working memory queue behavior` describe block. At minimum, test:
  - Guard: exits 0 when `DEVFLOW_BG_KB_REFRESH=1`
  - Guard: exits 0 when `.features/.disabled` exists
  - Throttle: exits 0 when `.kb-last-refresh` is recent
  - Happy path: verify it attempts to spawn when conditions are met (mock the spawn)

**No behavioral tests for `background-kb-refresh` script** - `scripts/hooks/background-kb-refresh`
**Confidence**: 80%
- Problem: The 167-line `background-kb-refresh` shell script only has syntax validation (`bash -n`). Its lock acquisition, watchdog timeout, per-slug iteration, and log rotation have no test coverage. This is a gap relative to `background-learning` which has pure function extraction tests.
- Fix: Extract testable pure functions (e.g., `acquire_lock`, `rotate_log`) similar to how `background-learning` exposes `check_daily_cap` and `increment_daily_counter` for isolated testing.

## Suggestions (Lower Confidence)

- **Missing `checkEntryFiles` unit test** - `scripts/hooks/lib/feature-kb.cjs:126` (Confidence: 70%) -- The `checkEntryFiles` function was extracted from `checkStaleness` in this branch, but it is not directly tested (only tested indirectly through `checkStaleness` and `checkAllStaleness`). A direct unit test would ensure the extraction preserved behavior.

- **`execSync` with unescaped paths in `kb-command.test.ts`** - `tests/feature-kb/kb-command.test.ts:15` (Confidence: 65%) -- The `execSync` calls construct shell commands with template literals (e.g., `` `node ${CJS_PATH} list ${tmp}` ``). If `tmp` ever contains spaces or special characters, these would break. The `feature-kb.test.ts` tests use `execFileSync` with array args which is safer. This is unlikely to cause issues with `os.tmpdir()` on most platforms but is an inconsistency.

- **Lock timeout reduced to 200ms may be flaky on slow CI** - `tests/feature-kb/feature-kb.test.ts:234` (Confidence: 62%) -- The lock timeout was reduced from 500ms to 200ms. On a slow CI runner or under heavy I/O, `Atomics.wait` granularity plus mkdir latency could cause intermittent failures.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces substantial new test coverage (tests/kb.test.ts with 16 tests for hook management, new CLI subcommand tests, manifest normalization tests, agent rename test update, and shell hook syntax checks). Coverage for the core library functions (feature-kb.cjs) is thorough. The main gaps are: (1) the `try/catch` boolean pattern inconsistency with established project conventions, (2) duplicate CLI test coverage across two files, and (3) missing behavioral tests for the two new shell hook scripts. The new `kb.test.ts` file is well-structured with clear AAA pattern, good edge case coverage (idempotency, preservation of unrelated settings), and follows the existing test organization conventions.
