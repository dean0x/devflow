# Consistency Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Focus**: Cross-hook consistency of the sidecar system (sidecar-capture, sidecar-dispatch, sidecar-evaluate, sidecar-config.ts)

## Issues in Your Changes (BLOCKING)

### HIGH

**Log format string inconsistency across sibling hooks** - `sidecar-capture:87`, `sidecar-evaluate:44`
**Confidence**: 90%
- Problem: The three sidecar hooks use two different log prefix formats. `sidecar-capture` uses bracket-delimited `[sidecar-capture]`, while `sidecar-evaluate` uses colon-delimited `sidecar-evaluate:`. Both follow the conventions of their predecessors (`stop-update-memory` used `[stop-hook]`, `session-end-learning` used `session-end-learning:`), but as newly-written sibling hooks sharing a single system, they should converge on one format for grep-ability and log analysis.
- Fix: Standardize on the colon format (`sidecar-capture:`, `sidecar-evaluate:`) to match the majority of existing hooks:
  ```bash
  # sidecar-capture:87
  log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] sidecar-capture: $1" >> "$LOG_FILE"; }
  ```

**Guard clause syntax and ordering inconsistency** - `sidecar-capture:11-13`, `sidecar-dispatch:11-13`, `sidecar-evaluate:10-12`
**Confidence**: 85%
- Problem: Two inconsistencies in the feedback-loop guard block:
  1. **Syntax**: sidecar-capture and sidecar-dispatch use `if [...]; then exit 0; fi` while sidecar-evaluate uses `[...] && exit 0`.
  2. **Ordering**: sidecar-capture/dispatch check UPDATER, LEARNER, KNOWLEDGE_REFRESH in that order; sidecar-evaluate checks LEARNER, UPDATER, KNOWLEDGE_REFRESH.
- Fix: Pick one syntax (recommend the compact `[...] && exit 0` form since it matches the old `session-end-learning`/`session-end-decisions` pattern which all three hooks derive from) and normalize the ordering to UPDATER, LEARNER, KNOWLEDGE_REFRESH everywhere.

**Missing `memory` marker gating in sidecar-dispatch feature check** - `sidecar-dispatch:136-140`
**Confidence**: 82%
- Problem: The dispatch marker collection loop gates `learning`, `decisions`, and `knowledge` markers against their config flags, removing stale markers when a feature is disabled. However, `memory` markers are not gated. If `memory:false` is set in sidecar config after a memory marker was already written, dispatch will still pick up and dispatch the stale memory marker. All other feature types have this protection.
- Fix: Add a `memory` case to the gating block:
  ```bash
  case "$BASENAME" in
    memory)     [ "$MEMORY_ENABLED"    != "true" ] && { rm -f "$MARKER_FILE" 2>/dev/null || true; continue; } ;;
    learning)   [ "$LEARNING_ENABLED"  != "true" ] && { rm -f "$MARKER_FILE" 2>/dev/null || true; continue; } ;;
    decisions)  [ "$DECISIONS_ENABLED" != "true" ] && { rm -f "$MARKER_FILE" 2>/dev/null || true; continue; } ;;
    knowledge)  [ "$KNOWLEDGE_ENABLED" != "true" ] && { rm -f "$MARKER_FILE" 2>/dev/null || true; continue; } ;;
  esac
  ```
  Note: `MEMORY_ENABLED` is already read from config at sidecar-dispatch:38, so no additional parsing is needed.

### MEDIUM

**Marker expiry only runs when jq is available** - `sidecar-dispatch:142-151`
**Confidence**: 88%
- Problem: The 24-hour marker expiry check (lines 142-151) is inside an `if [ "$_HAS_JQ" = "true" ]` block with no `else` branch. When only `node` is available, expired markers are never cleaned up. Every other jq usage in the sidecar hooks provides a node fallback, making this the single exception to the jq/node fallback pattern.
- Fix: Add a node fallback for the timestamp extraction:
  ```bash
  if [ "$_HAS_JQ" = "true" ]; then
    MARKER_TS=$(jq '.timestamp // empty' "$MARKER_FILE" 2>/dev/null || true)
  else
    MARKER_TS=$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(j.timestamp)process.stdout.write(String(j.timestamp))" -- "$MARKER_FILE" 2>/dev/null || true)
  fi
  if [ -n "$MARKER_TS" ] && [ "$MARKER_TS" -gt 0 ] 2>/dev/null; then
    MARKER_AGE=$(( NOW - MARKER_TS ))
    if [ "$MARKER_AGE" -gt 86400 ]; then
      rm -f "$MARKER_FILE" 2>/dev/null || true
      continue
    fi
  fi
  ```

**`ensure-memory-gitignore` failure handling inconsistency** - `sidecar-capture:80`, `sidecar-dispatch:46`
**Confidence**: 85%
- Problem: `sidecar-capture` sources `ensure-memory-gitignore` with `|| exit 0` (abort on failure), while `sidecar-dispatch` sources it with `|| true` (swallow failure and continue). The established pattern in both predecessor hooks (`stop-update-memory` and `prompt-capture-memory`) is `|| exit 0`.
- Fix: Change sidecar-dispatch to match:
  ```bash
  # sidecar-dispatch:46
  source "$SCRIPT_DIR/ensure-memory-gitignore" "$CWD" || exit 0
  ```

**Redundant `mkdir -p` after `devflow_log_dir`** - `sidecar-evaluate:43`
**Confidence**: 92%
- Problem: `sidecar-evaluate` calls `mkdir -p "$(dirname "$LOG_FILE")"` immediately after `devflow_log_dir "$CWD"`, which already performs `mkdir -p "$dir"`. The extra `mkdir -p` is dead code. `sidecar-capture` does not have this redundant call.
- Fix: Remove line 43 from sidecar-evaluate:
  ```bash
  # Delete this line:
  mkdir -p "$(dirname "$LOG_FILE")"
  ```

**CWD validation pattern divergence** - `sidecar-evaluate:21-24`
**Confidence**: 80%
- Problem: sidecar-capture and sidecar-dispatch validate CWD with `if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then exit 0; fi` (single compound check). sidecar-evaluate splits this into two separate checks: `[ -z "$CWD" ] && exit 0` then `[ ! -d "$MEMORY_DIR" ] && exit 0`. The evaluate hook does not check `[ ! -d "$CWD" ]` — it relies on `$MEMORY_DIR` not existing. Functionally safe but violates the pattern.
- Fix: Add `[ ! -d "$CWD" ]` check to sidecar-evaluate for consistency:
  ```bash
  [ -z "$CWD" ] && exit 0
  [ ! -d "$CWD" ] && exit 0
  MEMORY_DIR="$CWD/.memory"
  [ ! -d "$MEMORY_DIR" ] && exit 0
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**SOH delimiter representation divergence** - `sidecar-capture:27` vs `json-parse:173`
**Confidence**: 80%
- Problem: `sidecar-capture` line 27 embeds a literal SOH (0x01) byte in the jq string, while `json_extract_cwd_prompt` in `json-parse` (which sidecar-dispatch uses) represents it as `` — the conventional jq unicode escape. Both produce identical output, but the literal byte is invisible in editors and diffs, making the code harder to maintain and review.
- Fix: Use `` in the jq string for sidecar-capture, matching `json_extract_cwd_prompt`:
  ```bash
  _FIELDS=$(printf '%s' "$INPUT" | jq -r '(.cwd // "") + "" + (.stop_reason // "") + "" + (.response_text // "")')
  ```
  Note: This also matches the old `stop-update-memory` hook which used the same literal byte, so this is a pre-existing pattern. Fixing it in the new hook prevents the pattern from propagating further.

## Pre-existing Issues (Not Blocking)

_No critical pre-existing issues identified._

## Suggestions (Lower Confidence)

- **TypeScript async vs sync fs API divergence** - `sidecar-config.ts` vs `decisions-config.ts` (Confidence: 65%) -- `sidecar-config.ts` uses async `fs.promises` while `decisions-config.ts` uses synchronous `fs.readFileSync`. Both are valid, but the project has two styles for config utilities. Not actionable for this PR since `sidecar-config.ts` follows the `sentinel.ts`/`manifest.ts` async pattern.

- **sidecar-dispatch has no logging** - `sidecar-dispatch` (Confidence: 70%) -- sidecar-dispatch is the only sidecar hook without a `log()` function. Its predecessor (`prompt-capture-memory`) also had none, and UserPromptSubmit hooks run on the hot path, so omitting logging is defensible as a performance choice. Consider adding lightweight logging gated behind a debug flag if dispatch issues are hard to diagnose.

- **Non-atomic marker writes could deliver partial JSON** - `sidecar-capture:150`, `sidecar-evaluate:272,338,397` (Confidence: 65%) -- All marker file writes use direct `> "$SIDECAR_DIR/{name}.json"` without temp+rename. If the process is interrupted mid-write, dispatch could read a partial JSON file. The risk is low (writes are small, single-operation) and the 24h expiry provides eventual cleanup, so the trade-off is reasonable. The queue overflow truncation at `sidecar-capture:110` does use temp+rename correctly.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 4 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The three sidecar hooks are structurally well-designed and share the core patterns (config reading via `json_field_file`, jq/node fallback for JSON construction, `SIDECAR_DIR`/`MEMORY_DIR` path construction, feature gating). The TypeScript utility (`sidecar-config.ts`) follows established project conventions. The main consistency issues are cosmetic divergences between the sibling hooks (log format, guard syntax/ordering, CWD validation style) and one functional gap (missing `memory` marker gating in dispatch, missing node fallback for marker expiry). None are critical, but normalizing them before merge would prevent these inconsistencies from becoming entrenched patterns.
