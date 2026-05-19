# Testing Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Unused `fsPromises` import** - `tests/feature-kb/feature-kb.test.ts:6`
**Confidence**: 95%
- Problem: The import `import { promises as fsPromises } from 'fs'` was added in this PR but is never referenced anywhere in the test file. Only the synchronous `fs` functions (`writeFileSync`, `mkdirSync`, etc.) and the async `readSidecar` from the production module are used.
- Fix: Remove the unused import.
```typescript
// Remove this line:
import { promises as fsPromises } from 'fs';
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Missing test for `readSidecar` non-object JSON guard** - `src/cli/commands/kb.ts:33`
**Confidence**: 82%
- Problem: The `readSidecar` function has a guard `if (typeof raw !== 'object' || raw === null) return {}` that handles valid JSON that parses to a primitive (e.g., a file containing `42` or `"hello"`). The new `readSidecar` test suite covers missing file, invalid JSON, wrong field types, and mixed arrays, but does not cover this specific branch where JSON.parse succeeds but returns a non-object.
- Fix: Add a test case for a JSON file containing a primitive value.
```typescript
it('returns {} when JSON parses to a non-object (primitive)', async () => {
  const f = writeTmp('42');
  const result = await readSidecar(f);
  expect(result).toEqual({});
});
```

## Pre-existing Issues (Not Blocking)

No pre-existing issues identified.

## Suggestions (Lower Confidence)

- **CJS `read-sidecar` tests use inline try/finally instead of afterEach** - `tests/feature-kb/feature-kb.test.ts:562-605` (Confidence: 65%) -- The `json-helper read-sidecar` describe block uses per-test try/finally for temp file cleanup while the adjacent `readSidecar` TS describe block uses `afterEach` with a tracked array. The TS approach is cleaner and more resilient to assertion failures mid-test. Consider aligning the CJS tests to the same pattern for consistency.

- **No negative test for `read-sidecar` with path traversal input** - `scripts/hooks/json-helper.cjs:1818` (Confidence: 62%) -- The `read-sidecar` CJS command uses `safePath()` to sanitize the file argument, but there is no test verifying that path traversal attempts (e.g., `../../etc/passwd`) are blocked. This is already validated for other json-helper operations; extending coverage here would be defensive.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The test changes are well-structured and thorough. The PR adds significant new test coverage for the `readSidecar` helper (both the TypeScript function in `kb.ts` and the CJS `read-sidecar` operation in `json-helper.cjs`), covering happy paths, missing files, malformed JSON, wrong types, and missing arguments. Existing tests were correctly updated to remove the `category` field across all fixtures and assertions, keeping tests synchronized with the production schema change. The new `CLI stale-slugs (empty index)` test adds a useful edge case. Test names clearly describe expected behavior and follow AAA structure. The only blocking issue is a dead import; the coverage gap is a should-fix. PF-001 (Promise resolver naming) does not apply -- no Promise callbacks were introduced in these changes.
