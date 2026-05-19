# TypeScript Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Scope

Changed files with TypeScript relevance: `tests/shell-hooks.test.ts` (131 lines added/modified). The remaining changed files are shell scripts (`background-memory-update`, `stop-update-memory`, `preamble`) and documentation (`CLAUDE.md`), which fall outside the TypeScript review focus.

## Issues in Your Changes (BLOCKING)

### HIGH

**Shell injection via unsanitized JSON in execSync** - `tests/shell-hooks.test.ts:772,791,816,840`
**Confidence**: 82%
- Problem: The test helper pattern `echo '${input.replace(/'/g, "'\\''")}' | bash ...` escapes single quotes but does not guard against shell metacharacters that could appear in dynamically constructed JSON values. While these are test-only invocations with controlled inputs, the pattern is fragile and could break or behave unexpectedly if test data evolves to include backticks, `$()`, or newlines.
- Fix: Use `execSync` with `input` option to pipe data via stdin instead of shell interpolation:
```typescript
execSync(`bash "${STOP_HOOK}"`, {
  input: JSON.stringify({ cwd: tmpDir, stop_reason: 'tool_use', assistant_message: 'test' }),
  stdio: ['pipe', 'pipe', 'pipe'],
});
```
Note: This pattern already exists elsewhere in the codebase (e.g., `json-helper.cjs temporal-decay` tests use `stdio: ['pipe', 'pipe', 'pipe']`). The new tests should use the safer input-piping pattern consistently.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Missing `os` import not visible at diff level but required** - `tests/shell-hooks.test.ts:754`
**Confidence**: 85%
- Problem: The new test block at line 754 uses `os.tmpdir()` in `fs.mkdtempSync(path.join(os.tmpdir(), ...))`. The `os` module import is not shown in the diff additions. However, inspection of the full file confirms `import * as os from 'os'` exists at line 5. This is not a bug, but worth noting that the import was already present from prior test blocks -- no action needed.

**Removed `session-end-learning` bash syntax check without replacement** - `tests/shell-hooks.test.ts:733-735`
**Confidence**: 80%
- Problem: The explicit test `it('is included in bash -n syntax checks', ...)` was removed from the `session-end-learning structure` describe block. The `HOOK_SCRIPTS` array still includes `session-end-learning` and the generic `bash -n` loop still runs, so coverage is preserved. However, removing the explicit assertion reduces the test's documentary value as a regression guard that `session-end-learning` specifically stays in the syntax check list.
- Fix: No code change needed -- the generic loop already covers this. This is informational only.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Repeated shell-exec boilerplate across test blocks** - `tests/shell-hooks.test.ts` (multiple locations)
**Confidence**: 83%
- Problem: The pattern of `fs.mkdtempSync` + `beforeEach`/`afterEach` + `execSync` with shell-escaped JSON is repeated across many test blocks (the new working memory queue tests, the existing background-learning tests, the temporal-decay tests). A shared test helper for "run hook with JSON input" would reduce boilerplate and centralize the shell-escaping concern.
- Impact: Each new test block re-implements the same plumbing, increasing maintenance surface.
- Fix: Extract a `runHookWithInput(hookPath: string, input: object): string` helper at the top of the test file.

### LOW

**No type annotation on parsed JSON in test assertions** - `tests/shell-hooks.test.ts:799-802,824-826,863-867`
**Confidence**: 80%
- Problem: `JSON.parse(lines[0])` returns `any` (TypeScript's JSON.parse signature). The tests then access `.role`, `.content`, `.ts` without type narrowing or an interface definition. Since `tsconfig.json` has `strict: true`, this would normally be flagged, but the test file is outside `rootDir` and likely not subject to strict checking.
- Impact: Minor -- test-only code, but adding an interface like `{ role: string; content: string; ts: number }` would make test assertions self-documenting.

## Suggestions (Lower Confidence)

- **Consider testing the background-memory-update turn-pairing logic** - `scripts/hooks/background-memory-update:148-181` (Confidence: 65%) -- The while-read loop that pairs user/assistant entries and handles orphans is non-trivial shell logic with 4 branches (user after user, assistant after user, orphan assistant, trailing user). Adding a test that writes known JSONL entries and verifies the TURNS_TEXT output would catch pairing regressions.

- **Queue file concurrent append safety** - `scripts/hooks/stop-update-memory:76` and `scripts/hooks/preamble:33` (Confidence: 70%) -- Both hooks append to `.pending-turns.jsonl` using shell `>>` redirection. If two hooks fire simultaneously (e.g., preamble and stop hook), interleaved writes could corrupt a JSONL line. POSIX guarantees atomic writes only up to PIPE_BUF (typically 4096 bytes); entries near that limit could interleave. The 2000-char truncation provides some margin but does not fully eliminate the risk on all filesystems.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 1 |

**TypeScript Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The TypeScript changes are limited to test code, and the tests are well-structured with proper setup/teardown, meaningful assertions, and good coverage of the new queue behavior (tool_use filtering, end_turn capture, preamble capture, missing .memory/ graceful exit, JSONL format validation). The one blocking issue (shell injection pattern in tests) is a straightforward fix to align with the safer `input` option pattern already used elsewhere in the same file.
