# Reliability Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental (7 commits since d8e7670)

## Issues in Your Changes (BLOCKING)

### HIGH

**Stale `.retries` file persists across independent marker cycles** - `scripts/hooks/sidecar-dispatch:86-97`
**Confidence**: 85%
- Problem: When a `.processing` file is stale and retried, a `.retries` file is created (e.g., `learning.retries`). After the marker eventually succeeds (`.processing` deleted by the sidecar agent), the `.retries` file is never cleaned up. On the next independent failure cycle for the same task type, the retry counter starts at the stale value instead of 0, reducing the effective retry budget from 3 to (3 - previous_failures).
- Impact: After one failed cycle that consumed 1-2 retries then succeeded, the next failure cycle only gets 1-2 retries before being permanently marked `.failed`. Over time, all task types trend toward zero retry tolerance.
- Fix: Clean up the `.retries` file when the sidecar skill renames `.json` to `.processing` (in the SKILL.md instructions), OR reset it in `sidecar-evaluate` when writing a new marker:
```bash
# In sidecar-evaluate, after writing each marker file:
rm -f "$SIDECAR_DIR/learning.retries" 2>/dev/null || true
```
Or in `sidecar-dispatch`, before the stale-retry loop, clean retries for markers that completed successfully (no `.processing` and no `.json` means it ran to completion):
```bash
for RETRY_FILE in "$SIDECAR_DIR"/*.retries; do
  [ -f "$RETRY_FILE" ] || continue
  BASE="${RETRY_FILE%.retries}"
  # If neither .processing nor .json exists, the previous cycle completed
  [ ! -f "${BASE}.processing" ] && [ ! -f "${BASE}.json" ] && rm -f "$RETRY_FILE"
done
```

### MEDIUM

**`--enable` reports "already enabled" even when sidecar config says `memory: false`** - `src/cli/commands/memory.ts:325`
**Confidence**: 82%
- Problem: The `--enable` path checks `hasMemoryHooks(settingsContent)` — if hooks are registered (which they always are in the sidecar system since hooks are shared), it prints "Working memory already enabled" and returns. But it still calls `updateFeature(gitRoot, 'memory', true)` after that message. The UX issue is the misleading message, and the logic issue is that `--status` correctly shows "disabled" (because it checks sidecar config), but `--enable` says "already enabled" (because it only checks hooks).
- Impact: User runs `--status` (shows "disabled"), then `--enable` (says "already enabled" but actually enables it). Confusing but not data-loss — the feature IS enabled by the `updateFeature` call at line 335.
- Fix: Check sidecar config FIRST in the enable path:
```typescript
if (options.enable) {
  const alreadyEnabled = gitRoot ? await isFeatureEnabled(gitRoot, 'memory') : false;
  if (hasMemoryHooks(settingsContent) && alreadyEnabled) {
    p.log.info('Working memory already enabled');
  } else if (!hasMemoryHooks(settingsContent)) {
    const updated = addMemoryHooks(settingsContent, devflowDir);
    await fs.writeFile(settingsPath, updated, 'utf-8');
    p.log.success('Working memory enabled — sidecar hooks registered');
  } else {
    p.log.success('Working memory re-enabled via sidecar config');
  }
  if (gitRoot) await updateFeature(gitRoot, 'memory', true);
  return;
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Knowledge throttle marker never updated by `sidecar-evaluate`** - `scripts/hooks/sidecar-evaluate:292-328`
**Confidence**: 83%
- Problem: The knowledge evaluation section reads `.features/.knowledge-last-refresh` for throttling but never writes a new timestamp after producing a `knowledge.json` marker. The sidecar SKILL.md instructs the agent to write it after completion, which is correct. However, if the sidecar agent never runs (e.g., user closes session before next dispatch), the throttle stays expired and `sidecar-evaluate` writes a new `knowledge.json` marker on every session end, overwriting the previous unprocessed one.
- Impact: Redundant marker writes on every session end until the agent runs. Not data loss, but unnecessary work (stale-slug detection via node process on every session end, ~50-200ms). Also, if the agent processes the marker between two evaluate runs but FAILS to write `.knowledge-last-refresh`, the evaluate hook enters an infinite retry loop (bounded only by the daily session count).
- Fix: Write the timestamp in `sidecar-evaluate` after producing the marker (optimistic throttle — prevents repeated checks even if the agent hasn't run yet):
```bash
if [ -n "$STALE_SLUGS" ]; then
  # ... existing marker write ...
  echo "$NOW" > "$KNOWLEDGE_MARKER"  # Optimistic throttle
  log "Wrote knowledge marker: ..."
fi
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Orphan queue auto-clean drops first user turn of fresh sessions** - `scripts/hooks/sidecar-capture:83-90`
**Confidence**: 80%
- Problem: On the very first `end_turn` of a fresh session (empty queue or queue cleared by `--clear`), the queue contains only user turns from `sidecar-dispatch`. The auto-clean logic truncates files with no assistant role, discarding the first user turn before the first assistant turn is written.
- Impact: First user message of a fresh session is lost from the pending-turns queue. Memory updater processes the session without context for the opening prompt. Low real-world impact since subsequent turns are captured correctly, and the memory updater relies primarily on the full transcript.
- Note: This logic is pre-existing (unchanged between old and new code). The new diff only added a `QUEUE_LINES -gt 0` guard which is a correct optimization.

## Suggestions (Lower Confidence)

- **Non-atomic marker writes risk partial reads** - `scripts/hooks/sidecar-evaluate:179,260,317` (Confidence: 65%) — Marker files are written directly to their final path (`> "$SIDECAR_DIR/learning.json"`). If the shell is killed mid-write, dispatch could read a partial JSON file. A write-then-rename pattern (`> tmp && mv tmp target`) would be more robust but may be over-engineering for the expected file sizes (<10KB).

- **`echo "$SESSION_ID" | grep` spawns two processes per validation** - `scripts/hooks/sidecar-evaluate:57,135` (Confidence: 62%) — Using bash built-in `[[ "$SESSION_ID" =~ ^[a-zA-Z0-9_-]+$ ]]` would be faster but requires bash 3.2+ regex support (which macOS bash 3.2.57 does have). Current approach is safer for portability.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Reliability Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The retry budget leak (HIGH) is the primary concern — it degrades the system's self-healing capability over time. The knowledge throttle and status message issues are lower priority but worth fixing for correctness. The pre-existing orphan-clean issue does not block this PR.
