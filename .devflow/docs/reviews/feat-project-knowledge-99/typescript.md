# TypeScript Review Report

**Branch**: feat/project-knowledge-99 -> main
**Date**: 2026-03-14
**PR**: #140 — feat: Wave 2 -- project knowledge system (decisions + pitfalls)

## Scope

TypeScript files changed: 2
- `src/cli/utils/post-install.ts` (+1 line)
- `tests/memory.test.ts` (+153 lines, 8 new tests)

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Tests validate file I/O rather than exported functions** - `tests/memory.test.ts:345-486`
- Problem: The entire `knowledge file format` test suite (8 tests, 142 lines) tests inline string parsing logic using raw `fs.readFile`/`fs.writeFile` rather than testing exported TypeScript functions. These tests validate TL;DR parsing, ADR numbering extraction, duplicate detection, and TL;DR updates -- all logic that lives inline in the tests themselves rather than in a reusable module. The tests are essentially self-referential: they define the algorithm in the test body and then assert it works.
- Impact: If the actual shell scripts or command files that perform these operations diverge from the patterns tested here, the tests will still pass while the real code breaks. The tests give a false sense of coverage because they are testing their own implementation, not production code. Additionally, the parsing logic (TL;DR extraction via `replace`, ADR numbering via regex, duplicate detection via `includes`) has no TypeScript function backing it -- it cannot be reused or unit-tested independently.
- Fix: Extract the knowledge file parsing operations into a TypeScript module (e.g., `src/cli/utils/knowledge.ts`) with typed functions:

```typescript
// src/cli/utils/knowledge.ts

export interface KnowledgeTldr {
  count: number;
  keys: string[];
  raw: string;
}

export function parseTldr(firstLine: string): KnowledgeTldr | null {
  if (!firstLine.startsWith('<!-- TL;DR:')) return null;
  const raw = firstLine.replace('<!-- TL;DR: ', '').replace(' -->', '');
  // parse count and keys from raw...
  return { count, keys, raw };
}

export function extractHighestEntryNumber(content: string, prefix: 'ADR' | 'PF'): number {
  const matches = [...content.matchAll(new RegExp(`^## ${prefix}-(\\d+)`, 'gm'))];
  return matches.length > 0 ? Math.max(...matches.map(m => parseInt(m[1], 10))) : 0;
}

export function isDuplicatePitfall(content: string, area: string, issue: string): boolean {
  return content.includes(`**Area**: ${area}`) && content.includes(`**Issue**: ${issue}`);
}

export function updateTldr(content: string, prefix: 'ADR' | 'PF', label: string): string {
  const matches = [...content.matchAll(new RegExp(`^## ${prefix}-(\\d+)`, 'gm'))];
  const count = matches.length;
  const keys = matches.map(m => `${prefix}-${m[1].padStart(3, '0')}`).join(', ');
  return content.replace(/^<!-- TL;DR:.*-->/, `<!-- TL;DR: ${count} ${label}. Key: ${keys} -->`);
}
```

Then test those functions directly, importing them as production code. This aligns with the project's principle of "test behaviors, not implementation" and the CLAUDE.md guidance that "if tests need complex setup, the design is probably wrong."

**Note**: This is listed as HIGH rather than CRITICAL because the tests do validate the intended parsing contracts even though they do so against inline logic. The code works correctly today. The risk is maintainability drift between these test-defined patterns and the actual shell/markdown consumers.

### MEDIUM

**`let` used where `const` is sufficient** - `tests/memory.test.ts:466-467`
- Problem: In the "updates TL;DR to reflect new entry count after append" test, `fileContent` is declared with `let` and then reassigned with concatenation and replacement. While `let` is technically needed because of reassignment, the pattern of read-mutate-write could be made more functional:
```typescript
let fileContent = await fs.readFile(...);  // line 466
// ...
fileContent += newEntry;                   // line 469
// ...
fileContent = fileContent.replace(...);    // line 474
```
- Impact: Minor. Violates the project's "immutable by default" engineering principle from CLAUDE.md. The mutations make it harder to reason about intermediate states.
- Fix: Use `const` with a pipeline approach:
```typescript
const raw = await fs.readFile(path.join(tmpDir, '.memory', 'knowledge', 'pitfalls.md'), 'utf-8');
const withEntry = raw + newEntry;
const matches = [...withEntry.matchAll(/^## PF-(\d+)/gm)];
const count = matches.length;
const keys = matches.map(m => `PF-${m[1].padStart(3, '0')}`).join(', ');
const updated = withEntry.replace(/^<!-- TL;DR:.*-->/, `<!-- TL;DR: ${count} pitfalls. Key: ${keys} -->`);
await fs.writeFile(..., updated);
```

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`createMemoryDir` catches all exceptions silently** - `src/cli/utils/post-install.ts:479-485`
- Problem: The `try { ... } catch { /* may already exist */ }` block now wraps two `fs.mkdir` calls but still catches all errors silently. The comment "may already exist" is misleading since `{ recursive: true }` already handles the directory-exists case without throwing. The catch would only fire for genuine errors (permissions, disk full) which are silently swallowed.
- Impact: If the `knowledge/` subdirectory creation fails (e.g., permissions), the error is invisible. The user sees "`.memory/` directory ready" even when `knowledge/` was not created.
- Fix: Since `{ recursive: true }` handles idempotency, the catch block is only needed for real errors. Consider logging in verbose mode:
```typescript
try {
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });
  if (verbose) {
    p.log.success('.memory/ directory ready');
  }
} catch (error) {
  if (verbose) {
    p.log.warn(`Could not create memory directories: ${error}`);
  }
}
```

This is a pre-existing pattern but the PR adds a second `mkdir` call into the same silent catch, increasing the surface area for hidden failures.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Verbose log message does not mention `knowledge/` subdirectory** - `src/cli/utils/post-install.ts:482`
- Problem: The success log says `.memory/ directory ready` but now also creates `.memory/knowledge/`. The log does not reflect the new subdirectory.
- Impact: Minor UX. Users running with `--verbose` do not know `knowledge/` was created.
- Fix: Update to `.memory/ directory ready (with knowledge/)` or similar.

### LOW

**Non-null assertion in pre-existing code** - `src/cli/utils/post-install.ts:235`
- Problem: `writeFileSync(managedPath, updatedContent!, 'utf-8')` uses non-null assertion (`!`). The TypeScript patterns skill flags non-null assertion abuse as an anti-pattern.
- Impact: Pre-existing. The logic flow guarantees `updatedContent` is set when `shouldDelete` is false, but the assertion bypasses the type checker rather than proving it structurally.
- Fix: Restructure with early return or use a discriminated union for the delete/update decision.

### LOW

**`error` parameter typed as implicit `any` in pre-existing catch blocks** - `src/cli/utils/post-install.ts:157,278,449`
- Problem: Several catch blocks use `catch (error)` without an explicit type annotation. While TypeScript 4.4+ defaults catch variables to `unknown`, the codebase inconsistently uses `catch (error: unknown)` (line 132, 241, 388, 412) and plain `catch (error)` (line 157, 278, 449).
- Impact: Pre-existing inconsistency. Not introduced by this PR.
- Fix: Standardize all catch blocks to `catch (error: unknown)` for consistency with the explicit pattern already used elsewhere in the same file.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 2 |

**TypeScript Score**: 7/10

The TypeScript changes are minimal and correct. The single production line added (`fs.mkdir` for `knowledge/`) is clean and idiomatic. The main concern is that the 142-line test suite validates parsing logic inline rather than testing exported TypeScript functions, which creates a testing-coverage illusion and violates the project's architectural principles around testable design. The actual type safety of the changed TypeScript code is good -- no `any` types, proper async/await usage, correct `fs` API usage with `recursive: true`.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. Consider extracting knowledge file parsing into a typed TypeScript module (HIGH issue above). This can be done in a follow-up PR if preferred, as the current tests do validate the correct parsing contracts even if they do so against inline logic rather than production code.
