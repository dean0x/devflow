# Testing Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Queue cleanup tests duplicate production logic instead of exercising it** - `tests/memory.test.ts:202-245`
**Confidence**: 85%
- Problem: The `queue file cleanup` describe block (4 tests) manually reimplements the cleanup logic (`fs.unlink(...).then(() => true).catch(() => false)`) rather than calling the actual command handler or an exported function. This means the tests validate their own inlined copy of the logic, not the real code in `memory.ts`. If the production cleanup logic changes (e.g., adds error logging, changes paths), these tests will silently pass while the real code diverges.
- Fix: Extract the queue cleanup logic from the `memoryCommand` disable handler into a testable exported function (e.g., `cleanupQueueFiles(memoryDir: string): Promise<{queueDeleted: boolean, procDeleted: boolean}>`), then test that function directly. This aligns with the project's CLAUDE.md principle: "Test behaviors, not implementation".

```typescript
// In memory.ts — extract:
export async function cleanupQueueFiles(memoryDir: string): Promise<{ queueDeleted: boolean; procDeleted: boolean }> {
  const queueDeleted = await fs.unlink(path.join(memoryDir, '.pending-turns.jsonl')).then(() => true).catch(() => false);
  const procDeleted = await fs.unlink(path.join(memoryDir, '.pending-turns.processing')).then(() => true).catch(() => false);
  return { queueDeleted, procDeleted };
}

// In tests — call:
const result = await cleanupQueueFiles(path.join(tmpDir, '.memory'));
expect(result.queueDeleted).toBe(true);
```

### MEDIUM

**No test for prompt-capture-memory truncation boundary** - `scripts/hooks/prompt-capture-memory:27-29`
**Confidence**: 82%
- Problem: The `prompt-capture-memory` hook truncates prompts longer than 2000 characters (`PROMPT="${PROMPT:0:2000}... [truncated]"`). No test validates this truncation behavior. Similarly, the stop hook truncates `assistant_message` at 2000 chars (line 75-77) and this is also untested. This is meaningful behavior that affects memory fidelity.
- Fix: Add a test case that sends a >2000 character prompt and verifies the queued entry is truncated with the expected suffix.

```typescript
it('prompt-capture-memory truncates prompts over 2000 chars', () => {
  fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
  const longPrompt = 'x'.repeat(2500);
  const input = JSON.stringify({ cwd: tmpDir, session_id: 'test-trunc', prompt: longPrompt });
  execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
  const entry = JSON.parse(
    fs.readFileSync(path.join(tmpDir, '.memory', '.pending-turns.jsonl'), 'utf-8').trim()
  );
  expect(entry.content.length).toBeLessThan(2500);
  expect(entry.content).toContain('... [truncated]');
});
```

**No test for DEVFLOW_BG_UPDATER early exit in prompt-capture-memory** - `scripts/hooks/prompt-capture-memory:10`
**Confidence**: 80%
- Problem: The `prompt-capture-memory` hook has a guard clause (`if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then exit 0; fi`) that prevents feedback loops when the background updater's haiku session triggers hooks. This critical safeguard has no test. The same guard in `stop-update-memory` is also untested. A regression that removes this guard would cause an infinite loop of memory captures.
- Fix: Add a test that sets the env var and verifies no queue write occurs.

```typescript
it('prompt-capture-memory skips when DEVFLOW_BG_UPDATER=1', () => {
  fs.mkdirSync(path.join(tmpDir, '.memory'), { recursive: true });
  const input = JSON.stringify({ cwd: tmpDir, session_id: 'bg', prompt: 'test' });
  execSync(`bash "${PROMPT_CAPTURE_HOOK}"`, {
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEVFLOW_BG_UPDATER: '1' },
  });
  expect(fs.existsSync(path.join(tmpDir, '.memory', '.pending-turns.jsonl'))).toBe(false);
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No integration test for background-memory-update single-pass extraction refactor** - `scripts/hooks/background-memory-update`
**Confidence**: 82%
- Problem: The `background-memory-update` script received a significant refactor replacing per-line `json_field` calls with a single-pass `jq`/`node` TSV extraction. This is the core logic change of the PR (PF-006 resolution), yet it has zero automated tests. The only test covering `background-memory-update` is the syntax check (`bash -n`). While this script is hard to test in isolation (it invokes `claude -p`), the extraction/pairing logic could be extracted into a testable function or validated with a mock.
- Fix: At minimum, create a test that validates the extraction TSV output. For example, pipe known JSONL through the jq/node extraction commands and verify correct role/content pairing. This does not require a full `claude -p` invocation.

```typescript
it('single-pass extraction produces correct TSV from JSONL', () => {
  const entries = [
    '{"role":"user","content":"hello","ts":1}',
    '{"role":"assistant","content":"world","ts":2}',
  ].join('\n');
  const result = execSync(
    `jq -r '(.role // "") + "\\t" + ((.content // "") | gsub("\\n"; " "))' <<< '${entries}'`,
    { stdio: 'pipe' },
  ).toString().trim();
  const lines = result.split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe('user\thello');
  expect(lines[1]).toBe('assistant\tworld');
});
```

## Pre-existing Issues (Not Blocking)

None with CRITICAL severity.

## Suggestions (Lower Confidence)

- **Missing edge case: prompt-capture-memory with empty prompt** - `scripts/hooks/prompt-capture-memory:23` (Confidence: 70%) -- The hook guards against empty PROMPT with `if [ -z "$PROMPT" ]; then exit 0; fi`, but no test exercises this path. Low risk since behavior is correct; mainly a coverage gap.

- **No test for CWD validation in hooks** - `scripts/hooks/prompt-capture-memory:19`, `scripts/hooks/stop-update-memory:23` (Confidence: 65%) -- Both hooks now validate `[ ! -d "$CWD" ]` (new in this PR), but no test sends a non-existent CWD to verify early exit. The `preamble` hook received the same change.

- **`addMemoryHooks` idempotency change: always serializes** - `src/cli/commands/memory.ts:56-60` (Confidence: 65%) -- The `changed` flag and early-return optimization was removed from `addMemoryHooks`. Now it always serializes to JSON even when nothing changed (the `hasMemoryHooks` check at line 26-28 returns `settingsJson` for the all-present case, but partial-present cases always re-serialize). This is tested implicitly by the idempotency test, but the behavioral change (JSON reformatting on no-op) is not explicitly validated.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The test suite was significantly expanded in this PR -- 51 memory tests and 70 shell-hook tests all pass. The new `prompt-capture-memory` hook has basic coverage (queue write, missing `.memory/` dir, separation from preamble). The `addMemoryHooks`/`removeMemoryHooks`/`hasMemoryHooks`/`countMemoryHooks` functions are thoroughly tested for the new 4-hook configuration with good upgrade path and toggle cycle coverage. The content-array and overflow tests for `stop-update-memory` are well-designed. The main gaps are: (1) queue cleanup tests that duplicate rather than call production code, (2) missing truncation boundary tests, (3) missing feedback-loop guard tests, and (4) zero coverage for the background updater's extraction refactor -- the core performance fix of the PR.
