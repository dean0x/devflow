# TypeScript Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Range**: 0dd9e24...HEAD (incremental — 10 commits)
**Date**: 2026-04-13 22:08
**Build**: `npm run build` — BUILD OK | warnings: 0 | errors: 0

---

## Summary of Focus Areas (as requested)

| Focus Area | Verdict |
|---|---|
| `Migration<S>` discriminated union narrowing | Casts are **unnecessary** — real finding below |
| `isNotificationMap` type guard duplication | Confirmed duplicate, **divergent strength** — real finding below |
| `isCountActiveResult` guard (learn.ts) | Correct; object-level shape checked, caller defensive |
| `isSeverity` guard (notifications.ts) | Correct; used for output-time narrowing, safe |
| `isRawObservation` extension (learning-counts.ts) | Correct; exhaustiveness check downstream is valid |
| `pooled<T, R>` generic helper | Well typed; no generic issues |
| Exhaustiveness via `never` (learning-counts.ts:97, migrations.ts:336) | Both correct shape |
| `MigrationRunResult` return-type change | All callers migrated; no stale `void` callers |
| Zero new `any`, `!`, or unsafe `as` in production code | **Not met** — 2 `as Migration<...>` casts are gratuitous |

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Gratuitous `as Migration<'global'>` and `as Migration<'per-project'>` casts defeat the discriminated-union narrowing they pretend to enforce** — `src/cli/utils/migrations.ts:265`, `src/cli/utils/migrations.ts:307`

**Confidence**: 92%

- **Problem**: Inside `runMigrations`, after narrowing on `migration.scope === 'global'` (line 256) and `migration.scope === 'per-project'` (line 280), the code calls `(migration as Migration<'global'>).run({...})` and `(migration as Migration<'per-project'>).run({...})`. These casts were likely added under the assumption that TypeScript cannot narrow the generic parameter `S` from the discriminant field `scope`. Empirically verified: **TypeScript DOES narrow correctly** with the current design. Removing both casts and running `npx tsc --noEmit` on the repo's `tsconfig.json` (target ES2022, strict: true) compiles cleanly with zero errors. The conditional-type resolver on `S extends 'global' ? GlobalMigrationContext : PerProjectMigrationContext` distributes over the union correctly after narrowing, making the casts no-ops that mask future type regressions.
- **Impact**: Teaches future maintainers that the discriminated union is insufficient (it isn't), and silently hides any future bug where a non-matching context is passed through the cast (the cast widens the check away). Violates the Iron Law on `as`-based type laundering in production code.
- **Fix**:
  ```ts
  // line 265
  const raw = await migration.run({
    scope: 'global',
    devflowDir: ctx.devflowDir,
  });
  // line 307
  return migration.run({
    scope: 'per-project',
    devflowDir: ctx.devflowDir,
    memoryDir,
    projectRoot,
  });
  ```
  Drop both `as Migration<...>` casts. Rely on the discriminant narrowing.

---

**`isNotificationMap` is duplicated in two files with divergent guard strength** — `src/cli/hud/notifications.ts:28-30`, `src/cli/commands/learn.ts:31-36`

**Confidence**: 98%

- **Problem**: Both files now define `function isNotificationMap(v: unknown): v is Record<string, NotificationEntry>` that guards the same on-disk JSON format (`.memory/.notifications.json`), but the implementations differ:
  - `learn.ts` (stronger): rejects non-object/null/array **AND** walks `Object.values(v).every(entry => typeof entry === 'object' && entry !== null && !Array.isArray(entry))`.
  - `notifications.ts` (weaker): rejects only non-object/null/array — accepts `{ foo: 42 }` (primitive values) as a valid map.
  The two predicate types also differ in name (`NotificationEntry` vs `NotificationFileEntry`) but are structurally identical (same 7 optional fields). A file shape that passes the HUD's guard but fails learn.ts's guard is therefore treated differently by two readers of the same file.
- **Impact**: Real behavioral divergence under adversarial/corrupt inputs. HUD will accept `{ "foo": 42 }` and attempt property access on the primitive (safe by luck — `.severity` returns undefined, `.active` returns undefined → skipped by the `if (!entry.active)` guard — but the design invariant that entries are objects is no longer enforced at the parse boundary). Future refactors that don't happen to do defensive property access will break. Also, fixing the guard later requires fixing both copies in lockstep, a known drift surface (PF-008 class of bug).
- **Fix**: Promote the stronger `isNotificationMap` plus the shared `NotificationEntry`/`NotificationFileEntry` interface into a new `src/cli/utils/notifications-shape.ts` (or similar) and import from both sites. The HUD file already has `isSeverity` imported from elsewhere as a pattern precedent.
  ```ts
  // src/cli/utils/notifications-shape.ts (new)
  export interface NotificationEntry {
    active?: boolean;
    threshold?: number;
    count?: number;
    ceiling?: number;
    dismissed_at_threshold?: number | null;
    severity?: string;
    created_at?: string;
  }

  export function isNotificationMap(v: unknown): v is Record<string, NotificationEntry> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    return Object.values(v as object).every(
      (entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry),
    );
  }
  ```

### MEDIUM

**`const parsed = JSON.parse(raw)` at `learn.ts:1127` relies on implicit `any` property access in its subsequent guard chain** — `src/cli/commands/learn.ts:1127-1139`

**Confidence**: 85%

- **Problem**: `JSON.parse` returns `any`. The D-SEC2 guard chain `parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.version === 1 && parsed.entries !== null && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)` reads like it narrows, but `parsed.version` and `parsed.entries` are `any` accesses because `parsed` was never assigned a type. The final line `usageData = parsed.entries as typeof usageData;` is a pure cast that bypasses per-value shape checking for the inner record. A hand-edited `.knowledge-usage.json` with `{ version: 1, entries: { "ADR-001": "not-an-object" } }` passes the guard, then `usageData["ADR-001"].cites` returns `undefined` → `aUsage.cites - bUsage.cites` becomes `NaN`, and the sort becomes non-deterministic (implementation-defined).
- **Impact**: Low-probability crash surface (defensive `?? 0` and `|| { cites: 0, ... }` at call sites at lines 1144–1145, 1180 recover in most cases), but the sort ordering silently degrades. Also inconsistent with the stronger `isCountActiveResult`/`isRawObservation`/`isNotificationMap` guards introduced in this PR — this site got weaker treatment.
- **Fix**: Declare `parsed: unknown` and write a proper type guard:
  ```ts
  const parsed: unknown = JSON.parse(raw);
  function isKnowledgeUsage(v: unknown): v is { version: 1; entries: Record<string, { cites: number; last_cited: string | null; created: string | null }> } {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    const o = v as Record<string, unknown>;
    if (o.version !== 1) return false;
    if (typeof o.entries !== 'object' || o.entries === null || Array.isArray(o.entries)) return false;
    return Object.values(o.entries as object).every((e) =>
      typeof e === 'object' && e !== null &&
      typeof (e as Record<string, unknown>).cites === 'number'
    );
  }
  if (isKnowledgeUsage(parsed)) usageData = parsed.entries;
  ```

---

## Issues in Code You Touched (Should Fix)

### LOW

**Unused `MigrationContext` type import** — `tests/migrations.test.ts:11`

**Confidence**: 95%

- **Problem**: `type MigrationContext` is imported but never referenced anywhere in the file. Type-only imports are erased at compile time so there is no runtime cost, but `strict: true` in tsconfig does not catch this because `noUnusedLocals`/`noUnusedParameters` are not enabled. Adding the test suite's `GlobalMigrationContext` usage (in `init-logic.test.ts`) but leaving the legacy `MigrationContext` import in `migrations.test.ts` looks like an incomplete refactor.
- **Impact**: Dead code; minor readability cost. No runtime effect.
- **Fix**: Remove the `type MigrationContext` line from the import list, or use it in at least one test assertion if it represents meaningful API coverage.

---

**`pooled<T, R>` lacks input validation on `limit`** — `src/cli/utils/migrations.ts:200-212`

**Confidence**: 70%

- **Problem**: `limit` is typed as `number` with no `limit > 0` check. With `limit === 0`, the loop `i += 0` runs forever. With `limit < 0`, `items.slice(i, i + limit)` returns an empty array and the loop increments negatively → infinite loop on the opposite direction if `i` is negative. The single callsite passes `16` (line 304) so the current codebase is safe, but any future callsite passing a dynamic value must validate first.
- **Impact**: Defense-in-depth; nothing can trigger it today.
- **Fix**: Add a guard at the top:
  ```ts
  async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error(`pooled: limit must be a positive integer, got ${limit}`);
    }
    // ...
  }
  ```

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-010 pattern still present in pre-existing code paths** — `src/cli/commands/learn.ts:122, 156, 189, 1309`

**Confidence**: 95%

- **Problem**: Lines like `const settings: Settings = JSON.parse(cleanedJson)` remain — the lie-to-the-compiler pattern from PF-010. These lines are NOT in the current diff (pre-existing), so informational only. The new guards (`isNotificationMap`, `isCountActiveResult`, `isRawObservation` extension, `isSeverity`) are moving the codebase in the right direction, and the pitfall is well documented.
- **Impact**: Crash/silent-misbehavior surface on corrupted/hand-edited settings.json. Pre-existing since before #177.
- **Fix**: Out of scope for this PR. File a follow-up issue to harden the shared `Settings` boundary via `isSettings` guard or Zod.

### LOW

**`noUncheckedIndexedAccess` not enabled in tsconfig.json** — `tsconfig.json`

**Confidence**: 90%

- **Problem**: Without `noUncheckedIndexedAccess`, expressions like `results[i]` at `migrations.ts:321` (inside the `for (const [i, result] of results.entries())`) and `lines[i].match(...)` at `learn.ts:468` type-check as non-undefined. The current usage is safe by structure (index is always in bounds), but the flag would catch a whole class of future bugs for free.
- **Impact**: None today; opportunity cost on strictness.
- **Fix**: Enable `"noUncheckedIndexedAccess": true` in a follow-up PR and handle the fallout.

---

## Suggestions (Lower Confidence)

- **`ObservationType` union should be defined once and imported** — `src/cli/hud/learning-counts.ts:12`, `src/cli/commands/learn.ts:53` (Confidence: 75%) — both files spell out `'workflow' | 'procedural' | 'decision' | 'pitfall'`. Extract into `src/cli/types/learning.ts` and import in both places to prevent drift when a fifth observation type is added.
- **`isRawObservation` guard uses runtime `.includes(o.type)` after declaring `val is RawObservation`** — `src/cli/hud/learning-counts.ts:22-33` (Confidence: 70%) — TypeScript cannot statically verify that `.includes` narrows to the union. The predicate "lies" to the type system but is correct at runtime. The downstream `const _exhaustive: never = parsed.type` at line 97 is safe because the switch covers all cases — but a stricter pattern is `(['workflow', 'procedural', 'decision', 'pitfall'] as const).includes(o.type as ObservationType)` with `typeof o.type === 'string'` precondition. Low priority; current shape works.
- **HUD's weaker `isNotificationMap` returns true for `Record<string, number>`** — `src/cli/hud/notifications.ts:28-30` (Confidence: 78%) — already covered as HIGH finding above, but the defensive property access (`entry.active`, `entry.severity ?? 'dim'`) makes the crash path unreachable in practice. Still a consistency bug.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | - | 0 | 0 | 2 |
| Pre-existing | - | - | 1 | 1 |

**TypeScript Score**: 7/10 — The incremental work adds valuable runtime guards (`isNotificationMap` in learn.ts, `isCountActiveResult`, `isSeverity`, `isRawObservation` extension) and a well-designed `MigrationRunResult` return-type change that cleanly flows through all call sites. The discriminated union for `MigrationContext` is a strong direction. However, the `Migration<S>` generic design caused the author to reach for `as` casts inside `runMigrations` where the compiler actually narrows correctly on its own — those casts are regressive. The `isNotificationMap` duplication across learn.ts and notifications.ts with divergent strength is a real consistency bug that will bite on the next iteration. The `parsed.entries as typeof usageData` cast at learn.ts:1138 is the only remaining instance of weak-guard-plus-type-cast in the new code.

**Recommendation**: CHANGES_REQUESTED

The two HIGH findings (unnecessary `as Migration<...>` casts, divergent duplicated `isNotificationMap`) are concrete, narrowly scoped, and mechanically fixable. Fix them, then the branch is ready to merge. The MEDIUM finding on `parsed.entries` can be addressed in the same follow-up commit.
