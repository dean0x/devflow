# Architecture Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Dual disable mechanism creates inconsistent state** - `scripts/hooks/session-start-memory:22-27`
**Confidence**: 85%
- Problem: `session-start-memory` checks BOTH the legacy `.working-memory-disabled` sentinel AND the new sidecar config file. However, `memory.ts --disable` only writes to sidecar config (no longer manages the sentinel), while `memory.ts --enable` only writes to sidecar config. This means:
  1. If a user disabled memory on the old system (sentinel exists), upgrades, then enables via the new sidecar config, the sentinel still blocks `session-start-memory`.
  2. `init.ts` no longer calls `manageSentinel` for `.working-memory-disabled` or `.learning-disabled` (lines removed), so the sentinel is never cleaned up on re-init.
- Fix: Either (a) remove the legacy sentinel check from `session-start-memory` since the sidecar config is now authoritative, or (b) add cleanup of legacy sentinels in `memory.ts --enable` to handle the upgrade path. Option (a) is cleaner — applies ADR-001 (no migration code for devflow refactors — clean break philosophy). However, if existing users may have the sentinel from a prior install, a one-time removal on `--enable` (not a compat layer, just cleanup) would be pragmatic.

**`updateFeature` has a read-modify-write race condition** - `src/cli/utils/sidecar-config.ts:58-65`
**Confidence**: 82%
- Problem: `updateFeature` calls `readConfig` then `writeConfig` without any locking or atomic compare-and-swap. If two concurrent hooks or CLI invocations call `updateFeature` simultaneously (e.g., `devflow init` and a hook both running), one write may clobber the other. The `init.ts` code calls `updateSidecarFeature` four times sequentially (lines 1139-1142), each doing a full read-write cycle — if an external process writes between them, changes are lost.
- Fix: Either (a) batch all four updates into a single `writeConfig` call in `init.ts` (read once, merge all features, write once), or (b) use file locking (e.g., `proper-lockfile` or `mkdir`-based lock). Option (a) is simplest and eliminates the window for all the `init.ts` use cases:
  ```typescript
  // init.ts — single read-modify-write
  const config = await readConfig(gitRoot);
  await writeConfig(gitRoot, {
    ...config,
    memory: memoryEnabled,
    learning: learnEnabled,
    decisions: decisionsEnabled,
    knowledge: knowledgeEnabled,
  });
  ```

### MEDIUM

**Sidecar skill has unbounded agent knowledge scope** - `shared/skills/sidecar/SKILL.md`
**Confidence**: 83%
- Problem: The sidecar skill instructs background agents with inline prompts that encode the full protocol for learning, decisions, knowledge, and memory updates. At 159 lines and growing, this monolithic skill conflates four independent responsibilities into a single file. Each "Task" section is essentially a different agent with different data flows, yet they share a single activation and processing framework. This violates SRP — any change to one agent's protocol requires modifying the entire skill.
- Fix: Consider splitting into per-task skill files (`sidecar-memory`, `sidecar-learning`, `sidecar-decisions`, `sidecar-knowledge`) that the main `sidecar` skill dispatches to. This preserves the single entry point while allowing each agent's protocol to evolve independently.

**`sidecar-evaluate` duplicates decisions disabled-check pattern** - `scripts/hooks/sidecar-evaluate:204`
**Confidence**: 80%
- Problem: `sidecar-evaluate` checks the `.memory/decisions/.disabled` sentinel directly (line 204), which is a separate mechanism from the sidecar config `decisions: false`. This creates two sources of truth for whether decisions is enabled: the sidecar config (checked by `sidecar-dispatch` and CLI) and the sentinel (checked by `sidecar-evaluate` and `session-start-context`). A user could set sidecar config `decisions: true` but have the sentinel present, resulting in inconsistent behavior.
- Fix: Consolidate to sidecar config as the single source of truth. The sentinel should either be removed on `decisions --enable` (already not done in the new code) or `sidecar-evaluate` should check the sidecar config instead of the sentinel for the decisions feature specifically.

**No atomicity guarantee for marker rename in dispatch hook** - `scripts/hooks/sidecar-dispatch:71-86`
**Confidence**: 80%
- Problem: The stale retry logic renames `.processing` back to `.json` when a file is >5 min old. However, the sidecar skill also does `.json` -> `.processing` rename as an "atomic claim." If the dispatch hook detects a stale `.processing` file at the same moment a (very slow) sidecar agent is still writing its output, the rename-back creates a race where the agent writes to a file that no longer exists (or to a file that dispatch then re-dispatches). There is no lock coordination between the hook and the sidecar skill's rename.
- Fix: Use a write-to-temp-then-rename pattern for the sidecar agent's output, or add a check in the sidecar agent that re-validates the `.processing` file still exists before writing results. The 5-minute timeout is generous enough that this is unlikely in practice but architecturally unsound.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`memory.ts --disable` no longer cleans up queue files** - `src/cli/commands/memory.ts:334-343`
**Confidence**: 85%
- Problem: The old code drained orphaned `.pending-turns.jsonl` and `.pending-turns.processing` files on disable (preventing stale turns from being processed on re-enable). The new code only writes `memory: false` to sidecar config. If a user disables memory, stale turns remain in the queue. On re-enable, the next memory sidecar dispatch will process those potentially days-old turns.
- Fix: Add queue file cleanup in the `--disable` path:
  ```typescript
  if (gitRoot) {
    await updateFeature(gitRoot, 'memory', false);
    // Best-effort: drain orphaned queue files
    const memDir = path.join(gitRoot, '.memory');
    try { await fs.unlink(path.join(memDir, '.pending-turns.jsonl')); } catch { /* already gone */ }
    try { await fs.unlink(path.join(memDir, '.pending-turns.processing')); } catch { /* already gone */ }
    p.log.success('Working memory disabled - sidecar config updated');
  }
  ```

**`memory.ts --status` no longer warns about runtime-disabled state** - `src/cli/commands/memory.ts:303-313`
**Confidence**: 82%
- Problem: The old code checked for the sentinel file and warned the user if hooks were present but runtime-disabled. The new code only counts hooks and reports enabled/disabled — but with sidecar config, the hooks are always present (shared). A user who has `memory: false` in sidecar config but hooks registered will get "enabled (5/5 hooks)" which is misleading.
- Fix: Check `isFeatureEnabled(gitRoot, 'memory')` alongside hook count for an accurate status report.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Deleted `background-runner.ts` utilities not fully replaced** - `src/cli/utils/background-runner.ts` (deleted)
**Confidence**: 80%
- Problem: The deleted `background-runner.ts` (448 lines) contained `applyTemporalDecay`, `capEntries`, `checkStaleness`, `extractBatchMessages`, and lock management. These operational safeguards (temporal decay to expire old observations, capping at 100 entries, staleness detection) are not replicated in the new sidecar agent prompts. The sidecar learning/decisions agents are instructed only to "append" and "increment," with no decay, cap, or staleness logic.
- Fix: Either document that the sidecar agents handle these concerns via the `json-helper.cjs` scripts (if they still exist and are called), or add cap/decay instructions to the sidecar skill prompts. Without caps, `learning-log.jsonl` and `decisions-log.jsonl` may grow unbounded over time.

## Suggestions (Lower Confidence)

- **Sidecar config path is project-scoped but hooks are user-scoped** - `src/cli/utils/sidecar-config.ts:18` (Confidence: 70%) -- The sidecar config lives at `{project}/.memory/.sidecar/config.json` (project-scoped), but the hooks in `settings.json` are installed globally (user-scope by default). A user with 5 projects could have different sidecar configs per-project, which is intentional — but the `devflow memory --status` command checks hooks globally and config locally, which may confuse users who expect a unified view.

- **`init.ts` still manages `.features/.disabled` and `decisions/.disabled` sentinels despite sidecar config** - `src/cli/commands/init.ts:1133-1134` (Confidence: 65%) -- These sentinels are read by `session-start-context` (always-on hook) which is separate from the sidecar system. The dual mechanism (sentinel for context injection, sidecar config for background agents) may be intentional for the always-on hook, but creates two places to check when debugging why a feature appears disabled.

- **`DEVFLOW_BG_UPDATER` env var guard retained in `sidecar-capture` but naming is stale** - `scripts/hooks/sidecar-capture:11` (Confidence: 62%) -- The old background updater (`background-memory-update`) set `DEVFLOW_BG_UPDATER=1`. With sidecar agents, this env var is no longer set by anything in this PR. The guard is harmless but dead code.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The sidecar system is a well-motivated architectural simplification — replacing 8 shell scripts and 3 TypeScript utilities with 3 unified hooks plus a config-driven control plane. The marker-file coordination pattern is sound and the separation between evaluation (SessionEnd), dispatch (UserPromptSubmit), and capture (Stop) follows clean responsibility boundaries. The main architectural concerns are: (1) the dual disable mechanism (legacy sentinel + sidecar config) creating inconsistent state during upgrades, and (2) the read-modify-write race in `updateFeature`. Both are fixable without changing the overall design direction. The approach is consistent with ADR-001 (clean break philosophy) — the remaining sentinel references should be cleaned up rather than maintained as backward-compat code (avoids PF-001).
