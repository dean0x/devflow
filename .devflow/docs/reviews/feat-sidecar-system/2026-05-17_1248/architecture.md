# Architecture Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental (7 commits since d8e7670)

## Issues in Your Changes (BLOCKING)

### HIGH

**sidecar-evaluate writes markers that sidecar-dispatch may never pick up (SessionEnd → next session gap)** - `scripts/hooks/sidecar-evaluate:179,260`
**Confidence**: 85%
- Problem: `sidecar-evaluate` runs on SessionEnd and writes marker files (learning.json, decisions.json, knowledge.json) to `.memory/.sidecar/`. These markers are only consumed by `sidecar-dispatch` (UserPromptSubmit) which runs on the *next* session's first user prompt. If the user does not start a new session in the same project, or starts one in a different project, the markers persist indefinitely without being processed. There is no garbage collection or expiry for these markers — they are not subject to the stale retry logic (which only handles `.processing` files). Over multiple sessions without follow-up usage, markers accumulate and every subsequent `sidecar-dispatch` invocation will inject the SIDECAR directive, potentially triggering processing of stale/outdated data (e.g., learning signals from weeks ago).
- Fix: Add a timestamp field to each marker file and have `sidecar-dispatch` skip (or delete) markers older than a configurable threshold (e.g., 24 hours). The memory marker already has a `timestamp` field — extend this pattern to learning.json and decisions.json, and add an age check in sidecar-dispatch's marker collection loop.

**init.ts: writeSidecarConfig overwrites entire config vs memory.ts: updateFeature does read-modify-write** - `src/cli/commands/init.ts:1139-1144`, `src/cli/commands/memory.ts:335,344`
**Confidence**: 88%
- Problem: `init.ts` now calls `writeSidecarConfig(gitRoot, { memory, learning, decisions, knowledge })` which writes the full config atomically — correct for init. But `memory.ts` still calls `updateFeature(gitRoot, 'memory', true/false)` which does a read-modify-write. If a user runs `devflow init --no-learning` (writes `{memory:true, learning:false, decisions:true, knowledge:true}`) and then immediately runs `devflow memory --disable` in a concurrent terminal, `updateFeature` reads the config, sees `{memory:true, learning:false, ...}`, writes `{memory:false, learning:false, ...}`. This is fine in isolation. However, if `devflow init` and `devflow memory --disable` race on the same file, the init's full-write could clobber the memory disable, or vice versa. The D1 comment acknowledges non-atomicity for CLI commands but the init-vs-subcommand race is not addressed. This is not a critical data loss scenario (user can re-run), but it violates the single-writer assumption documented in D1.
- Fix: Document that `devflow init` should not be run concurrently with feature toggle commands, or use the same `updateFeature` pattern consistently in init (call `updateFeature` four times sequentially). Alternatively, introduce a file-swap write (write to `.tmp`, rename) in `writeConfig` to make at least the write itself atomic.

### MEDIUM

**sidecar-dispatch injects SIDECAR directive even when the corresponding feature is disabled in config** - `scripts/hooks/sidecar-dispatch:102-118`
**Confidence**: 82%
- Problem: `sidecar-dispatch` collects ALL pending `.json` marker files in `.memory/.sidecar/` (except `config.json`) and injects a SIDECAR directive for all of them. It does not check `config.json` to verify whether the features corresponding to those markers are still enabled. Scenario: (1) user has learning enabled, session ends, learning.json marker written. (2) User runs `devflow learn --disable` before the next session. (3) Next session starts, `sidecar-dispatch` sees learning.json marker and injects `SIDECAR: learning`. The sidecar skill would then attempt to spawn a learning background agent for a disabled feature. The config check is only done at marker *write* time (in sidecar-evaluate), not at marker *dispatch* time.
- Fix: In the sidecar-dispatch marker collection loop, read config.json once and skip markers whose corresponding feature is disabled. For example: if `LEARNING_ENABLED=false`, skip `learning.json`.

**sidecar-capture checks only `memory` config flag — queue append for non-memory features is gated by memory toggle** - `scripts/hooks/sidecar-capture:42-47`
**Confidence**: 80%
- Problem: `sidecar-capture` (Stop hook) has a single early-exit check: `memory: false` in config causes `exit 0`. This means the entire hook is skipped — including the decisions-usage-scan at line 113-118 and the queue append that feeds the sidecar system. The queue file (`.pending-turns.jsonl`) is used by the memory background updater, but the decisions usage scanner (ADR/PF citation tracking) is conceptually independent of the memory feature toggle. If a user disables memory but keeps decisions enabled, citation usage tracking silently stops.
- Fix: Move the `memory: false` early-exit to gate only the queue append and memory marker sections, not the decisions usage scanner. Alternatively, read decisions config separately and run the scanner regardless of memory state.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**session-start-memory: removed .working-memory-disabled sentinel check without migration path** - `scripts/hooks/session-start-memory:21-26`
**Confidence**: 83%
- Problem: The legacy sentinel check `[ -f "$CWD/.memory/.working-memory-disabled" ] && exit 0` was removed and replaced with sidecar config check. However, if a user previously disabled memory via the old system (creating `.working-memory-disabled`), they may still have this file present with no `config.json`. When config.json is absent, the hook defaults to `memory: true` (the `if [ -f "$SIDECAR_CONFIG" ]` guard means the check is skipped entirely if no config file exists). This means users who disabled memory under the old system will now have memory re-enabled without explicit consent. This is a behavioral regression from the user's perspective. (`applies ADR-001` — clean break philosophy accepts this trade-off, but it should be documented in the PR.)
- Fix: This is acceptable per ADR-001 (clean break), but worth noting in release notes that previously-disabled memory will become active again after upgrade. Users need to re-disable via `devflow memory --disable`.

**Stale retry `.retries` files never cleaned up on success** - `scripts/hooks/sidecar-dispatch:86-98`
**Confidence**: 82%
- Problem: When a `.processing` file is retried and renamed back to `.json`, a `.retries` counter file is created/incremented. When the marker eventually succeeds (gets renamed to `.processing` by the sidecar skill and then processed successfully), neither the sidecar skill nor any other component removes the `.retries` file. Over time, orphan `.retries` files accumulate in `.memory/.sidecar/`. If a new marker with the same base name (e.g., `learning.json` → `learning.processing` → success → later a new `learning.json` is written), the stale `.retries` count from the previous cycle persists, meaning the new marker starts with a non-zero retry count and may hit the `MAX_RETRIES` threshold prematurely.
- Fix: After successfully processing a marker, the consuming code should delete the corresponding `.retries` file. Alternatively, `sidecar-dispatch` should reset the `.retries` file when it sees a fresh `.json` marker (no `.processing` counterpart).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**sidecar-evaluate reads transcript via `ls -t` fallback — race with concurrent session writes** - `scripts/hooks/sidecar-evaluate:60`
**Confidence**: 80%
- Problem: When `session_id` fails validation or its file doesn't exist, the fallback `ls -t "$PROJECTS_DIR"/*.jsonl | head -1` picks the most recently modified transcript. In a multi-session scenario (user has two Claude Code instances in the same project), this could pick the wrong session's transcript.
- Fix: This is a pre-existing pattern (not introduced by this PR). Low priority — the session_id path traversal fix makes the valid path more robust.

## Suggestions (Lower Confidence)

- **Config.json written without fsync — crash during write could leave truncated file** - `src/cli/utils/sidecar-config.ts:51` (Confidence: 65%) — If the process crashes mid-write (power loss, OOM kill), the config file could be left empty or truncated. The shell hooks would then fall back to defaults (all-true), potentially re-enabling features the user disabled. An atomic write-then-rename pattern would prevent this.

- **sidecar-evaluate knowledge section does not check sidecar KNOWLEDGE_ENABLED against `.features/.disabled` sentinel — double gating** - `scripts/hooks/sidecar-evaluate:284-288` (Confidence: 70%) — The knowledge section checks both `KNOWLEDGE_ENABLED` (from sidecar config) and `.features/.disabled` sentinel. These could diverge if a user disables via one mechanism but not the other. Acceptable as defense-in-depth but adds cognitive complexity.

- **`memory --disable` drains queue but `memory --enable` does not validate queue integrity** - `src/cli/commands/memory.ts:346-350` (Confidence: 62%) — On disable, orphan queue files are deleted. On enable, if a stale `.pending-turns.processing` file exists from a crashed previous session, it could cause confusion. The enable path does not check for or clean up transient state.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The sidecar system's three-hook architecture (dispatch on UserPromptSubmit, capture on Stop, evaluate on SessionEnd) is a sound decomposition. However, the marker lifecycle has gaps: markers can accumulate without expiry, dispatch does not verify feature enablement at consumption time, and the memory config flag gates more functionality than it should. The race between init's full-write and subcommand read-modify-write patterns, while documented as acceptable, introduces a subtle inconsistency in the config management layer.
