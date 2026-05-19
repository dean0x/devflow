# Tests Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-30_1831

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical issues found.

### HIGH

No high-severity issues found.

### MEDIUM

**Sync `readFileSync` usage in new test file reads filesystem without async** - `tests/skill-references.test.ts` (multiple locations)
**Confidence**: 80%
- Problem: The entire `skill-references.test.ts` file uses `readFileSync` and `readdirSync` throughout (~30 call sites) while the codebase's existing test convention in `tests/init-logic.test.ts`, `tests/skill-namespace.test.ts`, and `tests/skills.test.ts` uses `await fs.promises` for I/O. The skill-references file does import `promises as fs` but only uses it once. Synchronous I/O in tests blocks the Node.js event loop and can cause slower test execution when files are on network mounts or slow storage. More importantly, this is a consistency issue with the rest of the test suite.
- Fix: Replace `readFileSync`/`readdirSync`/`statSync` with their async equivalents (`fs.readFile`, `fs.readdir`, `fs.stat`) to match the async pattern used in all other test files in this PR. Alternatively, if synchronous reads are intentional for simplicity in this pure-read test file, add a brief comment explaining the design choice.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`runClaudeWithRetry` swallows all errors silently** - `tests/integration/helpers.ts:98`
**Confidence**: 82%
- Problem: The `catch {}` block in `runClaudeWithRetry` (line 98-100) silently swallows all exceptions, including non-transient errors like `SyntaxError` from `JSON.parse` failures. While this function existed before and only the preamble string was changed in this PR, the empty catch makes debugging integration test failures significantly harder since a malformed response would be silently retried rather than surfaced.
- Fix: Log the error or at minimum narrow the catch to known transient error types:
  ```typescript
  } catch (err) {
    if (err instanceof Error && err.message.includes('TIMEOUT')) continue;
    throw err; // Rethrow non-transient errors
  }
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Integration helper `AMBIENT_PREAMBLE` is a duplicated copy of the shell hook** - `tests/integration/helpers.ts:19-28`
**Confidence**: 85%
- Problem: The `AMBIENT_PREAMBLE` string in helpers.ts is manually kept in sync with `scripts/hooks/ambient-prompt`. A test at line 648 of `skill-references.test.ts` validates individual skill refs match, but there is no test that the full preamble string is byte-for-byte identical. The PR's own "preamble drift detection" test (line 268 in `ambient.test.ts`) checks individual keywords but not full structural equivalence.
- Fix: Add a test that extracts the preamble from the shell hook and compares it character-by-character to the TypeScript constant, ensuring zero drift.

### LOW

**Test names in `skill-references.test.ts` could be more behavior-focused** - `tests/skill-references.test.ts` (multiple)
**Confidence**: 62% (moved to Suggestions)

## Suggestions (Lower Confidence)

- **Test names describe format numbers rather than behavior** - `tests/skill-references.test.ts` (Confidence: 62%) -- Test `describe` blocks use internal format numbers ("Format 1", "Format 7") rather than describing what breaks when tests fail. Consider more behavior-focused names like "Plugin manifest skills reference only canonical skills" instead of "Format 1: Plugin manifest skill arrays". This is minor since the test bodies are clear.

- **No negative test for `SHADOW_RENAMES` consistency with `LEGACY_SKILL_NAMES`** - `tests/init-logic.test.ts` / `tests/plugins.test.ts` (Confidence: 68%) -- `SHADOW_RENAMES` old names should all appear in `LEGACY_SKILL_NAMES` to ensure they get cleaned up during uninstall. There is no test enforcing this invariant. If someone adds a shadow rename without updating the legacy list, the old directory would persist.

- **`migrateShadowOverrides` does not test concurrent rename races** - `tests/init-logic.test.ts:625-711` (Confidence: 65%) -- The function uses sequential `fs.access` + `fs.rename` which has a TOCTOU window. In practice init runs single-threaded so this is low risk, but the test suite does not document this assumption.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Tests Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### What This PR Does Well

1. **Excellent rename-proof test design**: The new `skill-references.test.ts` (950 lines, 29 tests) derives all valid skill names from `getAllSkillNames()` at runtime. No hardcoded skill names means adding or renaming a skill automatically updates what tests consider valid. This is a model for how to write refactoring-resilient tests.

2. **Strong coverage of the new `migrateShadowOverrides` function**: 5 test cases covering the happy path (rename), conflict (both exist), no-op (nothing to migrate), multi-shadow batch, and missing directory. The `shadow migration -> install ordering` integration tests (lines 714-816) validate the critical ordering invariant that migration must run before install.

3. **Cross-component alignment tests**: The new tests at lines 810-950 of `skill-references.test.ts` validate that the reviewer agent, code-review command, and review-orchestration skill all agree on focus area names and skill mappings. This catches the exact class of bug that prompted commit `2c8d618` (the `tests` vs `testing` focus area mismatch).

4. **All 574 tests pass cleanly** with a 2.27s total runtime. No flaky tests, no timeouts.

5. **Consistent test data updates**: All 8 existing test files were updated to use V2 skill names (`software-design`, `testing`, `security`, `ui-design`) instead of the old names (`core-patterns`, `test-patterns`, `security-patterns`, `frontend-design`).

### Conditions for Approval

The single MEDIUM blocking issue (sync I/O consistency) is a style/consistency concern rather than a correctness issue. It does not block merge, but should be addressed before the next PR on this branch.
