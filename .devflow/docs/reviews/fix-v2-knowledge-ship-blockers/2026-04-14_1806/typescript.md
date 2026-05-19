# TypeScript Review Report

**Branch**: fix-v2-knowledge-ship-blockers -> main
**PR**: #182
**Date**: 2026-04-14_1806
**Reviewer**: typescript focus
**Pattern skill**: devflow:typescript (loaded)

## Scope

Diff command: `git diff main...HEAD`. Changes under review:

- `src/cli/utils/legacy-knowledge-purge.ts` — new file (+110 lines); two exports: `purgeLegacyKnowledgeEntries` and `purgeAllPreV2Knowledge`, both returning `Promise<PurgeLegacyKnowledgeResult>`
- `src/cli/utils/migrations.ts` — +28 lines; new `MIGRATION_PURGE_LEGACY_KNOWLEDGE_V3: Migration<'per-project'>` entry appended to `MIGRATIONS`
- `tests/legacy-knowledge-purge.test.ts` — +247 lines; new `describe('purgeAllPreV2Knowledge', …)` block
- `tests/learning/reconcile.test.ts` — +334 lines; new `describe('reconcile-manifest — self-heal (Fix 2)', …)` block
- `tests/resolve/knowledge-citation.test.ts` — new file (+348 lines)
- `tests/migrations.test.ts` — +57 lines; three new `it` cases

Known pitfalls cross-check (`.memory/knowledge/pitfalls.md`): PF-010 (`JSON.parse` without runtime validation) overlaps `migrations.ts` line 169 (`JSON.parse(raw) as MigrationsFile`), but that line is **pre-existing** (unchanged by this PR) — not a blocker. Noted in the Pre-existing section.

## Issues in Your Changes (BLOCKING)

_No CRITICAL or HIGH severity TypeScript issues found in changed lines._

The code conforms to the repo's strict TypeScript baseline:

- `tsconfig.json` has `strict: true`; no need for extra hardening at the file level
- Zero `any` occurrences in the changed `.ts` source or the changed test files (verified via grep — matches only appear inside `/** */` prose)
- All async functions have explicit `Promise<T>` return annotations
- All exported types are explicit (`PurgeLegacyKnowledgeResult`, `Migration<S>`, `GlobalMigrationContext`, `PerProjectMigrationContext`, `MigrationRunResult`)
- Runtime imports use `.js` extensions per ESM NodeNext convention (`./fs-atomic.js`, `./legacy-knowledge-purge.js`, `./shadow-overrides-migration.js`)
- Dynamic `import()` is used inside migration `run()` closures — correct, avoids eager-loading all migration dependencies at module init

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Regex type safety for capture-group dereference in non-null contexts** — `src/cli/utils/legacy-knowledge-purge.ts:142, 259`
**Confidence**: 82%
- Problem: Both call sites use `updatedContent.match(/^## (ADR|PF)-/gm) ?? []` to count entries, then rely on `.length`. This is fine because `length` is always defined on an array. However, the adjacent logic `content.replace(/<!-- TL;DR: \d+ (decisions|pitfalls)[^>]*-->/, …)` silently no-ops if the TL;DR comment is missing (e.g., a file that was hand-edited to remove the header). No explicit check; no log; no warning. The capture group `(decisions|pitfalls)` is also unused in the replacement body — the `label` is computed separately from `prefix` (line 144, 261), so the regex is only effectively asserting the TL;DR format rather than extracting from it.
- Fix: Either (a) drop the capture group (`/<!-- TL;DR: \d+ (?:decisions|pitfalls)[^>]*-->/`) — stylistic, removes the unused capture, or (b) guard against a missing TL;DR and emit a warning into the returned result so callers know the file was non-canonical. Option (a) is the minimal change:
```typescript
updatedContent = updatedContent.replace(
  /<!-- TL;DR: \d+ (?:decisions|pitfalls)[^>]*-->/,
  `<!-- TL;DR: ${count} ${label}. Key: -->`,
);
```

**`filePrefixPairs` tuple typed as `[string, string][]` loses prefix discriminant information** — `src/cli/utils/legacy-knowledge-purge.ts:113, 232`
**Confidence**: 80%
- Problem: `[string, string][]` widens what could be `Array<['ADR' | 'PF', string]>` or a discriminated tuple union. Downstream code does `prefix === 'ADR' ? 'decisions' : 'pitfalls'` (line 144, 261), which TS cannot exhaustively check — if someone appends `[path, 'XYZ']` the ternary silently maps to `'pitfalls'` without a compile error.
- Fix: Tighten the literal string type so the exhaustiveness check lives at compile time:
```typescript
type Prefix = 'ADR' | 'PF';
const filePrefixPairs: ReadonlyArray<readonly [string, Prefix]> = [
  [decisionsPath, 'ADR'],
  [pitfallsPath, 'PF'],
] as const;
```
Alternatively, factor the `prefix -> label` mapping into a `Record<Prefix, 'decisions' | 'pitfalls'>` so adding a new prefix surfaces in the type system.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-010: `JSON.parse(raw) as MigrationsFile` without runtime validation** — `src/cli/utils/migrations.ts:169`
**Confidence**: 95%
- Problem: This is the exact pattern called out in `.memory/knowledge/pitfalls.md` PF-010 — a declared-type lie over `JSON.parse`. The follow-up `if (!Array.isArray(parsed.applied)) return [];` mitigates the primary risk (non-array `applied`), but other fields (schema-version drift, unexpected extra fields) still flow through unvalidated.
- Status: Pre-existing, not modified by this PR. The PR adds a new migration entry, does not touch the parsing path.
- Recommendation: Address in a separate PR with a Zod schema for `MigrationsFile`. Do not block this PR.

**`as Migration<'global'>` / `as Migration<'per-project'>` casts in registry dispatch** — `src/cli/utils/migrations.ts:429, 439`
**Confidence**: 85%
- Problem: Inside `runMigrations`, after the runtime discriminant check `migration.scope === 'global'`, TS cannot narrow the generic parameter `S` of `Migration<S>` to its literal type. The code uses `migration as Migration<'global'>` (and the analogous per-project cast) and documents the narrowing limitation in a comment (D38). This is the canonical workaround, not a bug — but a typed helper would eliminate the cast:
```typescript
function isGlobalMigration(m: Migration): m is Migration<'global'> {
  return m.scope === 'global';
}
function isPerProjectMigration(m: Migration): m is Migration<'per-project'> {
  return m.scope === 'per-project';
}
```
- Status: Pre-existing (unchanged by this PR) — the comments at lines 426-428 explicitly explain the cast. Not a blocker.

## Suggestions (Lower Confidence)

- **Extract `SECTION_REGEX` pattern into a named builder** - `src/cli/utils/legacy-knowledge-purge.ts:131-134, 174` (Confidence: 65%) — Two regexes (`new RegExp(…)` in `purgeLegacyKnowledgeEntries` and the top-level `SECTION_REGEX` in `purgeAllPreV2Knowledge`) encode the same "section boundary" concept. Consider a shared factory/constant so the boundary grammar has one source of truth.
- **Use `as const satisfies …` on `MIGRATIONS` array** - `src/cli/utils/migrations.ts:137-141` (Confidence: 62%) — `readonly Migration[]` erases literal scope types. `as const satisfies ReadonlyArray<Migration>` would preserve the exact tuple shape for any consumer that wants compile-time knowledge of which migrations exist. Minor, stylistic.
- **`Array<{ anchorId; heading; body }>` inline object type in test helper** - `tests/learning/reconcile.test.ts:321, 329` (Confidence: 60%) — `buildDecisionsFile` and `buildPitfallsFile` take identical `Array<{…}>` literals. A named type `type Section = { anchorId: string; heading: string; body: string }` would DRY the signature and improve IDE hover. Tests only; no runtime impact.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking (your changes) | 0 | 0 | 0 | 0 |
| Should Fix (code you touched) | - | 0 | 2 | 0 |
| Pre-existing | - | - | 2 | 0 |

**TypeScript Score**: 9/10

**Recommendation**: **APPROVED**

Rationale:
- No `any`, no unchecked type assertions introduced in this PR, no missing return types, no missing `.js` runtime import extensions, and no violations of the project's explicit strict-mode baseline.
- The two MEDIUM Should-Fix items (tuple widening at `filePrefixPairs`, unused capture group in TL;DR regex) are small API-safety nits worth fixing while you're in the file but do not affect correctness.
- The MIGRATIONS registry correctly uses the discriminated union (`GlobalMigrationContext` | `PerProjectMigrationContext`) introduced in D38, and the new `Migration<'per-project'>` entry extends that pattern cleanly.
- Dynamic `await import(...)` inside migration `run()` is the right choice for a registry that must not eager-load every migration's dependency graph at module init.
- Tests use proper typed interfaces (`LogEntry`, `ManifestEntry`, `Manifest`) with zero `as any` or test-only type escapes.

The pre-existing PF-010 concern (unvalidated `JSON.parse`) is worth tracking but is outside this PR's blast radius.
