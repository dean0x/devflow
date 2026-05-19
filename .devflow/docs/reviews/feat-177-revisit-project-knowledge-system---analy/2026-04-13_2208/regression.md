# Regression Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Base SHA**: 0dd9e24 (incremental review of 10 commits)
**Date**: 2026-04-13_2208
**Full test suite**: 848/848 passing
**CLI build**: clean

---

## Prior CRITICAL Fix Verification

All three prior-review CRITICAL regressions are **resolved**:

| # | Prior Issue | Verification |
|---|-------------|--------------|
| 1 | Install ordering: `runMigrations` MUST run BEFORE `installViaFileCopy` | **FIXED**. `src/cli/commands/init.ts:687-719` now invokes `runMigrations` before the installer branch at line ~731. Old post-installer block (previously at ~line 847-871) is deleted. Comment block explicitly notes "Runs BEFORE installViaFileCopy so V1→V2 shadow renames are complete before the installer looks for V2-named directories." |
| 2 | 4 `*-teams.md` files must have Record Pitfalls/Decisions phases removed | **FIXED**. All 4 teams variants (`code-review-teams.md`, `debug-teams.md`, `implement-teams.md`, `resolve-teams.md`) have their Record phases replaced with an explanatory HTML comment citing D8. Phase renumbering (e.g., resolve-teams Phase 9 → Phase 8) is consistent throughout the document including the architecture diagram and "Written by orchestrator in Phase 8" reference. |
| 3 | `knowledge-persistence` removed from 3 plugin.json + skimmer.md + skills-architecture.md | **FIXED**. Removed from `devflow-ambient`, `devflow-debug`, `devflow-plan` plugin.json `skills` arrays (confirmed via `src/cli/plugins.ts` + `.claude-plugin/plugin.json` diffs). `shared/agents/skimmer.md` frontmatter now reads `skills: devflow:worktree-support` (knowledge-persistence dropped). `docs/reference/skills-architecture.md` moved the entry out of Tier 1 into a new "Format-Spec Skills (Not Plugin-Distributed)" section. `tests/build.test.ts` adds a `FORMAT_SPEC_SKILLS` allowlist so the "no orphaned declarations" test does not fail on the now-distributed-less skill. |

All three fixes are well-executed.

---

## Issues in Your Changes (BLOCKING)

None.

---

## Issues in Code You Touched (Should Fix)

None.

---

## Pre-existing Issues (Not Blocking)

None identified in this incremental slice.

---

## Suggestions (Lower Confidence)

- **staleReason diagnostic string may pick a different file when multiple refs are missing** — `scripts/hooks/lib/staleness.cjs:37-42` (Confidence: 78%) — the old shell used `sort -u` (lexicographic order); the new JS uses `[...new Set()]` (insertion order). Functional flagging (`mayBeStale: true`) is preserved exactly; only the specific file reported in `staleReason` differs when an entry has ≥2 missing refs. Test at `tests/learning/staleness.test.ts:119-136` passes because the test's lexicographic order happens to match insertion order. Impact is diagnostic-only — no downstream consumer parses staleReason beyond prefix match (`code-ref-missing:`). Dropping below 80% because this is truly cosmetic.

- **Malformed log line now disables staleness pass for the entire file** — `scripts/hooks/lib/staleness.cjs:79-85` (Confidence: 72%) — old shell swallowed per-line parse failures (the `node -e` returned empty and the original line was preserved); new CJS aborts on any parse failure (logs to stderr, exits 0, writes nothing). In practice `learning-log.jsonl` is only written via `writeJsonlAtomic`, so corruption would require an external/crash-induced cause. Recovery happens on the next session via `--purge`. Low real-world impact but a minor behavior-coverage reduction.

---

## New Changes Stress-Test Results

### 1. `Migration.run` return type change (`Promise<void>` → `Promise<MigrationRunResult | void>`)
**No caller breakage.** `normaliseRunResult()` at `src/cli/utils/migrations.ts:215-218` coerces `void` to `{ infos: [], warnings: [] }` before spreading. Both built-in migrations (`MIGRATION_SHADOW_OVERRIDES` at line 85-93, `MIGRATION_PURGE_LEGACY_KNOWLEDGE` at line 99-107) return `MigrationRunResult`. Test registries (e.g., `tests/migrations.test.ts:202-213`) return `void` and pass. All 21 migration tests + 3 init-seam tests pass.

### 2. Discriminated union for `MigrationContext`
**Shadow-overrides migration still receives correct context.** `MIGRATION_SHADOW_OVERRIDES` declares `Migration<'global'>` → runner dispatches at `migrations.ts:256-279` with `{ scope: 'global', devflowDir: ctx.devflowDir }` (only devflowDir). `migrateShadowOverridesRegistry(ctx.devflowDir)` is called with just the devflowDir path (verified at `shadow-overrides-migration.ts` — no `claudeDir` reference). Per-project migration `purge-legacy-knowledge-v2` receives `{ scope, devflowDir, memoryDir, projectRoot }` at `migrations.ts:306-312` and consumes only `memoryDir` (verified — no `claudeDir` reference in `legacy-knowledge-purge.ts`). **Claim "claudeDir was never consumed" is accurate.**

### 3. `staleness.cjs` extracted from background-learning
**Logic preserved with one diagnostic-only delta (see Suggestions).** The regex `[A-Za-z0-9_/.-]+\.(ts|tsx|js|cjs|md|sh|py|go|java|rs)` matches the shell grep pattern character-for-character. File existence check (`fs.existsSync` vs shell `[ -f ]`) preserves absolute-vs-relative-path handling. Output marker format `code-ref-missing:${staleRef}` byte-identical. Background-learning integration at `scripts/hooks/background-learning:468-484` correctly locates the module via `$SCRIPT_DIR/lib/staleness.cjs` (consistent with existing `transcript-filter.cjs` at line 143). Non-fatal failure mode preserved (`|| true` in shell, `exit 0` on read/parse failure in CJS). Tests at `tests/learning/staleness.test.ts` import the real module — 6 tests pass.

### 4. Atomic-write hardening (`wx` + EEXIST recovery)
**Semantics preserved for legitimate retries.** `writeExclusive` in `scripts/hooks/json-helper.cjs:12-21`, `writeFileAtomic` in `src/cli/commands/learn.ts:395-405`, `src/cli/utils/legacy-knowledge-purge.ts`, and `src/cli/utils/migrations.ts:157-180` all follow the same shape: open with `flag: 'wx'` → on EEXIST, unlink + retry once → then rename. Legitimate retries (same process, second call after successful first) create a fresh `.tmp` because the first rename already moved it to the target. Crash recovery (stale `.tmp` from dead prior process) unlinks + writes. TOCTOU symlink attack blocked — verified by the new test `tests/legacy-knowledge-purge.test.ts` "does not follow a symlink placed at the .tmp path". Concurrent writers ARE a theoretical issue (process A creates tmp, process B EEXIST+unlink+write, process A renames nonexistent file → ENOENT) but all these sites are behind explicit locks (`acquireLock` in json-helper.cjs at lines 1184, 1358, 1598, and `.knowledge.lock` in legacy-knowledge-purge).

### 5. `process.argv[1]` rewrite for staleReason
**No such rewrite in this diff.** The task description may reference an earlier iteration. The two `process.argv[1]` usages in `background-learning` (lines 185, 198) are in unchanged transcript-decoding code paths unrelated to staleness. The `staleReason` field is produced in `staleness.cjs:49` via template literal `` `code-ref-missing:${staleRef}` `` — identical format to the original shell `'code-ref-missing:${stale_ref}'`. String output preserved.

---

## Known Pitfalls Overlap

Two pitfalls directly overlap with this PR (`PF-007` install ordering, `PF-008` teams-variant drift). Both are listed as pitfalls **originating from this branch** — the prior review that produced them has now been addressed. The fixes themselves (migrations before installer; teams variants updated in lockstep) align exactly with the Resolution guidance in both PF entries. No regressions reintroducing these patterns were observed.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |
| Suggestions | - | - | - | 2 |

**Regression Score**: 9/10
**Recommendation**: **APPROVED**

**Rationale**: All three prior CRITICAL regressions are cleanly resolved. No new regressions introduced by the refactoring of `MigrationContext` (discriminated union), `Migration.run` return type widening, staleness extraction, or atomic-write hardening. The two suggestions are diagnostic-string edge cases with no functional impact. Full test suite (848 tests across 41 files) passes; CLI build clean.
