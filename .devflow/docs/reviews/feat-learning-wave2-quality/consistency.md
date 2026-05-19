# Consistency Review Report

**Branch**: feat-learning-wave2-quality -> main
**Date**: 2026-03-25
**PR**: #162

## Issues in Your Changes (BLOCKING)

### CRITICAL

_(none)_

### HIGH

**CWD encoding inconsistency between session-end-learning and background-learning** - `scripts/hooks/session-end-learning:63`
**Confidence**: 95%
- Problem: `session-end-learning` encodes the CWD path as `sed 's|/|-|g'` which turns `/Users/dean/Sandbox` into `-Users-dean-Sandbox`, then references `$HOME/.claude/projects/$ENCODED_CWD` (no leading dash). Meanwhile `background-learning:154` uses `sed 's|^/||' | tr '/' '-'` which strips the leading slash first, then builds the path as `$HOME/.claude/projects/-${encoded_cwd}` (dash prepended). The two approaches produce different results:
  - `session-end-learning`: `~/.claude/projects/-Users-dean-Sandbox`
  - `background-learning`: `~/.claude/projects/-Users-dean-Sandbox`

  In practice, the `sed 's|/|-|g'` on `/Users/dean` yields `-Users-dean` and then `projects/$ENCODED_CWD` becomes `projects/-Users-dean`, which accidentally matches the other approach. However, the existing codebase pattern (`background-learning`, `background-memory-update`) consistently uses the `sed 's|^/||' | tr '/' '-'` plus `projects/-${encoded_cwd}` idiom. The new hook uses a different technique to achieve the same result, which is fragile and breaks the established pattern.
- Fix: Align with the existing encoding pattern:
```bash
# session-end-learning:63 — match background-learning pattern
ENCODED_CWD=$(echo "$CWD" | sed 's|^/||' | tr '/' '-')
PROJECTS_DIR="$HOME/.claude/projects/-${ENCODED_CWD}"
```

### MEDIUM

**Log timestamp format inconsistency** - `scripts/hooks/session-end-learning:55`
**Confidence**: 90%
- Problem: The `log()` function in `session-end-learning` uses `date '+%H:%M:%S'` (local time, HH:MM:SS only), while `background-learning:27` and all other hook scripts (`stop-update-memory:36`, `background-memory-update:27`) use `date -u '+%Y-%m-%dT%H:%M:%SZ'` (UTC, full ISO 8601). Since both scripts write to the same log file (`$LOG_FILE = .learning-update.log`), interleaved entries will have mismatched timestamp formats.
- Fix: Use the same ISO 8601 UTC format:
```bash
log() {
  if [ "$DEBUG" = "true" ]; then
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] session-end-learning: $1" >> "$LOG_FILE"
  fi
}
```

**Conditional logging vs unconditional logging inconsistency** - `scripts/hooks/session-end-learning:53`
**Confidence**: 85%
- Problem: `session-end-learning` wraps `log()` in a `if [ "$DEBUG" = "true" ]` guard, making all logging conditional on the debug flag. But `background-learning:26` always logs unconditionally. Both scripts share the same log file. This creates a confusing developer experience where background-learning always logs progress but the triggering hook is silent unless debug mode is on.
- Fix: Either make both conditional on DEBUG (preferred for production) or both unconditional. Recommend making both conditional since this is an internal debugging aid:
```bash
# background-learning log() — add DEBUG guard to match session-end-learning
log() {
  if [ "$DEBUG" = "true" ]; then
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $1" >> "$LOG_FILE"
  fi
}
```
Alternatively, if unconditional logging is desired for observability, remove the guard from session-end-learning.

**`source` vs `.` for sourcing scripts** - `scripts/hooks/session-end-learning:21`
**Confidence**: 85%
- Problem: `session-end-learning` uses `. "$SCRIPT_DIR/json-parse"` (POSIX dot syntax), while every other hook script (`background-learning:17`, `background-memory-update:18`, `session-start-memory:13`, `stop-update-memory:18`, `ambient-prompt:12`) uses `source "$SCRIPT_DIR/json-parse"`. Both are functionally equivalent in bash, but the codebase consistently uses `source`.
- Fix: Use `source` for consistency:
```bash
source "$SCRIPT_DIR/json-parse"
source "$SCRIPT_DIR/log-paths"
```

**`set -euo pipefail` vs `set -e`** - `scripts/hooks/session-end-learning:12`
**Confidence**: 82%
- Problem: `session-end-learning` uses `set -euo pipefail` while every other hook script uses `set -e` only. The stricter flags (`-u` for undefined vars, `-o pipefail` for pipe exit codes) can cause unexpected failures if upstream scripts (like `json-parse`) use unset variables or rely on pipe exit code semantics.
- Fix: Use `set -e` to match the codebase convention. If stricter error handling is desired, it should be adopted across all hook scripts simultaneously, not in a single new hook.

**Missing `disown` after background process spawn** - `scripts/hooks/session-end-learning:200`
**Confidence**: 80%
- Problem: `session-end-learning` spawns a background process with `nohup bash ... &` but does not call `disown` afterward. The existing pattern in `stop-update-memory:83` uses `nohup ... & \n disown` and also redirects stdin/stdout with `</dev/null >/dev/null 2>&1`. The new hook redirects stdout/stderr to `$LOG_FILE` (reasonable), but omits `disown`, which means the background job remains in the shell's job table. Under `set -e`, this is unlikely to cause issues since the script exits immediately, but it deviates from the established pattern.
- Fix: Add `disown` for consistency:
```bash
DEVFLOW_BG_LEARNER=1 nohup bash "$SCRIPT_DIR/background-learning" "$CWD" "--batch" "$CLAUDE_BIN" \
  >> "$LOG_FILE" 2>&1 &
disown
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`addLearningHook` does not clean up legacy Stop hook** - `src/cli/commands/learn.ts:61`
**Confidence**: 85%
- Problem: `removeLearningHook` properly cleans both `SessionEnd` (new) and `Stop` (legacy) entries. However, `addLearningHook` only adds the new `SessionEnd` hook — it does not remove any leftover legacy `Stop` entry. If a user runs `devflow learn --enable` on a pre-existing installation, they end up with both the legacy Stop hook (which is now a no-op `exit 0`) and the new SessionEnd hook. The deprecated Stop hook adds a tiny bit of overhead on every session stop for no value.
- Fix: Have `addLearningHook` remove the legacy entry, or call `removeLearningHook` before adding:
```typescript
export function addLearningHook(settingsJson: string, devflowDir: string): string {
  // Clean up legacy Stop hook if present
  let cleaned = removeLearningHook(settingsJson);
  // ... rest of add logic, but check hasLearningHook on cleaned settings
```
Or document that `--disable && --enable` is required for migration (the deprecated script already says this, but the `--enable` path could do it automatically).

### LOW

**`increment_daily_counter` dead code in background-learning** - `scripts/hooks/background-learning:131`
**Confidence**: 80%
- Problem: The `increment_daily_counter` function is still defined in `background-learning` (lines 131-138) but is no longer called. The call site was replaced with a comment: `# Note: daily counter already incremented by session-end-learning before spawning us`. The dead function adds cognitive overhead when reading the script.
- Fix: Remove the `increment_daily_counter` function definition since the daily counter is now managed exclusively by `session-end-learning`.

## Pre-existing Issues (Not Blocking)

_(none)_

## Suggestions (Lower Confidence)

- **Missing `ensure-memory-gitignore` call in session-end-learning** - `scripts/hooks/session-end-learning` (Confidence: 65%) -- The old `stop-update-learning` sourced `ensure-memory-gitignore` to auto-create `.memory/` and manage `.gitignore`. The new hook assumes `.memory/` exists (line 31: `[ ! -d "$MEMORY_DIR" ] && exit 0`) but never creates it. This may be intentional since the memory system creates it first, but it breaks the self-contained setup pattern of the old hook.

- **Background-learning `check_daily_cap` is now redundant** - `scripts/hooks/background-learning:118` (Confidence: 70%) -- Since `session-end-learning` now performs the daily cap check before spawning the background learner, `check_daily_cap` in `background-learning` is a redundant guard. While defense-in-depth is reasonable, it could also cause a double-count mismatch if the counter format or timing drifts between the two scripts.

- **Naming pattern: `session-end-learning` vs `stop-update-memory`** - hook filenames (Confidence: 60%) -- Existing hooks use the pattern `{event}-update-{system}` (e.g., `stop-update-memory`, `stop-update-learning`). The new hook uses `session-end-learning` which follows a `{event}-{system}` pattern. The difference is minor but creates an inconsistent naming convention across hook scripts.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 5 | 0 |
| Should Fix | 0 | 0 | 1 | 1 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The naming migration from `learned-*` to `self-learning:*` is thorough and complete -- no stale references remain. The TypeScript changes (`learn.ts`) are well-structured with proper legacy cleanup in `removeLearningHook`. However, the new `session-end-learning` shell hook introduces several pattern deviations from the established hook conventions: different CWD encoding technique, different log format, different sourcing syntax, different shell strictness flags, and a missing `disown`. Each deviation is individually minor, but collectively they make the new hook feel like it was written without reference to the existing hook style. Aligning these 5-6 small inconsistencies would bring the score to 8/10.
