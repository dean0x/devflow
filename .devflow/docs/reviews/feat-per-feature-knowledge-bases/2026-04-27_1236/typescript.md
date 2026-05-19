# TypeScript Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Unsafe double type assertion bypasses type safety** - `src/cli/commands/kb.ts:539`
**Confidence**: 95%
- Problem: The expression `(kbEntry as Record<string, unknown>)?.referencedFiles as string[]` chains two unsafe casts. First it erases the typed `kbEntry` to `Record<string, unknown>`, then it asserts the result is `string[]` without any runtime validation. This is an `as`-based escape hatch that defeats TypeScript's type system (Iron Law violation: prefer type guards over type assertions).
- Impact: If `kbEntry.referencedFiles` is missing, undefined, or not an array of strings at runtime, no error will surface -- the code silently proceeds with a malformed value passed to `updateIndex`.
- Fix: The root cause is that the `FeatureKbModule.listKBs` return type omits `referencedFiles` from its interface (line 22) even though the CJS implementation (`listKBs` spreads the full `FeatureEntry` including `referencedFiles`). Fix the interface to include it, then the fallback becomes type-safe:

```typescript
// In FeatureKbModule interface (line 22), change listKBs return type:
listKBs: (worktreePath: string) => Array<{
  slug: string; name: string; category: string;
  directories: string[]; referencedFiles: string[];
  lastUpdated: string;
}>;

// Then line 539 simplifies to (no cast needed):
referencedFiles: sidecar.referencedFiles ?? kbEntry?.referencedFiles ?? [],
```

### MEDIUM

**Unvalidated JSON.parse of agent-written sidecar file** - `src/cli/commands/kb.ts:421` and `src/cli/commands/kb.ts:532`
**Confidence**: 82%
- Problem: Both `create` and `refresh` commands parse the sidecar JSON with `JSON.parse(await fs.readFile(...))` and assign the result to a typed local variable (`sidecar`) without runtime validation. The `catch` block silently swallows parse failures, but on a successful parse of malformed JSON (e.g., `referencedFiles` is a string instead of an array), the typed variable provides a false sense of safety. This violates the "validate at boundaries" principle from CLAUDE.md.
- Impact: The sidecar is written by an LLM agent (`claude -p`), making it an untrusted boundary. Malformed but parseable JSON (e.g., `{"referencedFiles": "src/foo.ts"}`) would propagate through `updateIndex` unchecked.
- Fix: Add a lightweight runtime guard after parse:

```typescript
// After JSON.parse succeeds:
const raw: unknown = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
const sidecar = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};
const referencedFiles = Array.isArray(sidecar.referencedFiles) ? sidecar.referencedFiles.filter((f): f is string => typeof f === 'string') : [];
const category = typeof sidecar.category === 'string' ? sidecar.category : undefined;
const description = typeof sidecar.description === 'string' ? sidecar.description : undefined;
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`FeatureKbModule` interface missing `referencedFiles` in `listKBs` return type** - `src/cli/commands/kb.ts:22`
**Confidence**: 92%
- Problem: The `listKBs` return type is `Array<{ slug: string; name: string; category: string; directories: string[]; lastUpdated: string }>` but the CJS implementation returns `{ slug, ...entry }` where `entry` is a `FeatureEntry` that includes `referencedFiles: string[]`, `description: string`, and `createdBy: string`. The interface is incomplete, which forced the unsafe cast on line 539.
- Impact: Anyone accessing `referencedFiles` on a `listKBs` result must cast, defeating type safety. The interface should match the actual runtime shape.
- Fix: Update the return type to include all fields from `FeatureEntry`:

```typescript
listKBs: (worktreePath: string) => Array<{
  slug: string; name: string; description: string;
  category: string; directories: string[];
  referencedFiles: string[]; lastUpdated: string;
  createdBy: string;
}>;
```

## Pre-existing Issues (Not Blocking)

No pre-existing TypeScript issues identified in reviewed files.

## Suggestions (Lower Confidence)

- **Test assertions on shell exit codes could use typed error interfaces** - `tests/feature-kb/feature-kb.test.ts:509-511`, `tests/shell-hooks.test.ts:1526-1528` (Confidence: 65%) -- The `expect.objectContaining({ status: 1 })` pattern works but relies on the shape of `child_process` error objects without a shared type. A small typed helper would improve readability across the 4+ occurrences in the test suite.

- **`name as string` assertion is safe but could be eliminated** - `src/cli/commands/kb.ts:388,426` (Confidence: 62%) -- The `name as string` cast is needed because `@clack/prompts` returns `string | symbol`. The `isCancel` guard on line 366 already narrows away the symbol case, but TypeScript's control flow analysis doesn't track this across `if/return` patterns into the subsequent closure. This is a known limitation and the cast is justified here, but extracting the narrowed value into a `const safeName: string = name as string` immediately after the guard would clarify intent.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The primary concern is the double type assertion on line 539, which bypasses TypeScript's type safety to work around an incomplete interface definition. The fix is straightforward: update the `FeatureKbModule.listKBs` return type to include `referencedFiles`, then the fallback chain becomes naturally type-safe. The sidecar JSON validation issue is secondary but worth addressing given that the data source is an LLM agent (untrusted boundary). Test improvements (duplicate removal, `toThrow` refactoring) are well-executed.
