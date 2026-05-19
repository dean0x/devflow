# Testing Review Report

**Branch**: `feat/177-revisit-project-knowledge-system---analy` → `main`
**Date**: 2026-04-13_0010
**Diff command**: `git diff main...HEAD`
**Pattern skill**: `devflow:testing`
**Known pitfalls checked**: PF-004 ("background hook god scripts") — still relevant; see HIGH findings below.

The PR adds ~5,200 lines of tests across 16 new files (plus the shell-hook + hud test edits) and one new integration test. Coverage of the new migration surface, capacity/HUD/review command paths is dense and mostly behaviour-focused. Issues cluster in three areas: (1) isolation leaks against real `$HOME`, (2) an integration test that re-implements production algorithms rather than exercising them, and (3) gaps around atomic-rename crash semantics and init.ts integration.

---

## Issues in Your Changes (BLOCKING)

### HIGH

**E2E test writes under the user's real `~/.claude/projects/` and `~/.devflow/logs/` directories** — `tests/integration/learning/end-to-end.test.ts:64, 246`
**Confidence**: 95%
- Problem: `claudeProjectsDir` is computed as `path.join(os.homedir(), '.claude', 'projects', '-${slug}')` and real session JSONL files are planted there (line 95, 108, 121). If the test aborts (timeout, crash, Ctrl-C) before `afterEach` runs, the synthetic session files and the `-${slug}` directory leak into the developer's live `~/.claude/projects/`. Same problem for `~/.devflow/logs/${slug}/` which is read but never cleaned (line 246). The only protection is the best-effort `try { fs.rmSync(claudeProjectsDir, ...) } catch {}` in `afterEach`.
- Impact: Test isolation violation — a real user directory is mutated by the test suite. A timeout leaves garbage that Claude Code's own session discovery might try to parse.
- Fix: Override `HOME` in the test environment before `fs.mkdtempSync`, and reset in `afterEach`, mirroring the pattern used in `tests/migrations.test.ts:136-148`:
  ```ts
  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-home-'));
    // ... now os.homedir() returns the tmp home
  });
  afterEach(() => {
    fs.rmSync(process.env.HOME!, { recursive: true, force: true });
    process.env.HOME = originalHome;
  });
  ```
  This keeps the slug-encoded Claude projects dir contained.

**Staleness test re-implements the production algorithm instead of exercising it** — `tests/learning/staleness.test.ts:16-43`
**Confidence**: 92%
- Problem: The describe block "staleness detection (D16)" passes entries through a hand-rolled `checkStaleEntries()` function that duplicates the FILE_REF_RE regex and the "flag-on-first-missing" logic. The actual production implementation lives in `scripts/hooks/background-learning`'s `check_staleness` bash function. The tests therefore validate a TypeScript copy of the algorithm, not the shell implementation — any divergence between the two will pass the tests while production breaks. Only one test in the file (`process-observations stores observations correctly`) touches real code, and that test does not exercise staleness at all.
- Impact: False confidence. If the shell regex or iteration order changes, tests pass while behaviour regresses. This is exactly the "tests validate implementation, not behaviour" anti-pattern from the Iron Law.
- Fix: Either (a) shell out to `background-learning` with a minimal fixture (as the E2E test does) and assert `mayBeStale` flags on the resulting log, or (b) extract the algorithm to `json-helper.cjs` (as a `check-staleness` op) and test that helper directly. Option (b) aligns with PF-004's resolution ("Move JSON-heavy logic to TypeScript; keep shell as thin orchestrator").

**No test verifies `init.ts` actually invokes `runMigrations`** — `src/cli/commands/init.ts:893-912` (no test file)
**Confidence**: 90%
- Problem: `tests/migrations.test.ts` tests `runMigrations` in isolation against temp dirs, and `tests/init-logic.test.ts` covers init orchestration, but nothing connects the two. The new integration point at `init.ts:893-912` — which decides what `projectsForMigration` to pass (`discoveredProjects` vs `gitRoot` fallback vs `[]`), calls `runMigrations`, then renders warnings/successes — is entirely untested. The registry could silently stop being called in init and every unit test would still pass.
- Impact: Regression risk on the main integration seam. If a future refactor drops the `await runMigrations(...)` call or passes the wrong dir, nothing catches it.
- Fix: Add one test in `tests/init-logic.test.ts` that stubs `MIGRATIONS` with a probe migration, runs the init flow, and asserts the probe's `run` was invoked with the expected `MigrationContext`. Minimum coverage: "init with discovered projects → migration sees those paths" and "init with no discovered projects but gitRoot → migration sees `[gitRoot]`".

**`writeAppliedMigrations` atomic-write crash recovery is never tested** — `tests/migrations.test.ts:70-75`
**Confidence**: 88%
- Problem: The test `creates migrations.json atomically (no .tmp file left behind)` verifies the happy path (both files end up as expected), but does not verify the actual atomicity guarantee — that a crash between `fs.writeFile(tmp, ...)` (line 121 of migrations.ts) and `fs.rename(tmp, filePath)` (line 122) leaves either the old file intact or the new file intact, never a partial file. The test name promises a crash-safety property that the body does not exercise.
- Impact: The "atomic writes" claim in the PR description (per review focus areas) is asserted but not verified. If a future change swaps `rename` for a non-atomic approach, the test still passes.
- Fix: Add a test that pre-writes a leftover `.tmp` file and verifies the next `writeAppliedMigrations` overwrites it cleanly, and/or a test that mocks `fs.rename` to throw and verifies the original `migrations.json` (if any) is unchanged:
  ```ts
  it('leaves old migrations.json intact when rename fails', async () => {
    await writeAppliedMigrations(tmpDir, ['a']);
    const renameSpy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk full'));
    await expect(writeAppliedMigrations(tmpDir, ['a', 'b'])).rejects.toThrow();
    expect(await readAppliedMigrations(tmpDir)).toEqual(['a']); // unchanged
    renameSpy.mockRestore();
  });
  ```

**Per-project concurrency semantics of `legacy-knowledge-purge` are untested** — `tests/legacy-knowledge-purge.test.ts:157-171`
**Confidence**: 82%
- Problem: The test "acquires and releases `.knowledge.lock` during operation" only verifies the lock is released after the call returns — it does not verify the lock is held during the purge, nor that two concurrent callers serialize. Since `migrations.ts:198-203` runs per-project migrations in parallel via `Promise.allSettled`, and since `purgeLegacyKnowledgeEntries` is called from inside the `.run` closure, concurrent calls against the same project's `.memory` are possible (e.g., two `devflow init` invocations in overlapping shells). The mkdir-based lock is the only serialization, but no test proves it prevents corruption.
- Impact: Race-condition class of bug is outside the test net. A failing rename during concurrent invocation could leave `decisions.md` in a partial state.
- Fix: Add a test that spawns two `purgeLegacyKnowledgeEntries({ memoryDir })` promises concurrently against the same seeded `.memory`, and asserts `removed` totals match (not double-counted) and file content is coherent. Optionally, test that a pre-existing `.knowledge.lock` directory older than `staleMs` (60s) is reclaimed.

### MEDIUM

**Dead env var `DEVFLOW_E2E_TEST` signals intent that the code doesn't honor** — `tests/integration/learning/end-to-end.test.ts:206`
**Confidence**: 90%
- Problem: The test sets `DEVFLOW_E2E_TEST: '1'` with the comment "Prevent daily cap from blocking test", but `DEVFLOW_E2E_TEST` is grep-absent from the entire `scripts/` directory and the rest of the codebase. Daily-cap bypass is actually achieved by writing `${today}\t0` to `.learning-runs-today` two lines later. The dead env var is a fossil that misleads readers.
- Impact: Reader confusion; implies a test-mode hook that doesn't exist. If someone later adds a real `DEVFLOW_E2E_TEST` gate, this test will silently start hitting it.
- Fix: Remove `DEVFLOW_E2E_TEST: '1'` and the misleading comment. If a sanctioned test-mode flag is desired, wire it up in `background-learning` and reference it in both places.

**E2E test conflates "pipeline runs" with "behaviour verified"** — `tests/integration/learning/end-to-end.test.ts:275-277`
**Confidence**: 85%
- Problem: The main assertion for observation status is `expect(['observing', 'ready', 'created']).toContain(obs.status)` — i.e., "the status is one of three possible values", which is equivalent to "the status field is set to something". Given the shim injects canned observations with `quality_ok: true`, the test knows exactly what status each obs should have (workflow/procedural at 1 observation → 'observing'; decision/pitfall at 1 → 'observing' since required=2). The looseness hides regressions where, e.g., all four observations silently end up `observing` when two should advance.
- Impact: The E2E test appears to assert behaviour but actually accepts any non-empty status. A real promotion regression would not fail this test.
- Fix: Tighten per-observation assertions. For each canned obs, assert the exact expected status given the threshold rules, e.g.:
  ```ts
  const byId = Object.fromEntries(observations.map(o => [o.id, o]));
  expect(byId['obs_e2e_w1'].status).toBe('observing'); // workflow required=3, count=1
  expect(byId['obs_e2e_d1'].status).toBe('observing'); // decision required=2, count=1
  ```

**E2E `sleep 3` overhead is accepted rather than bypassed** — `tests/integration/learning/end-to-end.test.ts:14-17, 194-198`
**Confidence**: 85%
- Problem: Comments state "background-learning has a `sleep 3` in the main path" and "We accept this". The three E2E test cases each pay the 3s + shim + process spawn cost, plus the 60s/30s/20s timeouts are generous enough to mask slow runs but not to prevent them. The file also claims support for `DEVFLOW_SKIP_SLEEP=1` ("we patch by setting DEVFLOW_SKIP_SLEEP=1 in env") but neither the env var nor the bypass logic exists in the shell script — the comment is aspirational.
- Impact: Test suite time creeps. With 3 tests × ~3s sleep + overhead, the integration suite minimum wall time is ≥10s for this file alone. On slow CI or parallel runs, the 20s/30s timeouts may start intermittently failing.
- Fix: Add a supported bypass in `background-learning`:
  ```bash
  [ -n "${DEVFLOW_SKIP_SLEEP:-}" ] || sleep 3
  ```
  Then set `DEVFLOW_SKIP_SLEEP=1` in the test env. This is a trivial production change with no functional impact (the sleep exists solely to let the parent session flush).

**`MIGRATIONS` registry tests don't verify migration ordering guarantees** — `tests/migrations.test.ts:98-124`
**Confidence**: 82%
- Problem: The registry tests verify uniqueness, required fields, and presence of specific IDs, but nothing verifies that migrations run in declaration order, that a failing earlier migration doesn't prevent a later independent one, or that `newlyApplied` preserves order. These are implicit guarantees consumers of the result may depend on.
- Impact: If someone reorders the array or replaces the `for...of` loop with `Promise.all`, tests pass but semantics shift.
- Fix: Add one test with two probe migrations and assert `newlyApplied` equals `['first', 'second']` in order, and that `applied` persisted on disk also preserves order.

**HUD notifications tests skip multi-file dismissal interaction** — `tests/learning/hud-notifications.test.ts:79-97`
**Confidence**: 80%
- Problem: The test "picks worst severity when multiple files have notifications" verifies selection among multiple active notifications, but there is no test for: (a) one file dismissed at current threshold + another file active-lower-severity → should the active one show? (b) both files dismissed at same threshold → result null? (c) active-but-unknown-file (e.g., pitfalls entry but key mismatch) → graceful ignore?
- Impact: Interactions between the D27 severity-picker and the D28 dismissal state are partially tested. Edge cases around per-file dismissal state are unexercised.
- Fix: Add tests covering the full truth table of (decisions dismissed y/n) × (pitfalls dismissed y/n) × (both active).

**`migrations.test.ts` HOME override is not isolated against parallel workers** — `tests/migrations.test.ts:136-148`
**Confidence**: 80%
- Problem: `process.env.HOME` is globally mutated in `beforeEach` and restored in `afterEach`. Vitest's default is to run test files in separate worker processes (which is safe), but within a file, tests share the process; and if a future change sets `poolOptions.threads.singleThread: true` or similar, cross-worker contamination could surface. More immediately: if any assertion in `beforeEach` throws after the HOME mutation, `afterEach` still runs and resets HOME, but if a test crashes between `process.env.HOME = ...` and the `afterEach` (rare but possible), the developer's real HOME is lost for the rest of the process.
- Impact: Fragile global-state mutation pattern. The same test could be written by passing an explicit `homeDir` parameter to `runMigrations` (which already accepts `ctx.devflowDir`), eliminating the need to touch env.
- Fix: Consider extending `runMigrations` to accept an explicit override for the home-dir location (currently hardcoded via `os.homedir()` at line 155), and thread it through in tests. This removes the env-var mutation entirely. Acceptable alternative: use `vi.stubEnv('HOME', ...)` / `vi.unstubAllEnvs()` which vitest tracks explicitly and cleans up on failure.

### LOW

**`shadow-overrides-migration` test: `SHADOW_RENAMES` indirection hides actual expected renames** — `tests/shadow-overrides-migration.test.ts:46-64`
**Confidence**: 78%

Tests use literal old names like `'test-patterns'`, `'core-patterns'`, `'git-safety'` directly. These are bound to the current `SHADOW_RENAMES` contents in `plugins.ts`, but the test file doesn't import or document that coupling. If `SHADOW_RENAMES` entries are removed, these tests silently become no-ops (`!(await shadowExists(oldShadow))` → continue → assertion passes trivially). Add an assertion that `SHADOW_RENAMES` contains each old name used in the tests, or derive the test inputs from `SHADOW_RENAMES` directly.

**`legacy-knowledge-purge.test.ts` hardcodes ID list already hardcoded in source** — `tests/legacy-knowledge-purge.test.ts:36-113`
**Confidence**: 75%

The tests assert specific IDs (ADR-002, PF-001/003/005) that match `LEGACY_IDS` in `legacy-knowledge-purge.ts:29`. The test file does not import `LEGACY_IDS`, so widening or narrowing the list in source creates silent test/behaviour drift. Import the constant and drive test fixtures from it. (Acceptable alternative: keep hardcoded but add a test that `LEGACY_IDS` equals the expected snapshot.)

**E2E reconcile test `manifestPath` variable is unused on assertion path** — `tests/integration/learning/end-to-end.test.ts:285, 298`
**Confidence**: 70%

The `fakeManifest` object is written to `manifestPath` at line 298, but the subsequent log write at line 315 overwrites everything and the third assertion block (`reconcileManifest marks missing artifacts as deprecated in log`, line 359) re-seeds its own log/manifest pair. The first test's manifest write is dead code from the perspective of its assertions — the deprecation check at line 331 flows from the `artifact_path` field on the observation, not from the manifest entry. Either assert the manifest entry was removed after reconcile (paralleling the third test at line 406), or drop the dead write.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`review-command.test.ts` tests parsing logic via a bash-helper sub-invocation** — `tests/learning/review-command.test.ts:327-354`
**Confidence**: 82%

The describe "knowledge capacity review (--review capacity mode)" says "These tests verify the parsing and sorting logic, not the interactive flow (p.multiselect is hard to test non-interactively)." That honesty is good, but the chosen workaround — calling `runHelper('count-active ...')` which shells out to `json-helper.cjs` — means the test for "parseKnowledgeEntries extracts active entries" actually tests `countActiveHeadings`, not `parseKnowledgeEntries`. The name of the test mis-describes what it verifies. Rename the test or add a separate test that directly exercises the review-command's entry-parsing function (if one is exported). The parse-vs-count distinction is meaningful when headings with missing Status fields are present.

**`hud-counts.test.ts` asserts `getLearningCounts` returns `null` on bad input instead of raising** — `tests/learning/hud-counts.test.ts:92-103, 124-128`
**Confidence**: 80%

Tests assert `result` equals `null` for missing log, invalid JSONL, and empty file. This implicitly documents a fail-silently contract, which is fine for HUD rendering, but the tests don't distinguish "no data" (missing file → null) from "bad data" (invalid JSONL → null). A malformed log is a real production signal that should be logged somewhere (a HUD warning or stderr). Consider asserting the specific error branch taken (e.g., via a spy on `console.error` if that's the expected behavior), or at minimum add a comment explaining why all three failure modes collapse to `null` silently.

**`capacity-thresholds.test.ts` mixes unit tests and integration tests without separation** — `tests/learning/capacity-thresholds.test.ts:180-324`
**Confidence**: 78%

The "render-ready capacity integration" describe block runs the full `render-ready` op of `json-helper.cjs` via `runHelper`, writing real files to a tmp dir. This is legitimate integration coverage, but it's co-located with pure-function tests for `countActiveHeadings` and `crossedThresholds`. The former take microseconds; the latter invoke `node` subprocesses. On a failure, the error messages don't make clear which layer is broken. Split the file into `capacity-thresholds.unit.test.ts` and `capacity-thresholds.integration.test.ts`, or add describe-level comments noting the boundary.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-004 still stands: `background-learning` (596 lines) + `json-helper.cjs` (1690 lines) remain god scripts** — `scripts/hooks/background-learning`, `scripts/hooks/json-helper.cjs`
**Confidence**: 90%

The pitfalls file flags `background-learning` as 560 lines with 7+ responsibilities; this PR grows it to 596 lines and adds logic paths (D7 migration, staleness pass). `json-helper.cjs` now sits at 1690 lines. The testing surface has grown correspondingly: `tests/learning/` adds ~3100 lines of tests that mostly shell out to `json-helper.cjs`. This is the right short-term move (tests exist now), but the underlying architectural pitfall is worse, not better. Not a blocker for this PR — noted per the pitfall's existing deferral.

**`shell-hooks.test.ts` embeds bash source in JS template literals** — `tests/shell-hooks.test.ts:47-62` (and similar patterns)
**Confidence**: 85%

The "pure functions" tests for `background-learning` copy chunks of bash source into template-literal strings, then run them via `bash -c`. This is the same anti-pattern as `staleness.test.ts:16-43` — testing a copy of production code, not production code. Addressed by the PF-004 resolution (move logic to TypeScript). Flagging for awareness; the test file pre-dates this PR.

## Suggestions (Lower Confidence)

- **`merge-observation.test.ts` — pattern-update semantics not asserted** - `tests/learning/merge-observation.test.ts:152-180` (Confidence: 70%) — The test asserts details merging when patterns match exactly, but does not cover the "new pattern 20% longer wins" branch D14 mentions; the test comment even notes this explicitly as a deferred case.
- **`render-decision.test.ts` / `render-pitfall.test.ts` — no tests for concurrent render + reconcile races** - (Confidence: 65%) — Both render and reconcile acquire `.knowledge.lock`, but no test seeds a contended lock scenario. Given the shift to render-ready as the authoritative writer, serialization is a core correctness property.
- **E2E test depends on global `os.tmpdir()` staying small** - `tests/integration/learning/end-to-end.test.ts:58, 68` (Confidence: 62%) — Two `mkdtempSync` calls per test run; over many CI runs on the same machine `/tmp` fills with `e2e-learning-test-*` and `claude-shim-*` dirs if any test crashes pre-cleanup. Low-severity housekeeping.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 5 | 6 | 3 |
| Should Fix | - | 0 | 3 | - |
| Pre-existing | - | - | 2 | 0 |

**Testing Score**: 7/10

Coverage of the new migration registry, legacy-knowledge purge, and shadow-overrides rename is genuinely thorough — each module has 7-14 focused tests with clear temp-dir isolation and good behaviour-level assertions (idempotency, failure semantics, vacuous-truth edge case D37). Learning-system tests across capacity thresholds, HUD counts, and the review command are also strong, with well-designed fixtures and helper files.

The score is held back by three concrete issues: (1) the E2E test touches real user directories (`~/.claude/projects`, `~/.devflow/logs`) rather than a test-scoped HOME, (2) the staleness test re-implements the algorithm it claims to test, and (3) the integration seam where `init.ts` calls `runMigrations` is entirely untested. None of these are hard to fix, but all three matter for the PR's stated goals around migration correctness and test isolation.

**Recommendation**: CHANGES_REQUESTED

The five HIGH findings are all quickly actionable — the HOME override in E2E, the init-integration test, the atomic-rename crash test, the concurrency test for the purge, and the staleness test refactor (or extraction). After these land, the review would be APPROVED.

---

**Report location**: `.docs/reviews/feat-177-revisit-project-knowledge-system---analy/2026-04-13_0010/testing.md`
