# Performance Review Report

**Branch**: feat-phase-3-decouple-decisions-agent -> main
**Date**: 2026-05-06

## Issues in Your Changes (BLOCKING)

### HIGH

**Sequential child process spawning in extractBatchMessages** - `src/cli/utils/background-runner.ts:249-272`
**Confidence**: 85%
- Problem: `extractBatchMessages` spawns a separate `node -e` child process for each session transcript sequentially via `for (const sid of sessionIds)`. While the deleted bash script had the same pattern, the TypeScript port preserves this sequential I/O bottleneck. Each `execFileAsync('node', ['-e', script])` incurs Node.js process startup overhead (~50-100ms) plus the actual transcript parsing. With 3+ sessions in a batch, this adds up.
- Impact: In the learning pipeline (batch_size=3), this means ~150-300ms of overhead from process spawning alone, plus the sequential reading of potentially large JSONL transcripts. The decisions pipeline uses batch_size=1, so the impact is lower there.
- Fix: Import and call `transcript-filter.cjs`'s `extractChannels` directly within the same Node process instead of spawning a child process for each session:
  ```typescript
  // Instead of spawning node -e for each session:
  const { extractChannels } = require(filterModule);
  const content = fs.readFileSync(transcriptPath, 'utf8');
  const result = extractChannels(content);
  ```
  This eliminates N child process spawns. If the `require` is a concern for ESM/CJS interop, a single child process that processes all sessions in one pass would still be better than N processes.

### MEDIUM

**Synchronous readFileSync in async function** - `src/cli/utils/background-runner.ts:240`
**Confidence**: 82%
- Problem: `extractBatchMessages` is an `async` function but uses `fs.readFileSync(batchIdsFile, ...)` to read the batch IDs file. While this file is small, the function also checks each transcript with `fs.existsSync(transcriptPath)` synchronously at line 251. In a background pipeline this blocks the event loop during file I/O, though the impact is limited since this is a background process with no concurrent request handling.
- Impact: LOW for background-only execution path. Would become higher if this utility were ever reused in a request-serving context.
- Fix: Use `await fs.promises.readFile(batchIdsFile, ...)` and `await fs.promises.access(transcriptPath)` for consistency with the async function signature. Not urgent for background-only code.

**Synchronous execFileSync in async --run-background paths** - `src/cli/commands/learn.ts:531,572-574,577-578` and `src/cli/commands/decisions.ts:185,215-216,220-224`
**Confidence**: 80%
- Problem: Both `--run-background` code paths use `execFileSync` for split migration, process-observations, and render-ready. These are potentially I/O-heavy operations (process-observations reads/writes JSONL, render-ready reads/writes markdown files and acquires locks). Using synchronous execution blocks the Node event loop for the full duration of each child process.
- Impact: Since these run in a detached background process (spawned via `nohup`), blocking the event loop has no user-facing latency impact. However, the `acquireBackgroundLock` at the top of the pipeline uses an async `_sleep(1_000)` for lock retry, which cannot interleave with synchronous calls.
- Fix: Replace `execFileSync` with the already-imported `execFileAsync` (which wraps `promisify(execFile)`):
  ```typescript
  await execFileAsync('node', [jsonHelperPath, 'process-observations', responseFile, logFile, '--types', 'workflow,procedural']);
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**HUD now reads two JSONL files instead of one on every status bar render** - `src/cli/hud/learning-counts.ts:120-121`
**Confidence**: 85%
- Problem: `getLearningCounts` previously read a single `learning-log.jsonl` file. After the split, it reads both `learning-log.jsonl` and `decisions-log.jsonl` sequentially via two `parseLogInto` calls. Each call does a synchronous `fs.readFileSync` followed by line-by-line JSON parsing. This function is called on every HUD render (status bar update).
- Impact: Doubles the file I/O and JSON parsing work on the HUD's hot path. For small log files (< 100 entries each), this is sub-millisecond. For logs near the 100-entry cap, it could add 1-2ms per render. Practically minor but worth noting as the HUD is the highest-frequency caller.
- Fix: No immediate fix needed -- the 100-entry cap keeps this bounded. If HUD lag is ever observed, consider caching counts with a file mtime check.

**HUD notifications reads two files instead of one** - `src/cli/hud/notifications.ts:55-56`
**Confidence**: 82%
- Problem: `getActiveNotification` now reads both `.decisions-notifications.json` and `.notifications.json` (legacy fallback), parsing each as JSON. These are small files, but this is synchronous I/O on the HUD render path.
- Impact: Minimal -- these are small JSON objects (not JSONL logs). The merge via spread operator `{...legacyMap, ...decisionsMap}` is O(n) where n is the number of notification keys (typically < 5).
- Fix: Accept as-is. The fallback path will naturally go away once the split migration runs.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**capEntries reads entire file then splits and filters** - `src/cli/utils/background-runner.ts:304-324`
**Confidence**: 80%
- Problem: `capEntries` reads the entire JSONL file into memory, splits on newlines, filters empty lines, then takes a slice. For the 100-entry cap, this is fine. But the `json_slurp_cap` function it replaces (in the deleted bash script) sorted by confidence before capping, which `capEntries` does not -- it keeps the last N lines. This is a behavioral change, not strictly a performance issue, but it means the cap no longer preserves the highest-confidence entries.
- Impact: Low risk -- the 100-entry cap is rarely hit, and the entries are already managed by temporal decay. The simpler "keep last N" approach is actually faster (no sort needed).

## Suggestions (Lower Confidence)

- **Split migration runs on every session start** - `scripts/hooks/session-start-memory:109` (Confidence: 70%) -- `split-migration.cjs` is invoked via `node` on every session start. While it has a sentinel check that exits early, this still incurs a Node process spawn (~50ms) on every session. Consider checking the sentinel file existence in bash before spawning node.

- **Duplicate split migration calls** - `src/cli/commands/learn.ts:530-531` and `src/cli/commands/decisions.ts:183-186` (Confidence: 65%) -- Both `--run-background` code paths run the split migration via `execFileSync` before their main work. Since session-start-memory already runs it, and these are spawned from session-end hooks (which run after session-start), the migration has already completed. The idempotency sentinel makes this cheap (early exit), but the node process spawn is still unnecessary overhead.

- **loadExistingObservations spawns node child process for filtering** - `src/cli/utils/background-runner.ts:366-386` (Confidence: 65%) -- `loadExistingObservations` shells out to `json-helper.cjs filter-observations` when it could parse the JSONL directly in-process (which it already does in the fallback path at `_loadObservationsFromLog`). The child process path adds ~50-100ms of overhead for no functional benefit over the fallback.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | - | 0 | 2 | 0 |
| Pre-existing | - | - | 1 | 0 |

**Performance Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is a major refactor that moves the learning/decisions pipeline from bash to TypeScript, which is a net positive for maintainability and testability. The sequential child process spawning in `extractBatchMessages` is the primary performance concern (HIGH), but its impact is bounded because it runs in a background process with capped batch sizes. The synchronous I/O patterns in the background runner are acceptable for the current background-only execution context but should be addressed if these utilities are ever reused in request-serving code. The HUD doubling of file reads is well-bounded by the 100-entry cap. Overall, the performance characteristics are reasonable for background infrastructure code.
