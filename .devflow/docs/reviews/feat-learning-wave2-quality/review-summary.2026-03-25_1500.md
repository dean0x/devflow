# Code Review Summary

**Branch**: feat-learning-wave2-quality → main
**Date**: 2026-03-25

## Merge Recommendation: CHANGES_REQUESTED

The PR introduces valuable improvements to the learning system (batching reduces LLM invocation frequency, reinforcement with cost-awareness, clearer naming). Tests are comprehensive (78 passing). However, **3 HIGH blocking issues** must be resolved before merge:

1. **Race condition in batch file handoff** (`mv` vs `cp+rm`) — can lose session IDs or trigger duplicate runs
2. **`hasLearningHook` does not detect legacy Stop hook** — causes confusing status output for upgrading users
3. **`docs/reference/file-organization.md` not updated** — documentation contradicts the new behavior

Additionally, **2 HIGH performance issues** in the synchronous SessionEnd path should be addressed (per-line subprocess spawning that blocks session exit).

---

## Issue Summary by Category

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking** (your changes) | 0 | 5 | 10 | 0 | 15 |
| **Should Fix** (code you touched) | 0 | 0 | 8 | 1 | 9 |
| **Pre-existing** (legacy code) | 0 | 1 | 5 | 1 | 7 |

**Total Issues**: 31 (15 blocking, 9 should-fix, 7 pre-existing)

---

## HIGH Blocking Issues (Must Fix)

### 1. Race Condition: Batch File Handoff (Affects: Architecture, Security)
**Locations**: `scripts/hooks/session-end-learning:190-192`, plus `scripts/hooks/background-learning:156-181`
**Confidence**: 85-92%

**Problem**: The `cp + rm -f` sequence for moving the session count file to the batch IDs file is not atomic:
```bash
cp "$SESSION_COUNT_FILE" "$BATCH_IDS_FILE"   # line 190
rm -f "$SESSION_COUNT_FILE"                    # line 192
```

If two sessions end simultaneously and both reach the "batch full" check, the second can read a stale/partial file between the `cp` and `rm`, causing:
- Duplicate batch runs (wasted LLM API calls)
- Lost session IDs (incomplete pattern context)
- Data integrity concerns in concurrent usage

**Impact**: CRITICAL for correctness in multi-session environments

**Fix**: Use `mv` (atomic on same filesystem) instead:
```bash
mv "$SESSION_COUNT_FILE" "$BATCH_IDS_FILE"
```

---

### 2. Status Detection Broken for Legacy Users (Affects: Regression)
**Location**: `src/cli/commands/learn.ts:131-141`
**Confidence**: 85%

**Problem**: `hasLearningHook()` only checks `settings.hooks.SessionEnd` for the new marker. Users who installed learning before this PR have the hook under `settings.hooks.Stop` with marker `stop-update-learning`. After upgrading the CLI (before manual migration), `--status` shows `Self-learning: disabled (hook not registered)` even though the deprecated Stop hook still executes.

**Impact**: Confusing upgrade experience; users don't know learning is broken or that they need to run `--disable && --enable`

**Fix**: Detect the legacy marker as a "needs upgrade" state:
```typescript
export function hasLearningHook(settingsJson: string): boolean {
  const settings = JSON.parse(settingsJson);

  // Check for new SessionEnd hook
  if (settings.hooks?.SessionEnd?.some(hook => hook.includes('session-end-learning'))) {
    return true;
  }

  // Check for legacy Stop hook and report upgrade needed
  if (settings.hooks?.Stop?.some(hook => hook.includes('stop-update-learning'))) {
    return 'legacy'; // or update --status to show "needs upgrade"
  }

  return false;
}
```

Also ensure `addLearningHook` calls `removeLearningHook` first to auto-upgrade:
```typescript
export function addLearningHook(settingsJson: string, devflowDir: string): string {
  let cleaned = removeLearningHook(settingsJson);
  // ... add SessionEnd hook ...
}
```

---

### 3. Documentation Outdated: Hook Rename Not Reflected (Affects: Documentation, Regression)
**Locations**:
- `docs/reference/file-organization.md:50` (file tree)
- `docs/reference/file-organization.md:157` (narrative)
- `docs/reference/file-organization.md:146` (event type reference)

**Confidence**: 90-92%

**Problem**: Reference docs still reference `stop-update-learning` as a Stop hook, when PR renamed it to `session-end-learning` on SessionEnd event. Active code-comment drift.

**Impact**: Developers consulting reference docs get incorrect information about learning system architecture

**Fix**: Update all three references:
```markdown
# Line 50: File tree
session-end-learning     # SessionEnd hook: triggers background learning

# Line 146: Event type reference
Learning SessionEnd hook

# Line 157: Narrative
A fourth hook (`session-end-learning`) provides self-learning. Toggleable via...
```

---

## HIGH Performance Issues (Should Fix)

### 4. Per-Line Subprocess Spawning in SessionEnd Hook (Affects: Performance, Complexity)
**Location**: `scripts/hooks/session-end-learning:108-131` (`reinforce_loaded_artifacts`)
**Confidence**: 92% (both performance & complexity reviews flagged)

**Problem**: `reinforce_loaded_artifacts()` iterates `learning-log.jsonl` with `while read` loop, spawning 2-3 `jq` subprocesses per line (calls `json_field` for status, artifact_path, and conditionally json_update). With 50+ observations, this is 100-300 subprocesses in the synchronous SessionEnd hook path.

**Impact**: Measurable latency (0.5-2s) added to session exit. Repeats PF-006 anti-pattern.

**Fix**: Use single-pass `jq -s` (slurp) operation:
```bash
reinforce_loaded_artifacts() {
  local learning_log="$MEMORY_DIR/learning-log.jsonl"
  [ ! -f "$learning_log" ] && return

  local loaded
  loaded=$(grep -oE 'self-learning[:/][a-z0-9-]+' "$TRANSCRIPT" 2>/dev/null | sort -u || true)
  [ -z "$loaded" ] && return

  local now_iso
  now_iso=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

  # Single jq pass to update all matching entries
  jq -c --arg now "$now_iso" --arg pat "$(echo "$loaded" | tr '\n' '|' | sed 's/|$//')" '
    if .status == "created" and .artifact_path and (.artifact_path | test($pat))
    then .last_seen = $now else . end
  ' "$learning_log" > "${learning_log}.tmp" && mv "${learning_log}.tmp" "$learning_log"
}
```

---

### 5. Per-Line Subprocess Spawning in Batch Message Extraction (Affects: Performance)
**Location**: `scripts/hooks/background-learning:166-177` (`extract_batch_messages`)
**Confidence**: 90%

**Problem**: Extracts user messages from transcripts with per-line subprocess spawning via `grep | while read | json_extract_messages`. With 3 sessions × 50 messages = 150 subprocess spawns. While background process doesn't block user, it extends lock hold time.

**Impact**: MEDIUM (background path, but increases overall system latency)

**Fix**: Single-pass jq extraction:
```bash
session_msgs=$(grep '"type":"user"' "$transcript" 2>/dev/null | \
  jq -rs '[.[] | if .message.content then
    if (.message.content | type) == "string" then .message.content
    else [.message.content[] | select(.type == "text") | .text] | join("\n")
    end
  else "" end] | map(select(. != "")) | join("\n")' 2>/dev/null || true)
```

---

## MEDIUM Blocking Issues (Should Fix, 10 total)

### CWD Encoding Inconsistency (2 reviews flagged)
**Locations**: `scripts/hooks/session-end-learning:63` vs `scripts/hooks/background-learning:154-155`
**Confidence**: 85-95%

Two different encoding implementations for the same concern create fragility:
- `session-end-learning`: `sed 's|/|-|g'` (turns `/Users/dean` → `-Users-dean`)
- `background-learning`: `sed 's|^/||' | tr '/' '-'` plus prepend `-`

Currently produce same result by accident, but divergent implementations can diverge with maintenance. Extract shared function.

---

### Log Timestamp Format Mismatch (2 reviews flagged)
**Location**: `scripts/hooks/session-end-learning:55` vs `scripts/hooks/background-learning:27`
**Confidence**: 90%

`session-end-learning` uses `date '+%H:%M:%S'` (local time, short format), while all other hooks use `date -u '+%Y-%m-%dT%H:%M:%SZ'` (UTC ISO 8601). Interleaved log entries will have mismatched formats.

**Fix**: Align to ISO 8601 UTC in session-end-learning.

---

### Shell Syntax Inconsistencies (3 separate issues)
**Confidence**: 80-85%

1. **Sourcing syntax** (`session-end-learning:21`): Uses `. "$SCRIPT_DIR/json-parse"` (POSIX dot) while all other hooks use `source` (bash)
2. **Shell strictness** (`session-end-learning:12`): Uses `set -euo pipefail` while others use `set -e` only
3. **Background process cleanup** (`session-end-learning:200`): Missing `disown` after `nohup ... &` spawn

---

### Missing `disown` After Background Process
**Location**: `scripts/hooks/session-end-learning:200`
**Confidence**: 80%

Standard pattern in `stop-update-memory:83` includes `disown` to decouple background job from shell. New hook omits this.

**Fix**:
```bash
DEVFLOW_BG_LEARNER=1 nohup bash "$SCRIPT_DIR/background-learning" ... &
disown
```

---

### `ART_NAME` Sanitization Incomplete + `ART_DESC` Not Escaped
**Locations**: `scripts/hooks/background-learning:592` (touched), `632,640` (new)
**Confidence**: 82-83%

1. **ART_NAME**: `tr -d '/' | sed 's/\.\.//g'` strips `/` and `..` but misses spaces, backticks, shell metacharacters, and doesn't catch `....` (becomes `..` after one pass)
2. **ART_DESC**: Interpolated unescaped into YAML frontmatter; model-generated content could contain `"` or special YAML characters

**Fix**: Use allowlist approach for ART_NAME:
```bash
ART_NAME=$(echo "$ART_NAME" | tr -cd 'a-z0-9-')
if [ -z "$ART_NAME" ] || [ ${#ART_NAME} -gt 50 ]; then
  log "Skipping artifact with empty/invalid name"
  continue
fi
```

Escape ART_DESC:
```bash
ART_DESC=$(echo "$ART_DESC" | sed 's/"/\\"/g' | tr -d '\n')
```

---

### `increment_daily_counter` Dead Code
**Locations**: `scripts/hooks/background-learning:131-138`
**Confidence**: 80-88%

Function still defined but never called (replaced by comment "daily counter already incremented by session-end-learning"). Remove the 8-line dead function.

---

### Session ID Not Validated Before Appending
**Location**: `scripts/hooks/session-end-learning:162`
**Confidence**: 80%

`SESSION_ID` extracted from hook JSON and appended directly without format validation. While source is trusted (Claude runtime), malformed ID with embedded newlines could inflate batch count.

**Fix**: Validate format:
```bash
if ! echo "$SESSION_ID" | grep -qE '^[a-zA-Z0-9_-]+$'; then
  log "Invalid session ID format, skipping"
  exit 0
fi
echo "$SESSION_ID" >> "$SESSION_COUNT_FILE"
```

---

### Batch Size Config Field Undocumented
**Location**: `scripts/hooks/session-end-learning:47`
**Confidence**: 82%

`batch_size` field (default 3) is read from `learning.json` but:
- Not documented in CLAUDE.md or README
- Not in `LearningConfig` TypeScript interface
- Not exposed in `--configure` wizard

Users can't discover or validate this option.

**Fix**: Add to `LearningConfig` interface and `--configure` prompt, or document that it's shell-only and users must edit `learning.json` manually.

---

### CHANGELOG.md Missing Wave 2 Entries
**Location**: `CHANGELOG.md:8-13`
**Confidence**: 85%

`[Unreleased]` section does not document significant behavioral changes:
- SessionEnd batching (every 3 sessions instead of every Stop)
- Procedural threshold raised 2→3
- Temporal spread now required for both types
- Daily runs default 10→5
- Naming changed `learned-*` to `self-learning:*`
- Hook renamed Stop→SessionEnd

**Fix**: Add entries explaining each change as user-facing behavioral changes.

---

## MEDIUM "Should Fix" Issues (8 total)

### Process-Observations High Complexity
**Location**: `scripts/hooks/background-learning:445-573`
**Confidence**: 92%

128-line function with ~15 cyclomatic complexity, 4-5 nesting levels. Handles 8+ responsibilities (field validation, confidence calc, temporal spread, JSON construction, file updates). Duplicate temporal spread calculation within same function.

**Fix**: Extract into focused helpers (`validate_observation`, `calculate_confidence`, `check_temporal_spread`, `update_existing_obs`, `create_new_obs`).

---

### `background-learning` 724-Line God Script
**Location**: `scripts/hooks/background-learning` (entire file)
**Confidence**: 88-90%

File length critical threshold exceeded. Concentrates 15+ functions: locking, config, transcript extraction, decay, LLM invocation, response processing, observation CRUD, artifact creation. PF-004 identified this concern; PR made it worse.

**Long-term fix**: Move JSON-heavy logic to TypeScript (per PF-004 resolution). Short-term: avoid adding more responsibilities to this script.

---

### Test Coverage Gaps (3 tests missing)
**Locations**:
- `src/cli/commands/learn.ts:175-182` (no test for `loadAndCountObservations`)
- `scripts/hooks/json-helper.cjs:179-182` (no test for string content path in `extract-text-messages`)
- `scripts/hooks/json-helper.cjs:309-315` (no test for `learning-new` naming change)

**Confidence**: 80-85%

New exported function and code paths have zero test coverage. User-facing outputs (invalid entry counts, artifact naming) could regress silently.

---

### Additional MEDIUM Issues
- **`addLearningHook` not cleaning up legacy Stop hook** (Consistency, Regression)
- **`create_artifacts` 85-line function with 4 nesting levels** (Complexity)
- **`build_sonnet_prompt` 90-line embedded heredoc** (Complexity/Maintainability)
- **`session-end-learning` main body not extracted to function** (Complexity)
- **`learnCommand.action()` 283-line handler** (Complexity, pre-existing)

---

## Strengths of This PR

1. **Architectural improvement**: Batching reduces LLM invocation frequency (good for cost and latency)
2. **Reinforcement feature**: Cost-aware pattern reinforcement without extra LLM calls
3. **Naming clarity**: Transition from `learned-*` to `self-learning:*` prefix is consistent and searchable
4. **Migration support**: `removeLearningHook` properly cleans both old and new hook formats
5. **Test coverage**: 78 passing tests including new legacy cleanup tests
6. **Documentation updated**: CLAUDE.md, README.md, and core docs accurately describe new behavior
7. **Threshold hardening**: Procedural and workflow thresholds now aligned (3 observations, 24h+ spread)

---

## Action Plan

### Before Merge (Blocking)

1. **Fix race condition** — Use `mv` instead of `cp + rm` for batch file handoff
2. **Detect legacy hook upgrade** — Have `hasLearningHook` return state indicating "needs upgrade" or auto-upgrade in `addLearningHook`
3. **Update documentation** — Sync `docs/reference/file-organization.md` with `session-end-learning` hook rename
4. **Fix per-line subprocess spawning** — Replace while-read loops with single-pass jq in:
   - `reinforce_loaded_artifacts` (synchronous SessionEnd path)
   - `extract_batch_messages` (background batching path)

### Recommended (HIGH/MEDIUM impact)

5. Align shell syntax (sourcing, strictness flags, disown)
6. Align CWD encoding and log timestamp formats
7. Remove dead `increment_daily_counter` function
8. Add missing test coverage for `loadAndCountObservations`, `extract-text-messages` string path, `learning-new`
9. Add CHANGELOG.md entries for behavioral changes
10. Document or expose `batch_size` config option

### Consider (MEDIUM priority)

11. Extract `process_observations` into focused helpers
12. Move Sonnet prompt template to external file
13. Extract `session-end-learning` batching logic into testable functions
14. Add `session ID` format validation

---

## Review Scores Summary

| Discipline | Score | Key Issues |
|-----------|-------|-----------|
| **Architecture** | 6/10 | Race condition, split daily cap ownership, CWD encoding DRY violation |
| **Complexity** | 5/10 | `process_observations` 128 lines, duplicate temporal spread, god script growth |
| **Consistency** | 5/10 | CWD encoding, log format, sourcing syntax, shell strictness, disown patterns |
| **Documentation** | 6/10 | file-organization.md outdated, CHANGELOG missing, batch_size undocumented |
| **Performance** | 5/10 | Per-line subprocess spawning in synchronous & background paths, PF-006 reintroduced |
| **Regression** | 7/10 | Legacy hook detection broken for `--status`, behavioral changes undocumented |
| **Security** | 7/10 | Race condition, unescaped model output, incomplete sanitization |
| **Tests** | 6/10 | Missing tests for new function, new code paths, new operation naming |

**Average Score**: 6.1/10

---

## Recommendation Summary

**Status**: CHANGES_REQUESTED

The PR's core improvements (batching, reinforcement, naming) are valuable and well-tested. However, **3 HIGH blocking issues require resolution**:
1. Race condition in batch file handoff
2. Legacy hook detection broken for upgrading users
3. Documentation drift in reference docs

Additionally, **2 HIGH performance issues** in the synchronous path should be addressed (per-line subprocess spawning that blocks session exit).

With these fixes applied, the PR will be ready for merge. The recommendation moves from `CHANGES_REQUESTED` to `APPROVED` once blocking issues are resolved.
