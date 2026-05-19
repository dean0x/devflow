# Code Review Summary

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Reviewers**: Security, Reliability, Concurrency, Architecture, Complexity, Testing, Regression, Consistency

---

## Merge Recommendation: BLOCK MERGE

**Reason**: Multiple CRITICAL concurrency issues that will silently discard learning/decisions data in multi-session environments, plus HIGH-severity migration regressions that break feature toggles for existing users.

---

## Score: 5.6/10

Overall quality is undermined by latent concurrency bugs (marker overwrites, queue race conditions) and incomplete migration handling (sentinel desync, stale state paths, orphan hooks).

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking (Your Changes) | 2 | 13 | 12 | 0 | **27** |
| Should Fix (Code You Touched) | 0 | 1 | 5 | 0 | **6** |
| Pre-existing (Not Your Changes) | 0 | 0 | 2 | 0 | **2** |
| **TOTAL** | **2** | **14** | **19** | **0** | **35** |

---

## BLOCKING ISSUES (Must Fix Before Merge)

### CRITICAL (2)

#### ISSUE-1: Queue File Append Interleaving — `.pending-turns.jsonl`
**Source**: Concurrency  
**Severity**: CRITICAL  
**Confidence**: 95%  
**File**: `scripts/hooks/sidecar-capture:100,109-111` | `scripts/hooks/sidecar-dispatch:63`

Two concurrent sessions appending to the queue file can lose data during overflow truncation. Session A starts `tail+mv` while Session B appends — Session B's `>>` redirection may target the old inode after the `mv` completes, silently losing the append. Additionally, two concurrent overflow truncations can clobber each other's `.tmp` file, losing the second session's truncated output entirely.

**Fix**: Use PID-unique temp file for truncation, or move truncation into the sidecar background agent:
```bash
TRUNC_TMP="$QUEUE_FILE.trunc.$$"
tail -100 "$QUEUE_FILE" > "$TRUNC_TMP" && mv "$TRUNC_TMP" "$QUEUE_FILE"
```

---

#### ISSUE-2: Marker Overwrite Between sidecar-evaluate and Model Rename
**Source**: Concurrency  
**Severity**: CRITICAL  
**Confidence**: 92%  
**File**: `scripts/hooks/sidecar-evaluate:272,338,397`

Session A's `learning.json` (learning analysis payload) is silently overwritten by Session B if both sessions end within seconds of each other (realistic scenario: user closes 3 tabs). The first session's learning data, decisions data, and knowledge data are permanently lost. The same race applies to `memory.json`, `decisions.json`, and `knowledge.json`.

**Fix**: Use per-session marker filenames instead of per-task filenames:
```bash
learning.{session_id}.json  # or learning.{timestamp}.{pid}.json
```
Update dispatch to glob on prefix (`learning.*.json`) and batch-process all matching files.

---

### HIGH (13)

#### ISSUE-3: Unsanitized Arithmetic Input from `.knowledge-last-refresh` File
**Source**: Security, Reliability  
**Severity**: HIGH  
**Confidence**: 90-95%  
**File**: `scripts/hooks/sidecar-evaluate:374-376`

`LAST_REFRESH` is read from file and used directly in bash arithmetic without sanitization. Non-numeric content causes arithmetic evaluation to fail under `set -e`, killing the entire hook and preventing learning/decisions markers from being written.

**Fix**: Sanitize with `tr -dc '0-9'`:
```bash
LAST_REFRESH=$(cat "$KNOWLEDGE_MARKER" 2>/dev/null | tr -dc '0-9' || true)
LAST_REFRESH="${LAST_REFRESH:-0}"
```

---

#### ISSUE-4: Predictable Temp File Path Without Symlink Protection in Queue Truncation
**Source**: Security  
**Severity**: HIGH  
**Confidence**: 82%  
**File**: `scripts/hooks/sidecar-capture:110`

Shell `>` follows symlinks. If a symlink exists at `$QUEUE_FILE.tmp`, the redirection overwrites the symlink target. Use `mktemp` or atomic temp file with PID:
```bash
TMPFILE=$(mktemp "$QUEUE_FILE.XXXXXX") && tail -100 "$QUEUE_FILE" > "$TMPFILE" && mv "$TMPFILE" "$QUEUE_FILE"
```

---

#### ISSUE-5: Entire `learning-log.jsonl` Captured into Shell Variable
**Source**: Reliability  
**Severity**: HIGH  
**Confidence**: 85%  
**File**: `scripts/hooks/sidecar-evaluate:144`

The entire learning log is captured into a shell variable, piped multiple times, and may exceed `ARG_MAX` limits after hundreds of sessions. Use a temp file instead:
```bash
TEMP_LOG="${LEARNING_LOG}.tmp"
jq -c ... "$LEARNING_LOG" > "$TEMP_LOG"
# Process from file, not variable
```

---

#### ISSUE-6: `.failed` Marker Files Accumulate Indefinitely
**Source**: Reliability  
**Severity**: HIGH  
**Confidence**: 90%  
**File**: `scripts/hooks/sidecar-dispatch:111`

When `.processing` files exceed `MAX_RETRIES`, they are renamed to `.failed` and never cleaned up. No visibility or retry path exists. Add 7-day cleanup:
```bash
for FAILED_FILE in "$SIDECAR_DIR"/*.failed; do
  FAILED_AGE=$(( NOW - $(get_mtime "$FAILED_FILE") ))
  [ "$FAILED_AGE" -gt 604800 ] && rm -f "$FAILED_FILE" 2>/dev/null || true
done
```

---

#### ISSUE-7: Daily Run Counter Lost-Update — `.learning-runs-today`, `.decisions-runs-today`
**Source**: Concurrency  
**Severity**: HIGH  
**Confidence**: 90%  
**File**: `scripts/hooks/sidecar-evaluate:284,350`

Two concurrent sessions both read `RUNS_TODAY=2`, both write `3`. The cap is effectively reduced by 1 for each collision. Use atomic increment with lock:
```bash
if mkdir "$RUNS_FILE.lock" 2>/dev/null; then
  RUNS_TODAY=$(read_daily_cap "$RUNS_FILE" 0)
  printf '%s\t%d\n' "$TODAY" "$((RUNS_TODAY + 1))" > "$RUNS_FILE"
  rmdir "$RUNS_FILE.lock"
fi
```

---

#### ISSUE-8: Session Count File Append-Then-Read Race
**Source**: Concurrency  
**Severity**: HIGH  
**Confidence**: 88%  
**File**: `scripts/hooks/sidecar-evaluate:245,250`

With `BATCH_SIZE=3`, sessions A, B, C all append, all read `CURRENT_COUNT=3`, all write markers (C wins overwrite), all delete `.learning-sessions`. Result: only session C's transcript analyzed, A/B's learning signals lost. Use lock around check-and-clear.

---

#### ISSUE-9: Learning Log Reinforcement Read-Modify-Write Race
**Source**: Concurrency  
**Severity**: HIGH  
**Confidence**: 85%  
**File**: `scripts/hooks/sidecar-evaluate:143-163`

Two concurrent sidecar-evaluate instances read the log, both write to the same `${LEARNING_LOG}.tmp`, one overwrites the other. Fix: use PID-unique temp:
```bash
TEMP_LOG="${LEARNING_LOG}.tmp.$$"
```

---

#### ISSUE-10: session-start-context Learning Sentinel Desync
**Source**: Regression  
**Severity**: HIGH  
**Confidence**: 95%  
**File**: `scripts/hooks/session-start-context:34,80` | `src/cli/commands/learn.ts:684-704`

`session-start-context` still checks the old `.memory/.learning-disabled` sentinel, but `devflow learn --enable/--disable` no longer creates/removes it. Disable requests are silently ignored. Fix: update session-start-context to read sidecar config instead:
```bash
LEARNING_ENABLED="true"
SIDECAR_CONFIG="$CWD/.memory/.sidecar/config.json"
if [ -f "$SIDECAR_CONFIG" ]; then
  LEARNING_ENABLED=$(json_field_file "$SIDECAR_CONFIG" "learning" "true")
fi
```

---

#### ISSUE-11: Stale State File Paths in `--reset`
**Source**: Regression  
**Severity**: HIGH  
**Confidence**: 92%  
**File**: `src/cli/commands/learn.ts:408-416` | `src/cli/commands/decisions.ts:405-411`

`devflow learn --reset` looks for state files at `.memory/.learning-runs-today` but sidecar-evaluate writes them to `.memory/.sidecar/.learning-runs-today`. After reset, sidecar state persists and daily cap remains active. Fix: update transient file lists to include sidecar paths.

---

#### ISSUE-12: Orphan Old Hooks in settings.json on Upgrade
**Source**: Regression  
**Severity**: HIGH  
**Confidence**: 90%  
**File**: `src/cli/commands/init.ts:1070-1074`

Users upgrading will have orphan hooks (`prompt-capture-memory`, `stop-update-memory`, `session-end-learning`, `session-end-decisions`, `session-end-knowledge-refresh`) registered in settings.json but with non-existent scripts. These hooks fire but fail silently. Fix: add legacy hooks to `LEGACY_HOOK_FILES` list in init.ts.

---

#### ISSUE-13: CLAUDE.md Not Updated to Reflect Sidecar Architecture
**Source**: Architecture  
**Severity**: HIGH  
**Confidence**: 95%  
**File**: `CLAUDE.md`

Five sections still describe the pre-sidecar system (old hook names, `mv`-based atomic handoff, `mkdir`-based lock, `.working-memory-disabled` sentinel). Any agent or developer reading CLAUDE.md forms an incorrect mental model. Must update to describe: 3 sidecar hooks + 2 retained hooks + sidecar config.json toggle + marker-file dispatch.

---

#### ISSUE-14: No `O_EXCL` Protection on Memory Marker Write
**Source**: Security  
**Severity**: HIGH  
**Confidence**: 80%  
**File**: `scripts/hooks/sidecar-capture:150,159`

Shell `>` follows symlinks. Write to temp file first, then `mv`:
```bash
jq -n ... > "$SIDECAR_DIR/memory.json.tmp" && mv "$SIDECAR_DIR/memory.json.tmp" "$SIDECAR_DIR/memory.json"
```

---

#### ISSUE-15: Marker Expiry Only Enforced When jq is Available
**Source**: Security  
**Severity**: HIGH  
**Confidence**: 85%  
**File**: `scripts/hooks/sidecar-dispatch:142`

When jq is absent, markers never expire. Resource consumption vector — stale markers trigger unnecessary API calls indefinitely. Add node fallback for timestamp extraction.

---

### MEDIUM (12)

#### ISSUE-16: sidecar-evaluate is a 415-line Monolithic Script
**Source**: Complexity, Architecture  
**Severity**: MEDIUM  
**Confidence**: 92-85%  
**File**: `scripts/hooks/sidecar-evaluate:1-415`

Contains four independent evaluation domains (artifact reinforcement, learning, decisions, knowledge) with no decomposition. Exceeds 300-line maintainability threshold. Extract each into sourced helper or separate evaluator script. Each section is already delimited by banners and gated by `*_ENABLED` flags.

---

#### ISSUE-17: Artifact Reinforcement Section Has 5-Level Nesting Depth
**Source**: Complexity  
**Severity**: MEDIUM  
**Confidence**: 90%  
**File**: `scripts/hooks/sidecar-evaluate:132-196`

Deepest indentation reaches 8 spaces with combined shell + jq + bash nesting. Extract to function with early returns to flatten to depth 0.

---

#### ISSUE-18: 11 jq/node Dual-Path Branches Across Three Hooks
**Source**: Complexity  
**Severity**: MEDIUM  
**Confidence**: 85%  
**File**: Multiple locations in sidecar hooks

Every JSON operation doubles code surface. Add `json_write_marker` helper to eliminate 6 marker-writing branches in sidecar-evaluate.

---

#### ISSUE-19: Log File Rotation Missing
**Source**: Reliability  
**Severity**: MEDIUM  
**Confidence**: 85%  
**File**: `sidecar-capture:87` | `sidecar-evaluate:44`

Log files grow unbounded (on every assistant turn / session end). Add size check before logging. If >1MB, truncate to last 500 lines.

---

#### ISSUE-20: Non-Atomic Marker Writes Can Produce Corrupt JSON on Kill
**Source**: Reliability  
**Severity**: MEDIUM  
**Confidence**: 82%  
**File**: `sidecar-capture:150` | `sidecar-evaluate:267,332,390`

Direct write to final path (no temp+rename). If process killed mid-write, next sidecar-dispatch reads corrupt JSON. Use tmp+rename pattern.

---

#### ISSUE-21: Learning and Decisions Log Files Have No Growth Bounds
**Source**: Reliability  
**Severity**: MEDIUM  
**Confidence**: 80%  
**File**: `sidecar-evaluate:263,329`

Files grow unbounded and are read entirely into memory for deduplication. Cap ID list to 200 most recent observations.

---

#### ISSUE-22: `.learning-sessions` File Can Grow Unbounded
**Source**: Reliability  
**Severity**: MEDIUM  
**Confidence**: 80%  
**File**: `sidecar-evaluate:245`

Only cleared when batch threshold met and marker successfully written. If transcript filter fails, file grows indefinitely. Add cap at 50 lines.

---

#### ISSUE-23: `get_mtime` Returns Empty String on Missing File, Causing Arithmetic Failure
**Source**: Reliability  
**Severity**: MEDIUM  
**Confidence**: 85%  
**File**: `sidecar-capture:137`

No fallback when `stat` fails. Add `LAST_UPDATE="${LAST_UPDATE:-0}"` after `get_mtime`.

---

#### ISSUE-24: Dual-Toggle Inconsistency: decisions Uses Sentinel AND Config, Others Use Config Only
**Source**: Architecture  
**Severity**: MEDIUM  
**Confidence**: 82%  
**File**: `src/cli/commands/decisions.ts:812-836`

Two features (decisions, knowledge) have dual-toggle (sentinel + config), two (memory, learning) have single-toggle (config only). No centralized documentation of which hooks read which source of truth. Add "Toggle Sources of Truth" table to CLAUDE.md.

---

#### ISSUE-25: Learning and Decisions Evaluation Sections Follow Near-Identical Structural Pattern
**Source**: Complexity  
**Severity**: MEDIUM  
**Confidence**: 80%  
**File**: `scripts/hooks/sidecar-evaluate:202-295,301-357`

~30 lines of duplication in daily cap check, signal extraction, marker write sequence. Parameterized function could share logic.

---

#### ISSUE-26: `json_field` Interpolates Field Name Directly Into jq Filter String
**Source**: Security  
**Severity**: MEDIUM  
**Confidence**: 82%  
**File**: `scripts/hooks/json-parse:29,40`

Not exploitable today (hardcoded field names), but future callers with untrusted input would be vulnerable. Use `--arg` for field name.

---

#### ISSUE-27: Log Format String Inconsistency Across Sibling Hooks
**Source**: Consistency  
**Severity**: MEDIUM  
**Confidence**: 90%  
**File**: `sidecar-capture:87` vs `sidecar-evaluate:44`

`sidecar-capture` uses `[sidecar-capture]`, `sidecar-evaluate` uses `sidecar-evaluate:`. Standardize on colon format.

---

#### Additional MEDIUM Issues (Consistency):
- **ISSUE-28**: Guard clause syntax inconsistency (`if...then exit` vs `&& exit`)
- **ISSUE-29**: Guard clause ordering inconsistency (UPDATER/LEARNER vs LEARNER/UPDATER)
- **ISSUE-30**: Missing `memory` marker gating in dispatch feature check
- **ISSUE-31**: Marker expiry node fallback missing
- **ISSUE-32**: `ensure-memory-gitignore` failure handling inconsistency
- **ISSUE-33**: Redundant `mkdir -p` in sidecar-evaluate
- **ISSUE-34**: CWD validation pattern divergence
- **ISSUE-35**: SOH delimiter representation divergence

---

## Cross-Cutting Themes

### 1. **Concurrency Safety Regression** (appears in Concurrency, Testing, Reliability)
The sidecar system replaced the old `mkdir`-based locking with last-writer-wins for all shared files. This introduces 2 CRITICAL and 3 HIGH concurrency bugs (marker overwrites, queue truncation race, counter lost-updates, session batch race, log reinforcement race) that are **absent from the pre-sidecar system**. The old background-memory-update hook used a 90-second acquisition timeout with stale-lock detection; this protection was not replicated.

**Impact**: Multi-session environments will silently discard learning/decisions data. Regression from the pre-sidecar system's serialization guarantees.

### 2. **Marker Atomicity Pattern** (appears in Security, Reliability, Consistency)
Multiple marker files are written without temp+rename pattern (memory.json, learning.json, decisions.json, knowledge.json, marker expiry). While crash-safety is the immediate concern, the pattern is also inconsistent with decisions-usage-scan.cjs which correctly uses `O_EXCL` writes.

### 3. **Unbounded Growth Paths** (appears in Reliability)
Five state files accumulate indefinitely: `.failed` markers, log files, learning-log.jsonl, decisions-log.jsonl, `.learning-sessions`. No cleanup or rotation mechanism.

### 4. **Incomplete Migration** (appears in Regression)
Three HIGH-severity issues broke feature toggles and state cleanup for upgrading users:
- sentinel-to-config transition incomplete (session-start-context still checks old sentinel)
- reset commands look for state at old paths
- orphan hooks left in settings.json after upgrade

### 5. **Dual-Code-Path Maintenance Burden** (appears in Complexity, Consistency)
11 jq/node dual-path branches require synchronized maintenance. No test ensures both paths produce identical output. The jq/node duality increases code surface by ~60 lines across the three hooks and is a source of subtle inconsistencies (guard syntax, ordering, marker expiry fallback).

---

## Positive Notes

✓ **Core Architecture Sound**: The 3-hook sidecar system (capture/dispatch/evaluate) maps cleanly to Claude Code hook lifecycle and is a net simplification.

✓ **Marker-Based Coordination**: Filesystem-native coordination between evaluate and dispatch is elegant and naturally crash-recoverable.

✓ **Config-Based Feature Toggles**: sidecar config.json as single source of truth for feature toggles is a clear improvement over scattered sentinels.

✓ **Strong Fundamentals in Tests**: Tests demonstrate behavioral testing approach, good isolation, clear AAA structure, and comprehensive happy-path coverage.

✓ **Input Sanitization Awareness**: Config values sanitized with `tr -dc '0-9'` before arithmetic, `RESPONSE_TEXT`/`PROMPT` safely passed via `--arg`.

✓ **Feedback Loop Prevention**: All three hooks check `DEVFLOW_BG_*` environment variables to prevent recursive invocation.

---

## Deduplication

Several issues appear across multiple reviewers but represent the same underlying bug:

- **Unsanitized `LAST_REFRESH` arithmetic** — flagged by Security (90%), Reliability (95%), Concurrency (n/a). Single issue, boosted confidence to 95%.
- **Marker overwrites in concurrent sessions** — flagged by Concurrency (92%), Testing (mentions untested concurrency), Reliability (mentions marker corruption). CRITICAL severity, consolidated to ISSUE-2.
- **Log file growth** — flagged by Reliability (no rotation), Architecture (mentions disk accumulation). Consolidated to ISSUE-19.
- **Queue truncation race** — flagged by Concurrency (95%), Security (symlink follow risk 82%). CRITICAL + HIGH combined into ISSUE-1.
- **jq/node dual-path branches** — flagged by Complexity (85%), Consistency (not a separate issue). Consolidated to ISSUE-18.

---

## Action Plan

### Phase 1: Fix CRITICAL Issues (Days 1-2)
1. ✅ Replace marker files with per-session naming (ISSUE-2)
2. ✅ Add PID-unique temp files for queue truncation (ISSUE-1)
3. ✅ Sanitize `LAST_REFRESH` (ISSUE-3)

### Phase 2: Fix HIGH Concurrency Issues (Days 2-3)
4. ✅ Add atomic locking for daily caps (ISSUE-7)
5. ✅ Add atomic locking for session count check-and-clear (ISSUE-8)
6. ✅ PID-unique temp for artifact reinforcement (ISSUE-9)
7. ✅ Fix session-start-context sentinel desync (ISSUE-10)
8. ✅ Fix `--reset` state file paths (ISSUE-11)

### Phase 3: Fix HIGH Security/Reliability Issues (Day 3)
9. ✅ Add symlink protection to marker writes (ISSUE-4, ISSUE-14)
10. ✅ Use temp file for learning-log capture (ISSUE-5)
11. ✅ Add `.failed` file cleanup (ISSUE-6)
12. ✅ Update orphan hook cleanup (ISSUE-12)

### Phase 4: Update Documentation (Day 4)
13. ✅ Update CLAUDE.md (ISSUE-13)
14. ✅ Add toggle sources of truth table (dual-toggle inconsistency)

### Phase 5: Address MEDIUM Issues (Days 4-5)
15. ✅ Extract sidecar-evaluate sections into helpers (ISSUE-16, ISSUE-17)
16. ✅ Flatten artifact reinforcement nesting
17. ✅ Add json_write_marker helper for dual-path elimination (ISSUE-18)
18. ✅ Add log rotation (ISSUE-19)
19. ✅ Cap unbounded files (ISSUE-21, ISSUE-22)
20. ✅ Normalize consistency issues across hooks (ISSUE-27 through ISSUE-35)

### Phase 6: Add Tests (Day 5)
21. ✅ Concurrency tests (queue race, dual-write markers, config race)
22. ✅ Feature-gating behavior tests
23. ✅ Marker expiry tests
24. ✅ Fix failing sentinel.test.ts
25. ✅ Update integration tests

---

## Confidence Levels

| Severity | Average Confidence |
|----------|-------------------|
| CRITICAL | 93% |
| HIGH | 88% |
| MEDIUM | 82% |

All CRITICAL and HIGH issues have clear reproduction scenarios and straightforward fixes documented by reviewers.
