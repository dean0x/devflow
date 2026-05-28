# Code Review Summary

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25_2312
**Cycle**: 1 (initial review)

## Merge Recommendation: CHANGES_REQUESTED

This PR contains one MEDIUM blocking issue in test coverage that must be resolved before merge. The implementation is sound, but the extracted helper functions lack direct unit tests for their error-handling paths. Once tests are added, this PR is approved.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 0 | 1 | 0 | 1 |
| Should Fix | 0 | 0 | 1 | 0 | 1 |
| Pre-existing | 0 | 0 | 7 | 1 | 8 |

---

## Blocking Issues (MUST FIX)

### 1. Missing Direct Tests for Extracted Helpers
**File**: `src/cli/commands/ambient.ts:93-109`
**Severity**: MEDIUM
**Confidence**: 82%
**Category**: Testing (blocking)

**Problem**: 
The two new exported helper functions `installCommandsRule` and `removeCommandsRule` are tested only indirectly through `addAmbientHook`/`removeAmbientHook` with mocked fs. The error-handling branch in `removeCommandsRule` (line 107) that re-throws non-ENOENT errors is completely untested. Since these are exported functions that could be called independently, their error paths must be directly validated.

**Fix**:
Add dedicated test blocks:

```typescript
describe('installCommandsRule', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates directory and writes file', async () => {
    const mkdirSpy = vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const writeSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    await installCommandsRule();
    expect(mkdirSpy).toHaveBeenCalledWith(path.dirname(COMMANDS_RULE_PATH), { recursive: true });
    expect(writeSpy).toHaveBeenCalledWith(COMMANDS_RULE_PATH, COMMANDS_RULE_CONTENT, 'utf-8');
  });
});

describe('removeCommandsRule', () => {
  afterEach(() => vi.restoreAllMocks());

  it('swallows ENOENT', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.spyOn(fs, 'unlink').mockRejectedValue(err);
    await expect(removeCommandsRule()).resolves.toBeUndefined();
  });

  it('re-throws non-ENOENT errors', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    vi.spyOn(fs, 'unlink').mockRejectedValue(err);
    await expect(removeCommandsRule()).rejects.toThrow('EACCES');
  });
});
```

---

## Should-Fix Issues (Recommended)

### 1. Dual-Source Content Duplication
**File**: `src/cli/commands/ambient.ts:26-52`
**Severity**: MEDIUM
**Confidence**: 82%
**Category**: Architecture (should fix)

**Problem**: 
The `COMMANDS_RULE_CONTENT` constant is a verbatim copy of `shared/rules/commands.md`. Although the new sync test guards against drift, maintaining two sources of truth for the same content violates DRY. The codebase pattern is single-source-of-truth in `shared/rules/` with build-time distribution.

**Recommendation**: 
The dual-source is a justified exception for the ambient plugin (managed directly, not by the rules system), and the new drift-detection test (line 383-389) mitigates the risk effectively. This is not blocking but should be addressed in a follow-up refactoring to implement build-time embedding or runtime file reading.

---

## Pre-existing Issues (Not Blocking)

### Security (2 MEDIUM)

**1. Broad Catch in Settings Read** - `ambient.ts:217` (80% confidence)
- Catches all errors when reading `settings.json`, not just `ENOENT`, silently overwrites on permission/corruption errors
- Suggestion: Narrow catch to ENOENT only

**2. Broad Catch in devflowDir Resolution** - `ambient.ts:244` (80% confidence)
- Swallows all errors from `JSON.parse` or `getDevFlowDirectory()`
- Suggestion: Log or narrow catch (current fallback behavior is safe)

### Architecture (1 MEDIUM)

**3. Fragile devflowDir Resolution Heuristic** - `ambient.ts:233-246` (80% confidence)
- Infers devflowDir by parsing hook command path with `../../..` navigation, couples to internal conventions
- Suggestion: Use `getDevFlowDirectory()` as primary source with hook-path as validated fallback

### Performance (1 MEDIUM)

**4. Sequential fs.rm() Loop Over 224+ Entries** - `init.ts:979` (82% confidence)
- Iterates `LEGACY_SKILL_NAMES` sequentially with independent fs operations
- Suggestion: Parallelize with `Promise.allSettled`
- Note: PR only adds 16 entries (negligible incremental impact); pattern worth optimizing in future

### Complexity (1 MEDIUM)

**5. LEGACY_SKILL_NAMES Array Exceeds Maintainability Threshold** - `plugins.ts:300-524` (85% confidence)
- 188 entries spanning 224 lines; PR adds 16 more
- Suggestion: Extract sub-arrays by era/version and compose

### Reliability (0 CRITICAL)

**6. Unvalidated JSON.parse** - `ambient.ts:118` (65% confidence)
- `JSON.parse` without try/catch in `addAmbientHook`/`removeAmbientHook`
- Suggestion: Add try/catch with user-friendly error message

### Testing (1 LOW)

**7. Sync Test Reads Real Filesystem** - `tests/ambient.test.ts:383-389` (80% confidence)
- The drift-detection test reads from disk without mock (intentional), but asymmetry could confuse contributors
- Suggestion: Add comment explaining intentional real-fs read

---

## Convergence Status

**Cycle**: 1 (Initial review, no prior resolutions to compare against)

**Reviewer Agreement Summary**:
- All 9 reviewers agree on quality (scores: 9/10, 8/10, 9/10, 9/10, 9/10, 9/10, 8/10, 9/10, 9/10)
- Single consensus issue: Missing direct tests for extracted helpers (flagged by Testing reviewer as BLOCKING)
- Architecture reviewer flags dual-source content (mitigated by test)
- No conflicts between reviewers; all findings are complementary

**Key Strengths**:
- Extracted helpers follow SRP and improve auditability
- Narrowed ENOENT catch in `removeCommandsRule` is a security improvement
- Classification hook tracking fix resolves a real bug (idempotency edge case)
- Test suite includes fs mocking and drift-detection guard
- All 46 tests pass
- No breaking changes or regressions

**Next Steps**:
1. Add direct unit tests for `installCommandsRule` and `removeCommandsRule` (blocking)
2. Consider drift-detection test comment for clarity (optional)
3. Plan future: evaluate build-time embedding for `COMMANDS_RULE_CONTENT` and parallelize legacy cleanup (both non-blocking)

---

## Action Plan

1. **Add direct tests for extracted helpers** (required before merge)
   - Test `installCommandsRule` mkdir + writeFile flow
   - Test `removeCommandsRule` ENOENT swallowing
   - Test `removeCommandsRule` non-ENOENT re-throwing
   
2. **Re-run test suite** to ensure new tests pass and coverage improves

3. **Then merge** — all reviewers approve pending test coverage fix
