# Architecture Review Report

**Branch**: feat-learning-wave2-quality -> main
**Date**: 2026-03-25
**PR**: #162

## Issues in Your Changes (BLOCKING)

### HIGH

**Race condition: batch file consumed without lock coordination** - `scripts/hooks/session-end-learning:189-192`, `scripts/hooks/background-learning:156-181`
**Confidence**: 85%
- Problem: `session-end-learning` writes `.learning-batch-ids` via `cp` and immediately resets the session counter (`rm -f`). The background learner (`background-learning`) reads and deletes `.learning-batch-ids` inside `extract_batch_messages()`. However, there is no atomicity guarantee on the handoff. If two SessionEnd hooks fire in rapid succession (concurrent sessions ending), the second hook could overwrite `.learning-batch-ids` between the `cp` and the background learner reading it, losing the first batch. The background learner holds a lock, but `session-end-learning` does not acquire that lock before writing the batch file.
- Fix: Either (a) use the same `mkdir`-based lock in `session-end-learning` around the cp/rm/spawn sequence, or (b) use an atomic rename (`mv`) instead of `cp` + `rm` for the handoff -- the batch file is the session-count file itself, renamed atomically:
  ```bash
  mv "$SESSION_COUNT_FILE" "$BATCH_IDS_FILE"
  ```
  This is already close to what the code does conceptually but uses `cp` + `rm` (two operations) instead of `mv` (one atomic operation).

**Daily counter double-checked but with split responsibility** - `scripts/hooks/session-end-learning:173-196`, `scripts/hooks/background-learning:117-128,721`
**Confidence**: 82%
- Problem: Daily cap enforcement is split across two scripts with divergent logic. `session-end-learning` increments the daily counter *before* spawning the background learner (line 195). The background learner also has `check_daily_cap()` (line 117-128) and a now-dead `increment_daily_counter()` function (lines 131-138) that is never called (line 721 says "Note: daily counter already incremented"). This creates a Separation of Concerns violation -- ownership of the daily cap state is ambiguous. The counter file format (tab-separated) is reimplemented in both scripts independently rather than being a shared concern.
- Fix: Remove `increment_daily_counter()` from `background-learning` since it is dead code. Consider removing `check_daily_cap()` from `background-learning` as well since `session-end-learning` already gates on the cap, or document the double-check as intentional defense-in-depth. Either way, the dead `increment_daily_counter()` function should be removed to avoid confusion.

### MEDIUM

**CWD encoding inconsistency across coordinating scripts** - `scripts/hooks/session-end-learning:63`, `scripts/hooks/background-learning:154`
**Confidence**: 85%
- Problem: `session-end-learning` encodes CWD with `sed 's|/|-|g'` (line 63) while `background-learning` uses `sed 's|^/||' | tr '/' '-'` then prepends `-` (line 154-155). Both produce identical results currently, but the divergent implementations for the same concern are fragile -- a future change to one could break the other. This is a DRY violation on a critical path-encoding function.
- Fix: Extract the encoding into a shared shell function in `log-paths` or a new `path-helpers` sourced file:
  ```bash
  # In a shared helper
  encode_cwd() { echo "$1" | sed 's|/|-|g'; }
  ```

**`addLearningHook` does not clean up legacy Stop hook on enable** - `src/cli/commands/learn.ts:61-90`
**Confidence**: 83%
- Problem: When a user runs `devflow learn --enable`, `addLearningHook()` only checks for and adds a `SessionEnd` hook. It does not remove the legacy `Stop` hook (`stop-update-learning`) that may still exist from pre-Wave-2 installations. Users who upgrade by running `--enable` will end up with both hooks registered -- the new `SessionEnd` hook and the old `Stop` hook (which now just exits immediately, wasting a hook invocation on every session stop). The docs say "Run `devflow learn --disable && devflow learn --enable` to upgrade" but this manual two-step is error-prone.
- Fix: Have `addLearningHook()` also call `removeFromEvent('Stop', LEGACY_HOOK_MARKER)` or call `removeLearningHook()` first before adding the new hook. This makes `--enable` self-upgrading:
  ```typescript
  export function addLearningHook(settingsJson: string, devflowDir: string): string {
    // First, clean up any legacy Stop hook
    const cleaned = removeLearningHook(settingsJson);
    const settings: Settings = JSON.parse(cleaned);
    // ... add SessionEnd hook ...
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`background-learning` remains a 724-line shell monolith (PF-004 reintroduced)** - `scripts/hooks/background-learning`
**Confidence**: 90%
- Problem: Known pitfall PF-004 flagged `background-learning` as a 560-line god script. This PR increased it to 724 lines by adding batch extraction, skill templates, and naming rules inline. The script concentrates 8+ responsibilities: locking, config loading, batch transcript extraction, temporal decay, LLM invocation, response processing, observation CRUD, and artifact creation. PF-004's resolution was "Move JSON-heavy logic to TypeScript; keep shell script as thin orchestrator (~100 lines)." This PR moved in the opposite direction.
- Fix: This is a pre-existing architectural concern that has worsened. The immediate action for this PR should be to avoid adding more responsibilities to this script. Long-term, the PF-004 resolution remains the correct path: extract JSON-heavy logic (decay, observation CRUD, artifact management) to TypeScript or to `json-helper.cjs`.

**Reinforcement function uses per-line JSON parsing in a synchronous hook** - `scripts/hooks/session-end-learning:94-138`
**Confidence**: 80%
- Problem: `reinforce_loaded_artifacts()` iterates over every line of `learning-log.jsonl` with a `while read` loop, calling `json_field` (which spawns jq or node) 2 times per line. This is the same per-line-spawning anti-pattern flagged in PF-006 for `session-start-memory`. The `SessionEnd` hook runs synchronously in the Claude process -- latency here directly delays the user. With 50 observations, this spawns ~100 subprocesses.
- Fix: Replace the while-read loop with a single-pass jq/node operation. Pass the list of loaded slugs and the current timestamp to `json-helper.cjs` as a new operation (e.g., `reinforce-artifacts`), returning the updated JSONL in one invocation.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Config loading duplicated between shell and TypeScript (PF-005 adjacent)** - `scripts/hooks/background-learning:89-113`, `src/cli/commands/learn.ts:233-248`
**Confidence**: 85%
- Problem: The SYNC comment at `background-learning:89` acknowledges this: config loading (defaults, global override, project override) is implemented independently in both shell and TypeScript. The default value for `max_daily_runs` was changed from 10 to 5 in both places in this PR, demonstrating the coordination cost. Any future config field addition requires synchronized changes in two languages.
- Fix: Long-term, have the shell script call a single TypeScript entry point (`json-helper.cjs load-config`) that returns resolved config as JSON, eliminating the duplication.

**Per-line jq spawning in batch transcript extraction (PF-006 pattern)** - `scripts/hooks/background-learning:166-177`
**Confidence**: 85%
- Problem: `extract_batch_messages()` uses `grep | while read | json_extract_messages` per line per session, spawning a jq/node subprocess for each user message line across all batched transcripts. With 3 sessions averaging 50 user messages each, this is ~150 subprocess spawns. This is the same PF-006 anti-pattern. The background script runs detached so it does not block the user, but it does consume system resources.
- Fix: Replace with a single-pass approach: pass the full transcript file to a `json-helper.cjs` operation that extracts all user messages in one invocation.

## Suggestions (Lower Confidence)

- **Batch file as implicit contract between scripts** - `scripts/hooks/session-end-learning:189`, `scripts/hooks/background-learning:156` (Confidence: 70%) -- The `.learning-batch-ids` file serves as an implicit IPC contract between two scripts. If the format changes (e.g., adding metadata per session), both scripts must be updated in lockstep. Consider documenting the contract or using a structured format (JSON) instead of plain newline-separated IDs.

- **Adaptive batch size logic hardcoded** - `scripts/hooks/session-end-learning:151-154` (Confidence: 65%) -- The threshold (15 observations) and escalated batch size (5) are hardcoded, overriding the configurable `batch_size` from `learning.json`. This means users cannot control batch frequency once they pass 15 observations, which may be surprising.

- **`hasLearningHook` only checks SessionEnd, not Stop** - `src/cli/commands/learn.ts:131-140` (Confidence: 72%) -- `hasLearningHook()` returns `false` for users who still have only the legacy Stop hook. This means `--status` will report learning as disabled even though the legacy Stop hook is technically registered (albeit a no-op). Combined with `addLearningHook` not cleaning up legacy hooks, this could confuse users mid-upgrade.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | - | 2 | 2 | - |
| Should Fix | - | - | 2 | - |
| Pre-existing | - | - | 2 | - |

**Architecture Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The architectural direction is sound -- moving from per-session Stop hook to batched SessionEnd is a good separation of concerns improvement, and the reinforcement feature adds value without LLM cost. However, the handoff between `session-end-learning` and `background-learning` introduces coordination concerns (race condition on batch file, split daily cap ownership, inconsistent path encoding) that should be addressed before merge. The legacy hook cleanup gap in `--enable` will create a poor upgrade experience for existing users. The `background-learning` monolith continues to grow against PF-004 guidance.
