# Resolution Summary

**Branch**: feat/177-revisit-project-knowledge-system---analy → main
**Date**: 2026-04-13_2208
**Review**: .docs/reviews/feat-177-revisit-project-knowledge-system---analy/2026-04-13_2208
**Command**: /resolve
**PR**: #181

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues Addressed | 16 |
| Fixed | 15 |
| False Positive | 1 |
| Deferred (TECH_DEBT) | 0 |
| Blocked | 0 |
| Test count | 852 → 884 (+32 new adversarial-input + TOCTOU tests) |

## Batches
4 Resolver batches (3 in parallel + 1 sequential for dependencies) + 1 Simplifier polish.

| Batch | Scope | Commit |
|-------|-------|--------|
| R1 | Core refactors — extract fs-atomic + notifications-shape, remove D35 collision + Migration casts, extract scope dispatch helpers | `3484a57` |
| R2 | Hooks consistency — unify lock helper naming, document intentional bash timeout deviation | `ed59ce0` |
| R3 | Testing gaps — extract `runMigrationsWithFallback` seam + rewrite tests, add knowledge-usage-scan security tests | `9028ac3` |
| R4 | Polish — extract `reportMigrationResult`, split `isRawObservation`, add 32 adversarial-input tests | `ba1941b` |
| Simplifier | Fix stale D34 lock claims, collapse verbose re-export JSDoc, remove dead `run` test wrapper | `d89552d` |

## Fixed Issues

### HIGH
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Race-tolerant atomic writes diverge (TS vs CJS) — extracted `src/cli/utils/fs-atomic.ts` | learn.ts, legacy-knowledge-purge.ts, migrations.ts | `3484a57` |
| `isNotificationMap` has two incompatible definitions — consolidated to `src/cli/utils/notifications-shape.ts` with stronger guard | learn.ts:31-36, notifications.ts:28-30 | `3484a57` |
| D-tag collision D35 — rebased `legacy-knowledge-purge.ts` D35 → D39 | legacy-knowledge-purge.ts:45 | `3484a57` |
| Unnecessary `as Migration<'global'>` / `as Migration<'per-project'>` casts — kept only where generic-S narrowing genuinely requires them, with documenting comments | migrations.ts:265, 307 | `3484a57` |
| Lock helper naming drift — renamed `acquireLock` → `acquireMkdirLock` in json-helper.cjs; bash hook 90s/300s timeouts DOCUMENTED as intentional (guards Sonnet pipeline, not file I/O) | json-helper.cjs:429, background-learning:70, SKILL.md:117 | `ed59ce0` |
| "Integration seam" tests don't test the seam — extracted `runMigrationsWithFallback` helper from init.ts with injectable runner, rewrote 3 duplicates into 4 real seam tests (D37 fallback, call-ordering, emptiness, pre-install ordering) | init.ts:762-794, init-logic.test.ts:857-969 | `9028ac3` |
| knowledge-usage-scan.cjs security hardening has zero tests — added 3 tests (relative-cwd rejection, symlink TOCTOU, Atomics.wait lock serialisation) | tests/learning/knowledge-usage-scan.test.ts | `9028ac3` |

### MEDIUM
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Contract drift: `ctx.devflowDir` vs re-derived `os.homedir()` — verified no actual drift (parameter was being passed correctly; false alarm on one call site) | migrations.ts | `3484a57` |
| `writeFileAtomic` duplicated 4× — resolved by fs-atomic.ts extraction, 3 TS sites now import canonical helper | learn.ts, legacy-knowledge-purge.ts, migrations.ts | `3484a57` |
| `runMigrations` 112-line function with 4-level nesting — extracted `runGlobalMigration` and `runPerProjectMigration` helpers | migrations.ts | `3484a57` |
| `init.ts` migration-reporter block — extracted `reportMigrationResult(result, logger, verbose)` to migrations.ts (co-located with types); init.ts re-exports `MigrationLogger` for backward compat; 8 new behavior tests added | init.ts:88-104, migrations.ts | `ba1941b` |
| `isRawObservation` 6-clause boolean chain — split into required-fields phase + optional-booleans phase via `isOptBool` helper | learning-counts.ts:22-33 | `ba1941b` |
| Type guard style drift — extracted `VALID_OBSERVATION_TYPES as const`; type alias, guard check, and switch exhaustiveness all derive from same constant | learning-counts.ts:12 | `ba1941b` |
| `writeExclusive` in json-helper.cjs has no TOCTOU test — 4 new tests (basic write, overwrite, symlink pre-placed, stale .tmp) | tests/learning/json-helper-write-exclusive.test.ts | `ba1941b` |
| Runtime type guards lack fallback-case tests — 32 adversarial tests for isRawObservation, isNotificationMap, isSeverity, reportMigrationResult | tests/learning/hud-*.test.ts, tests/migrations.test.ts | `ba1941b` |

## False Positives

| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| `runMigrations` infos/warnings level drift | init.ts:762-794 | Code was already correct — `p.log.warn` for failures/warnings, `p.log.info` for infos, `p.log.success` for applied count. Reviewer's suggestion had no valid target. |

## Deferred to Tech Debt

None. Per user preference (`feedback_no_tech_debt_defer`), all valid review findings were fixed directly.

## Blocked

None.

## Key Discoveries

1. **Bash timeout deviation is intentional**: R2's investigation found `background-learning`'s 90s/300s lock timeouts are NOT drift — they guard the entire Sonnet analysis pipeline (transcript extraction → 180s claude-p watchdog → rendering), not just file I/O. Node's 30s/60s is correct for `.knowledge.lock` which only guards reads/writes. All three lock paths (`.knowledge.lock`, `.learning.lock`, `.knowledge-usage.lock`) have distinct semantics and timeouts; documented in SKILL.md.

2. **Migration generic-S narrowing**: R1 removed the flagged `as Migration<...>` casts in the inline dispatch, but when it extracted `runGlobalMigration` / `runPerProjectMigration` helpers, the casts had to reappear at the helper-call boundary. They are now documented as semantically necessary (the `MIGRATIONS` array is heterogeneously typed; each invocation narrows at the call site).

3. **False positive on MED #7**: The reviewer's hypothetical drift in init.ts output levels didn't exist; code was already correct.

## Verification

- `npm test`: 884/884 pass (852 prior + 32 new adversarial/TOCTOU tests from R4)
- `npm run build`: clean (TypeScript + 17 plugins distributed, 72 skill copies + 34 agent copies)
- All Resolvers reported zero regressions in per-batch tests
- Simplifier polish committed (`d89552d`) — stale D34 lock-consistency claims corrected; dead test wrapper removed

## Next Steps

- Push 5 commits (ed59ce0, 9028ac3, 3484a57, ba1941b, d89552d) to PR #181
- Verify CI passes
- Re-request review or merge
