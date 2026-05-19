# Testing Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09_0130

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Missing test for assistant_message content array format** - `tests/shell-hooks.test.ts`
**Confidence**: 85%
- Problem: The stop hook (`stop-update-memory:40-48`) handles two distinct `assistant_message` formats: a plain string and a content array (`[{type: "text", text: "..."}]`). The new test at line 778 only exercises the string format (`assistant_message: 'test response'`). The content array branch (jq path `.assistant_message[] | select(.type == "text")` and the equivalent Node fallback) is never tested, leaving a meaningful code path uncovered.
- Fix: Add a test case that passes `assistant_message` as an array of content blocks:
```typescript
it('stop_reason end_turn with content array — extracts text blocks', () => {
  fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');

  const input = JSON.stringify({
    cwd: tmpDir,
    session_id: 'test-session-005',
    stop_reason: 'end_turn',
    assistant_message: [
      { type: 'text', text: 'First paragraph' },
      { type: 'tool_result', content: 'ignored' },
      { type: 'text', text: 'Second paragraph' },
    ],
  });

  execSync(`echo '${input.replace(/'/g, "'\\''")}' | bash "${STOP_HOOK}"`, { stdio: 'pipe' });

  const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
  const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  const entry = JSON.parse(lines[0]);
  expect(entry.content).toContain('First paragraph');
  expect(entry.content).toContain('Second paragraph');
});
```

**Missing test for queue overflow truncation** - `tests/shell-hooks.test.ts`
**Confidence**: 82%
- Problem: The stop hook (`stop-update-memory:82-89`) implements queue overflow safety: when the `.pending-turns.jsonl` file exceeds 200 lines, it truncates to the last 100. This safety mechanism has no test coverage. Bugs in overflow handling (e.g., the `tail/mv` dance corrupting data or the line count comparison being off-by-one) would go undetected.
- Fix: Add a test that pre-populates the queue with >200 lines, triggers the stop hook, and verifies truncation:
```typescript
it('queue overflow — truncates to last 100 when > 200 lines', () => {
  fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');

  const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
  // Pre-populate with 201 lines
  const entries = Array.from({ length: 201 }, (_, i) =>
    JSON.stringify({ role: 'user', content: `msg-${i}`, ts: 1000 + i })
  );
  fs.writeFileSync(queueFile, entries.join('\n') + '\n');

  const input = JSON.stringify({
    cwd: tmpDir,
    session_id: 'test-overflow',
    stop_reason: 'end_turn',
    assistant_message: 'overflow trigger',
  });

  execSync(`echo '${input.replace(/'/g, "'\\''")}' | bash "${STOP_HOOK}"`, { stdio: 'pipe' });

  const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
  // 201 pre-existing + 1 new = 202 > 200, so truncated to 100
  expect(lines.length).toBeLessThanOrEqual(101);
});
```

### MEDIUM

**Missing test for empty assistant_message — skips queue append** - `tests/shell-hooks.test.ts`
**Confidence**: 83%
- Problem: The stop hook (`stop-update-memory:60-64`) explicitly handles the empty `assistant_message` case by logging and exiting. This guard prevents writing empty entries to the queue, but no test verifies this behavior. An empty string could come from a Claude session that was interrupted before generating output.
- Fix: Add a test with `assistant_message: ''` and verify no queue file is created.

**Missing test for truncation of long assistant messages** - `tests/shell-hooks.test.ts`
**Confidence**: 80%
- Problem: The stop hook (`stop-update-memory:66-69`) truncates `assistant_message` to 2000 chars. Similarly, the preamble hook truncates user prompts to 2000 chars. Neither truncation path has test coverage. If the bash substring syntax `${VAR:0:2000}` fails on certain shells or content, the queue could accumulate unbounded entries.
- Fix: Add a test passing a >2000 char message and asserting the queued content ends with `... [truncated]` and is roughly 2000 chars.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No integration test for background-memory-update turn parsing** - `scripts/hooks/background-memory-update:147-181`
**Confidence**: 80%
- Problem: The turn-pairing logic in `background-memory-update` (lines 147-181) processes queued JSONL entries, handles orphan users, orphan assistants, and user+assistant pairs. This is the core of the new architecture, yet it is only indirectly covered by the JSONL format validation test (which writes/reads a file without executing the script). A parsing bug (e.g., mishandling of special characters in `json_field`, or the `while read` loop consuming partial lines) would not be caught.
- Fix: Create an integration test that writes known JSONL entries to a `.processing` file, invokes just the turn-parsing portion (extract as a sourced function, or test via a minimal wrapper that `source`s the script up to the parsing section). This is admittedly harder for a bash script; at minimum, consider a test that runs the background updater against a mock (with `CLAUDE_BIN` pointing to a no-op script) and asserts the log output contains the correct turn count.

**Test `'queue JSONL format'` validates format but not behavior** - `tests/shell-hooks.test.ts:847-869`
**Confidence**: 80%
- Problem: The `queue JSONL format` test (line 847) creates entries directly via `fs.writeFileSync` and reads them back, verifying the schema. This is effectively testing Node's `JSON.stringify`/`JSON.parse` roundtrip, not the hooks' serialization logic. The test name suggests it validates the queue format produced by the hooks, but it bypasses both the preamble and stop hook entirely.
- Fix: Either (a) rename to clarify it tests the schema contract rather than hook behavior, or (b) replace with a test that exercises both hooks and then validates the combined queue output format.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**No test for crash recovery path in background-memory-update** - `scripts/hooks/background-memory-update:97-119`
**Confidence**: 85%
- Problem: The crash recovery logic (leftover `.processing` file from a prior failed run, merging new queue entries, capping to 200 lines) is entirely untested. This is a significant operational path -- crashes and timeouts are real in production background processes.

**No test for the background updater's lock/stale-lock behavior** - `scripts/hooks/background-memory-update:50-76`
**Confidence**: 80%
- Problem: Locking and stale lock recovery are correctness-critical for concurrent session safety. The `acquire_lock`, `break_stale_lock`, and cleanup-on-exit paths have zero test coverage.

## Suggestions (Lower Confidence)

- **Node fallback paths untested** - `scripts/hooks/stop-update-memory:51-57`, `scripts/hooks/preamble:35-37` (Confidence: 70%) -- All tests run in an environment with `jq` available. The `node -e` fallback branches for JSON serialization are never exercised. Consider a test that temporarily sets `_HAS_JQ=false` or runs in a PATH without jq.

- **Preamble slash-command skip not tested** - `scripts/hooks/preamble:42-44` (Confidence: 65%) -- The preamble skips prompts starting with `/`. While this is an existing behavior, the new queue-capture code (lines 24-39) intentionally runs before the skip check. A test confirming that `/plan` still gets queued but does not produce a preamble output would validate this design intent.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The new tests are well-structured, use proper temp directory isolation with `beforeEach`/`afterEach` cleanup, and validate the core happy paths (stop_reason filtering, end_turn queue capture, preamble user capture, missing .memory guard). However, two significant format/boundary paths in the newly added code lack coverage: the content array format for `assistant_message` and the queue overflow truncation. These are both in code introduced by this PR and represent real operational scenarios. The existing tests provide a good foundation that can be extended with relatively small additions.
