# Testing Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**Date**: 2026-06-02_0013
**Focus**: testing (PR #233)
**Diff**: `git diff main...HEAD -- tests/ambient.test.ts`

## Verification Summary

All 40 tests in `tests/ambient.test.ts` pass (`npx vitest run` → pass: 40 fail: 0). Source under
test (`src/cli/commands/ambient.ts`) read in full to verify assertions against actual behavior.
Cross-cycle: the Cycle-1 EACCES flip (`.rejects` → `.resolves`, line 341-344) correctly pins the
new fail-safe contract — not re-raised.

Answers to the focused questions:

1. **Ordering-invariant test proves the invariant** — YES. `addAmbientHook(withHook, ...)` takes the
   early-return path (`changed` stays false because `hasPreamble` is true), and
   `removeLegacyCommandsRule()` runs at `ambient.ts:107` *before* the `if (!changed) return` at
   `ambient.ts:109`. The test asserting `fs.unlink` was called genuinely exercises the early-return
   purge path. Valid.
2. **Fail-safe (swallows ALL errors)** — adequately tested. Source uses a bare `catch {}`
   (not code-discriminated), so the single non-ENOENT case (EACCES) is representative of the entire
   non-ENOENT branch. ENOENT + EACCES together prove the contract. Minor comment/coverage mismatch
   noted below.
3. **Deleted tests genuinely dead** — YES. `installCommandsRule` and `COMMANDS_RULE_CONTENT` no
   longer exist as exports in `ambient.ts`. The deleted `describe('installCommandsRule')` and
   `describe('COMMANDS_RULE_CONTENT')` blocks tested removed symbols. No lost coverage of live behavior.
4. **Symmetric coverage gap** — `removeAmbientHook`'s unconditional purge on its early-return path is
   NOT proven by any test. See HIGH finding below.

## Issues in Your Changes (BLOCKING)

None. The changed tests are correct, pass, and the deletions are clean.

## Issues in Code You Touched (Should Fix)

### HIGH
**Missing symmetric ordering-invariant test for `removeAmbientHook` early-return path** — `tests/ambient.test.ts:251` — Confidence: 90%
- Problem: The new ordering-invariant test (line 94-104) proves `addAmbientHook` purges the legacy
  rule on its early-return path. But `removeAmbientHook` has the *same* structure — it calls
  `removeLegacyCommandsRule()` at `ambient.ts:128` *before* its early-return at `ambient.ts:130`
  (`if (!removedPrompt && !removedClassification) return`). No test asserts `fs.unlink` is called on
  that path. The closest test, `'is idempotent — safe to call when not present'` (line 251), passes a
  `Stop`-only settings object that triggers the early-return, but it only asserts `result === input` —
  it never asserts the purge ran. The prompt explicitly asks whether the unconditional invocation in
  BOTH functions is covered; for `removeAmbientHook` it is not. A regression that moved
  `removeLegacyCommandsRule()` after the early-return in `removeAmbientHook` would pass all current
  tests.
- Fix: Add a mirror test in the `removeAmbientHook` suite:
  ```typescript
  it('purges legacy rule even when nothing to remove (ordering invariant)', async () => {
    // No ambient/classification hooks → removeAmbientHook takes the early-return path.
    // removeLegacyCommandsRule MUST still run so stale commands.md files are cleaned up.
    const input = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }] } });
    const result = await removeAmbientHook(input);
    expect(result).toBe(input);                       // early-return preserved
    expect(fs.unlink).toHaveBeenCalledWith(COMMANDS_RULE_PATH); // purge still ran
  });
  ```
  (The suite's `beforeEach` already stubs `fs.unlink`, so no extra setup is needed.)

### MEDIUM
**Ordering-invariant test re-stubs mid-test in a brittle way** — `tests/ambient.test.ts:98-100` — Confidence: 82%
- Problem: The test calls `vi.restoreAllMocks()` then re-stubs `fs.unlink` to "assert on the second
  call." This works, but it discards the call-count isolation the `beforeEach` provides and couples
  the test to the fact that the *first* `addAmbientHook` also calls `unlink`. A cleaner assertion
  reasons only about the second call rather than tearing down and rebuilding the spy. This is a
  readability/robustness nit, not a correctness defect — the test does prove the invariant.
- Fix: Avoid the restore/re-stub dance; assert the call count delta instead, e.g. capture
  `(fs.unlink as Mock).mock.calls.length` before the second `addAmbientHook` and assert it increased,
  or clear with `vi.clearAllMocks()` (preserves the stub implementation) instead of
  `vi.restoreAllMocks()` (removes it, forcing the re-stub).

## Pre-existing Issues (Not Blocking)

None relevant to the testing lens within the changed scope.

## Suggestions (Lower Confidence)

- **Fail-safe comment over-promises vs. test coverage** - `tests/ambient.test.ts:341` (Confidence: 70%)
  — The renamed test exercises only EACCES; the source comment (`ambient.ts:61`) enumerates
  "ENOENT, EACCES, EPERM, EROFS, etc." Because the `catch {}` is not code-discriminated, EACCES is a
  sufficient representative, so this is acceptable — optionally add a non-Error throw (e.g.
  `mockRejectedValue('weird')`) to pin that even non-Error rejections are swallowed.
- **`fs.unlink` spy assertion is boundary-coupled** - `tests/ambient.test.ts:104` (Confidence: 65%)
  — Asserting on the `fs.unlink` spy is implementation-coupled, but `removeLegacyCommandsRule` returns
  `void` and its only contract IS the unlink side-effect at a fixed path, so spying on the fs boundary
  is the correct seam here. Noted for awareness, not a defect.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 1 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Testing Score**: 8
**Recommendation**: APPROVED_WITH_CONDITIONS
