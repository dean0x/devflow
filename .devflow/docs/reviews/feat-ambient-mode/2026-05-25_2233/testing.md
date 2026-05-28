# Testing Review Report

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### HIGH

**Unit tests for `addAmbientHook`/`removeAmbientHook` produce real filesystem side-effects** - `tests/ambient.test.ts:17-140`
**Confidence**: 90%
- Problem: `addAmbientHook` now calls `fs.mkdir` and `fs.writeFile` on the real `COMMANDS_RULE_PATH` (`~/.claude/rules/devflow/commands.md`), and `removeAmbientHook` calls `fs.unlink` on it. Every unit test that calls these functions writes to (or deletes from) the developer's home directory. Unit tests must not produce side-effects on the real filesystem — this violates test isolation and can cause flaky failures in CI or when running tests in parallel. If the test suite runs on a machine without devflow installed, `removeAmbientHook` tests silently swallow an `ENOENT` error and still pass — hiding the coupling.
- Fix: Mock `fs.mkdir`, `fs.writeFile`, and `fs.unlink` in the `addAmbientHook`/`removeAmbientHook` test suites using `vi.mock('fs', ...)` or `vi.spyOn`. Alternatively, inject the filesystem dependency so tests can pass a fake. Example with spyOn:
  ```typescript
  import { vi, beforeEach, afterEach } from 'vitest';
  import { promises as fs } from 'fs';

  beforeEach(() => {
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'writeFile').mockResolvedValue();
    vi.spyOn(fs, 'unlink').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  ```

### MEDIUM

**`removeAmbientHook` stale-classification cleanup is not tested for the return-value path** - `tests/ambient.test.ts:152-171`
**Confidence**: 82%
- Problem: The test "also removes stale SessionStart classification hook from previous installs" verifies that `filterHookEntries` cleans the classification hook from SessionStart. However, the implementation at `ambient.ts:154` only checks `removedPrompt` (UserPromptSubmit changes) for the early-return guard (`if (!removedPrompt) return settingsJson`). If a user has **only** a stale classification hook in SessionStart and no UserPromptSubmit hooks at all, `removeAmbientHook` returns the original JSON unchanged — the classification hook is cleaned in the parsed object but then discarded because `removedPrompt` is false. There is no test covering this scenario.
- Fix: Add a test for the edge case where only a stale classification hook exists:
  ```typescript
  it('returns unchanged JSON when only stale classification hook exists (no UserPromptSubmit)', async () => {
    const input = JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: '/path/to/run-hook session-start-classification' }] },
        ],
      },
    });
    const result = await removeAmbientHook(input);
    // BUG: classification hook is NOT cleaned because removedPrompt is false
    // Decide whether this is intentional (stale hook left behind) or a bug
    // If a bug, fix ambient.ts to also check removedClassification
    expect(result).toBe(input); // Documents current behavior
  });
  ```

**Integration test bypasses actual preamble hook by manually injecting systemPrompt** - `tests/integration/ambient-activation.test.ts:38-43`
**Confidence**: 80%
- Problem: The "plan handoff" integration test passes `systemPrompt: 'EXECUTION_PLAN detected...'` directly to `runClaudeStreaming`, bypassing the actual preamble shell hook entirely. The test proves Claude responds to a system prompt by loading `devflow:implement`, but does not prove the preamble hook itself fires, detects plan markers, and produces the correct output. The test name says "all three markers triggers implement skill" but the markers are not processed by the preamble — the system prompt is hardcoded.
- Fix: For a true integration test of the preamble hook, either (a) let the hook fire naturally by not passing `systemPrompt` (so the default `false` is used and the real hook injects via UserPromptSubmit), or (b) rename the test to clarify it is testing "model responds to plan directive" rather than "preamble hook detects plan markers". If the preamble hook cannot fire in `claude -p` mode (no UserPromptSubmit hooks in print mode), document this limitation and add a separate unit test for the shell hook's pattern matching logic.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Removed `removeLegacyAmbientHook` tests and export without replacement coverage** - `tests/ambient.test.ts` (deleted lines 304-347)
**Confidence**: 82%
- Problem: The `removeLegacyAmbientHook` function and its dedicated tests were removed. The legacy hook removal is now handled internally by `addAmbientHook` (via `filterHookEntries`). The existing tests for `addAmbientHook` do cover the legacy-replacement path (lines 108-140), so the core behavior is still tested. However, the removed tests also verified idempotency and cleanup of empty structures specifically for the legacy-only path, which are now only indirectly covered.
- Fix: No action strictly required — the remaining tests in `addAmbientHook` cover legacy replacement. This is informational.

**Deleted 160+ lines of router/classification structural validation tests with no replacement** - `tests/ambient.test.ts` (deleted lines 521-737)
**Confidence**: 85%
- Problem: The `router structural validation` and `preamble drift detection` test suites were entirely deleted. These validated: (1) router covers all non-CHAT intents, (2) dual-mode intents map to :triage skills, (3) router table skills exist on disk, (4) all 7 triage skills have correct frontmatter, (5) ci-status-gate PATTERN consistency, (6) preamble contains classification instructions, (7) classification-rules.md has required elements, (8) session-start-classification reads rules file. Since the router, triage skills, and classification rules are all deleted in this PR (applies ADR-001), these tests correctly needed removal. The new `COMMANDS_RULE_CONTENT` tests (lines 330-352) replace some of this structural validation for the new architecture. However, there is no test that verifies the preamble shell hook itself (the actual `scripts/hooks/preamble` file) correctly pattern-matches the three plan markers.
- Fix: Add a unit test that reads the preamble hook script and verifies it checks for `## Goal`, `## Steps`, and `## Files` markers. This replaces the old "preamble drift detection" suite for the new architecture:
  ```typescript
  describe('preamble hook structural validation', () => {
    it('preamble checks all three plan markers', async () => {
      const hookPath = path.resolve(__dirname, '../scripts/hooks/preamble');
      const hookContent = await fs.readFile(hookPath, 'utf-8');
      expect(hookContent).toContain('## Goal');
      expect(hookContent).toContain('## Steps');
      expect(hookContent).toContain('## Files');
    });

    it('preamble outputs EXECUTION_PLAN directive', async () => {
      const hookPath = path.resolve(__dirname, '../scripts/hooks/preamble');
      const hookContent = await fs.readFile(hookPath, 'utf-8');
      expect(hookContent).toContain('EXECUTION_PLAN');
      expect(hookContent).toContain('devflow:implement');
    });
  });
  ```

**Deleted 22 integration tests (GUIDED + ORCHESTRATED tiers) with only 3 replacements** - `tests/integration/ambient-activation.test.ts`
**Confidence**: 83%
- Problem: The file went from 24 integration tests (covering QUICK, GUIDED x7, ORCHESTRATED x9 tiers) to 3 tests (plan handoff, normal prompt, partial markers). The old tests validated that natural language prompts triggered correct intent classification and skill loading chains end-to-end. The new architecture is fundamentally simpler (no classification pipeline), so fewer tests are expected. However, the remaining integration tests do not verify the actual preamble hook fires in a real Claude session — they either hardcode the system prompt or disable it. This means the new architecture's critical path (preamble hook detects plan markers and outputs a directive) has no end-to-end integration test.
- Fix: This may be an intentional trade-off (hook cannot fire in `claude -p` mode). If so, document why and add a shell-level test for the preamble hook:
  ```bash
  # Test preamble hook with plan markers
  echo '## Goal\nAdd X\n## Steps\n1. Do Y\n## Files\n- z.ts' | \
    DEVFLOW_USER_PROMPT='## Goal\nAdd X\n## Steps\n1. Do Y\n## Files\n- z.ts' \
    bash scripts/hooks/preamble
  ```

## Pre-existing Issues (Not Blocking)

(none above CRITICAL threshold)

## Suggestions (Lower Confidence)

- **`runClaudeStreamingWithRetry` removal leaves no fallback mechanism** - `tests/integration/helpers.ts` (Confidence: 65%) — The retry-with-model-fallback helper was deleted. If future integration tests need reliability against model non-determinism, consider keeping a simplified version or documenting why it was removed.

- **`textResult` helper is now only used in `skill invocation helpers` block** - `tests/ambient.test.ts:12-14` (Confidence: 62%) — The `textResult` helper was originally used by classification tests. After their deletion, it is only used by `hasSkillInvocations` tests (lines 407-414). Still needed, but the JSDoc could be updated to reflect its narrower scope.

- **No negative test for preamble hook skipping empty prompts** - `scripts/hooks/preamble` (Confidence: 70%) — The preamble hook has an early exit for empty `$DEVFLOW_USER_PROMPT`, but the deleted "preamble filter" integration tests that covered this were not replaced with a unit-level equivalent.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 3 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The PR correctly removes tests for deleted features (applies ADR-001 — clean break philosophy), and adds good structural validation for the new `COMMANDS_RULE_CONTENT`. However, the new `addAmbientHook`/`removeAmbientHook` functions now have real filesystem side-effects (writing/deleting `~/.claude/rules/devflow/commands.md`) that execute during unit tests without mocking — this is the primary blocking issue. Additionally, the preamble hook's plan-marker detection logic (the critical path of the new architecture) has no direct test coverage: the integration test bypasses it with a hardcoded system prompt, and no unit test validates the shell script's pattern matching.
