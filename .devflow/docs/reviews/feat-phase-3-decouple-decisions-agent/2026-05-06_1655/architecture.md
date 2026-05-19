# Architecture Review Report

**Branch**: feat-phase-3-decouple-decisions-agent -> main
**Date**: 2026-05-06

## Issues in Your Changes (BLOCKING)

### HIGH

**Significant code duplication between `decisions.ts` and `learn.ts` CLI commands** - `src/cli/commands/decisions.ts` and `src/cli/commands/learn.ts`
**Confidence**: 85%
- Problem: The `decisions.ts` command (726 lines) is a near-structural duplicate of `learn.ts`. The subcommands `--status`, `--list`, `--configure`, `--purge`, `--clear`, `--reset`, `--review`, `--dismiss-capacity`, `--enable/--disable`, and `--run-background` all follow the same pattern with nearly identical control flow, differing only in which log file they read, which hook marker they match, and which observation types they filter. This violates SRP and OCP -- when a new subcommand pattern is added, two files must change. The `--review` flow in `decisions.ts:543-638` and `learn.ts:956-1086` share the same flag-clear / deprecate / skip loop with almost identical code.
- Impact: Maintenance burden doubles. Bug fixes (like the notification path fix in commit `730febb`) must be applied to both files independently, increasing risk of drift. The `--configure` wizard in both commands has nearly identical structure with minor value changes.
- Fix: Extract a shared `ObservationCommandRunner` or utility module that parameterizes: log file path, hook marker, observation type filter, notification file path, lock directory, and display strings. Both `decisions.ts` and `learn.ts` would become thin wrappers around this shared runner. This is a "should do in this PR" issue because the duplication was introduced in this branch.

### MEDIUM

**`decisions.ts` `--run-background` duplicates pipeline orchestration from `learn.ts`** - `src/cli/commands/decisions.ts:168-233` and `src/cli/commands/learn.ts:516-589`
**Confidence**: 82%
- Problem: Both `--run-background` handlers follow the exact same pipeline sequence: run split migration, acquire lock, register cleanup, load config, extract batch messages, apply temporal decay, cap entries, run agent, process observations (with type filter), render ready, check staleness, release lock. The only differences are: config loader function, agent runner function, type filter string, manifest/notification path overrides, and batch IDs file name. This is classic template method pattern waiting to be extracted.
- Impact: Adding a new pipeline step (e.g., log rotation, new post-processing) requires identical changes in two places.
- Fix: Extract a `runBackgroundPipeline(opts: PipelineOpts)` function in `background-runner.ts` that accepts the variable parts as parameters. Both commands call this single function with their specific config.

**`json-helper.cjs` optional path overrides increase API surface complexity** - `scripts/hooks/json-helper.cjs` (render-ready, reconcile-manifest)
**Confidence**: 80%
- Problem: The `render-ready` and `reconcile-manifest` operations in `json-helper.cjs` gained optional `--manifest-path` and `--notifications-path` overrides. While functional, this widens the API surface of what was previously a simple `<log> <baseDir>` interface. The arg parsing (`for (let i = 2; i < args.length; i++)`) is ad hoc rather than using a consistent argument parser. Multiple callers now must know to pass (or not pass) these overrides, and the default path derivation (`path.join(baseDir, '.memory', '.learning-manifest.json')`) is embedded in the switch case rather than centralized.
- Impact: Future callers of these operations must understand the optional path override contract. Missing an override silently falls back to the learning manifest, which could corrupt state.
- Fix: Consider separating the decisions pipeline into its own json-helper operation (e.g., `render-ready-decisions`) with explicit required paths, rather than overloading the existing operations with optional args. Alternatively, if the overload approach is intentional, extract arg parsing into a shared `parseOptionalPaths(args, startIdx)` function.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`learn.ts --review` capacity mode reads `.learning-notifications.json` but writes to the same file -- notification file scope mismatch** - `src/cli/commands/learn.ts:1258` and `src/cli/commands/learn.ts:1293`
**Confidence**: 84%
- Problem: The capacity review mode in `learn.ts` reads from `.learning-notifications.json` (line 1258) and writes back to `.learning-notifications.json` (line 1293), but it operates on both `decisions.md` and `pitfalls.md` files (lines 1105-1111). Since the decisions pipeline now writes capacity notifications to `.decisions-notifications.json`, the capacity review in `learn.ts` will only see/clear notifications from the legacy/learning system, not from the decisions pipeline. A user running `devflow learn --review` in capacity mode will deprecate entries from both decisions files but only clear notifications from the learning notifications file.
- Fix: The capacity review should read/write from both `.learning-notifications.json` and `.decisions-notifications.json`, or this subcommand should be moved to a shared location accessible from both `devflow learn` and `devflow decisions`.

**`learn.ts --reset` still references `.notifications.json` (renamed to `.learning-notifications.json`)** - `src/cli/commands/learn.ts:847`
**Confidence**: 82%
- Problem: The `--reset` transient files list at line 847 references `.learning-notifications.json`, which is the correct post-rename path. However, the old `.notifications.json` is not included in the cleanup list. If a user's project has both the pre-migration `.notifications.json` and the post-migration `.learning-notifications.json`, running `--reset` will only clean up the new file.
- Fix: Add `.notifications.json` to the transient files list as a cleanup target for the legacy path.

### LOW

**`decisions.ts --reset` removes `decisions` directory via `rmdir` which fails if non-empty** - `src/cli/commands/decisions.ts:508`
**Confidence**: 80%
- Problem: `await fs.rmdir(path.join(memoryDir, 'decisions'))` will fail silently if the directory contains `decisions.md` or `pitfalls.md`. The `--reset` operation only removes state files (log, manifest, notifications, etc.) but does not touch the rendered markdown files. This is likely intentional (preserving user-curated decisions), but using `rmdir` on a non-empty directory is a no-op, making line 508 dead code in most cases.
- Fix: Either remove this line (since it cannot succeed when decisions files exist) or add a comment clarifying the intent (e.g., "// Clean up empty decisions directory after manual file removal").

## Pre-existing Issues (Not Blocking)

*No critical pre-existing issues identified in the reviewed files.*

## Suggestions (Lower Confidence)

- **`extractBatchMessages` spawns a Node subprocess per session transcript** - `src/cli/utils/background-runner.ts:256-263` (Confidence: 70%) -- Each transcript runs `node -e` with an inline script to call `extractChannels`. For batches with many sessions, this could be slow. Consider requiring `transcript-filter.cjs` directly since this is already a Node process.

- **`registerLockCleanup` does not call `process.exit` for SIGTERM/SIGINT** - `src/cli/utils/background-runner.ts:116-117` (Confidence: 65%) -- The handler releases the lock but does not terminate the process for SIGTERM/SIGINT signals. This could leave the process running after the signal is received. The `uncaughtException` handler calls `process.exit(1)` but the signal handlers do not.

- **Threshold reduction from 2 to 1 for decisions/pitfalls in `json-helper.cjs`** - `scripts/hooks/json-helper.cjs:92-93` (Confidence: 62%) -- Reducing the required observation count from 2 to 1 means every decision/pitfall observation is immediately promotable (given quality_ok). This is architecturally intentional (decisions are high-signal from DIALOG_PAIRS) but reduces the deduplication safety net. applies ADR-001 -- this is a deliberate design choice rather than an architectural concern.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | - | 0 | 2 | 1 |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

This PR represents a well-structured decomposition of a monolithic learning system into two independent agents. The new `background-runner.ts` shared utility module is an excellent extraction that centralizes locking, daily caps, transcript extraction, and log maintenance. The split-migration approach with idempotent sentinel files is production-grade.

However, the primary architectural concern is the significant code duplication between `decisions.ts` (726 lines) and `learn.ts`. These two commands share the same structural skeleton for nearly every subcommand. The `--run-background` pipeline orchestration is nearly identical. This duplication was introduced by this branch and will compound as both systems evolve. Extracting the shared patterns into a parameterized runner would reduce the combined ~1400 lines to roughly ~900 lines while making both pipelines easier to maintain.

The `json-helper.cjs` optional path override approach, while functional, adds complexity to what was a clean positional-argument API. The notification file split (.notifications.json -> .learning-notifications.json + .decisions-notifications.json) with fallback merging in the HUD is well-handled, but the `learn.ts --review` capacity mode does not account for the decisions-specific notification file, creating a potential blind spot. avoids PF-001 -- the PR correctly avoids migration code for the split, using an idempotent sentinel-based migration (`split-migration.cjs`) instead.
