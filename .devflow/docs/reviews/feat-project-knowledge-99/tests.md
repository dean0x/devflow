# Tests Review Report

**Branch**: pr-140 (feat: Wave 2 -- project knowledge system) -> main
**Date**: 2026-03-14
**PR**: #140

## Issues in Your Changes (BLOCKING)

### HIGH

**Tests validate inline logic, not importable functions** - `tests/memory.test.ts:358-485`
- Problem: The entire `describe('knowledge file format')` block (8 tests, ~130 lines) tests parsing/manipulation logic that is inlined within each test body. These tests write a file, then re-read it and apply regex/string operations to extract data. They are testing the correctness of regex patterns and string manipulation code that is copy-pasted into test bodies -- not testing any exported function or module behavior. This violates the Iron Law: "Tests validate behavior, not implementation." These tests validate nothing in the production codebase; they validate ad-hoc scripts written inside the test itself.
- Impact: If the actual consumers of this format (the session-start-memory shell hook, the command markdown instructions for `/implement`, `/code-review`, `/debug`, `/resolve`) change their parsing logic, these tests will still pass. The tests provide false confidence -- they prove a regex works in isolation but do not prove the production code works.
- Fix: Either (a) extract the knowledge file parsing logic into a TypeScript utility module (e.g., `src/cli/utils/knowledge.ts`) with functions like `parseTldr()`, `getHighestEntryNumber()`, `isDuplicate()`, `updateTldr()` and test those exports, or (b) if the logic intentionally lives only in shell scripts and markdown instructions (no TypeScript runtime), convert these to integration tests that actually invoke the shell hook with fixture data and assert its output. As-is, the tests are self-referential -- they test code that exists nowhere outside the test file.

```typescript
// CURRENT (self-referential -- tests code that only exists in the test):
it('extracts highest ADR number via regex', async () => {
  // ... writes file ...
  const matches = [...fileContent.matchAll(/^## ADR-(\d+)/gm)];
  const highest = matches.length > 0
    ? Math.max(...matches.map(m => parseInt(m[1], 10)))
    : 0;
  expect(highest).toBe(3);
});

// BETTER (tests an actual export):
// In src/cli/utils/knowledge.ts:
// export function getHighestEntryNumber(content: string, prefix: string): number { ... }

it('extracts highest ADR number', () => {
  const content = '## ADR-001: First\n## ADR-002: Second\n## ADR-003: Third';
  expect(getHighestEntryNumber(content, 'ADR')).toBe(3);
});
```

### MEDIUM

**No test coverage for `createMemoryDir` failure path** - `tests/memory.test.ts:258-271`
- Problem: The two new tests for `createMemoryDir` (lines 258-262, 264-271) only test the happy path -- directory creation and idempotency. The source code at `src/cli/utils/post-install.ts:479-485` has a `catch` block that silently swallows errors. There is no test that verifies behavior when `fs.mkdir` fails for a reason other than "already exists" (e.g., permission denied, read-only filesystem).
- Impact: A regression in error handling would go undetected. The silent `catch` could mask real errors.
- Fix: Add a test that verifies the function does not throw when the directory already exists (covered), and consider whether the silent catch is the intended behavior or whether it should surface errors. If silent catch is intended, document it in a test name like `it('suppresses mkdir errors silently')`.

### MEDIUM

**Missing coverage for the session-start-memory hook's knowledge injection** - `scripts/hooks/session-start-memory:122-140`
- Problem: The PR adds 20 lines of new shell logic (Section 1.5: Project Knowledge TL;DR) to the session-start-memory hook. This logic reads knowledge files, parses TL;DR lines, filters out headings via `grep -qv '^#'`, and injects them into the session context. None of this is tested. The `knowledge file format` tests in `memory.test.ts` only test the TypeScript-side regex logic (which itself is not extracted into any function). The shell hook is the actual production consumer and has zero test coverage.
- Impact: The shell hook could silently break (e.g., `sed` pattern change, `grep` filter regression, `printf '%b'` edge case) with no test catching it.
- Fix: Add an integration test that invokes the session-start-memory hook with a mock `$CWD` containing knowledge files and asserts the JSON output includes the `PROJECT KNOWLEDGE (TL;DR)` section. This project already has shell-invocation patterns in its test suite that could serve as a template.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No tests for pitfall-recording logic in commands** - `plugins/devflow-code-review/commands/code-review.md`, `plugins/devflow-debug/commands/debug.md`, `plugins/devflow-resolve/commands/resolve.md`, `plugins/devflow-implement/commands/implement.md`
- Problem: The PR adds identical "Record Pitfalls" / "Record Decisions" phases to 8 command files (4 base + 4 teams variants). These phases describe a multi-step algorithm: read file, check cap (>=50), find highest ID, append entry, deduplicate, update TL;DR, use mkdir-based lock. This algorithm is specified in natural language (Markdown instructions for agents) and has no automated verification. The `knowledge file format` tests cover fragments of this algorithm (regex extraction, TL;DR update, deduplication) but test them as isolated inline code, not as the integrated flow.
- Impact: Any agent implementation of these instructions could deviate from the specification (e.g., not checking the 50-entry cap, not deduplicating, not using the lock) and no test would catch it.
- Fix: At minimum, the core operations (cap check, dedup, ID increment, TL;DR update) should be extracted into a shared TypeScript utility that agents can call, with corresponding tests. This would also eliminate the specification drift risk across 8 command files that contain identical instructions.

### LOW

**Duplicate step numbering in implement-teams.md** - `plugins/devflow-implement/commands/implement-teams.md`
- Problem: After renumbering steps 2-4 to 3-5, step 5 appears twice in each teammate prompt (e.g., lines 97+99: step "5. Document findings" and step "5. Report completion"). This is a documentation issue in the command spec, not a test issue, but the test suite has no validation that command specifications are internally consistent.
- Impact: Minor -- agents may skip the duplicated step number. Not a test gap per se, but worth noting.
- Fix: Renumber the final step to 6 in each teammate prompt block.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**No integration tests for shell hooks** - `scripts/hooks/`
- Problem: The project has 4 shell hooks (`session-start-memory`, `stop-update-memory`, `pre-compact-memory`, `ambient-prompt`) with zero integration tests. All tests in the suite are unit tests against TypeScript functions.
- Impact: Shell hook regressions can only be caught manually. This PR compounds the gap by adding 20 lines of new shell logic.
- Fix: Consider adding a `tests/hooks.test.ts` that invokes hooks via `child_process.exec` with controlled environments and asserts JSON output structure.

### LOW

**Test file grows to 486 lines** - `tests/memory.test.ts`
- Problem: The `memory.test.ts` file now contains 486 lines across 5 describe blocks covering distinct concerns (hooks, directory creation, migration, knowledge format). This is approaching the threshold where splitting into separate test files would improve maintainability.
- Impact: Navigability and test isolation degrade as the file grows.
- Fix: Consider splitting into `tests/memory-hooks.test.ts`, `tests/memory-dir.test.ts`, `tests/memory-migration.test.ts`, and `tests/knowledge.test.ts` when convenient.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 1 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Tests Score**: 5/10

The PR adds 8 new tests for the knowledge file format and 2 tests for `createMemoryDir`. All 36 tests pass. However, the new tests have a fundamental design issue: they test inline logic (regex patterns, string operations) that exists only within the test bodies, not any exported function or production code path. The actual production consumers -- the session-start-memory shell hook and the agent command instructions -- have no automated test coverage. The tests provide format documentation value but limited regression protection.

**Recommendation**: CHANGES_REQUESTED

Primary concern: The `knowledge file format` test suite validates patterns that are not connected to production code. Either extract the parsing logic into a testable TypeScript module, or add integration tests that verify the shell hook's actual behavior. Without this, the tests create a false sense of coverage -- the format could drift between what the tests validate and what the hooks/agents actually implement.
