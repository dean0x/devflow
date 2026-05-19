# Reliability Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Unbounded stale-retry loop without max iteration cap** - `scripts/hooks/sidecar-dispatch:71-87`
**Confidence**: 82%
- Problem: The glob `"$SIDECAR_DIR"/*.processing` iterates over all `.processing` files without a cap. While the sidecar directory is expected to contain only a handful of known task files (memory, learning, decisions, knowledge), there is no guard against an unexpected proliferation of `.processing` files (e.g., from a bug writing stale markers or a user creating files manually). Under `set -e`, if `stat` or arithmetic fails on any file the entire hook crashes — but the loop itself is bounded by filesystem state so this is more of a defensive concern than a live outage risk.
- Fix: Add a counter with a max (e.g., 10) to short-circuit:
```bash
RETRY_COUNT=0
MAX_RETRIES=10
for PROC_FILE in "$SIDECAR_DIR"/*.processing; do
  [ -f "$PROC_FILE" ] || continue
  RETRY_COUNT=$((RETRY_COUNT + 1))
  [ "$RETRY_COUNT" -gt "$MAX_RETRIES" ] && break
  # ... existing logic
done
```

---

**No retry/accumulation bound on `.processing` marker lifespan** - `scripts/hooks/sidecar-dispatch:81-84`, `scripts/hooks/sidecar-capture:119-122`
**Confidence**: 84%
- Problem: The stale-retry mechanism renames `.processing` back to `.json` after 5 minutes, which causes the task to be re-dispatched on the next prompt. If the sidecar agent consistently fails (e.g., bad prompt, model error, quota exhaustion), the marker will cycle between `.json` and `.processing` indefinitely across sessions — each session spawning a failing background agent. There is no cap on total retry attempts.
- Fix: Track retry count in the marker file itself (add a `retries` field) or use a `.failed` extension after N retries:
```bash
# In the stale-retry section, check if marker has been retried too many times
RETRY_LIMIT=3
if [ "$PROC_AGE" -gt 300 ]; then
  # Check retry count (stored as .retries sideband file)
  RETRY_FILE="${PROC_FILE}.retries"
  RETRIES=$(cat "$RETRY_FILE" 2>/dev/null || echo "0")
  if [ "$RETRIES" -ge "$RETRY_LIMIT" ]; then
    mv "$PROC_FILE" "${PROC_FILE%.processing}.failed" 2>/dev/null || true
    rm -f "$RETRY_FILE"
  else
    echo "$((RETRIES + 1))" > "$RETRY_FILE"
    mv "$PROC_FILE" "${PROC_FILE%.processing}.json" 2>/dev/null || true
  fi
fi
```

---

**`sidecar-evaluate` can crash under `set -e` when `SESSION_COUNT_FILE` does not exist at wc** - `scripts/hooks/sidecar-evaluate:137-138`
**Confidence**: 85%
- Problem: At line 137-138, `CURRENT_COUNT` is set via `wc -l < "$SESSION_COUNT_FILE"` only if the file exists. However, the file existence check (`if [ -f "$SESSION_COUNT_FILE" ]`) was already confirmed fixed in commit c809837. The fix moved the read inside the conditional. Verified: current code is correct. *(Re-evaluated: NOT an issue after the fix commit.)*

Actually, re-reading lines 137-138:
```bash
if [ -f "$SESSION_COUNT_FILE" ]; then
  CURRENT_COUNT=$(wc -l < "$SESSION_COUNT_FILE" | tr -d ' ')
fi
```
This is correct after the fix. Withdrawing this finding.

---

**Race condition: `sidecar-capture` queue truncation is non-atomic** - `scripts/hooks/sidecar-capture:84-88`
**Confidence**: 83%
- Problem: The orphan queue auto-clean (`: > "$QUEUE_FILE"`) truncates the file in-place. If `sidecar-dispatch` is writing to the same file concurrently (which is possible since Stop and UserPromptSubmit hooks can fire in close succession), the truncation could discard a just-written user turn. The window is small (both hooks are triggered from the same Claude session, so they are effectively serialized by the session), but on systems with aggressive I/O scheduling this is a theoretical data loss path.
- Fix: This is low-risk in practice because hooks within a single session are serialized by the Claude runtime. Consider adding a comment documenting this assumption, or using rename-based truncation for extra safety:
```bash
if ! grep -qF '"role":"assistant"' "$QUEUE_FILE" 2>/dev/null; then
  log "Auto-clean: replacing orphan user-only queue"
  rm -f "$QUEUE_FILE"
  (umask 077 && touch "$QUEUE_FILE") 2>/dev/null || true
fi
```

### MEDIUM

**`sidecar-evaluate` transcript grep may match false positives** - `scripts/hooks/sidecar-evaluate:68`
**Confidence**: 80%
- Problem: `USER_TURNS=$(grep -c '"type":"user"' "$TRANSCRIPT" 2>/dev/null || echo "0")` matches any line containing the literal string `"type":"user"` including lines where this appears inside message content (e.g., if a user discusses JSON schemas). This could over-count user turns, potentially triggering learning/decisions evaluation on shallow sessions that only happen to contain that string in assistant output.
- Fix: Use a more specific pattern or count with jq:
```bash
if [ "$_HAS_JQ" = "true" ]; then
  USER_TURNS=$(jq -s '[.[] | select(.type == "user")] | length' "$TRANSCRIPT" 2>/dev/null || echo "0")
else
  USER_TURNS=$(grep -c '"type":"user"' "$TRANSCRIPT" 2>/dev/null || echo "0")
fi
```

---

**`updateFeature` in sidecar-config.ts is not atomic (read-modify-write race)** - `src/cli/utils/sidecar-config.ts:58-65`
**Confidence**: 82%
- Problem: `updateFeature` reads config, modifies it, and writes back without any locking. If two CLI commands run concurrently (e.g., `devflow memory --disable` and `devflow learn --disable` in parallel terminals), the second write can overwrite the first's change. The JSDoc says "immutable update pattern" (after the fix commit) but the actual I/O is still a non-locked read-then-write.
- Fix: Use write-through with a lock, or accept the race as low-probability (config writes are infrequent user-initiated actions). At minimum, document the limitation:
```typescript
/**
 * Toggle a single feature in the sidecar config.
 * Reads current config, applies the change, and writes back.
 * NOTE: Not concurrency-safe — concurrent updateFeature calls may lose writes.
 * Acceptable because config changes are infrequent, user-initiated CLI actions.
 */
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`session-start-memory` still checks legacy sentinel but does not inform user it's deprecated** - `scripts/hooks/session-start-memory:22`
**Confidence**: 80%
- Problem: Line 22 checks `$CWD/.memory/.working-memory-disabled` (the legacy sentinel), and line 23-26 checks the new sidecar config. Both paths exit silently. However, the `devflow memory --disable` command no longer creates the legacy sentinel (it writes sidecar config instead). A user who has the legacy sentinel from before the upgrade will have memory permanently disabled with no feedback path telling them to migrate. This is an intentional clean-break (applies ADR-001), but the dual-check without deprecation logging may confuse debugging.
- Fix: Add a log line when the legacy sentinel is detected to aid debugging:
```bash
if [ -f "$CWD/.memory/.working-memory-disabled" ]; then
  # Legacy sentinel — memory disabled. User should run devflow memory --enable to migrate.
  exit 0
fi
```

## Pre-existing Issues (Not Blocking)

*(none identified at CRITICAL severity in unchanged code)*

## Suggestions (Lower Confidence)

- **Marker file accumulation over time** - `scripts/hooks/sidecar-evaluate` (Confidence: 65%) — If the sidecar skill fails to delete `.processing` files after completing work (e.g., agent crashes post-work but pre-cleanup), markers can accumulate. Consider a periodic garbage collection pass for `.processing` files older than 1 hour (the current 5-minute retry handles this, but only converts them back to `.json` for retry — see the retry-bound finding above).

- **No size bound on `$PENDING_TASKS` string** - `scripts/hooks/sidecar-dispatch:96-101` (Confidence: 62%) — The comma-joined task list grows with each pending marker. In the expected case (4 known tasks), this is fine. If unexpected files appear in the sidecar dir, the injected context could grow large. Low probability given the directory is controlled.

- **`sidecar-capture` checks config before `mkdir -p "$SIDECAR_DIR"`** - `scripts/hooks/sidecar-capture:43-47,141` (Confidence: 70%) — The config check at line 43 reads from `$SIDECAR_DIR/config.json`, but `mkdir -p "$SIDECAR_DIR"` only happens at line 141. If the directory doesn't exist yet, the config read fails silently (file-not-found → defaults to enabled), which is correct behavior. But it means the first invocation always runs through even if the user had previously disabled memory via a different path. Consistent with safe defaults.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The sidecar system demonstrates good reliability fundamentals: throttling (2-min memory cooldown, 2-hour knowledge cooldown), daily caps, queue overflow protection (200-line cap with tail-100 trim), bounded input (2000-char truncation), and graceful degradation (|| true on non-critical operations). The two HIGH findings relate to the stale-retry mechanism lacking a maximum retry count, which could cause infinite retry loops for consistently-failing sidecar tasks. The `set -e` interactions are well-handled after the fix commit (c809837). The `updateFeature` race is acceptable for its usage pattern but should be documented.
