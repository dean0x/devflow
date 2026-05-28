# Testing Review Report

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Missing direct tests for extracted `installCommandsRule` / `removeCommandsRule` helpers** - `src/cli/commands/ambient.ts:93-109`
**Confidence**: 82%
- Problem: These two new exported helper functions are tested only indirectly via `addAmbientHook`/`removeAmbientHook` (where fs is mocked). There are no direct unit tests that exercise their ENOENT handling branch (`removeCommandsRule` swallowing ENOENT but re-throwing other errors) or the actual `mkdir + writeFile` flow of `installCommandsRule`. Since these are exported and could be called independently, the error path in `removeCommandsRule` line 107 is untested.
- Fix: Add a small test block for each helper:
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

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### LOW

**`COMMANDS_RULE_CONTENT` sync test reads from real filesystem** - `tests/ambient.test.ts:383-389`
**Confidence**: 80%
- Problem: The `matches shared/rules/commands.md source file` test reads from disk without a mock (unlike all the other tests in this file that stub fs). This is intentional (dual-source guard), but it does not use the same `fs` import — it calls through the non-mocked `fs.readFile` because neither `beforeEach` in the enclosing describe stubs `readFile`. This is correct behavior, but the asymmetry could confuse future contributors who see `vi.spyOn(fs, 'writeFile')` in other blocks and assume all disk operations are mocked.
- Fix: Add a brief comment:
```typescript
it('matches shared/rules/commands.md source file', async () => {
  // Intentionally reads real filesystem (not mocked) — validates dual-source sync
  const sourceFile = path.resolve(__dirname, '../shared/rules/commands.md');
  ...
```

## Suggestions (Lower Confidence)

- **No test for `addAmbientHook` when `installCommandsRule` rejects** - `tests/ambient.test.ts:28-35` (Confidence: 65%) — If `fs.writeFile` (the rule install) throws during `addAmbientHook`, the hook JSON modification has already occurred in-memory. No test verifies that this error propagates or what the caller should expect. Low priority since the CLI wraps this in try/catch elsewhere.

- **`hasAmbientHook` describe has unnecessary mock setup** - `tests/ambient.test.ts:316-324` (Confidence: 70%) — Only one test in the `hasAmbientHook` block actually calls `addAmbientHook` (which triggers the mocked fs). The other 5 tests are synchronous and never touch fs. The mocks are harmless but add unnecessary setup/teardown to tests that do not need it.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The test suite is well-structured, follows AAA patterns, tests behavior over implementation, covers idempotency, edge cases, and legacy migration paths. The fs mocking approach correctly prevents side-effects. The dual-source guard test is a strong quality addition. The one condition: the newly extracted `installCommandsRule`/`removeCommandsRule` helpers deserve direct tests (particularly the ENOENT error-path branch) before merge.
