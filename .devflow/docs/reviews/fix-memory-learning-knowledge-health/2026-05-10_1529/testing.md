# Testing Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Auto-clean test missing empty queue edge case** - `tests/shell-hooks.test.ts:1351`
**Confidence**: 85%
- Problem: The auto-clean tests cover a queue with 5 orphan user entries and a healthy mixed queue, but do not test the empty queue case (`QUEUE_FILE` exists but is empty or has 0 lines). The implementation at `scripts/hooks/stop-update-memory:63-68` does `grep -q '"role":"assistant"'` on the file -- an empty file returns exit code 1 from grep, which means the auto-clean `> "$QUEUE_FILE"` truncation fires on an already-empty file. This is harmless but the edge case behavior should be documented by a test for completeness, especially since the grep exit code on an empty file could behave differently across bash versions.
- Fix: Add a test case for an empty pre-existing queue file:
```typescript
it('auto-clean on empty queue file is a no-op (no crash)', () => {
  fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.memory', '.working-memory-last-trigger'), '');
  const queueFile = path.join(tmpDir, '.memory', '.pending-turns.jsonl');
  fs.writeFileSync(queueFile, '');

  const input = JSON.stringify({
    cwd: tmpDir,
    session_id: 'test-session-empty-queue',
    stop_reason: 'end_turn',
    response_text: 'response after empty queue',
  });

  execSync(`bash "${STOP_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });

  const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  const entry = JSON.parse(lines[0]);
  expect(entry.role).toBe('assistant');
});
```

**Auto-clean test missing single-user-entry case** - `tests/shell-hooks.test.ts:1351`
**Confidence**: 82%
- Problem: The orphan test uses 5 entries, which tests bulk truncation. A single orphan user entry (the minimum case that triggers auto-clean) is not tested. While the implementation handles it identically, a single-entry test would verify the boundary condition and serve as documentation of the minimum trigger.
- Fix: Add a test with exactly 1 orphan user entry to confirm the auto-clean triggers at the minimum case, or add a comment to the existing test explaining why the multi-entry case is sufficient.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Overflow test does not verify content of preserved entries** - `tests/shell-hooks.test.ts:1408-1440`
**Confidence**: 80%
- Problem: The overflow test verifies the count (100 lines) and the last entry, but does not verify that the preserved entries are the *last* 100 from the original 202. The `tail -100` in the implementation (line 96 of stop-update-memory) should keep entries 103-202, but no assertion confirms the first preserved entry is `entry 102` (index 102, the 103rd line). The test only checks the last line. This is a weaker assertion than necessary for verifying that `tail` preserves the correct end of the file.
- Fix: Add an assertion on the first entry of the resulting queue to verify it's from the tail end of the original entries:
```typescript
const firstEntry = JSON.parse(resultLines[0]);
expect(firstEntry.content).toBe('entry 102');
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Fence-stripping: no test for nested/double fences** - `tests/learning/learning-agent.test.ts:110-140` (Confidence: 65%) -- The regex-based fence stripping is tested for leading whitespace and trailing whitespace, but not for malformed cases like double opening fences or fences with extra text after `json`. These are unlikely from Claude output but are the kind of inputs that expose regex brittleness.

- **No test for auto-clean with response_text being empty** - `tests/shell-hooks.test.ts:1351` (Confidence: 62%) -- When `response_text` is empty and the queue has only orphan user entries, the auto-clean truncates the queue but then the "Skip if empty" guard (line 71-73 of stop-update-memory) exits without appending. The queue ends up empty. This interaction between two guards is not tested.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Overall Assessment**:

The test changes are well-structured and appropriately cover the three areas of change:

1. **Stop hook field rename** (`assistant_message` -> `response_text`): All existing tests correctly updated to use the new field name. The replacement of the content-array test with auto-clean tests is appropriate -- the content-array test was testing behavior that no longer exists (the hook previously had to join `assistant_message` content arrays; `response_text` is already a plain string), so removing it is correct.

2. **Auto-clean tests**: The two new auto-clean tests (orphan truncation and mixed-queue preservation) cover the core happy path and the negative case. The missing edge cases (empty queue, single orphan) are MEDIUM severity since the implementation handles them implicitly, but explicit tests would improve confidence.

3. **Overflow test fix**: The change from all-user-role entries to mixed roles is a correct fix -- all-user entries would now trigger auto-clean before the overflow check, making the test unreliable. The mixed-role approach correctly avoids that interaction.

4. **Fence-stripping tests**: The two new tests (`leading whitespace` and `trailing whitespace after markers`) directly correspond to the regex changes in `_stripMarkdownFences` -- the `\s*` additions in the regex patterns. These are well-targeted tests.

5. **Timeout and debug field changes**: Mechanical updates (180s -> 300s, `debug: false` removal) correctly reflect the implementation changes and pass.

6. **ensure-features-init tests**: Five tests with good coverage of create, idempotency, gitignore with/without .git, and non-overwrite of existing data.

**Testing Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions: The two MEDIUM blocking issues (empty queue edge case and single-orphan boundary) are low-risk but represent gaps in edge case coverage for a new feature. The should-fix overflow content verification would strengthen an existing test.
