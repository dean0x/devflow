# Testing Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**No tests for `devflow memory --clear` handler** - `src/cli/commands/memory.ts:177-247`
**Confidence**: 95%
- Problem: The `--clear` flag introduces a significant new feature with project discovery, interactive scope selection, and file deletion across multiple projects. This handler has zero test coverage. The functions `hasMemoryDir` and `filterProjectsWithMemory` (lines 146-154) are also untested. The handler includes several branches (no projects found, local vs all scope, current project deduplication) that could regress silently.
- Fix: Add unit tests for `hasMemoryDir` and `filterProjectsWithMemory` (exported or test-accessible). For the command handler, add integration tests covering: (1) no projects with .memory/ found, (2) single project cleanup, (3) cleanup when no queue files exist, (4) cleanup when both .pending-turns.jsonl and .pending-turns.processing exist. Example:
```typescript
describe('memory --clear helpers', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-clear-'));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('hasMemoryDir returns true when .memory/ exists', async () => {
    await fs.mkdir(path.join(tmpDir, '.memory'), { recursive: true });
    expect(await hasMemoryDir(tmpDir)).toBe(true);
  });

  it('hasMemoryDir returns false when .memory/ missing', async () => {
    expect(await hasMemoryDir(tmpDir)).toBe(false);
  });

  it('filterProjectsWithMemory filters correctly', async () => {
    const withMem = path.join(tmpDir, 'proj-a');
    const withoutMem = path.join(tmpDir, 'proj-b');
    await fs.mkdir(path.join(withMem, '.memory'), { recursive: true });
    await fs.mkdir(withoutMem, { recursive: true });
    const result = await filterProjectsWithMemory([withMem, withoutMem]);
    expect(result).toEqual([withMem]);
  });
});
```

**Removed tests not replaced with equivalent coverage** - `tests/memory.test.ts`
**Confidence**: 88%
- Problem: The PR removes 9 tests (~120 lines) covering queue file cleanup and knowledge file format parsing. The removed queue cleanup tests validated the exact behavior that moved to `--clear`, but the new `--clear` handler has no tests (see above). The removed knowledge file tests (TL;DR parsing, ADR numbering, duplicate pitfall detection, graceful missing file handling, TL;DR update after append) validated behaviors used by the session-start hook and knowledge-persistence skill. These behaviors are now untested at the unit level. Only the session-start-memory hook integration tests remain, covering TL;DR injection but not the parsing logic itself.
- Fix: Either keep the knowledge file format tests (they test real behaviors, not removed code) or confirm equivalent coverage exists elsewhere. The queue cleanup tests should be replaced with tests for the `--clear` handler as noted above.

### MEDIUM

**`get-mtime` helper has only a syntax check, no behavioral test** - `scripts/hooks/get-mtime`
**Confidence**: 82%
- Problem: The `get-mtime` helper is a new shared utility sourced by `background-memory-update` and `stop-update-memory`. It has only a `bash -n` syntax check in `shell-hooks.test.ts:22`. No test verifies that `get_mtime` actually returns a valid epoch timestamp for an existing file or handles missing files gracefully. The BSD-first detection order (lines 7-10) could fail silently on Linux if `stat -f` returns an error code but also prints to stdout before failing.
- Fix: Add a behavioral test:
```typescript
it('get_mtime returns a valid epoch for existing file', () => {
  const tmpFile = path.join(os.tmpdir(), `devflow-mtime-test-${Date.now()}`);
  fs.writeFileSync(tmpFile, 'test');
  try {
    const result = execSync(
      `source "${path.join(HOOKS_DIR, 'get-mtime')}" && get_mtime "${tmpFile}"`,
      { stdio: 'pipe' },
    ).toString().trim();
    expect(Number(result)).toBeGreaterThan(0);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**New truncation tests use weak assertions** - `tests/shell-hooks.test.ts:268-311`
**Confidence**: 83%
- Problem: The prompt truncation test (line 285) asserts `entry.content.length < 3000` and the stop hook truncation test (line 309) asserts `entry.content.length < 5000`. These assertions are correct but imprecise. The hooks truncate to 2000 chars then append `... [truncated]` (15 chars), yielding exactly 2015 chars. Asserting `< 3000` would pass even if the truncation logic were broken and only removed a single character.
- Fix: Tighten the assertions to verify the actual expected length:
```typescript
// For 2000 char truncation + "... [truncated]" suffix
expect(entry.content.length).toBe(2015);
// or at minimum:
expect(entry.content.length).toBeLessThanOrEqual(2020);
```

## Pre-existing Issues (Not Blocking)

### LOW

**Unused import in `tests/memory.test.ts`** - `tests/memory.test.ts:5`
**Confidence**: 90%
- Problem: `import { exec } from 'child_process'` is imported but only used by the `session-start-memory hook integration` tests. After removing the knowledge file tests, the `exec` import is still used but `os` may become unused if queue cleanup tests were the sole consumer. Verified `os` is still used by `createMemoryDir` and `migrateMemoryFiles` test fixtures, so only `exec` warrants checking.
- Fix: No action needed -- `exec` is used by session-start-memory tests. This is informational only.

## Suggestions (Lower Confidence)

- **Batched JSON parsing in hooks not tested with tab-containing prompts** - `scripts/hooks/preamble:16-18`, `scripts/hooks/prompt-capture-memory:18-20` (Confidence: 70%) -- The `@tsv` output format uses tab as delimiter. If a user prompt contains a literal tab character, `cut -f2-` would split incorrectly, potentially losing content. The existing preamble tests use simple strings. A test with `\t` in the prompt would verify correctness.

- **`--clear` interactive prompt not tested for non-TTY environments** - `src/cli/commands/memory.ts:196` (Confidence: 65%) -- The `p.select()` call in the `--clear` handler will fail or hang in non-TTY (CI) environments. Other handlers like `--enable`/`--disable` work in non-TTY because they don't prompt. Consider adding a `--clear --all` or `--clear --local` non-interactive path.

- **No test for `addMemoryHooks` early-return with parsed Settings object** - `src/cli/commands/memory.ts:27` (Confidence: 62%) -- The `addMemoryHooks` function now calls `hasMemoryHooks(settings)` with a parsed object (not a string) on line 27. The existing idempotency test passes a JSON string, exercising the string path. A test passing pre-populated settings as the object path would increase confidence in the overload.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 1 |

**Testing Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The PR adds 6 good new behavioral tests for shell hooks (truncation, DEVFLOW_BG_UPDATER guard) and 3 tests for the `countMemoryHooks`/`hasMemoryHooks` Settings overload. However, it removes 9 tests covering queue cleanup and knowledge file parsing without replacement, and the largest new feature (`--clear` with cross-project discovery and file deletion) has zero test coverage. The net test delta is -6 tests in `memory.test.ts` and +4 in `shell-hooks.test.ts`, but the coverage gap is concentrated on the new `--clear` handler which is the highest-risk addition in this PR.
