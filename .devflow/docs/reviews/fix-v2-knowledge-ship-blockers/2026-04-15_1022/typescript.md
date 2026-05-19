# TypeScript Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**PR**: #182
**Diff**: bd1c92f...HEAD
**Date**: 2026-04-15_1022

## Scope

TypeScript files in this diff:

- `src/cli/plugins.ts` (modified — registry entries only)
- `src/cli/utils/legacy-knowledge-purge.ts` (refactored — `withKnowledgeFiles` extraction)
- `src/cli/utils/migrations.ts` (modified — v3 migration calls renamed export)
- `tests/knowledge/apply-knowledge-skill.test.ts` (added)
- `tests/knowledge/command-adoption.test.ts` (added)
- `tests/knowledge/index-generator.test.ts` (added)
- `tests/knowledge/helpers.ts` (added)
- `tests/learning/helpers.ts` (modified — `djb2` exported)
- `tests/learning/reconcile.test.ts` (modified — uses shared `djb2`, added A1 heal regression test)
- `tests/legacy-knowledge-purge.test.ts` (modified — function rename + concurrency tests)
- `tests/resolve/knowledge-citation.test.ts` (modified — imports production module)
- `tests/skill-references.test.ts` (modified — reviewer.md citation parity loosened)

Pitfalls audit: `.memory/knowledge/pitfalls.md` was checked. No active PF entries flag patterns in this diff.

---

## Issues in Your Changes (BLOCKING)

_None._

The TypeScript surface of this PR is small and tight. The production-code refactor in `legacy-knowledge-purge.ts` extracts a shared `withKnowledgeFiles` helper with a properly typed `KnowledgeFilePair = readonly [string, 'ADR' | 'PF']` discriminated tuple, a typed callback signature, and `readonly` arrays at call sites. No `any`, no unsafe casts, no missing return types, no fabricated module-private exports. The migration registration mirrors the existing v2 pattern exactly.

---

## Issues in Code You Touched (Should Fix)

### LOW

**`any` in catch clause — `tests/knowledge/index-generator.test.ts:239`** — Confidence: 92%

```typescript
} catch (e: any) {
  threw = true
  stderr = e.stderr ?? ''
}
```

- Problem: This is the only `: any` introduced in the diff. The TypeScript skill's Iron Law is "Unknown over any." Project precedent in `tests/paths.test.ts:32` and `tests/integration/learning/end-to-end.test.ts:243,356` uses bare `catch (e)` (which TS infers as `unknown` under `useUnknownInCatchVariables: true`, default in `strict`).
- Impact: Inconsistent with the rest of the test suite; defeats narrowing. Low actual risk because the `e.stderr` access immediately follows and would surface as a runtime `undefined` if the shape were wrong, but it cuts against the project's stated standard.
- Fix: Either narrow with a type guard, or annotate the expected shape explicitly:

  ```typescript
  } catch (e) {
    threw = true
    const err = e as { stderr?: string };
    stderr = err.stderr ?? '';
  }
  ```

  Or, more idiomatic for this codebase (an `execSync` failure is always a `child_process.ExecException`-shaped object):

  ```typescript
  import type { SpawnSyncReturns } from 'child_process';
  // ...
  } catch (e) {
    threw = true
    stderr = (e as SpawnSyncReturns<Buffer>).stderr?.toString() ?? '';
  }
  ```

---

## Pre-existing Issues (Not Blocking)

_None worth surfacing in this focus area._ Pre-existing test files (e.g. `reconcile.test.ts`) already use untyped `JSON.parse(...)` followed by direct property access — this is a project-wide convention that the new code consistently mirrors. Flagging it in this PR would violate the Iron Law of the review methodology.

---

## Suggestions (Lower Confidence)

- **Consider typing `JSON.parse` results from `runHelper`** — `tests/learning/reconcile.test.ts:150,183,219,242,286,350,392,449,476,515,545,570,604,642` (Confidence: 62%) — `JSON.parse` returns `any`, so `result.healed`, `result.deletions`, etc. are unchecked. A small `interface ReconcileResult { healed: number; deletions: number; edits: number; unchanged: number; }` plus `JSON.parse(...) as ReconcileResult` would catch typos at compile time. This is pre-existing project style though, so the consistency cost may outweigh the safety gain.

- **Consider `as const` on `KnowledgeFilePair` literals** — `src/cli/utils/legacy-knowledge-purge.ts:189-192, 253-256` (Confidence: 65%) — Both call sites construct `readonly KnowledgeFilePair[]` from inline tuple literals. The explicit annotation `const filePrefixPairs: readonly KnowledgeFilePair[]` is correct and fine; `as const` would be slightly more idiomatic and let inference do the work, but the explicit form is arguably clearer at the call site. Cosmetic.

- **Consider hoisting the dynamic import in `migrations.ts`** — `src/cli/utils/migrations.ts:101, 126` (Confidence: 60%) — Both v2 and v3 call `await import('./legacy-knowledge-purge.js')` inside `run`. Per-call dynamic imports are intentional in some registries (lazy loading), but here both run together on the same code path. Pre-existing v2 pattern — flagging only because the v3 copy doubles down. Not blocking.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 1 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 9/10
**Recommendation**: APPROVED

### Notes

Strong points:

1. The `withKnowledgeFiles` higher-order helper has a properly-typed callback signature `(content: string, prefix: 'ADR' | 'PF') => { updated: string; removedCount: number }` — an exemplary use of TypeScript to make the policy/mechanism split explicit.
2. The `KnowledgeFilePair = readonly [string, 'ADR' | 'PF']` named tuple with a literal-union prefix is a textbook discriminated-tuple pattern. Both call sites use the `readonly` annotation.
3. The renamed export `purgeAllPreV2KnowledgeEntries` (from `purgeAllPreV2Knowledge`) is consistently updated across `migrations.ts` and all four test sites — no dangling references.
4. New `tests/knowledge/helpers.ts` exports `loadFile(relPath: string): string` and `extractSection(content: string, startAnchor: string, endAnchor: string | null): string` with explicit return types and proper `string | null` discriminated parameter — clean, minimal, properly typed.
5. Test file `tests/knowledge/index-generator.test.ts` uses an explicit cast on the `require()` return value with a typed shape:

   ```typescript
   const { filterKnowledgeContext, loadKnowledgeContext, loadKnowledgeIndex } = require(...)
     as {
       filterKnowledgeContext: (raw: string) => string
       loadKnowledgeContext: (worktree: string, opts?: { decisionsFile?: string; pitfallsFile?: string }) => string
       loadKnowledgeIndex: (worktree: string, opts?: { decisionsFile?: string; pitfallsFile?: string }) => string
     }
   ```

   This is the right way to bridge a `.cjs` module into a typed test — far better than `as any`.
6. `tests/learning/helpers.ts` `djb2(s: string): string` extraction eliminates the duplicated inline definition flagged in the prior code-review pass; export typing matches the production hash function it mirrors.
7. The `purge-legacy-knowledge-v3` migration uses the same `Migration<'per-project'>` typed shape as v2 — registry pattern is consistent.

The single LOW finding is the lone `: any` annotation in a catch clause; an easy fix and the rest of the diff is clean.

---

**Report written to**: `.docs/reviews/fix-v2-knowledge-ship-blockers/2026-04-15_1022/typescript.md`
