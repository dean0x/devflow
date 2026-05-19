# TypeScript Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Non-null assertions on `loadIndex` return value without guard** - `tests/feature-kb/feature-kb.test.ts:179,195,214,258,275,285`
**Confidence**: 82%
- Problem: Multiple new and existing test lines use `index!.features[...]` after calling `loadIndex()`, which returns `{ ... } | null`. While these are test assertions where the prior `updateIndex` call is expected to succeed, the non-null assertion operator (`!`) bypasses TypeScript's null safety. If `loadIndex` ever returns `null` due to a filesystem race or test bug, the error message would be an opaque "Cannot read properties of null" rather than a clear test failure.
- Fix: Replace `index!.features[...]` with an explicit assertion:
  ```typescript
  const index = loadIndex(tmp);
  expect(index).not.toBeNull();
  // Then use index directly — after the assertion, TypeScript knows it's non-null
  // Or: if (index === null) throw new Error('index unexpectedly null');
  ```
  Note: This is a MEDIUM finding because in test code the non-null assertions are widely accepted and the risk is limited to test debuggability. The pattern is also pre-existing in unchanged lines (e.g., lines 49-50) so only the newly added instances (lines 258) are attributable to this PR.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`FeatureKbModule` interface and test type cast diverge on `updateIndex`/`removeEntry` signatures** - `src/cli/commands/kb.ts:18-24`, `tests/feature-kb/feature-kb.test.ts:28-37`
**Confidence**: 80%
- Problem: The `FeatureKbModule` interface in `kb.ts` omits `updateIndex` and `loadIndex` entirely (acceptable since they are unused there), but also declares `removeEntry` without the `lockTimeoutMs?` optional parameter. The test file independently re-declares all types via a separate `as { ... }` cast with different signatures (e.g., `removeEntry` includes `lockTimeoutMs?`). Two independent type declarations for the same CJS module create a maintenance burden where one can drift from the other.
- Fix: Extract a shared type definition into a `.d.ts` file or a shared types module (e.g., `tests/feature-kb/types.ts` or `src/cli/types/feature-kb.ts`) that both `kb.ts` and the test file import. This ensures a single source of truth for the module's TypeScript surface.

### LOW

**`Record<string, unknown>` used as entry type in tests** - `tests/feature-kb/feature-kb.test.ts:32-33,180,195,214`
**Confidence**: 80%
- Problem: The `updateIndex` parameter and `loadIndex` return type use `Record<string, unknown>` for feature entries rather than a typed interface. This means every access to an entry property (e.g., `entry.name`, `entry.lastUpdated`) requires a type assertion like `as string` or `as Record<string, unknown>`. A proper typed interface (matching the CJS module's actual shape) would improve type safety and readability.
- Fix: Define a `FeatureKbEntry` interface:
  ```typescript
  interface FeatureKbEntry {
    name: string;
    description: string;
    directories: string[];
    referencedFiles: string[];
    category: string;
    lastUpdated: string;
    createdBy: string;
  }
  ```
  Then use it in the type cast: `features: Record<string, FeatureKbEntry>`.

## Suggestions (Lower Confidence)

- **`exitOnInvalidSlug` uses `process.exit` instead of throwing** - `src/cli/commands/kb.ts:38-45` (Confidence: 65%) -- The helper calls `process.exit(1)` directly, making it untestable in isolation and inconsistent with the project's Result-type preference. In CLI command handlers `process.exit` is pragmatic, but wrapping validation as a Result would be more architecturally consistent.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED

The TypeScript changes are well-typed and clean. No `any` types, no unsafe casts in production code, proper interface for the CJS module consumer in `kb.ts`, and correct use of `unknown` for the CJS require bridge. The `markStale` -> `findOverlapping` rename is reflected consistently in both the interface, test types, and test bodies. The new `exitOnInvalidSlug` helper is properly typed with explicit `void` return. The `KB_AGENT_TOOLS` constant reduces duplication. Test types correctly declare `lockTimeoutMs?` optional parameters. All 31 tests pass. PF-001 (Promise resolver naming) does not apply -- no Promise callbacks in the changed TypeScript files.
