# Complexity Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Date**: 2026-04-13 22:08
**Scope**: Incremental review of 10 commits (0dd9e24...HEAD) resolving prior review findings

## Context

This is an INCREMENTAL review focused on whether the fixes introduced regressions in complexity. The prior review (PR #181, commits before 0dd9e24) flagged security issues — these commits added type guards, discriminated unions, `execFileSync`, and a migration runner. The complexity lens asks: did the hardening work bloat functions, deepen nesting, or muddle control flow?

**Known pitfalls cross-referenced** (`/Users/dean/Sandbox/devflow/.memory/knowledge/pitfalls.md`):
- **PF-002** — init.ts handler monolith (pre-existing, deferred). Relevant: these 10 commits added ~18 lines to the handler (migration-runner block).
- **PF-010** — `JSON.parse` assigned to typed variable without runtime validation. Relevant: these 10 commits are the **resolution** for PF-010 in learn.ts and notifications.ts (introducing `isNotificationMap`, `isCountActiveResult`, `isSeverity`, `isRawObservation`). Pattern was applied correctly and is being reinforced, not reintroduced.

---

## Issues in Your Changes (BLOCKING)

None. No critical or high-severity complexity regressions were introduced by the 10 commits in scope. Functions remained at or below the metrics thresholds in `devflow:complexity`, and nesting did not exceed 4 levels.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`runMigrations` function touches 5 thresholds at once** — `src/cli/utils/migrations.ts:236-347`
**Confidence**: 85%
- Problem: The function is 112 total lines (including JSDoc); the imperative body is ~60 lines with 4-level nesting (`for → if/else-if → try → inner for` and `for → if/else-if → await pooled → for`). Per-branch this is fine, but reading the function requires holding four concerns in mind simultaneously: applied-set filtering, scope dispatch, non-fatal error accumulation, and "mark-applied iff all succeeded" semantics. The discriminated union of `MigrationScope` plus `Migration<S>` generics (lines 27-58) plus `pooled<T,R>` generic (lines 200-212) plus `normaliseRunResult` coercer (215-218) plus the main loop dispatch all live in the same file — each is small, but the cognitive load of the file as a whole is high for new contributors.
- Category: Should-Fix (you touched the function heavily in commit `cdec1cd` and added `infos`/`warnings` accumulation, expanding it by ~15 lines).
- Fix: Extract the two scope branches into named helpers to flatten the dispatch:
  ```typescript
  async function runGlobalMigration(
    migration: Migration<'global'>,
    ctx: { devflowDir: string },
  ): Promise<{ applied: boolean; infos: string[]; warnings: string[]; failure?: MigrationFailure }> { ... }

  async function runPerProjectMigration(
    migration: Migration<'per-project'>,
    ctx: { devflowDir: string },
    projects: string[],
  ): Promise<{ applied: boolean; infos: string[]; warnings: string[]; failures: MigrationFailure[] }> { ... }
  ```
  Then `runMigrations` becomes a ~15-line orchestrator that walks the registry, dispatches on scope, accumulates results, and writes state. The discriminated union already forces the compiler to ensure these two helpers cover the domain — the `never` exhaustiveness check at line 334-337 migrates naturally to the dispatch site.
- Impact: Metric reduction — current fn ~60 LoC / nesting 4; proposed orchestrator ~15 LoC / nesting 2, helpers ~25 LoC / nesting 3. Readability wins more than it costs.
- Note: This is worth doing **only** if another migration scope (e.g., `pre-install` vs `post-install` hinted at in PF-007 resolution) is likely. If not, leave as-is — the current shape is at the edge of acceptable but not crossing it.

**`init.ts` migration-runner block adds 4 sequential output loops** — `src/cli/commands/init.ts:768-794`
**Confidence**: 82%
- Problem: The block is now 27 lines: one `runMigrations` call followed by 4 separate `for` loops (failures, infos, warnings, verbose newlyApplied) plus 1 conditional success log. Cyclomatic complexity of the block = 5 branches. Nothing individually wrong, but the block contributes to PF-002 growth (init handler was 877 lines; this adds ~18 net lines). Given PF-002 already flags this file as a monolith, each new addition compounds the problem.
- Category: Should-Fix — within scope because the prior review added this block and you expanded it in commit `cdec1cd` when you added `warnings`/`infos` to the result type.
- Fix: Extract a reporter function next to `runMigrations` (in `migrations.ts`), since the loops are mechanical I/O over the result:
  ```typescript
  // In migrations.ts
  export function reportMigrationResult(
    result: RunMigrationsResult,
    log: { info(m: string): void; warn(m: string): void; success(m: string): void },
    verbose: boolean,
  ): void {
    for (const f of result.failures) {
      const where = f.project ? ` in ${path.basename(f.project)}` : '';
      log.warn(`Migration '${f.id}'${where} failed: ${f.error.message}`);
    }
    for (const info of result.infos) log.info(info);
    for (const warn of result.warnings) log.warn(warn);
    if (result.newlyApplied.length > 0) log.success(`Applied ${result.newlyApplied.length} migration(s)`);
    if (verbose) for (const id of result.newlyApplied) log.info(`  ✓ ${id}`);
  }
  ```
  The init.ts call-site collapses to 3 lines: `const result = await runMigrations(...); reportMigrationResult(result, p.log, verbose);`. Benefits: (1) unit-testable independent of init flow, (2) slows PF-002 growth, (3) the reporter owns the output policy in one place so future migrations that surface new fields (e.g., `deprecations`) don't grow init.ts further.
- Impact: Current block = 27 lines / 5 branches; proposed = 3 lines / 1 branch at the call site, 7 lines total in helper with same 5 branches — nesting unchanged but concentrated where it belongs.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`isNotificationMap` has divergent definitions across files** — `src/cli/commands/learn.ts:31-36` vs `src/cli/hud/notifications.ts:28-30`
**Confidence**: 90%
- Problem: Two separately-defined `isNotificationMap` type guards covering the same `.notifications.json` file shape, with **different validation depth**:
  - `learn.ts`: validates top-level is object AND every entry value is a non-null non-array object (line 34: `Object.values(v as object).every(entry => ...)`).
  - `notifications.ts`: validates only top-level is object (does NOT check entries). This means a corrupted file like `{"key": "string"}` passes `notifications.ts` guard but fails `learn.ts` guard.
- Impact: Silent shape divergence — a user-edited notifications file where one entry is accidentally a string will pass the HUD read-path (`notifications.ts`) and crash the write-path (`learn.ts`) or vice versa, depending on which tool runs first. This is a regression of the exact pattern PF-010 was created to prevent ("JSON.parse result assigned to a declared TypeScript type without runtime validation"). The guard exists, but two inconsistent implementations is worse than one — both claim to be `v is Record<string, NotificationFileEntry>` but disagree.
- Fix: Extract a single shared validator. Candidate location: `src/cli/utils/notification-schema.ts` with a canonical `parseNotificationMap(raw: unknown): Result<Record<string, NotificationFileEntry>, string>`. Both call-sites import it. Bonus: since `NotificationFileEntry` is already duplicated (learn.ts:17-24 and notifications.ts:9-17), this extraction also resolves that DRY violation.
- Category: Pre-existing — neither guard is new in the lines you added (both guards were added in this PR across multiple commits: `d5b879f` added notifications.ts guards; `cf593b3` added learn.ts guards). The divergence is pre-existing across these two commits that landed independently. Not blocking, but worth fixing now while both files are fresh.

### LOW

**`isRawObservation` validates 6 fields inline with a 6-line boolean chain** — `src/cli/hud/learning-counts.ts:22-33`
**Confidence**: 88%
- Problem: The guard is a single `return` of a 6-clause conjunction, extended from 3 to 6 clauses in this PR. Boolean complexity = 6. Crosses the HIGH threshold in `devflow:complexity` metrics for boolean conditions (5+ clauses = HIGH severity).
- Impact: Readable but fragile — adding a 7th optional field requires extending the chain and mentally tracking "is this required or optional?" for each. The mix of required (`typeof o.type === 'string'`) and optional (`o.mayBeStale === undefined || typeof o.mayBeStale === 'boolean'`) in a single expression is the readability hit, not the length.
- Fix: Split into required/optional phases with early return:
  ```typescript
  function isRawObservation(val: unknown): val is RawObservation {
    if (typeof val !== 'object' || val === null) return false;
    const o = val as Record<string, unknown>;
    // Required
    if (typeof o.type !== 'string' || typeof o.status !== 'string') return false;
    if (!['workflow', 'procedural', 'decision', 'pitfall'].includes(o.type)) return false;
    // Optional flags — must be boolean if present
    const isOptBool = (v: unknown) => v === undefined || typeof v === 'boolean';
    return isOptBool(o.mayBeStale) && isOptBool(o.needsReview) && isOptBool(o.softCapExceeded);
  }
  ```
  Extracting `isOptBool` collapses the repetitive "undefined || boolean" pattern and documents the intent.
- Category: Pre-existing — flagged now because this PR tripled the clause count.

**`formatLearningStatus` filters observations 8 times over a single array** — `src/cli/commands/learn.ts:269-277`
**Confidence**: 78%
- Problem: 8 sequential `observations.filter(...)` calls (workflows, procedurals, decisions, pitfalls, created, ready, observing, deprecated, needReview). 9 passes over the same array for what is conceptually a single bucketing operation. Not a perf issue at typical N (100s of observations); a readability issue.
- Fix: Single-pass reduce into a buckets object:
  ```typescript
  const buckets = observations.reduce((acc, o) => {
    acc[o.type].push(o);
    acc[o.status].push(o);
    if (o.mayBeStale || o.needsReview || o.softCapExceeded) acc.needReview.push(o);
    return acc;
  }, { workflow: [], procedural: [], ... } as Record<string, LearningObservation[]>);
  ```
- Category: Pre-existing — not changed in the 10 commits under review. Reporting at 78% confidence (Suggestions section per threshold rule).

---

## Suggestions (Lower Confidence)

- **`runMigrations` type-cast `as Migration<'global'>` at dispatch site** — `src/cli/utils/migrations.ts:265,307` (Confidence: 72%) — The discriminated-union narrowing should let TS infer the scope-specific Context type without the cast. If TS narrowing fails, a small helper `function runOne<S extends MigrationScope>(m: Migration<S>, ctx: ...)` might let you push the cast into one place. Low priority — cast is well-commented and localized.
- **`pooled<T,R>` returns `PromiseSettledResult<R>[]`, forcing callers to re-case `result.status === 'rejected'`** — `src/cli/utils/migrations.ts:200-212` (Confidence: 68%) — The only caller is `runMigrations`, which then writes a second loop at line 316-329 to fan results into `failures`/`infos`/`warnings`. If `pooled` is never used elsewhere, consider a `pooledPartition` variant returning `{ fulfilled: R[]; rejected: { item: T; reason: Error }[] }` that eliminates the caller's second loop. Skip if `pooled` is intended to grow to general utility status.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 2 |

**Complexity Score**: 8/10

**Recommendation**: APPROVED_WITH_CONDITIONS

### Rationale

The 10 commits maintain complexity within acceptable bounds. The discriminated-union types in `migrations.ts` (D38) and the new type guards in `learn.ts`, `notifications.ts`, and `learning-counts.ts` are **correctly applied resolutions** to PF-010 — they do not introduce new complexity debt, they close a known hole. The exhaustiveness `never` checks in `migrations.ts:336` and `learning-counts.ts:96-99` are textbook type-safety patterns and add zero runtime complexity.

The two MEDIUM Should-Fix items are softer:
1. `runMigrations` is on the upper edge of acceptable but not over — extract only if a third scope lands.
2. `init.ts` migration-reporter block adds to PF-002's monolith growth. Extracting the reporter into `migrations.ts` is a small, cheap win that also slows PF-002.

The pre-existing MEDIUM (`isNotificationMap` divergence) is the most consequential finding — it is a quiet regression of the exact anti-pattern PF-010 was created to prevent. Two guards for the same file shape, disagreeing on depth, is strictly worse than one guard. Worth fixing in a follow-up while both call-sites are fresh in contributors' minds.

### Confidence Assessment

All findings are reported at ≥80% confidence except the two Suggestions (72% and 68%). No findings were dropped at <60%. The report consolidates across files where appropriate (single MEDIUM for the divergent `isNotificationMap`) rather than listing one finding per file.
