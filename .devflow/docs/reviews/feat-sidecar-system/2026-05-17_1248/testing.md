# Testing Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental (7 commits since d8e7670) + uncommitted changes

## Issues in Your Changes (BLOCKING)

### HIGH

**sidecar-evaluate log assertions are conditional — tests pass trivially when log file is absent** — `tests/shell-hooks.test.ts:1862,1884,1913,1965,1995,2057,2079,2097`
**Confidence**: 92%
- Problem: Eight tests in `sidecar-evaluate business logic` wrap their key assertions in `if (fs.existsSync(logFile))` guards. If the hook fails to create the log file (e.g., `LOG_FILE` path changes, `mkdir -p` fails, or the `log()` function silently errors), all assertions inside the conditional are skipped and the test passes green — hiding real regressions. This is the textbook "test that never fails" anti-pattern.
- Fix: Replace conditional guards with unconditional assertions. If the log file is expected, assert its existence first:
```typescript
expect(fs.existsSync(logFile)).toBe(true);
const log = fs.readFileSync(logFile, 'utf-8');
expect(log).toContain('Evaluating learning');
```
If the log file is genuinely optional, split into a separate test that validates log creation.

---

**No test for decisions daily cap in sidecar-evaluate** — `scripts/hooks/sidecar-evaluate:228-229`
**Confidence**: 85%
- Problem: The `sidecar-evaluate` hook has a decisions daily cap check (lines 213-229) — analogous to the learning daily cap. Learning daily cap has a dedicated test (`learning daily cap blocks marker creation`), but there is no equivalent test for the decisions path. If the `DEC_RUNS_FILE` parsing or comparison logic has a bug (e.g., wrong field position in `cut -f2`), it would go undetected.
- Fix: Add a test mirroring the learning cap test:
```typescript
it('decisions daily cap blocks marker creation', () => {
  const sidecarDir = path.join(tmpDir, '.memory', '.sidecar');
  fs.mkdirSync(sidecarDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(sidecarDir, '.decisions-runs-today'), `${today}\t3\n`);
  createTranscript(homeDir, tmpDir, 5);
  runHook(EVALUATE_HOOK, { cwd: tmpDir, session_id: 'test-session' }, homeDir);
  expect(fs.existsSync(path.join(sidecarDir, 'decisions.json'))).toBe(false);
});
```

---

**transcript-filter.cjs CLI handler: no test for non-existent file path** — `scripts/hooks/lib/transcript-filter.cjs:193-196`
**Confidence**: 82%
- Problem: The newly added CLI handler catches file-read errors and outputs `[]\n` (line 194-196). This is a critical edge case in production — the transcript file may not exist if Claude cleaned up its project directory. There is no test exercising this path. If the error handling changes (e.g., someone adds `process.exit(1)` instead), the `sidecar-evaluate` hook would fail with a non-zero exit and abort all evaluation.
- Fix: Add a test:
```typescript
it('user-signals with non-existent file returns []', () => {
  const result = execSync(`node "${FILTER}" user-signals "/tmp/no-such-file.jsonl"`, { stdio: 'pipe' }).toString().trim();
  expect(JSON.parse(result)).toEqual([]);
});
```

### MEDIUM

**`memory.ts` --disable queue drain logic untested** — `src/cli/commands/memory.ts:345-349`
**Confidence**: 85%
- Problem: The new `--disable` handler drains orphaned queue files (`.pending-turns.jsonl` and `.pending-turns.processing`) to prevent stale turns from processing on re-enable. This is important correctness logic — if it fails silently, re-enabling memory could replay old stale turns into a fresh session. There are no integration tests for `devflow memory --disable` that verify queue files are actually removed.
- Fix: Add a test in the CLI test suite (or shell-hooks.test.ts):
```typescript
it('devflow memory --disable drains queue files', async () => {
  // Setup: create .memory with pending turns
  // Run: devflow memory --disable
  // Assert: .pending-turns.jsonl no longer exists
});
```

---

**`sidecar-capture` scanner pre-check (grep for ADR/PF before node spawn) not tested** — `scripts/hooks/sidecar-capture:115-117`
**Confidence**: 80%
- Problem: The new optimization wraps the `decisions-usage-scan.cjs` invocation in a `grep -qE 'ADR-[0-9]+|PF-[0-9]+'` guard. The existing test `runs scanner when decisions/.disabled absent` passes because the response text contains `'applies ADR-001'` which matches the grep. But there is no test verifying the skip path: that responses WITHOUT ADR/PF citations do NOT invoke the scanner. If the grep pattern is wrong (e.g., someone changes it to a broken regex), the scanner would silently stop processing legitimate citations.
- Fix: Add a negative test:
```typescript
it('does NOT run scanner when response lacks ADR/PF citations', () => {
  // Write usage file with ADR-001 at cites=0
  // Send response_text: 'just a normal response' (no ADR/PF)
  // Assert: cites still 0 (scanner was not invoked)
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**sidecar-evaluate `learning session dedup` test has weak assertion** — `tests/shell-hooks.test.ts:2009-2013`
**Confidence**: 83%
- Problem: The dedup test runs the hook twice with the same session ID, then checks the session count file with `if (fs.existsSync(sessionCountFile))`. If the file does not exist (e.g., because the hook failed or the path changed), the test passes vacuously. For a deep session with batch_size=3 and only 1 unique session, the file SHOULD exist with exactly 1 line.
- Fix: Remove the conditional and assert unconditionally:
```typescript
const sessionCountFile = path.join(sidecarDir, '.learning-sessions');
expect(fs.existsSync(sessionCountFile)).toBe(true);
const lines = fs.readFileSync(sessionCountFile, 'utf-8').trim().split('\n').filter(Boolean);
expect(lines).toHaveLength(1);
expect(lines[0]).toBe('dup-session');
```

---

**No test for `sidecar-evaluate` with empty USER_SIGNALS (batch triggered but filter returns `[]`)** — `scripts/hooks/sidecar-evaluate:156`
**Confidence**: 80%
- Problem: When `BATCH_SIZE` is reached and the transcript-filter returns an empty array (`[]` string), the hook checks `[ -n "$USER_SIGNALS" ]`. An empty JSON array `[]` is a non-empty string, so the condition passes and the marker is written with `userSignals: "[]"`. This is technically valid but semantically wrong — it dispatches a learning agent run with zero signal data, wasting an API call. There is no test for this boundary.
- Fix: Either fix the hook to check for `"[]"` as empty, or add a test documenting the current behavior:
```typescript
it('learning marker written even when user-signals is empty array ([])', () => {
  // Create transcript with only tool_result entries (all filtered out)
  // Verify marker is written with userSignals: "[]"
  // OR verify marker is NOT written (if fix is applied)
});
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`sidecar-config.test.ts` does not test concurrent `writeConfig` calls (race condition documented in D1)** — `src/cli/utils/sidecar-config.ts:57-64`
**Confidence**: 65% (documented as acceptable, but no regression guard)
- Problem: The D1 JSDoc comment acknowledges a non-atomic read-modify-write in `updateFeature`. While the design decision explicitly accepts this trade-off, there is no test that demonstrates the behavior under concurrent calls (even a sequential simulation showing the last-write-wins behavior). If someone removes the D1 comment and "fixes" it with a broken locking mechanism, there would be no regression test.
- This is informational — the D1 comment is the intended documentation.

## Suggestions (Lower Confidence)

- **No test for `sidecar-dispatch` with corrupt/invalid prompt field** — `scripts/hooks/sidecar-dispatch:39` (Confidence: 70%) — If `json_extract_cwd_prompt` returns a malformed result, the `PROMPT` variable could be garbage. Testing with null/undefined prompt would verify graceful handling.

- **No test for `sidecar-evaluate` when `transcript-filter.cjs` is missing** — `scripts/hooks/sidecar-evaluate:152` (Confidence: 65%) — The hook checks `[ -f "$FILTER_LIB" ]` before calling it, but if the path is wrong the entire learning/decisions evaluation silently produces no markers. A test with a renamed filter lib would catch path regressions.

- **`sidecar-capture` auto-clean changed condition (`QUEUE_LINES > 0`) not specifically targeted** — `scripts/hooks/sidecar-capture:86` (Confidence: 68%) — The existing `auto-clean with empty queue file` test covers the new guard implicitly (empty file has 0 lines, so `QUEUE_LINES -gt 0` is false, auto-clean skips, assistant appends). However, the assertion does not distinguish between "grep found nothing" (old behavior) and "wc-l check short-circuited" (new behavior). If the condition is accidentally inverted, the test still passes.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The new test suite (uncommitted `shell-hooks.test.ts` additions) provides solid coverage of the sidecar hooks' happy paths — batch accumulation, throttling, config-based feature toggles, stale marker recovery, and path traversal rejection are all well-tested. However, 8 of the `sidecar-evaluate` tests rely on conditional log file assertions that can pass trivially, and key edge cases (decisions daily cap, empty user signals, missing transcript file, scanner skip path) lack coverage. These gaps are exactly where subtle bugs hide in shell scripts.
