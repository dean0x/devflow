# TypeScript Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Date**: 2026-04-13_0010
**PR**: #181
**DIFF_COMMAND**: `git diff main...HEAD`

## Summary of Scope

The PR introduces ~2,800 lines of new TypeScript across five main areas:

- `src/cli/utils/migrations.ts` (new, 226 lines) — run-once migration registry with `MigrationScope` discriminated union
- `src/cli/utils/legacy-knowledge-purge.ts` (new, 171 lines) — knowledge-file purge helper
- `src/cli/utils/shadow-overrides-migration.ts` (new, 77 lines) — extracted from init.ts
- `src/cli/commands/init.ts` (modified) — migration registry integration
- `src/cli/commands/learn.ts` (modified, +573 lines) — `LearningObservation` v2 expansion, `--review`/`--dismiss-capacity`, capacity workflow
- `src/cli/hud/*.ts` — new `learning-counts`, `notifications`, and corresponding component files

Overall TypeScript hygiene is strong: `tsconfig` uses `strict: true`, no `any` types appear in the newly-added code, `JSON.parse` results are generally narrowed via `Record<string, unknown>` or type guards, and discriminated unions (e.g. `MigrationScope`) are used appropriately. The issues below are focused and targeted — mostly around validating unknown JSON at trust boundaries and tightening type guards.

**Known pitfalls check**: Scanned `.memory/knowledge/pitfalls.md` (PF-001..PF-006). No overlap with files changed in this PR that would reintroduce a known pattern — PF-005 (duplicated HookEntry/HookMatcher/Settings) is NOT reintroduced because the new code in `learn.ts` correctly imports from `'../utils/hooks.js'`. PF-002 (init.ts monolith) is made slightly worse by the new `runMigrations` block, but not reintroduced as a DRY violation.

---

## Issues in Your Changes (BLOCKING)

### CRITICAL
_None._

### HIGH

**Unsafe `JSON.parse` assignment bypasses declared type (`.notifications.json` reads)** — Confidence: 92%
- `src/cli/commands/learn.ts:1170-1172`
- `src/cli/commands/learn.ts:1221`
- Problem: `notifications = JSON.parse(...)` is assigned directly into a variable declared as `Record<string, NotificationFileEntry>` without any runtime validation of the parsed structure. `JSON.parse` returns `any`, so this silently coerces arbitrary JSON into the declared type. Consequences:
  - If the file is malformed but still parses (e.g., an array `[]`, a primitive `42`, or `null`), subsequent `Object.entries(notifications)` / indexing / writeback will throw or silently write back corrupt data.
  - At line 1243 the corrupted state round-trips back to disk via `writeFileAtomic(... JSON.stringify(notifications))`, worsening on-disk corruption rather than healing it.
  - Adjacent code in `src/cli/hud/notifications.ts:35-40` uses the same pattern (`data = JSON.parse(raw)` assigned into `Record<string, NotificationEntry>`), though the HUD path at least fails closed by returning `null`.
- Fix:
  ```typescript
  // Validate at the boundary
  function isNotificationMap(v: unknown): v is Record<string, NotificationFileEntry> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      && Object.values(v).every(e =>
        typeof e === 'object' && e !== null
        && (e.active === undefined || typeof e.active === 'boolean')
        // ... validate other fields
      );
  }

  let notifications: Record<string, NotificationFileEntry> = {};
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(notifPath, 'utf-8'));
    if (isNotificationMap(parsed)) notifications = parsed;
  } catch { /* no file */ }
  ```
  Mirror the existing pattern in `applyConfigLayer` (`learn.ts:275-288`), which already does per-field validation after `as Record<string, unknown>`.

**Type assertion `as NotificationData['severity']` bypasses runtime validation** — Confidence: 88%
- `src/cli/hud/notifications.ts:64`
- Problem: `severity: (worst.entry.severity as NotificationData['severity']) ?? 'dim'`. The declared source type is `string | undefined`, but it is coerced to the narrower `'dim' | 'warning' | 'error'` union with no runtime check. If a writer ever produces `"info"` or `"fatal"`, the value will propagate as invalid enum through `ctx.notifications.severity` into the switch at `src/cli/hud/components/notifications.ts:17-28`. The component's `default: dim(...)` mitigates the immediate crash risk, but downstream consumers that trust the type (e.g., telemetry, logging, future logic) can desynchronize from reality.
- Fix:
  ```typescript
  const SEVERITY_VALUES = ['dim', 'warning', 'error'] as const;
  type Severity = typeof SEVERITY_VALUES[number];
  function isSeverity(v: unknown): v is Severity {
    return typeof v === 'string' && (SEVERITY_VALUES as readonly string[]).includes(v);
  }
  // ...
  severity: isSeverity(worst.entry.severity) ? worst.entry.severity : 'dim',
  ```

**`JSON.parse` result used without validation — `usageData` and `result` in capacity review** — Confidence: 90%
- `src/cli/commands/learn.ts:1092-1093`
- `src/cli/commands/learn.ts:1184-1190`
- Problem: Two implicit-`any` paths from `JSON.parse`:
  - Line 1092: `const parsed = JSON.parse(raw); if (parsed && parsed.version === 1) usageData = parsed.entries || {};`. `parsed.entries` is treated as `Record<string, { cites; last_cited; created }>` without validation. Later code does `usageData[a.id].cites - usageData[b.id].cites` (line 1102) — if cites is a string or missing, the comparator will produce `NaN` and corrupt sorting.
  - Line 1184: `const result = JSON.parse(execSync(...).trim());` with `result.count ?? 0`. The parsed value is implicit `any`.
- Fix: Explicitly type as `unknown` and narrow:
  ```typescript
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === 'object' && parsed !== null
      && (parsed as { version?: unknown }).version === 1) {
    const entries = (parsed as { entries?: unknown }).entries;
    if (entries && typeof entries === 'object') {
      usageData = entries as typeof usageData; // still needs per-entry validation
    }
  }
  ```
  Or define an `isUsageFile` type guard that mirrors `isRawObservation` in `hud/learning-counts.ts`.

### MEDIUM

**`isRawObservation` doesn't validate optional attention flags** — Confidence: 82%
- `src/cli/hud/learning-counts.ts:22-30`
- Problem: The type guard claims `val is RawObservation`, but only validates `type` and `status`. The optional flags `mayBeStale`, `needsReview`, `softCapExceeded` are declared `boolean | undefined` in `RawObservation`, but the guard permits arbitrary values (e.g., strings, numbers, objects) through. They're then used truthy in the counter (line 73: `if (parsed.mayBeStale || parsed.needsReview || parsed.softCapExceeded)`). Truthy checks survive, but the type predicate is a lie — any consumer reading these as `boolean` later will be wrong. Additionally, the `type` property narrowing relies on the `includes` return value which is `boolean`, but TypeScript does narrow the subsequent `parsed.type` to a specific string when used in the switch at line 80, so that part is fine.
- Fix: Validate optional fields when present:
  ```typescript
  const opt = (k: string): boolean =>
    o[k] === undefined || typeof o[k] === 'boolean';
  return (
    typeof o.type === 'string' &&
    typeof o.status === 'string' &&
    ['workflow', 'procedural', 'decision', 'pitfall'].includes(o.type) &&
    opt('mayBeStale') && opt('needsReview') && opt('softCapExceeded')
  );
  ```

**Missing exhaustiveness check on `MigrationScope` dispatch** — Confidence: 84%
- `src/cli/utils/migrations.ts:164-222`
- Problem: `if (migration.scope === 'global') { ... } else { ... }` silently handles any new scope as "per-project" if the union is extended. `MigrationScope = 'global' | 'per-project'` is a 2-variant union today, but the registry is designed to grow. Adding `'per-user'` or `'per-repo'` later would silently route it to the per-project branch without a compile error.
- Fix: Switch with `never` assertion, following the pattern in the skill checklist:
  ```typescript
  switch (migration.scope) {
    case 'global':     /* ... */ break;
    case 'per-project': /* ... */ break;
    default: {
      const _exhaustive: never = migration.scope;
      throw new Error(`Unhandled scope: ${_exhaustive}`);
    }
  }
  ```

**`learningCounts` switch lacks exhaustive `never` default** — Confidence: 80%
- `src/cli/hud/learning-counts.ts:80-93`
- Problem: The switch on `parsed.type` covers all 4 types of `ObservationType` today, but there's no `default: const _: never = parsed.type`. If the union is extended (likely — `decision` and `pitfall` were just added in this PR), future additions will silently fail to increment a counter rather than produce a compile error.
- Fix: Add a `default:` arm with the `never` assertion (purely compile-time, no runtime overhead).

**`MIGRATIONS` registry is `readonly Migration[]` but entries are mutable** — Confidence: 83%
- `src/cli/utils/migrations.ts:50`
- Problem: `export const MIGRATIONS: readonly Migration[] = [...]`. The array reference is readonly (cannot reassign/push), but each `Migration` entry is deeply mutable — callers can set `MIGRATIONS[0].id = 'x'` or `MIGRATIONS[0].run = () => ...` without a compile error. Given this is an exported registry consumed by other modules, a reader could inadvertently mutate state.
- Fix: Strengthen with `DeepReadonly` or use a stricter type:
  ```typescript
  export const MIGRATIONS: ReadonlyArray<Readonly<Migration>> = [...];
  ```
  Better: use `Readonly<Migration>` on the element type and mark the member properties with `readonly` in the interface:
  ```typescript
  export interface Migration {
    readonly id: string;
    readonly description: string;
    readonly scope: MigrationScope;
    readonly run: (ctx: MigrationContext) => Promise<void>;
  }
  ```
  This matches the intent conveyed by the `as const` design of the registry.

### LOW

**`filePrefixPairs` type could be narrower to a literal union** — Confidence: 80%
- `src/cli/utils/legacy-knowledge-purge.ts:118-121`
- Problem: `const filePrefixPairs: [string, string][] = [[decisionsPath, 'ADR'], [pitfallsPath, 'PF']]`. The inner `string` for the prefix hides that only `'ADR' | 'PF'` are valid. Any future caller adding a third tuple can silently pass an unrelated string, breaking the filter logic below (`LEGACY_IDS.filter(id => id.startsWith(prefix))`).
- Fix:
  ```typescript
  const filePrefixPairs: ReadonlyArray<readonly [string, 'ADR' | 'PF']> = [
    [decisionsPath, 'ADR'],
    [pitfallsPath, 'PF'],
  ] as const;
  ```

---

## Issues in Code You Touched (Should Fix)

**`NotificationFileEntry` and `NotificationEntry` are structurally identical but declared twice** — Confidence: 88%
- `src/cli/commands/learn.ts:16-24` (NotificationFileEntry)
- `src/cli/hud/notifications.ts:9-17` (NotificationEntry)
- Problem: Both interfaces have the exact same fields (`active?`, `threshold?`, `count?`, `ceiling?`, `dismissed_at_threshold?`, `severity?`, `created_at?`). The JSDoc on line 11-14 of `learn.ts` explicitly acknowledges the mirror. This is the same shape of duplication flagged in **PF-005** (HookEntry/HookMatcher duplicated across command files), which was resolved by extracting to `src/cli/utils/hooks.ts`. The current PR reintroduces the pattern for a different file type.
- Fix: Extract a shared module, e.g. `src/cli/utils/notifications-types.ts`:
  ```typescript
  export interface NotificationEntry { /* fields */ }
  export type NotificationMap = Record<string, NotificationEntry>;
  ```
  Import from both read-path (`hud/notifications.ts`) and write-path (`commands/learn.ts`).

**`MigrationFailure.error: Error` loses the original type after `new Error(String(error))` wrapping** — Confidence: 82%
- `src/cli/utils/migrations.ts:178-184, 205-213`
- Problem: When a non-Error value is rejected, the fallback `new Error(String(error))` stringifies it, losing structured data (e.g., error codes, cause chains). This is less of a "type" problem and more of a type-loss concern. Consider using an Error `cause` chain (ES2022 supported):
  ```typescript
  error: error instanceof Error
    ? error
    : new Error(`Migration produced non-Error value: ${String(error)}`, { cause: error }),
  ```
  A stricter alternative is to type the field as `unknown` and let callers decide what to do.

---

## Pre-existing Issues (Not Blocking)

**`tsconfig.json` does not enable `noUncheckedIndexedAccess`** — Confidence: 90%
- `tsconfig.json:9` (only `strict: true` is set)
- Problem: The skill checklist (`~/.claude/skills/devflow:typescript/SKILL.md`, checklist item #8) explicitly recommends `noUncheckedIndexedAccess`. Without it, array/record indexing returns `T` instead of `T | undefined`, which hides possible undefined access. Example in this PR: `src/cli/commands/learn.ts:1154-1156` does `const entry = candidates.find(e => e.id === entryId); if (!entry) continue;` — the programmer had to remember the guard. With `noUncheckedIndexedAccess` on, similar patterns elsewhere (like `updatedObservations[idx]` at line 957 after `findIndex`) would be forced into explicit checks.
- Fix: Enable in a separate PR (opt-in flag with substantial fan-out across the existing codebase).

**Implicit `any` tuple destructuring could benefit from `const`-tuple typing in older code** — Confidence: 72%
- `src/cli/utils/shadow-overrides-migration.ts:34`
- `src/cli/plugins.ts:403`
- Problem: `Map<string, [string, string][]>` and `SHADOW_RENAMES: [string, string][]` use plain tuple types. A `readonly [string, string]` would prevent swapping tuple members. Pre-existing, informational only.

---

## Suggestions (Lower Confidence)

- **Consider a `Result<T, E>` return type for `runMigrations`** - `src/cli/utils/migrations.ts:148` (Confidence: 70%) — The function returns `{ newlyApplied, failures }` which is effectively a two-value record. Per engineering principle #1 (Result types) in CLAUDE.md, this could model success/failure more explicitly. Not a strict improvement — the current shape communicates both partial success and failures in one call, which a classic `Result<T, E>` would lose.

- **`allEntries` interface could be a named type** - `src/cli/commands/learn.ts:1020-1027` (Confidence: 68%) — The inline array type for knowledge entries is defined locally. Lifting to a named type (e.g. `interface KnowledgeEntrySummary { ... }`) would improve readability and reusability for future capacity-related code.

- **`export { migrateShadowOverridesRegistry as migrateShadowOverrides }` backward-compat re-export may be short-lived** - `src/cli/commands/init.ts:~16-21 of diff` (Confidence: 65%) — The re-export preserves the old symbol name for tests. Add a `// TODO: remove after tests migrated` comment or deprecation JSDoc so the re-export doesn't persist beyond the test migration.

---

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 4 | 1 |
| Should Fix | - | 2 | 0 | - |
| Pre-existing | - | - | 1 | 1 |

**TypeScript Score**: 8/10

Strong baseline TypeScript hygiene — strict mode, no `any`, good use of discriminated unions and type guards. The main weakness is inconsistent validation at `JSON.parse` boundaries: some paths use `Record<string, unknown>` + per-field checks (gold standard, see `applyConfigLayer`), while others assign `JSON.parse` directly into declared types. Fixing the HIGH findings raises the score to 9/10.

**Recommendation**: CHANGES_REQUESTED

The three HIGH-severity findings (`JSON.parse` boundary validation in `.notifications.json` read paths, unsafe severity assertion, `usageData`/`result` unchecked parses) are boundary-validation bugs that silently corrupt state on malformed input. They're narrow fixes — adding a type guard or using the existing `applyConfigLayer`-style per-field validation pattern — and should be addressed before merge to prevent on-disk state corruption when real-world notifications files drift from the expected shape.
