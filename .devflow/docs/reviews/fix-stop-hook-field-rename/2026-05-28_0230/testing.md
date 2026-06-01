# Testing Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Misleading test name contradicts test body** - `tests/debug.test.ts:166`
**Confidence**: 85%
- Problem: Test is named `'disable from missing file -- no-op (no file written)'` but the test body calls `await fs.writeFile(settingsPath, updated, 'utf-8')` -- it explicitly writes a file. The name claims "no file written" while the test writes one. This is confusing for future maintainers and misrepresents what the test validates.
- Fix: Rename to reflect what the test actually asserts -- that `stripDebugTrace('{}')` produces output with no `env` key:
```typescript
it('disable from missing file -- stripDebugTrace({}) produces no env key', async () => {
```

**`readDebugStatus` missing malformed JSON test -- asymmetric with sibling functions** - `tests/debug.test.ts:92`
**Confidence**: 82%
- Problem: `applyDebugTrace` and `stripDebugTrace` both have `'throws on malformed JSON'` tests (lines 49-51, 85-87), but `readDebugStatus` has no equivalent test. The production code (debug.ts:50) calls `JSON.parse` which will throw on malformed input. The command wrapper (debug.ts:78-82) catches this, but the pure function's throw behavior is unverified. This is an asymmetric coverage gap -- the three pure functions are documented as a parallel set (applies ADR-007) yet one lacks the error-path test the other two have.
- Fix: Add a test in the `readDebugStatus` describe block:
```typescript
it('throws on malformed JSON', () => {
  expect(() => readDebugStatus('not json')).toThrow(SyntaxError);
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`load_existing_ids()` exported by eval-helpers has zero test coverage** - `scripts/hooks/eval-helpers:41-58`
**Confidence**: 80%
- Problem: The new `eval-helpers` module exports three functions: `read_daily_cap`, `atomic_increment_daily`, and `load_existing_ids`. The first two have dedicated behavioral tests in `shell-hooks.test.ts` (lines 182-268), but `load_existing_ids` -- which has two code paths (jq vs node fallback) and handles missing files, empty files, and malformed JSONL -- has no tests at all. This function is used by both `eval-learning` and `eval-decisions` for observation deduplication, making it a critical data integrity function.
- Fix: Add tests covering the three branches: (1) missing file returns `[]`, (2) valid JSONL returns array of ids, (3) empty file returns `[]`. Example:
```typescript
describe('eval-helpers: load_existing_ids', () => {
  it('returns [] when file is absent', () => {
    const result = execSync(`bash -c '
      source "${EVAL_HELPERS}"
      load_existing_ids "/nonexistent/path"
    '`, { stdio: 'pipe' }).toString().trim();
    expect(result).toBe('[]');
  });

  it('returns array of ids from JSONL', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-test-'));
    try {
      const logFile = path.join(tmpDir, 'test.jsonl');
      fs.writeFileSync(logFile, '{"id":"a"}\n{"id":"b"}\n');
      const result = execSync(`bash -c '
        source "${EVAL_HELPERS}"
        load_existing_ids "${logFile}"
      '`, { stdio: 'pipe' }).toString().trim();
      expect(JSON.parse(result)).toEqual(['a', 'b']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

**No behavioral tests for `hook-bootstrap` and `hook-log-init`** - `scripts/hooks/hook-bootstrap`, `scripts/hooks/hook-log-init`
**Confidence**: 80%
- Problem: Both new extracted helper scripts are added to `HOOK_SCRIPTS` for syntax checks (lines 18-19), but have no behavioral tests. `hook-bootstrap` sets up debug tracing and `hook-log-init` sets up logging with a 2MB size guard -- both have testable behavior (e.g., `hook-log-init` creates `LOG_FILE`, the size guard truncates at 2MB, `log()` appends timestamped lines). Given these are sourced by every hook in the system, behavioral regressions here would cascade.
- Fix: At minimum, add a test for `hook-log-init`'s size guard (the 2MB truncation is a new behavioral guarantee distinct from the 5MB debug-trace truncation already tested):
```typescript
it('hook-log-init truncates log file exceeding 2MB', () => {
  // similar pattern to the debug-trace 5MB truncation test
});
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **I/O integration tests are not truly integration tests** - `tests/debug.test.ts:146-174` (Confidence: 65%) -- The "I/O integration" tests call pure functions and then manually write/read files, simulating what the command does rather than exercising the actual command path. They test that `applyDebugTrace('{}')` produces the right output and that file I/O works, but the actual command's ENOENT catch + fallback-to-`'{}'` logic is never exercised. Consider whether these add value beyond what the pure function tests already cover, or whether they should exercise the real `debugCommand.parseAsync()`.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The test rewrite is a significant quality improvement -- replacing three test-local functions that duplicated production logic with direct imports of pure functions (applies ADR-007). The shell-hooks tests now source real `eval-helpers` functions instead of inlining bash duplicates. All 195 tests pass. The conditions are: (1) add the missing `readDebugStatus` malformed JSON test for symmetry with its sibling functions, and (2) rename the misleading test. The `load_existing_ids` and `hook-log-init` coverage gaps are worth addressing but not blocking.
