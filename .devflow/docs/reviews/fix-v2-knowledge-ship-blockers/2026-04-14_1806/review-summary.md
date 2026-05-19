# Code Review Summary

**Branch**: fix/v2-knowledge-ship-blockers → main
**PR**: #182
**Date**: 2026-04-14_1806
**Test Results**: 943/943 passing, zero regressions

---

## Merge Recommendation: CHANGES_REQUESTED

This PR ships three critical v2.0.0 ship-blocker fixes (knowledge integration into `/resolve`, reconciler self-healing, and v3 migration expansion) with solid execution and comprehensive test coverage. However, **6 blocking issues across architecture, consistency, documentation, and testing** must be resolved before merge:

1. **Architecture (HIGH)**: Heal path skipped when manifest absent — incomplete crash-recovery scenario coverage
2. **Architecture (HIGH)**: Duplicated section-slice algorithm across 4 call sites — adds technical debt rather than reducing it
3. **Complexity (HIGH)**: Reconcile-manifest case handler exceeds all three complexity thresholds simultaneously
4. **Consistency (HIGH)**: Migration v3 return-shape breaks established pattern (3/3 existing use named bindings; v3 inlines)
5. **Documentation (HIGH)**: CHANGELOG places post-release fixes under sealed `[2.0.0]` section (violates Keep-a-Changelog)
6. **Testing (HIGH)**: `filterKnowledgeContext` tests exercise a helper production code doesn't use — false confidence on filter behavior

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking** (your changes) | 0 | 6 | 0 | 0 | **6** |
| **Should Fix** (code you touched) | 0 | 1 | 10 | 0 | **11** |
| **Pre-existing** (legacy code) | 0 | 0 | 3 | 3 | **6** |

---

## Blocking Issues (Must Fix Before Merge)

### Architecture

#### A1. Heal path skipped when manifest file does not yet exist
**File**: `scripts/hooks/json-helper.cjs:1401`
**Confidence**: 88%

The reconcile-manifest handler short-circuits on missing manifest (line 1401), but the exact crash window Fix 2 targets (render-ready writes knowledge file, crashes before writing manifest) produces NO manifest on first-ever render. On the next session-start, reconcile returns immediately and heal never runs. The fix appears to work for second-and-later crashes (where manifest exists) but not the first-render case.

**Fix**: Allow heal to run even with missing manifest by constructing an empty in-memory manifest when the log file exists but manifest does not. Add test case: "manifest absent + knowledge file contains self-learning anchor + log has matching ready obs → heal triggers."

---

#### A2. Duplicated section-slice algorithm across four call sites
**Files**: `scripts/hooks/json-helper.cjs:207-210`, `:251-255`, `:1463-1465`, `:1511-1512` + `src/cli/utils/legacy-knowledge-purge.ts:174`
**Confidence**: 84%

The "extract section body from `## ANCHOR:` to next `##` heading or EOF" logic appears **five times** with subtly different encodings:
- `indexOf('\n## ', ...)` pattern (lines 207, 252)
- Regex `new RegExp('(##\\s+${entry.anchorId}[\\s\\S]*?)(?=\\n##\\s+(?:ADR|PF)-|\\s*$)')` (lines 1463, 1511)
- TS regex `/\n## (ADR|PF)-\d+:[^\n]*(?:\n(?!## )[^\n]*)*/g` (legacy-purge.ts:174)

Each variant has slightly different edge behavior. Adding a new counter or renaming sections requires fanout edits to all five sites.

**Fix**: Extract a single `sliceKnowledgeSection(content, anchorId) → string | null` helper in json-helper.cjs and share across the three reconcile sites. Keep `findUnmanagedAnchors` using its own loop (iterates all, not one specific). Comment on the TS variant linking to this canonical helper to reduce the five-site drift surface to two.

---

### Complexity

#### C1. Reconcile-manifest case handler exceeds all three HIGH complexity thresholds
**File**: `scripts/hooks/json-helper.cjs:1395-1534`
**Confidence**: 88%

The case body is now 140 lines with ~22 decision points and max nesting depth 4. Hits all three severity metrics simultaneously. The body interleaves four distinct phases (validation, deletion/edit detection, healing, commit) into a single scope — untestable in isolation, result-shape duplicated 5 places.

**Fix**: Extract three helper functions (`loadReconcileState`, `reconcileExisting`, `healUnmanagedAnchors`) so the case body becomes an orchestrator. Each helper becomes independently testable and reusable. Collapses the five-place result-shape duplication to a single factory.

---

### Consistency

#### Con1. Migration v3 return-shape breaks 3/3 existing pattern
**File**: `src/cli/utils/migrations.ts:100-107` vs `:125-134`
**Confidence**: 95%

All existing registry entries (v2 legacy purge, shadow-overrides) use a **named intermediate binding** before return:
```typescript
const infos = condition ? [...] : [];
return { infos, warnings: [] };
```

New v3 migration breaks pattern by inlining the ternary directly into the object literal. Per the codebase's Iron Law, consistency trumps local preference — the moment to pick one style before a fourth entry adds more precedent.

**Fix**: Align v3 with the established named-binding pattern (apply to v3 since it's new code).

---

### Documentation

#### D1. CHANGELOG categorization violates Keep-a-Changelog convention
**File**: `CHANGELOG.md:39-41`
**Confidence**: 92%

Three bullets added under `## [2.0.0] - 2026-04-05` (a sealed release section), but:
1. Keep-a-Changelog treats released versions as immutable — modifying them mutates history readers relied on
2. Fix 2 (reconciler self-heal) and Fix 3 (v3 purge) are **fixes to regressions in 2.0.0**, not new additions — wrong category
3. Project is already using `## [Unreleased]` section above (lines 8–28) — the three bullets should go there

**Fix**: Move all three bullets to `## [Unreleased]`: split Fix 1 into `### Added`, Fixes 2–3 into `### Fixed`, OR bump a new patch/minor version heading. Do not edit the sealed 2.0.0 entry.

---

### Testing

#### T1. `filterKnowledgeContext` tests exercise a helper production code doesn't use
**File**: `tests/resolve/knowledge-citation.test.ts:37-54` (filter helper), `:60-119` (8 tests)
**Confidence**: 95%

There is **NO production implementation** of `filterKnowledgeContext`. Verified by grep across all source dirs — zero hits. The entire filter lives in the test file. The function feeds to itself and asserts against its own output, proving only self-consistency. The real pipeline is: orchestrator markdown instruction → LLM interprets it → LLM emits filtered text. **None of those steps are exercised.**

**Fix (Option A — Best)**: Extract the filter into production code (`src/cli/utils/knowledge-filter.ts`), have the orchestrator call it, and import the SAME function into tests. Closes the gap and DRYs the instruction (currently stated three times: resolve.md, resolve-teams.md, resolve:orch/SKILL.md).

**Fix (Option B — Acceptable)**: Delete the filter helper and the 8 filter unit tests. They carry zero safety value as written. Keep only the structural markdown assertions (that the INSTRUCTION is present) — the most you can test without running an LLM.

---

## Should-Fix Issues (High Priority, Ideally This PR)

### Architecture

| Issue | File | Confidence | Description |
|-------|------|-----------|-------------|
| **A3** | `scripts/hooks/json-helper.cjs:245, 1509` | 90% | Heal block re-reads knowledge files already read in `findUnmanagedAnchors` — thread `fileContent` through to eliminate duplicate I/O |
| **A4** | `src/cli/utils/migrations.ts:402, 408` | 82% | `ctx.devflowDir` parameter ignored; state always written to `~/.devflow` — misleading API signature, complicates testing |

### Complexity

| Issue | File | Confidence | Description |
|-------|------|-----------|-------------|
| **C2** | `src/cli/utils/legacy-knowledge-purge.ts:207-276` | 92% | `purgeAllPreV2Knowledge` duplicates 90% of `purgeLegacyKnowledgeEntries` — extract shared helper accepting a predicate |
| **C3** | `scripts/hooks/json-helper.cjs:1402, 1408, 1418, 1425, 1529` | 91% | Counters object `{deletions, edits, unchanged, healed}` duplicated 5× in one case — introduce `emptyReconcileResult()` factory |

### Consistency

| Issue | File | Confidence | Description |
|-------|------|-----------|-------------|
| **Con2** | `src/cli/utils/legacy-knowledge-purge.ts:88, 207` | 85% | Asymmetric function names (`purgeLegacyKnowledgeEntries` vs `purgeAllPreV2Knowledge`) obscure sibling relationship — rename v3 to `purgeAllPreV2KnowledgeEntries` (Option A) or align both on "pre-v2" vocabulary (Option B) |
| **Con3** | `src/cli/utils/migrations.ts:97, 122` | 82% | Migration ID suffix convention (`-v2`, `-v3`, `-v2-names`) is undocumented — add comment block above MIGRATIONS array explaining the convention |
| **Con4** | `plugins/devflow-resolve/commands/resolve.md:72`, etc. | 78% | Phase 1.5 numbering break vs Step 0d is intentional but undocumented — add explicit comment clarifying the ambient-mode numbering divergence |

### Documentation

| Issue | File | Confidence | Description |
|-------|------|-----------|-------------|
| **D2** | `plugins/devflow-resolve/commands/resolve.md:204-236` | 85% | Architecture diagrams missing Step 0d (Load Project Knowledge) — add diagram row for new step in both base and teams files |
| **D3** | `docs/self-learning.md` (via `CHANGELOG.md`) | 85% | Missing scrutiny-commit documentation — expand Fix 2 CHANGELOG bullet to mention the `- **Source**: self-learning:` marker requirement that gates heal |

### Performance

| Issue | File | Confidence | Description |
|-------|------|-----------|-------------|
| **P1** | `plugins/devflow-resolve/commands/resolve.md:70-72` | 90% | KNOWLEDGE_CONTEXT fanned to every Resolver without relevance filtering — tokens scale with (batch count × knowledge size); pre-filter per-batch by file/area (design issue, not v2.0.0 blocker but track for future) |
| **P2** | `scripts/hooks/json-helper.cjs:245` | 80% | Unconditional file read of knowledge files even when no heal candidates exist — add `hasReady` guard to skip scan in common zero-heal case |

### Testing

| Issue | File | Confidence | Description |
|-------|------|-----------|-------------|
| **T2** | `tests/resolve/knowledge-citation.test.ts:128-180` | 85% | Structural markdown tests coupled to heading anchors via `indexOf` — use regex-based matching that fails loudly when anchors absent |
| **T3** | `tests/learning/reconcile.test.ts:174-180, 312-318` | 97% | `djb2` hash helper duplicated within file — extract to `tests/learning/helpers.ts` or expose `hash <content>` CLI op on json-helper.cjs to share implementation |
| **T4** | `tests/legacy-knowledge-purge.test.ts:157-171, 404-419` | 90% | Lock-lifecycle tests assert cleanup but not mutual exclusion — add concurrent-caller serialization test or extract lock helper with dedicated unit tests |

### TypeScript

| Issue | File | Confidence | Description |
|-------|------|-----------|-------------|
| **TS1** | `src/cli/utils/legacy-knowledge-purge.ts:142, 259` | 82% | Unused capture group in TL;DR regex — drop `(decisions\|pitfalls)` capture and use non-capturing `(?:decisions\|pitfalls)` |
| **TS2** | `src/cli/utils/legacy-knowledge-purge.ts:113, 232` | 80% | `filePrefixPairs: [string, string][]` loses type discriminant — tighten to `ReadonlyArray<readonly [string, Prefix]> as const` where `Prefix = 'ADR' \| 'PF'` |

---

## Pre-existing Issues (Informational Only)

### Security

| Issue | File | Confidence | Category |
|-------|------|-----------|----------|
| **PF-010 rerun** | `src/cli/utils/migrations.ts:169` | 95% | `JSON.parse` without runtime validation — already flagged in pitfalls.md; validate via Zod in separate PR |
| **Knowledge context injection** | `shared/agents/resolver.md:81` | 80% | `KNOWLEDGE_CONTEXT` passed verbatim to Resolver without size limit or delimiter fencing — document as hardening opportunity (not blocking) |

### Architecture

| Issue | File | Confidence | Category |
|-------|------|-----------|----------|
| **God module reinforced** | `scripts/hooks/json-helper.cjs` (now 1,791 lines) | 95% | File approaching god-module territory; this PR adds 87 lines instead of extracting — track as tech debt (PF-004) |
| **Migration registry lacks schema-version awareness** | `src/cli/utils/migrations.ts:137` | 72% | No explicit ordering or prerequisite guards; v3 must run after v2 (expressed implicitly by array order) — add `dependsOn` field when registry grows |

### Performance

| Issue | File | Confidence | Category |
|-------|------|-----------|----------|
| **Knowledge-usage.json lock bypass** | `scripts/hooks/json-helper.cjs:408-418` | 78% | `registerUsageEntry` does read-modify-write without `.knowledge-usage.lock` — different lock than `.learning.lock` creates lost-write race (low impact: `cites` counter is informational) |
| **Section-regex unbounded quantifiers** | `src/cli/utils/legacy-knowledge-purge.ts:174` | 95% | Patterns use `*` on arbitrary-length content but are defended by tempered-greedy bounds and lookahead — no ReDoS risk (benchmarked at <1 ms for 200-section input) |

---

## Per-Focus Summary

| Reviewer | Score | Issues | Recommendation |
|----------|-------|--------|-----------------|
| **Security** | 8/10 | 1 MEDIUM (should fix), 3 LOW (pre-existing) | APPROVED_WITH_CONDITIONS |
| **Architecture** | 7.5/10 | 2 HIGH + 3 MEDIUM (should fix), 2 MEDIUM (pre-existing) | CHANGES_REQUESTED |
| **Performance** | 8/10 | 1 HIGH (design, not blocker), 2 MEDIUM (should fix), 1 MEDIUM (pre-existing) | APPROVED_WITH_CONDITIONS |
| **Complexity** | 6/10 | 1 HIGH + 2 MEDIUM (should fix), 1 MEDIUM (pre-existing) | CHANGES_REQUESTED |
| **Consistency** | 8/10 | 1 HIGH + 2 MEDIUM (should fix) | CHANGES_REQUESTED |
| **Regression** | 9/10 | 1 MEDIUM (should fix), 1 LOW (pre-existing) | APPROVED |
| **Testing** | 6/10 | 2 HIGH + 3 MEDIUM (should fix), 2 MEDIUM (pre-existing) | CHANGES_REQUESTED |
| **TypeScript** | 9/10 | 2 MEDIUM (should fix), 2 MEDIUM (pre-existing) | APPROVED |
| **Documentation** | 7/10 | 2 HIGH + 1 MEDIUM (should fix) | CHANGES_REQUESTED |

---

## Fix Effort Estimate

**Blocking fixes** (must do): 3–4 hours
- A1: Manifest-absent heal path — 30 min
- A2: Extract `sliceKnowledgeSection` helper — 45 min
- C1: Extract reconcile case helpers — 60 min
- Con1: Align migration return-shape — 10 min
- D1: Move CHANGELOG entries — 10 min
- T1: Extract filter to production or delete tests — 1–2 hours

**Should-fix recommendations** (ideally this PR): 2–3 hours
- Duplication cleanup (C2, C3, T3): 1 hour
- Consistency annotations (Con2, Con3, Con4): 45 min
- TypeScript tightening (TS1, TS2): 30 min
- Testing robustness (T2, T4): 1 hour

**Deferred** (separate PR): Tech debt, god module (PF-004), performance design (P1)

---

## Final Notes

**Strengths**:
- Test-driven development (TDD) sequence is textbook-clean: test commits precede feat commits for all three fixes
- Reconcile self-heal regression guards are well-conceived (pre-v2 immunity test, crash-window coverage)
- v3 migration independence correctly verified (runs regardless of v2 success/failure)
- Cross-surface discipline on `/resolve` knowledge loading (byte-identical Step 0d prose across base/teams)
- Zero regressions: 943 tests passing, all 71 new tests in the 4 modified files pass

**Gaps**:
- Knowledge-citation.test.ts tests a filter that doesn't exist in production — fundamental test-strategy misalignment
- Crash-recovery scenario coverage incomplete (first-render manifest-absent case)
- Section-slice algorithm duplication suggests the heal block should migrate to a dedicated module rather than inline expansion
- CHANGELOG violations obscure the fix categorization and ship-blocker status

This is ship-blocker-quality work hampered by a few structural issues that, once addressed, will unblock a solid v2.0.0 release. The fixes themselves are sound; the presentation and architecture just need tightening.
