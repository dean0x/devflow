# TypeScript Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-30_1831

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Unused import `{ promises as fs }` in new test file** - `tests/skill-references.test.ts:11`
**Confidence**: 95%
- Problem: `import { promises as fs } from 'fs'` is imported but never used anywhere in the file. All file operations use the sync imports from line 10 (`readFileSync`, `readdirSync`, `statSync`). This is dead code that a linter would flag and indicates an incomplete cleanup during file creation.
- Fix: Remove line 11 entirely:
  ```typescript
  // Remove this line:
  import { promises as fs } from 'fs';
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Non-null assertions after `expect().toBeTruthy()` (2 occurrences)** - `tests/skill-references.test.ts:871`, `tests/skill-references.test.ts:892`
**Confidence**: 82%
- Problem: The pattern `expect(match).toBeTruthy()` followed by `match![1]` uses non-null assertion (`!`). While the preceding `expect` guarantees the value is truthy at test time, this is an anti-pattern per the TypeScript skill -- prefer narrowing over `!`. If the regex changes and the match becomes `null`, the `!` assertion would cause a runtime crash rather than a clear test failure on the `expect` line.
- Fix: Use a guarded check or `if` block to narrow:
  ```typescript
  if (!coreMatch) {
    expect.unreachable('review-orchestration should list 7 core reviewers');
  }
  const coreReviewers = coreMatch[1].split(',').map(s => s.trim());
  ```
  Alternatively, extract a helper:
  ```typescript
  function expectMatch(value: RegExpMatchArray | null, msg: string): RegExpMatchArray {
    expect(value, msg).toBeTruthy();
    return value!; // Single point of assertion
  }
  ```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`SHADOW_RENAMES` could use `as const` for narrower typing** - `src/cli/plugins.ts:312` (Confidence: 65%) -- Declaring as `as const satisfies ReadonlyArray<readonly [string, string]>` would make the tuple entries literal types, enabling exhaustive checks if consumers ever switch on rename pairs. Minor improvement.

- **`migrateShadowOverrides` nested try/catch control flow** - `src/cli/commands/init.ts:69-83` (Confidence: 70%) -- The nested try/catch using `fs.access` for existence checks is a common Node.js pattern but makes the control flow harder to follow than it needs to be. An alternative approach would be to use `fs.stat` with a helper like `async function exists(p: string): Promise<boolean>` to flatten the nesting. However, this is an established pattern in the codebase and the function is well-tested, so it is not blocking.

- **`JSON.parse` return typed via annotation rather than schema validation** - `tests/skill-references.test.ts:121-123` (Confidence: 62%) -- `JSON.parse(...)` returns `any`, and the type annotation `let manifest: { skills?: string[] }` provides no runtime guarantee. In test code this is acceptable, but for production code the project convention (Zod validation at boundaries) should be preferred. Since this is test-only, it is a minor observation.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The TypeScript changes in this branch are well-typed and cleanly structured. The new `migrateShadowOverrides` function has explicit return types, the `SHADOW_RENAMES` constant is properly typed as `[string, string][]`, and the 950-line `skill-references.test.ts` file demonstrates strong test discipline with rename-proof patterns derived from runtime data. No `any` types anywhere. Strict mode is enabled and compilation passes cleanly.

The two MEDIUM findings (unused import, non-null assertions) are minor cleanup items that do not affect correctness. The branch is safe to merge after addressing the unused import.
