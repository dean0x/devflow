# Testing Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Unused imports in sentinel.test.ts** - `tests/sentinel.test.ts:13-20`
**Confidence**: 95%
- Problem: Five functions are imported but never used in the test file: `addMemoryHooks`, `removeMemoryHooks`, `hasMemoryHooks` from `memory.js`, and `addLearningHook`, `hasLearningHook` from `learn.js`. The PR description mentions "CLI sentinel management" tests, but the file only tests shell hook behavior and `init.js` context hook registration utilities. The memory/learn CLI functions are never exercised here.
- Fix: Remove the unused imports:
```typescript
// Remove lines 12-20 entirely:
// import {
//   addMemoryHooks,
//   removeMemoryHooks,
//   hasMemoryHooks,
// } from '../src/cli/commands/memory.js';
// import {
//   addLearningHook,
//   hasLearningHook,
// } from '../src/cli/commands/learn.js';
```

**Missing coverage: CLI sentinel create/remove on --enable/--disable** - `src/cli/commands/memory.ts:333-355`, `src/cli/commands/learn.ts:933-956`
**Confidence**: 90%
- Problem: The production code adds sentinel file management to `devflow memory --enable` (removes `.working-memory-disabled`), `devflow memory --disable` (creates `.working-memory-disabled`), `devflow learn --enable` (removes `.learning-disabled`), and `devflow learn --disable` (creates `.learning-disabled`). These are new code paths with no test coverage. The PR description lists "CLI sentinel management" as a test focus area, and the unused imports in sentinel.test.ts suggest tests were planned but not written.
- Fix: Add tests for the CLI sentinel lifecycle. Example for memory:
```typescript
describe('memory CLI sentinel management', () => {
  it('--disable creates .working-memory-disabled sentinel', async () => {
    // Setup: settings.json with memory hooks, .memory/ dir
    // Act: run memory --disable equivalent
    // Assert: sentinel file exists at .memory/.working-memory-disabled
  });

  it('--enable removes .working-memory-disabled sentinel', async () => {
    // Setup: sentinel exists
    // Act: run memory --enable equivalent
    // Assert: sentinel file no longer exists
  });
});
```

**Missing coverage: `devflow learn --status` sentinel warning path** - `src/cli/commands/learn.ts:389-398`
**Confidence**: 88%
- Problem: New code in `learn --status` checks for the `.learning-disabled` sentinel and emits a runtime-disabled warning. This UI feedback path has no test coverage. Similarly, `memory --status` at `memory.ts:310-316` has the same pattern with no tests.
- Fix: Add a test that verifies the `--status` output includes the runtime-disabled warning when the sentinel exists.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Weak assertion in background-memory-update sentinel test** - `tests/sentinel.test.ts:101-109`
**Confidence**: 85%
- Problem: The `background-memory-update` sentinel guard test only asserts `not.toThrow()` -- it does not verify that the hook actually skipped its work. Unlike other sentinel guard tests (e.g., `prompt-capture-memory` asserts no `.pending-turns.jsonl`, `pre-compact-memory` asserts no `backup.json`), this test has no observable side-effect assertion. The positive path (sentinel absent) is also missing entirely.
- Fix: Add a positive-path test and assert an observable side effect for both paths. For the disabled path, verify that no lock directory or processing file was created:
```typescript
it('exits cleanly and logs when .working-memory-disabled exists', () => {
  mkMemoryDir(tmpDir);
  writeDisabledSentinel(path.join(tmpDir, '.memory', '.working-memory-disabled'));
  expect(() => {
    execSync(`bash "${HOOK}" "${tmpDir}" ""`, { stdio: ['pipe', 'pipe', 'pipe'] });
  }).not.toThrow();
  // Verify no lock was acquired (the hook skipped processing)
  expect(fs.existsSync(path.join(tmpDir, '.memory', '.working-memory.lock'))).toBe(false);
});
```

**Conditional assertion weakens learned behaviors sentinel test** - `tests/sentinel.test.ts:339-355`
**Confidence**: 82%
- Problem: The "skips learned behaviors when `.learning-disabled` exists" test wraps its assertion in `if (output.length > 0)`. If the hook produces no output for any reason (e.g., a bug in the learning log parsing), the test silently passes without asserting anything. The corresponding positive-path test (line 324-337) does not use this conditional pattern, creating an asymmetry.
- Fix: Assert the output is empty when only learned behaviors would have been present (with learning disabled), or assert the non-containment unconditionally:
```typescript
it('skips learned behaviors when .learning-disabled exists', () => {
  // ... setup ...
  const output = execSync(...).toString().trim();
  // With only learning content and learning disabled, output should be empty
  expect(output).toBe('');
});
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Duplicated hook runner setup across test files** - `tests/sentinel.test.ts`, `tests/memory.test.ts`
**Confidence**: 80%
- Problem: Both `sentinel.test.ts` and `memory.test.ts` define nearly identical helper functions (`mkTmpDir`/`mkMemoryDir`/`sessionInput` and their async equivalents) and the same `runHook` patterns with `execSync`/`exec`. The session-start-context hook is tested in both files (sentinel.test.ts lines 272-373 and memory.test.ts lines 583-650) with overlapping coverage. This creates maintenance burden when hook contracts change.

## Suggestions (Lower Confidence)

- **Part ordering in sentinel.test.ts inconsistent with labels** - `tests/sentinel.test.ts:44,272,375` (Confidence: 65%) -- The file labels sections as "Part B" (line 44), "Part C" (line 169), "Part D" (line 197), "Part A" (line 272), then "Part A" again (line 375). The logical order A-B-C-D is not reflected in the physical layout, and there are two sections labeled "Part A". This is a readability concern only.

- **No negative test for `addContextHook` with malformed JSON** - `tests/sentinel.test.ts:377-433` (Confidence: 62%) -- The context hook registration tests cover the happy path (add, remove, idempotent, preserve-others) but do not test error handling for malformed settings JSON input. The `addContextHook` function calls `JSON.parse` directly and would throw on invalid input.

- **`extractPatternBlock` helper tested only indirectly** - `tests/ambient.test.ts:542-553` (Confidence: 60%) -- The new `extractPatternBlock` utility function is defined in ambient.test.ts but only exercised through the `ci-status-gate PATTERN block` drift test. If the function has a bug in its marker parsing, the drift test would silently produce empty arrays (which it does guard against with `.toBeGreaterThan(0)`, so this is partially mitigated).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 3 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The test suite provides solid sentinel guard coverage for all 6 hook scripts (prompt-capture, stop-update, background-update, pre-compact, session-start-memory, session-end-learning) plus the decisions scanner and the new session-start-context hook. The session-start-context tests cover all three feature gates (decisions disabled, learning disabled, empty CWD) and verify the extraction from session-start-memory. The context hook registration utilities (add/remove/has/idempotent) are well-tested.

The conditions for full approval: (1) remove the unused imports in sentinel.test.ts -- dead imports suggest planned tests that were not written, and (2) add CLI sentinel create/remove tests for `memory --enable/--disable` and `learn --enable/--disable`, which are new production code paths with no coverage.
