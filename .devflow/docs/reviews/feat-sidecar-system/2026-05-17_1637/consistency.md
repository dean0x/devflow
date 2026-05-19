# Consistency Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: sidecar-capture, sidecar-dispatch, sidecar-evaluate, transcript-filter.cjs, session-start-memory, pre-compact-memory

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent feedback-loop guard style between sidecar hooks** - `sidecar-evaluate:10-12` vs `sidecar-capture:11-13` vs `sidecar-dispatch:11-13`
**Confidence**: 82%
- Problem: `sidecar-evaluate` uses short-circuit `[ ... ] && exit 0` syntax for its env-var feedback-loop guards, while `sidecar-capture` and `sidecar-dispatch` use full `if [ ... ]; then exit 0; fi` syntax. All three hooks are performing the identical guard operation on the same set of env vars.
- Fix: Standardize all three to the same form. Since the `if` form is used in 2/3 hooks and is more readable under `set -e`:
```bash
# sidecar-evaluate lines 10-12 — change from:
[ "${DEVFLOW_BG_LEARNER:-}" = "1" ] && exit 0
[ "${DEVFLOW_BG_UPDATER:-}" = "1" ] && exit 0
[ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ] && exit 0

# to:
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then exit 0; fi
```

---

**Knowledge marker missing `timestamp` field — inconsistent with learning/decisions markers** - `sidecar-evaluate:388-399`
**Confidence**: 92%
- Problem: The learning marker (line 269) and decisions marker (line 335) both include a `--argjson timestamp "$NOW"` field in their JSON output. The knowledge marker (lines 388-399) omits this field entirely. In `sidecar-dispatch`, the expiry logic (lines 142-151) checks `.timestamp` to expire markers older than 24h. Knowledge markers will never be expired because they lack the `timestamp` field, causing them to persist indefinitely if dispatch fails to process them and they don't get recovered through the stale-processing path.
- Fix: Add `timestamp` to the knowledge marker:
```bash
# jq path:
jq -n \
  --argjson staleSlugs "$STALE_ARRAY" \
  --arg worktreePath "$CWD" \
  --argjson timestamp "$NOW" \
  '{staleSlugs: $staleSlugs, worktreePath: $worktreePath, timestamp: $timestamp}' \
  > "$SIDECAR_DIR/knowledge.json"

# node path:
node -e "
  const slugs = process.argv[1].trim().split('\n').filter(Boolean);
  process.stdout.write(JSON.stringify({staleSlugs: slugs, worktreePath: process.argv[2], timestamp: parseInt(process.argv[3])}) + '\n')
" -- "$STALE_SLUGS" "$CWD" "$NOW" > "$SIDECAR_DIR/knowledge.json"
```

---

**Memory marker missing `timestamp` field — same expiry gap** - `sidecar-capture:143-160`
**Confidence**: 92%
- Problem: Same issue as above. The `memory.json` marker written by sidecar-capture (line 148) includes a `timestamp` field, which is correct. However, looking at the `sidecar-dispatch` expiry code (line 143), it uses `jq '.timestamp // empty'` which reads the top-level `timestamp`. The memory marker does include `timestamp` so this is consistent. **Correction**: on re-examination, the memory marker DOES include timestamp (line 148). This finding is withdrawn for memory.json, but remains valid for knowledge.json only.

*This finding is consolidated with the one above (knowledge marker only).*

### MEDIUM

**Log function format inconsistency between sidecar-capture and sidecar-evaluate** - `sidecar-capture:87` vs `sidecar-evaluate:44`
**Confidence**: 85%
- Problem: `sidecar-capture` uses `[sidecar-capture]` with brackets in its log format (line 87: `[sidecar-capture] $1`), while `sidecar-evaluate` uses bare prefix without brackets (line 44: `sidecar-evaluate: $1`). Both are writing to per-hook log files in the same `~/.devflow/logs/` directory.
- Fix: Standardize on the bracketed format that `sidecar-capture` uses (matches the ISO timestamp bracket style):
```bash
# sidecar-evaluate line 44 — change:
log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] sidecar-evaluate: $1" >> "$LOG_FILE"; }
# to:
log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [sidecar-evaluate] $1" >> "$LOG_FILE"; }
```

---

**sidecar-evaluate does not validate `$CWD` is a directory** - `sidecar-evaluate:21`
**Confidence**: 84%
- Problem: Both `sidecar-capture` (line 37) and `sidecar-dispatch` (line 26) guard with `[ -z "$CWD" ] || [ ! -d "$CWD" ]`, checking that CWD both exists and is a valid directory. `sidecar-evaluate` (line 21) only checks `[ -z "$CWD" ]` — it does not confirm the path is actually a directory. A non-existent CWD would then fail at line 24 (`[ ! -d "$MEMORY_DIR" ]`) but only after SIDECAR_DIR/config paths have been derived.
- Fix:
```bash
# sidecar-evaluate line 21 — change:
[ -z "$CWD" ] && exit 0
# to:
[ -z "$CWD" ] || [ ! -d "$CWD" ] && exit 0
```
Note: the short-circuit compound form needs careful grouping under `set -e`:
```bash
if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then exit 0; fi
```

---

**Inconsistent config-reading scope: sidecar-capture reads only `memory`, sidecar-evaluate reads `learning/decisions/knowledge` but not `memory`** - `sidecar-capture:44-48` vs `sidecar-evaluate:29-38`
**Confidence**: 80%
- Problem: `sidecar-capture` reads only the `memory` field from config (because it only does memory work + decisions-scanner). `sidecar-evaluate` reads `learning`, `decisions`, `knowledge` but does NOT read `memory` — yet it uses `LEARNING_ENABLED` to gate the artifact reinforcement section that writes to `LEARNING_LOG` (which lives in `.memory/`). This is *intentionally* different (the evaluate hook gates per-feature, while capture gates the memory subsystem), but the comment at sidecar-evaluate line 28 says "Read sidecar config" without clarifying WHY memory is excluded. This makes future maintainers likely to add `memory` there incorrectly.
- Fix: Add a clarifying comment:
```bash
# Read sidecar config — per-feature gates only (memory gating is handled by sidecar-capture,
# not here — evaluate writes markers, which capture/dispatch gate independently).
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`read_daily_cap` default parameter unused in fallback path** - `sidecar-evaluate:93,100`
**Confidence**: 83%
- Problem: The function signature accepts `default="${2:-0}"` (line 93) and uses it on line 100 as `count="${count:-$default}"`. But `count` is initialized to `0` on line 94 and only reassigned from `cut` output. If `cut` produces empty output (after `tr -dc '0-9'`), then `count` becomes empty and falls through to `"${count:-$default}"` which correctly uses `$default`. However, all call sites pass `0` as the default (`read_daily_cap "$RUNS_FILE" 0`, line 228/306), which is identical to the initial `count=0`. The `default` parameter adds complexity with zero behavioral difference from just using `0`.
- Fix: Either remove the default parameter (always fall back to 0) or document when a caller might want a non-zero default. Minor — not blocking.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`session-start-memory` uses `cd "$CWD"` which changes working directory permanently** - `session-start-memory:83`
**Confidence**: 85%
- Problem: Line 83 does `if cd "$CWD" 2>/dev/null && git rev-parse ...` — this changes the working directory for the rest of the script. Other hooks (like `pre-compact-memory:42`) do the same thing. While both hooks exit soon after, this is fragile if code is added below. `sidecar-evaluate` and `sidecar-dispatch` do not use `cd` at all — they pass `--cwd` or `-C` to commands. The newer sidecar hooks show the preferred pattern.
- Fix: Use a subshell for the git operations: `if (cd "$CWD" && git rev-parse --git-dir >/dev/null 2>&1); then ...`. Or since these are legacy hooks being superseded, accept as-is.

## Suggestions (Lower Confidence)

- **Expiry logic only runs when jq is available** - `sidecar-dispatch:142` (Confidence: 72%) -- The 24h marker expiry block is inside `if [ "$_HAS_JQ" = "true" ]`. When only node is available, markers will never expire. Consider adding a node fallback path.

- **`sidecar-evaluate` does not gate `memory` marker skip for already-pending** - `sidecar-evaluate` (Confidence: 65%) -- If a `memory.json` marker is written by `sidecar-capture` but then `sidecar-evaluate` also runs, both could theoretically write conflicting markers for different features in the same directory. In practice this is fine since they write different filenames, but the lack of a "memory" feature case in evaluate's feature-gate switch is worth noting for completeness.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 3 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The most impactful finding is the missing `timestamp` on the knowledge marker — this creates an asymmetry where learning/decisions markers can be expired by sidecar-dispatch but knowledge markers cannot, potentially accumulating stale markers indefinitely. The log format and CWD validation inconsistencies are lower-risk but easy to fix while in this code.

Applies ADR-001: The session-start-memory and pre-compact-memory hooks correctly reference the clean-break philosophy in their comments about ignoring the legacy `.working-memory-disabled` sentinel.
