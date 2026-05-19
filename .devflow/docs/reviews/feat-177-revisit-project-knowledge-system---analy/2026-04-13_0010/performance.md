# Performance Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**PR**: #181
**Date**: 2026-04-13
**Diff command**: `git diff main...HEAD`
**Files reviewed (core)**: `src/cli/utils/migrations.ts`, `src/cli/utils/legacy-knowledge-purge.ts`, `src/cli/utils/shadow-overrides-migration.ts`, `src/cli/commands/init.ts`, `src/cli/hud/{index.ts,render.ts,learning-counts.ts,notifications.ts}`, `src/cli/hud/components/{learning-counts.ts,notifications.ts}`, `scripts/hooks/knowledge-usage-scan.cjs`, `scripts/hooks/lib/transcript-filter.cjs`, `tests/integration/learning/end-to-end.test.ts`, `tests/migrations.test.ts`

---

## Known-Pitfalls Overlap

Checked `.memory/knowledge/pitfalls.md`. Relevant entries: **PF-006 session-start jq loop latency** touches `scripts/hooks/session-start-memory`, which was lightly modified in this PR (added a `reconcile-manifest` hop on line 108 and a knowledge TL;DR read loop on lines 113-134). The added work is bounded (2 files read sequentially, one optional node subprocess gated by file existence) and does not reintroduce the PF-006 pattern. **No regression.** **PF-004** (background-learning god script) is pre-existing and untouched by this PR.

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Busy-wait CPU spin inside lock acquisition loop** — Confidence: 95%
- `scripts/hooks/knowledge-usage-scan.cjs:64-66`
- Problem: The mkdir-lock retry loop uses a synchronous CPU spin (`while (Date.now() < end) { /* spin */ }`) for the 10 ms backoff instead of yielding. This is called from the Stop hook on *every* end-of-turn via `stop-update-memory` → `knowledge-usage-scan.cjs`. Under contention with `json-helper.cjs render-ready` holding `.knowledge-usage.lock`, the process pegs one CPU core at 100 % for up to 2 s of deadline while also starving any other event-loop work in the same Node process. Even in the uncontended success path the outer loop only runs once, but any contention triggers the hot spin.
- Fix: Replace the spin with a synchronous sleep. Node ships `Atomics.wait` for exactly this case in sync contexts:
  ```js
  // Top of file
  const SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));
  function syncSleep(ms) { Atomics.wait(SLEEP_BUF, 0, 0, ms); }

  // Replace lines 64-66
  // Yield instead of burning CPU
  syncSleep(10);
  ```
  Or, since this script is already standalone and short-lived, switch the script to async (`fs.promises.mkdir` + `await new Promise(r => setTimeout(r, 10))`) — same lock semantics, no CPU burn.

---

## Issues in Code You Touched (Should Fix)

### HIGH

**Migration state file rewritten O(N²) times during cold init** — Confidence: 88%
- `src/cli/utils/migrations.ts:177, 220`
- Problem: `writeAppliedMigrations` is called after every successful migration. Inside the loop it computes `[...applied, ...newlyApplied]` and writes the full JSON via temp + rename. With N migrations, this produces N fsync-adjacent rename operations whose cumulative write volume is O(N²) bytes (each write includes all previously applied IDs). Today N=2, so the absolute cost is trivial (~3 ms on SSD). The concern is the growth curve as the registry fills up, which the file explicitly describes as append-only: "Append-only growth: adding a migration = adding an entry here, nothing else" (lines 34-37). At N=30-50 migrations this becomes ~500-2500 writes during a first-run `devflow init` where none are applied yet.
- Fix: Write state once at the end of the batch when nothing failed, or write once per *successful migration tier* (all globals, then all per-project). The stated rationale for incremental persistence — "so one failure doesn't lose progress on previously completed migrations" — is already satisfied by a single write at the end of the loop (each migration either succeeded or was skipped; failures are non-applied by design at lines 178-183 and 211-213). Alternative: batch writes every K=5 migrations.
  ```typescript
  // After the whole loop, not inside each branch
  if (newlyApplied.length > 0) {
    await writeAppliedMigrations(homeDevflowDir, [...applied, ...newlyApplied]);
  }
  ```

**Per-project parallel sweep is unbounded — potential fd / EMFILE risk on large user setups** — Confidence: 82%
- `src/cli/utils/migrations.ts:198-203`
- Problem: `Promise.allSettled(discoveredProjects.map(async (projectRoot) => { ... migration.run(...) }))` has no concurrency limit. Each `purgeLegacyKnowledgeEntries` call opens at least: one `fs.access` (knowledge dir), one `mkdir` lock, two `fs.readFile` (decisions.md, pitfalls.md), up to two `fs.writeFile` + two `fs.rename`, one `fs.unlink`, one `fs.rmdir`. Typical developers have dozens of Claude-enabled projects (the `discoverProjectGitRoots` filter can yield 50-200 on longtime users). On macOS default `ulimit -n = 256`; hitting EMFILE during init produces a confusing "Migration '…' failed" for *all* projects at once. The file's D35 comment even acknowledges the pattern is modeled on `.claudeignore` multi-project install (lines 921-923 of init.ts), which has the *same* unbounded concurrency pattern — meaning both places inherit the risk. This is the "bounded concurrency?" question the focus area called out.
- Fix: Use a small concurrency gate (8-16 simultaneous). A minimal `pLimit`-style helper:
  ```typescript
  async function parallelMap<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        try { results[i] = { status: 'fulfilled', value: await fn(items[i]) }; }
        catch (reason) { results[i] = { status: 'rejected', reason }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  // Replace the allSettled call:
  const results = await parallelMap(discoveredProjects, 16, async (projectRoot) => {
    const memoryDir = path.join(projectRoot, '.memory');
    await migration.run({ ...ctx, memoryDir, projectRoot });
  });
  ```

**`installClaudeignore` multi-project sweep has the same unbounded Promise.all** — Confidence: 80%
- `src/cli/commands/init.ts:920-923`
- Problem: Parallel to the migration issue above. `Promise.all(discoveredProjects.map(root => installClaudeignore(...)))` fires all project installs simultaneously. Each one does `fs.stat` + potential `fs.readFile` + `fs.writeFile` of a `.claudeignore` file. For 100+ projects this will pass fine on a fast SSD but risks EMFILE on macOS defaults and creates unpredictable file-ordering in logs. Mentioned here because the new migration code explicitly cites this as its template (`migrations.ts:187-190` D35 comment).
- Fix: Use the same `parallelMap` helper with a 16-way limit.

### MEDIUM

**`readAppliedMigrations` + `runMigrations` hit disk on every `devflow init` — no short-circuit** — Confidence: 78%
- `src/cli/utils/migrations.ts:93-103, 148-223`; invoked from `src/cli/commands/init.ts:893-912`
- Problem: Every `devflow init` unconditionally performs: `readAppliedMigrations` (fs.readFile + JSON.parse), then iterates the whole `MIGRATIONS` array. For the steady state where all migrations are applied, the loop still runs through N entries doing `applied.includes(migration.id)` (O(N) per check → O(N²) total — trivial today but scales). After that, even if no new migration ran, the code doesn't write the state file (good — line 177 is gated by a successful run). So the repeat cost is bounded: one JSON read + O(N²) string lookups. This meets the "Cost of running migrations.json read on every init (even when no-op)" focus-area question. The answer: it is ~1-5 ms on a warm page cache, which is acceptable, **but** the `applied.includes` lookup should still be a Set to keep the loop cheap as N grows.
- Fix: Tiny. Change `const applied = await readAppliedMigrations(homeDevflowDir);` → build a `Set<string>` and use `appliedSet.has(migration.id)` in the loop. Zero algorithmic risk, makes steady-state init O(N) instead of O(N²) over the registry.

**`legacy-knowledge-purge.ts` regex rebuilt per-ID per-file** — Confidence: 75%
- `src/cli/utils/legacy-knowledge-purge.ts:134-143`
- Problem: For each legacy ID (4 total) a `new RegExp(...)` is compiled inside the loop. The regex source depends only on the fixed `LEGACY_IDS` constant so the regexes could be pre-compiled at module load time. Absolute cost is tiny (~4 regex compiles per file × 2 files per project × N projects), but the code is in the hot migration path and the fix is a literal constant-hoist.
- Fix: Pre-compute once at module scope:
  ```typescript
  const LEGACY_SECTION_REGEXES: [string, RegExp][] = LEGACY_IDS.map(id => [
    id,
    new RegExp(`\\n## ${escapeRegExp(id)}:[^\\n]*(?:\\n(?!## )[^\\n]*)*`, 'g'),
  ]);
  ```
  Then inside the loop do a prefix filter on the tuple list instead of recompiling.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**HUD render path re-reads `.memory/learning-log.jsonl` and `.notifications.json` on every status-line invocation** — Confidence: 85%
- `src/cli/hud/learning-counts.ts:42`, `src/cli/hud/notifications.ts:30`, invoked from `src/cli/hud/index.ts:85-92`
- Problem: `getLearningCounts` and `getActiveNotification` are called synchronously every time Claude Code re-renders the status line (which, depending on user settings, can be every few seconds). They do `fs.readFileSync` of the full `learning-log.jsonl` (one JSON parse per non-blank line) and `.notifications.json` on each render. This is on the HUD hot path. For `learning-log.jsonl` at hard-ceiling (100 entries × 4 types = ~400 entries × ~800 bytes each = ~320 KB), each render parses ~400 JSON objects and iterates them. At a 2 s statusLine refresh that is ~200 JSON.parse calls/sec from the HUD alone. Because the HUD has a 2 s hard timeout (`index.ts:15`), this is currently bounded — but it is using budget that could be spent elsewhere and it scales with observation count.
  - Good news: the log is capped at ~100 entries per type by the hard-ceiling logic (D17), so in absolute terms this is tractable.
  - The functions are already synchronous and single-pass — well-written.
  - The overall HUD timeout at `index.ts:15` bounds the damage.
- Fix: Add a tiny mtime-keyed cache (the HUD already has `cache.ts` with exactly this pattern — see imports of `fs.readFileSync` + `fs.writeFileSync`). Skip the re-read when `fs.statSync(logPath).mtimeMs` is unchanged vs. the cached value. `learning-log.jsonl` is append-only from the background-learning pipeline and mutated rarely, so the cache hit rate is effectively 100 % between learning runs.
- Category note: the HUD components themselves are *new* (introduced in this PR), but the pattern of "re-read every frame" is inherited from the sibling HUD code, so classifying as pre-existing/Should-Fix. I flag it separately because the focus area explicitly asked about the render hot path.

### LOW

**`parseLearningLog` + `loadAndCountObservations` double-iterate content** — Confidence: 72%
- `src/cli/commands/learn.ts:193-228`
- Problem: `loadAndCountObservations` does `.split('\n').filter(l=>l.trim()).length` and then `parseLearningLog` does `.split('\n')` again and filters. Two full splits + two passes over content. For `--status` and `--list` this is fine; for repeated CLI calls or tests it adds up. Pre-existing (this file isn't new), but the PR adds to the volume of data flowing through it.
- Fix: Single `.split('\n')` pass, count non-empty, attempt parse.

---

## Suggestions (Lower Confidence)

- **`knowledge-usage-scan.cjs` spawns a Node process on every Stop hook** — `scripts/hooks/stop-update-memory:109` (Confidence: 70%) — Each assistant turn spawns a fresh Node (≈30-80 ms cold start) just to regex-scan text for `ADR-NNN|PF-NNN`. For users with memory + learning enabled this is every turn. Consider folding the scan into the existing `background-memory-update` batch or into `json-helper.cjs` via a subcommand so the Node VM amortizes across responsibilities. Current cost is bounded but constant-per-turn.
- **`legacy-knowledge-purge` scans both files sequentially per project** — `src/cli/utils/legacy-knowledge-purge.ts:123` (Confidence: 62%) — The `for` loop over `filePrefixPairs` is strictly sequential. The two files are independent and could be read in parallel with `Promise.all`. Cost saved is one fs.readFile latency per project (~1-3 ms on SSD). Probably not worth the complexity given the migration runs at most once per machine per project.
- **HUD `learning-counts.ts` iterates `.split('\n')` eagerly for the full file** — `src/cli/hud/learning-counts.ts:57` (Confidence: 60%) — A streaming line reader (readline on a createReadStream) would let the HUD bail early if it hit the soft-cap and didn't need to count further. Marginal benefit; unlikely to justify the code.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 3 | 2 | - |
| Pre-existing | - | 0 | 1 | 1 |

**Focus-area verdict**:

| Focus question | Answer |
|-----|-----|
| Parallel per-project sweep bounded concurrency? | **No** — unbounded `Promise.allSettled` (finding above). |
| File I/O in `legacy-knowledge-purge` (read/write/rename) | Atomic rename pattern is correct. Regex hoisting + sequential file reads are minor. |
| Cost of `migrations.json` read on every init | Trivial (~1-5 ms warm cache). Minor algorithmic cleanup in `applied.includes` → Set. |
| HUD render hot path: new allocations/computation per frame? | Yes, `learning-counts` and `notifications` now `readFileSync` + `JSON.parse` per frame. Bounded by the 2 s HUD timeout but deserves an mtime cache. |
| `knowledge-usage-scan` inner loops | One bug: busy-wait spin in `acquireLock` (blocks whole event loop during contention). |
| Tests: slow synchronous I/O or unbounded waits | Integration test accepts `sleep 3` in `background-learning` explicitly (line 14-17, 194-198) — it's documented as unavoidable. The test runs exactly once and has a 60 s timeout. Acceptable. `execFileSync` + `execSync` are appropriate for spawning the hook script under test. |

**Performance Score**: 7/10 — overall solid, with one real busy-wait bug and two unbounded-concurrency patterns that matter for power users with many projects.

**Recommendation**: **CHANGES_REQUESTED**

- Must-fix (blocking): the busy-wait spin in `knowledge-usage-scan.cjs:64-66`. One-line change; the file is on every Stop hook.
- Should-fix in this PR: bound the per-project migration concurrency, deduplicate the `writeAppliedMigrations` calls, swap `applied` to a `Set`.
- Can follow in a separate PR: HUD mtime cache for `learning-counts` / `notifications`, and bound the pre-existing `.claudeignore` multi-install.
