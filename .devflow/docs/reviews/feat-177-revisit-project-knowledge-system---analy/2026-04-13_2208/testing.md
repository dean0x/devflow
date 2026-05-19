# Testing Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Date**: 2026-04-13 22:08
**Mode**: Incremental — 10 commits since 0dd9e24
**Test run**: `npm test` → 848/848 pass. `npm run test:integration` → 18/19 pass (1 pre-existing failure in ambient-activation.test.ts, unrelated to this review).

## Summary of Scope

The incremental commits resolve a prior review's testing findings. Areas touched:
1. `tests/integration/learning/end-to-end.test.ts` — HOME isolation via `vi.stubEnv`.
2. `tests/learning/staleness.test.ts` — refactored to import real `staleness.cjs` module.
3. `tests/init-logic.test.ts` — 115 new lines claiming to add "runMigrations integration seam" coverage.
4. `tests/build.test.ts` — `FORMAT_SPEC_SKILLS` exclusion for `knowledge-persistence`.
5. `tests/legacy-knowledge-purge.test.ts` — adds TOCTOU symlink test for `writeFileAtomic` `wx` flag.
6. `tests/plugins.test.ts` — removes stale assertion `ambient!.skills.toContain('knowledge-persistence')`.

Production code changed (without matching test coverage for new behavior):
- `scripts/hooks/knowledge-usage-scan.cjs` — path-traversal reject, `Atomics.wait` sleep, `wx`-flag atomic write.
- `scripts/hooks/json-helper.cjs` — shared `writeExclusive` helper (`wx` flag) for `writeJsonlAtomic` / `writeFileAtomic`.
- `src/cli/commands/learn.ts` — 3 new runtime type guards (`isNotificationMap`, `isCountActiveResult`, `writeFileAtomic` with `wx` flag), `execFileSync` replacing `execSync`.
- `src/cli/hud/notifications.ts` — `isSeverity` + `isNotificationMap` runtime guards.
- `src/cli/hud/learning-counts.ts` — stricter `isRawObservation` (rejects non-boolean attention flags).
- `src/cli/commands/init.ts` — `runMigrations` moved to run BEFORE `installViaFileCopy` (PF-007 ordering fix).

## Issues in Your Changes (BLOCKING)

### HIGH

**`runMigrations integration seam (D32/D35)` tests in init-logic.test.ts are misnamed and duplicate existing coverage** — `tests/init-logic.test.ts:857-969`
**Confidence**: 93%
- Problem: The added describe block claims to "test the integration between init's code path and runMigrations" and "covers the seam that migrations.test.ts cannot cover (module-level isolation only)". It does neither. The three tests (`invokes runMigrations with correct devflowDir and discovered projects list`, `passes discovered project roots to per-project migrations`, `does not re-run migrations that are already applied`) import `runMigrations` directly and call it directly. They never invoke `init.ts`, `initCommand.parseAsync(...)`, or any function from init.ts that threads into `runMigrations`. All three tests are functional duplicates of existing coverage in `tests/migrations.test.ts` (`skips already-applied migrations` at :161, `records newly applied migrations to state file` at :176, the probe-migration pattern at :202-234, `processes all discovered projects` at :236-290).
- Impact: Tests appear to cover the init↔migrations integration contract but provide zero incremental coverage. The actual integration seam (init.ts:769-794 calling `runMigrations` with `projectsForMigration = discoveredProjects.length > 0 ? discoveredProjects : (gitRoot ? [gitRoot] : [])`, running BEFORE `installViaFileCopy` per D7/PF-007) is completely untested. A future refactor that (a) reverts the D7 ordering fix, (b) drops `gitRoot` fallback from `projectsForMigration`, or (c) stops calling `runMigrations` at all would pass this test suite. This is exactly the regression the original review asked to guard against.
- Fix: Either (a) delete the three duplicate tests and rely on migrations.test.ts for `runMigrations` unit coverage, or (b) actually test the integration: factor out the migration-execution block in init.ts into an exported helper (e.g., `executeRunOnceMigrations(options: { discoveredProjects, gitRoot, verbose })`) and test THAT helper end-to-end including the `projectsForMigration` fallback logic and the ordering guarantee relative to installViaFileCopy. Example:
  ```ts
  it('runs migrations before installViaFileCopy (D7/PF-007)', async () => {
    const calls: string[] = [];
    // Spy on both with the call order recorded
    // Assert runMigrations finished before installViaFileCopy started
  });
  it('uses gitRoot as fallback when discoveredProjects is empty', async () => {
    // Arrange: empty history.jsonl, gitRoot present
    // Assert: probeMigration sees ctx.projectRoot === gitRoot
  });
  ```

**Security hardening to `knowledge-usage-scan.cjs` has no test coverage** — `tests/learning/knowledge-usage-scan.test.ts`
**Confidence**: 90%
- Problem: Commit ab20b47 adds three security fixes to `scripts/hooks/knowledge-usage-scan.cjs`:
  1. Reject relative `--cwd` input with `process.exit(2)` (CWE-23 path-traversal hardening per PF-009/PR-level security comments).
  2. Replace busy-spin `while (Date.now() < end) {}` with `Atomics.wait(...)` zero-CPU sleep (PF-009 fix).
  3. Write `.tmp` with `wx` flag + EEXIST retry to prevent symlink TOCTOU (matches writeExclusive in json-helper.cjs).
  None of these behaviors are tested. `tests/learning/knowledge-usage-scan.test.ts` passes only absolute `cwd` strings, never exercises the lock path, and doesn't plant a symlink at the `.tmp` location.
- Impact: A regression that drops the `path.isAbsolute` check (e.g., a "cleanup" that removes what looks like a dead check after `path.resolve`) would not fail any test — the scanner would silently accept `../../../etc/passwd` as `--cwd`. Same for the busy-spin and the `wx` flag: all three security properties can be reverted with zero test-level signal.
- Fix: Add three targeted tests mirroring the pattern in `tests/legacy-knowledge-purge.test.ts:218-244`:
  ```ts
  it('rejects relative cwd with exit code 2 (CWE-23)', () => {
    const result = spawnSync('node', [SCANNER, '--cwd', '../etc'], { ... });
    expect(result.status).toBe(2);
    expect(result.stderr.toString()).toContain('cwd must be absolute');
  });
  it('does not follow a symlink at .knowledge-usage.json.tmp (TOCTOU)', () => {
    // Plant symlink at .tmp path pointing to attacker file; assert attacker file not overwritten
  });
  // Busy-spin is harder to assert directly — can at least assert no >=100% CPU over 2s sample via measurement, or at least smoke-test that concurrent invocations serialise without pegging
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`writeExclusive` helper in `json-helper.cjs` has no dedicated test** — `scripts/hooks/json-helper.cjs` (new function)
**Confidence**: 85%
- Problem: Commit 95ecd00 adds `writeExclusive` as a shared `wx`-flag helper used by both `writeJsonlAtomic` and `writeFileAtomic` in `json-helper.cjs`. Analogous TOCTOU protection exists with a dedicated test in `tests/legacy-knowledge-purge.test.ts:218-244` for the `legacy-knowledge-purge.ts` variant. The `json-helper.cjs` variant — which runs in a HOT PATH (every learning observation ingest, every log write from background-learning) — has no equivalent symlink-TOCTOU test. All existing json-helper integration tests (reconcile, process-observations, render-workflow, etc.) happen to exercise `writeJsonlAtomic` only in the non-adversarial case.
- Impact: If a future refactor unifies the two atomic-write helpers or drops the `wx` flag from `writeExclusive` (e.g., someone "simplifying" the exception handling), the `legacy-knowledge-purge` test catches it for that file — but the much more frequently-used `json-helper.cjs` writers regress silently.
- Fix: Add one TOCTOU test per writer in `tests/learning/json-helper.test.ts` (or a new file) that plants a symlink at `${file}.tmp` and asserts the symlink target is not overwritten. A single test per call site (`writeJsonlAtomic` + `writeFileAtomic`) is sufficient — it's about locking down the property that `writeExclusive` is the only path to `.tmp`.

**New runtime type guards in `learn.ts` and `notifications.ts` have no direct test coverage** — `src/cli/commands/learn.ts:55-76`, `src/cli/hud/notifications.ts` (new `isSeverity`, `isNotificationMap`, `isCountActiveResult`)
**Confidence**: 82%
- Problem: Commits cf593b3 and d5b879f add four runtime type guards to address PF-010 (JSON.parse without runtime validation). None are directly tested for their fallback behavior:
  - `isSeverity(v)` in notifications.ts — no test passes a bogus severity string (e.g., `'critical'`, `42`, an object) to verify the code falls back to `'dim'`.
  - `isNotificationMap(v)` in notifications.ts — no test passes an array-shaped `.notifications.json` (`'[{...}]'`) to verify `getActiveNotification` returns `null`. The existing "handles malformed JSON gracefully" test at `tests/learning/hud-notifications.test.ts:99-102` only covers `JSON.parse` failure, not shape-rejection.
  - `isNotificationMap` / `isCountActiveResult` in learn.ts — no test covers the `--dismiss-capacity` branch at `learn.ts:1273-1278` where `isNotificationMap(raw)` returns false and the command prints "unexpected shape — treating as empty".
  - Stricter `isRawObservation` in learning-counts.ts — no test passes `mayBeStale: 'yes'` (a string, not boolean) to verify the entry is dropped. Existing tests at `tests/learning/hud-counts.test.ts:74-90` pass ONLY boolean `true`.
- Impact: The type guards are defense-in-depth against corrupted or hand-edited `.notifications.json` / `learning-log.jsonl`. Without tests, any "simplification" of the guards (e.g., removing the `Array.isArray` check, or loosening the exhaustive `Object.values(...).every(...)`) passes CI. The existing hud-counts tests cover only the happy path with well-formed attention flags.
- Fix: Add adversarial-shape tests for each guard:
  ```ts
  it('treats notifications.json containing an array as absent', () => {
    fs.writeFileSync(notifPath, JSON.stringify([{ key: 'foo' }]));
    expect(getActiveNotification(tmpDir)).toBeNull();
  });
  it('defaults severity to dim when notifications.json contains bogus severity', () => {
    fs.writeFileSync(notifPath, JSON.stringify({ 'knowledge-capacity-decisions': {
      active: true, threshold: 70, count: 72, ceiling: 100, severity: 'critical',
    }}));
    expect(getActiveNotification(tmpDir)!.severity).toBe('dim');
  });
  it('skips entries with non-boolean mayBeStale', () => {
    const line = JSON.stringify({
      id: 'x', type: 'workflow', status: 'created', mayBeStale: 'true',
    });
    fs.writeFileSync(logPath, line + '\n');
    expect(getLearningCounts(tmpDir)).toBeNull(); // entry rejected as malformed
  });
  ```

**Cross-file `process.env.HOME` mutation can race between `tests/migrations.test.ts` and `tests/init-logic.test.ts`** — `tests/init-logic.test.ts:870-871`, `tests/migrations.test.ts:136-137`
**Confidence**: 83%
- Problem: Both files mutate `process.env.HOME` in beforeEach/afterEach using direct assignment (not `vi.stubEnv`). Vitest's default configuration has no `fileParallelism: false`, so these two files can execute concurrently in different workers. If they share a worker (Vitest pools test files within workers), the shared `process.env.HOME` state is a race condition — one file's `afterEach` restoring the original HOME while another file's `beforeEach` is partway through setting its own.
- Impact: In practice, each Vitest worker gets its own Node.js process, so cross-file contamination across workers is not possible. But the same-worker scheduling is implementation-defined — this pattern is fragile by design. The new end-to-end.test.ts correctly uses `vi.stubEnv('HOME', fakeHome)` + `vi.unstubAllEnvs()` in afterEach, which is scoped to the test run and respects vitest's isolation. The new init-logic.test.ts "integration seam" block copies the fragile pattern from migrations.test.ts instead of the safer vi.stubEnv approach.
- Fix: Replace `process.env.HOME = ...` with `vi.stubEnv('HOME', ...)` in both `tests/init-logic.test.ts:870-879` and `tests/migrations.test.ts:136-146` (out of scope for this incremental review but pre-existing). The init-logic.test.ts changes in this PR should use the safer pattern.

### LOW

**End-to-end test pays ~9s of `sleep 3` penalty across 3 it() calls** — `tests/integration/learning/end-to-end.test.ts:207`
**Confidence**: 95%
- Problem: The test comment explicitly documents this: "We cannot easily patch the sleep ... we accept the ~3s overhead for integration tests". Each `it()` in this file triggers a 3-second sleep in `scripts/hooks/background-learning:489`. 3 tests × 3s = 9s minimum, before any real work. Combined with the 15-30s timeouts per test, the integration suite takes several minutes per run.
- Impact: The comment correctly identifies this as unavoidable given the current shell-script design. But the workaround (`DEVFLOW_SKIP_SLEEP` env var) was explicitly designed-around ("does not have a DEVFLOW_SKIP_SLEEP check"). This is a tooling gap, not a bug — but worth flagging that background-learning MUST eventually grow a test-mode skip flag. The existing 5-min integration timeout at `vitest.integration.config.ts:8` reflects this.
- Fix: Out of scope for this review, but the fix is mechanical: `[ "${DEVFLOW_SKIP_SLEEP:-}" = "1" ] || sleep 3` at `background-learning:489`. Gate-test the env var.

## Pre-existing Issues (Not Blocking)

### LOW

**Misnamed test in `tests/learning/review-command.test.ts:371` does not test `writeFileAtomic`** — `tests/learning/review-command.test.ts:371-387`
**Confidence**: 96%
- Problem: The test name is `writeFileAtomic persists notification dismissal`, but the test body calls `fs.writeFileSync` directly, never touches `writeFileAtomic` from learn.ts. This is a fake test — it verifies `fs.writeFileSync` and `JSON.parse` work, nothing about the atomic rename, `.tmp` sibling, or `wx` flag behavior that `writeFileAtomic` is supposed to provide.
- Impact: Fake confidence. The PR touched `writeFileAtomic` in learn.ts (added `wx` flag) without any test catching a regression.
- Fix: Either rename the test (e.g., `notification dismissal persists to disk`) or rewrite it to actually invoke the `writeFileAtomic` export — possibly by exporting it from learn.ts or reaching the real call site via the `--dismiss-capacity` command.

## Suggestions (Lower Confidence)

- **`FORMAT_SPEC_SKILLS` exclusion in `tests/build.test.ts:89` does not prevent accidental redistribution** - `tests/build.test.ts:89-98` (Confidence: 70%) — The exclusion is correct (knowledge-persistence is legitimately a format spec per D9) but doesn't verify that no plugin.json silently re-adds `knowledge-persistence` to its `skills` array in the future. Consider an inverse assertion: `expect(referencedSkills.has('knowledge-persistence')).toBe(false)`.
- **`tests/learning/staleness.test.ts` refactor is correct but the integration-test at :154-173 duplicates unit-test fixtures** - `tests/learning/staleness.test.ts:139-174` (Confidence: 65%) — The "process-observations integration" test creates its own tmpDir + responseFile + logFile, mirroring a structure that already exists in `tests/learning/render-*.test.ts`. The test is misnamed: it doesn't test staleness at all — it just checks that `process-observations` stores an observation with `status: 'observing'`. Consider moving it to `tests/learning/process-observations.test.ts` where it actually belongs, or renaming the describe block.
- **End-to-end test at `tests/integration/learning/end-to-end.test.ts:283-285` has a weak assertion** - `tests/integration/learning/end-to-end.test.ts:283-285` (Confidence: 65%) — The test asserts `expect(['observing', 'ready', 'created']).toContain(obs.status)`. This accepts 3 out of 4 possible statuses (`deprecated` is the only one excluded) — effectively a tautology for any observation the pipeline produces. The comment at line 279 correctly notes the ambiguity ("with required=2 for decision/pitfall, single observation → 'observing' or 'ready'"), but the right fix is to DECIDE what the expected status is per observation type rather than accept-any-of-three. As-is the test cannot distinguish "pipeline worked correctly" from "pipeline left everything in 'observing'".

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | 0 |
| Should Fix | 0 | 0 | 3 | 1 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Testing Score**: 6/10

**Recommendation**: CHANGES_REQUESTED

The resolved issues ARE partially fixed:
- End-to-end HOME isolation via `vi.stubEnv` is correctly implemented (afterEach calls `vi.unstubAllEnvs()`, subprocess inherits HOME via `...process.env`).
- Staleness test refactor genuinely imports `scripts/hooks/lib/staleness.cjs` and exercises the real algorithm — this is a meaningful improvement.
- `tests/legacy-knowledge-purge.test.ts:218-244` is a good TOCTOU symlink test.
- The `tests/plugins.test.ts` removal of the `knowledge-persistence` assertion was correct — stale coverage, not lost coverage.
- The `tests/build.test.ts` FORMAT_SPEC_SKILLS exclusion is reasonable given D9.

BUT the fix to the "runMigrations integration seam" is incorrectly implemented — the added tests don't exercise the integration seam they claim to cover. They are effectively a copy of migrations.test.ts with probe migrations. This is a meaningful testing gap because the actual init↔runMigrations path (including the D7 ordering fix and the discoveredProjects/gitRoot fallback) remains untested. Additionally, new security hardening to `knowledge-usage-scan.cjs` (three separate properties: relative-path rejection, Atomics.wait, wx-flag atomic write) has zero test coverage despite being security-critical.

The PR is mergeable provided either:
1. The "runMigrations integration seam" tests are deleted (they are harmless but misleading), AND the knowledge-usage-scan security fixes get at least one test per property; OR
2. The integration seam tests are rewritten to actually test init.ts's call path with the gitRoot fallback and migration-before-install ordering.

Option 1 is faster and lower-risk. Option 2 is the more correct long-term fix and would require extracting init.ts's inline migration block into an exported, testable helper.
