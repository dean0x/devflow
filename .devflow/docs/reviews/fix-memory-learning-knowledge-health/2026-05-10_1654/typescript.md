# TypeScript Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Untyped `JSON.parse` results in new shell-hooks test blocks (9 occurrences)** -- Confidence: 82%
- `tests/shell-hooks.test.ts:1400`, `tests/shell-hooks.test.ts:1427`, `tests/shell-hooks.test.ts:1490`, `tests/shell-hooks.test.ts:1494`, `tests/shell-hooks.test.ts:1244`, `tests/shell-hooks.test.ts:1268`, `tests/shell-hooks.test.ts:1344`, `tests/shell-hooks.test.ts:1375`, `tests/shell-hooks.test.ts:1515`
- Problem: `JSON.parse(...)` returns `any` by default. The results are stored in `const entry = JSON.parse(lines[0])` and then accessed as `entry.role`, `entry.content`, `entry.ts` without a type assertion. This means the test assertions against `.role`, `.content`, and `.ts` bypass type checking entirely. While this is a pre-existing pattern repeated throughout the test file, the new test blocks (auto-clean empty queue, auto-clean single orphan, overflow first-entry assertion) continue it.
- Fix: Add an inline type assertion at parse sites:
  ```typescript
  const entry = JSON.parse(lines[0]) as { role: string; content: string; ts: number };
  ```
  This is the same pattern already used in `decisions-agent.test.ts` (e.g., line 341: `JSON.parse(content) as { observations: Array<{ details: string }> }`).

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`ExecFileMock` type alias erases mock type information** -- Confidence: 80%
- `tests/decisions/decisions-agent.test.ts:34`, `tests/learning/learning-agent.test.ts:33`
- Problem: `type ExecFileMock = ReturnType<typeof vi.fn>` is `Mock<(...args: any[]) => any>`, which loses the `execFile` overload signatures. The double cast `vi.mocked(execFile) as unknown as ExecFileMock` discards the original type. This is a pre-existing pattern not introduced by this branch but is used in the vicinity of every change.
- Fix: Define a narrower mock type matching the actual `execFile` callback overload being used:
  ```typescript
  type ExecFileCallback = (
    cmd: string,
    args: string[],
    opts: { timeout?: number } | null,
    callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => ReturnType<typeof execFile>;
  type ExecFileMock = ReturnType<typeof vi.fn<ExecFileCallback>>;
  ```

### LOW

**`noUncheckedIndexedAccess` not enabled in tsconfig** -- Confidence: 85%
- `tsconfig.json`
- Problem: With `strict: true` but without `noUncheckedIndexedAccess`, array index access like `lines[0]` and `resultLines[resultLines.length - 1]` returns `T` instead of `T | undefined`. This affects the new test code where `JSON.parse(lines[0])` and `JSON.parse(resultLines[resultLines.length - 1])` are used without null checks. While the tests guard with `expect(lines).toHaveLength(1)` before accessing, TypeScript cannot narrow based on runtime assertions.
- Note: Enabling this flag is a project-wide decision that would affect all existing code. Flagged for awareness, not action on this PR.

## Suggestions (Lower Confidence)

- **Duplicated test helper code across agent test files** - `tests/decisions/decisions-agent.test.ts` and `tests/learning/learning-agent.test.ts` (Confidence: 65%) -- `ExecFileMock`, `mockExecFile`, `getCapturedClaudeArgs`, and `makeTmpDir` are nearly identical across both files. A shared test helper module would reduce maintenance burden, but this is a style choice that predates this branch.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 1 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The TypeScript changes are clean and well-executed. The `debug` field removal from `runDecisionsAgent` and `runLearningAgent` opts aligns correctly with the updated `DecisionsAgentOpts` and `LearningAgentOpts` interfaces (both confirmed to no longer include a `debug` field). The `_args` prefix for the unused mock parameter in `learning-agent.test.ts:41` follows TypeScript convention. The indentation fix in error-path test cases (`decisions-agent.test.ts:423`, `learning-agent.test.ts:271`, `learning-agent.test.ts:285`) is pure formatting. All 140 tests pass, and vitest typecheck confirms zero type errors across the changed files.

The only blocking finding is the continued use of untyped `JSON.parse` in new test code, which is a minor concern in test files but would be trivial to fix with inline type assertions matching the pattern already established in `decisions-agent.test.ts`.
