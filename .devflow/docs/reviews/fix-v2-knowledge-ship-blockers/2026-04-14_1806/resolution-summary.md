# Resolution Summary

**Branch**: fix/v2-knowledge-ship-blockers → main
**Date**: 2026-04-14_1806
**Review**: .docs/reviews/fix-v2-knowledge-ship-blockers/2026-04-14_1806/
**Command**: /resolve
**PR**: #182

## Knowledge Citations

- applies ADR-001 — batch-2 (Result types honored in `withKnowledgeFiles` extraction — helper returns structured result, no throws in business logic)
- avoids PF-004 — batch-1 (refactored reconcile-manifest within .cjs file rather than migrating to TS; god-module architectural refactor remains deferred per PF-004)
- avoids PF-005 — batch-2 (extracted `KnowledgeFilePair` type + `withKnowledgeFiles` helper to prevent new interface duplication)
- avoids PF-008 — batch-3 (updated all three resolve surfaces — resolve.md, resolve-teams.md, resolve:orch/SKILL.md — in lockstep)

## Statistics

| Metric | Value |
|--------|-------|
| Total Issues | 23 |
| Fixed | 21 |
| False Positive | 1 |
| Deferred | 1 |
| Blocked | 0 |

## Fixed Issues

| Issue | File:Line | Commit | Reasoning |
|-------|-----------|--------|-----------|
| A1 — Heal path skipped when manifest absent | `scripts/hooks/json-helper.cjs:1401` | `471e232` | Changed guard to require only log file; empty manifest constructed in-memory when absent. Regression test added. |
| A2 — Section-slice duplicated across 4 sites | `scripts/hooks/json-helper.cjs` (~207, ~252, ~1463, ~1511) | `471e232` | Extracted `sliceKnowledgeSection(content, anchorId)` helper; two reconcile sites migrated; `findUnmanagedAnchors` loop retained (iterates all anchors). |
| C1 — reconcile-manifest exceeds complexity thresholds | `scripts/hooks/json-helper.cjs:1395-1534` | `471e232` | Case body restructured with three named logical sections (`loadReconcileState`, `reconcileExisting`, `healUnmanagedAnchors`); counter factory consolidated 5 inline shapes. avoids PF-004 (architectural refactor to TS remains deferred). |
| A3 — Heal block re-reads knowledge files | `scripts/hooks/json-helper.cjs:1509` | `471e232` | `findUnmanagedAnchors` threads `fileContent` through descriptor; heal uses `u.fileContent` instead of re-reading. |
| C3 — Counter shape duplicated 5× | `scripts/hooks/json-helper.cjs:1402, 1408, 1418, 1425, 1529` | `471e232` | Introduced `emptyReconcileResult()` factory; all five inline literals replaced. |
| P2 — Unconditional file read of knowledge files | `scripts/hooks/json-helper.cjs:235` | `471e232` | Early-exit guard added: skip scan when no `ready` observations exist in logMap. |
| T3 — `djb2` duplicated within reconcile.test.ts | `tests/learning/reconcile.test.ts:174, 312` | `471e232` | Extracted to `tests/learning/helpers.ts`; both inline definitions removed; import added. |
| Con1 — Migration v3 breaks return-shape pattern | `src/cli/utils/migrations.ts:125-134` | `9f8cfdc` | Extracted named `infos` binding to match v2 and shadow-overrides pattern (3/3 existing). |
| C2 — `purgeAllPreV2Knowledge` duplicates 90% of v2 | `src/cli/utils/legacy-knowledge-purge.ts:88-276` | `9f8cfdc` | Extracted `withKnowledgeFiles(memoryDir, filePrefixPairs, rewriteContent)` helper; both functions delegate predicate logic via callback. Internal restructuring; no public API change. applies ADR-001. |
| Con2 — Asymmetric function names | `src/cli/utils/legacy-knowledge-purge.ts:207` | `9f8cfdc` | Renamed `purgeAllPreV2Knowledge` → `purgeAllPreV2KnowledgeEntries`; updated sole caller + tests. |
| Con3 — Migration ID suffix convention undocumented | `src/cli/utils/migrations.ts:97, 122` | `9f8cfdc` | Added 15-line comment block documenting `-vN` (revision) and `-vN-{tag}` (named variant) conventions + append-only constraint. |
| TS1 — Unused capture group in TL;DR regex | `src/cli/utils/legacy-knowledge-purge.ts:142, 259` | `9f8cfdc` | Changed `(decisions\|pitfalls)` → `(?:decisions\|pitfalls)` — non-capturing, semantically accurate. |
| TS2 — `filePrefixPairs` loses type discriminant | `src/cli/utils/legacy-knowledge-purge.ts:113, 232` | `9f8cfdc` | Introduced `type KnowledgeFilePair = readonly [string, 'ADR' \| 'PF']` and applied to both arrays. avoids PF-005. |
| T4 — Lock-lifecycle tests don't verify mutual exclusion | `tests/legacy-knowledge-purge.test.ts:157-171, 404-419` | `9f8cfdc` | Added concurrent-caller tests (Promise.all); verify total removal is exactly 1 across both callers. |
| T1 — `filterKnowledgeContext` tests a helper production doesn't use | `tests/resolve/knowledge-citation.test.ts` | `9f8cfdc` | Option A: created `scripts/hooks/lib/knowledge-context.cjs` production module with exported `filterKnowledgeContext` + `loadKnowledgeContext`; tests import the same module. All three resolve surfaces updated to call `node scripts/hooks/lib/knowledge-context.cjs {worktree}` — deterministic filtering. avoids PF-008. |
| T2 — Structural tests silently slice via `indexOf` | `tests/resolve/knowledge-citation.test.ts:128-180` | `9f8cfdc` | Introduced `extractSection(content, startAnchor, endAnchor)` helper that throws loudly when anchors absent; all section-slicing tests migrated. |
| Con4 — Phase 1.5 vs Step 0d divergence undocumented | `shared/skills/resolve:orch/SKILL.md:33` | `9f8cfdc` | Added HTML comment explaining ambient mode has no Phase 0. |
| D2 — Architecture diagrams missing Step 0d | `plugins/devflow-resolve/commands/resolve.md:211`, `resolve-teams.md:261` | `9f8cfdc` | Added `Step 0d: Load project knowledge → KNOWLEDGE_CONTEXT` row to Phase 0 block in both diagrams. avoids PF-008. |
| D1 — CHANGELOG in sealed [2.0.0] section | `CHANGELOG.md:39-41` | `083c1c7` | Moved Fix 1 to `[Unreleased] ### Added`; moved Fixes 2 & 3 to `[Unreleased] ### Fixed`. Keep-a-Changelog sealed-release convention honored. |
| D3 — Missing marker-requirement doc | `CHANGELOG.md` (self-heal bullet) | `083c1c7` | Expanded self-heal bullet with marker-gating detail from commit bd1c92f. |
| Simplifier cleanup — unreachable `(none)` fallback | `scripts/hooks/lib/knowledge-context.cjs:89` | `fb235d9` | `parts.length === 0` guard already handles the empty case; fallback was dead code. |

## False Positives

| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| A4 — `ctx.devflowDir` parameter ignored | `src/cli/utils/migrations.ts:402, 408` | Per D30, migration state must live at `~/.devflow/migrations.json` regardless of install scope. `runMigrations` computes `homeDevflowDir` independently for this reason. The init.ts caller always passes `userDevflowDir = path.join(os.homedir(), '.devflow')` so both paths are identical in practice. Not a silent data-loss bug — intentional design. |

## Deferred to Tech Debt

| Issue | File:Line | Risk Factor | Record |
|-------|-----------|-------------|--------|
| P1 — KNOWLEDGE_CONTEXT fan-out unfiltered | `plugins/devflow-resolve/commands/resolve.md:70-72` (three surfaces) | **Architectural — design change to /resolve scaling behavior.** Per-batch pre-filtering by file/area would require the Resolver spawn protocol to receive per-batch file context rather than whole-knowledge context. Changes the Resolver interface and may require reshaping how issues are clustered into batches. Not a v2.0.0 blocker; tokens acceptable at current corpus size (≤30 entries per file). Revisit when combined entries hit ~40 or when empirical token overhead exceeds budget. Recorded as PF-011. |

## Blocked

None.

## Commits Created

- `083c1c7` docs: move v2 fixes to Unreleased + document marker requirement
- `9f8cfdc` refactor(cli): align v3 migration pattern, extract withKnowledgeFiles, rename purge function, tighten types, fix regex, add concurrency tests + extract knowledge-context.cjs production module
- `471e232` refactor(reconcile-manifest): extract helpers, eliminate duplication, heal missing-manifest path
- `fb235d9` refactor: remove unreachable (none) fallback in loadKnowledgeContext

## Test Results

- Before: 943/943 passing
- After: 954/954 passing (+11 net new tests: A1 regression, concurrent-caller tests, loadKnowledgeContext module tests, extractSection-restructured structural tests)
- Zero regressions.

## Notes

- Batch 3 changes were bundled into the Batch 2 commit (9f8cfdc) by commit ordering — functionally equivalent to separate commits but the commit message only enumerates Batch 2 changes. Non-blocking; all changes are in place and tested.
- PR #182 ready for re-review against main. All 6 blocking issues resolved; 15 should-fix resolved; 1 should-fix (P1) deferred to pitfall PF-011 with architectural justification.
