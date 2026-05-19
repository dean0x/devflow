# Architecture Review Report

**Branch**: fix/learning-validation-and-debug-logs -> main
**Date**: 2026-03-25
**Commit**: 8e2f451 fix: learning system empty-field validation + debug log relocation

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicated validation logic between post-install.ts and learn.ts (isLearningObservation)** - `src/cli/utils/post-install.ts:620-625`
**Confidence**: 90%
- Problem: The auto-purge logic in `migrateMemoryFiles()` uses an inline validation check (`obj.id && obj.type && obj.pattern`) that duplicates the type guard `isLearningObservation()` from `learn.ts`, but with weaker semantics. The `isLearningObservation` guard checks for non-empty strings, valid enum values for `type` and `status`, correct field types for `confidence`/`observations`, and array evidence. The inline check in `post-install.ts` only checks truthiness of three fields -- it would pass entries with `type: "invalid"`, missing `confidence`, or numeric `id` values.
- Impact: Silent data divergence. The `--purge` command and `--status`/`--list` invalid-entry counting use `parseLearningLog` (which delegates to `isLearningObservation`), while the migration auto-purge uses the weaker inline check. An entry with `type: "garbage"` would survive migration auto-purge but be counted as invalid by `--status`. Users would see "N invalid entries, run --purge" after a migration that was supposed to clean them.
- Fix: Import and reuse `parseLearningLog` from `learn.ts` in `post-install.ts` instead of re-implementing the filter:
```typescript
import { parseLearningLog } from '../commands/learn.js';

// Replace lines 618-628 with:
const content = await fs.readFile(logPath, 'utf-8');
const rawLines = content.split('\n').filter(l => l.trim());
const validObservations = parseLearningLog(content);
if (validObservations.length < rawLines.length) {
  const validLines = validObservations.map(o => JSON.stringify(o));
  await fs.writeFile(logPath, validLines.join('\n') + (validLines.length ? '\n' : ''), 'utf-8');
}
```

### MEDIUM

**Project-slug derivation duplicated 5x across 4 shell hooks + 1 TypeScript file** - `scripts/hooks/background-learning:19-21`, `scripts/hooks/stop-update-learning:35-37`, `scripts/hooks/stop-update-memory:34-36`, `scripts/hooks/background-memory-update:20-22`, `src/cli/utils/post-install.ts:602`
**Confidence**: 85%
- Problem: The identical 3-line pattern (`_PROJECT_SLUG=$(echo "$CWD" | sed 's|^/||' | tr '/' '-')` / `_LOG_DIR="$HOME/.devflow/logs/$_PROJECT_SLUG"` / `mkdir -p "$_LOG_DIR"`) is copy-pasted across all 4 hook scripts. The TypeScript equivalent in `post-install.ts` re-derives the same slug with regex. Any future change to the slug format (e.g., handling special characters, length capping) requires coordinated edits in 5 locations.
- Impact: DRY violation that compounds PF-005 (already tracking duplicated hook interfaces). Slug format drift between shell and TypeScript would cause log files to land in different directories for the same project, making debug logs unfindable.
- Fix: Extract a shared shell function in a new `scripts/hooks/log-paths` sourced file:
```bash
# scripts/hooks/log-paths
devflow_log_dir() {
  local cwd="$1"
  local slug=$(echo "$cwd" | sed 's|^/||' | tr '/' '-')
  local dir="$HOME/.devflow/logs/$slug"
  mkdir -p "$dir"
  echo "$dir"
}
```
Then in each hook: `source "$SCRIPT_DIR/log-paths"` and `LOG_FILE="$(devflow_log_dir "$CWD")/.learning-update.log"`. For TypeScript, add a `getProjectLogDir(cwd: string)` to `src/cli/utils/paths.ts`.

**Config loading order change lacks defensive guard** - `scripts/hooks/background-learning:618-619`
**Confidence**: 82%
- Problem: The main section was reordered from `rotate_log` then `load_config` to `load_config` then `rotate_log`. This is correct (rotate_log now reads `DEBUG` to determine max_lines, so config must load first). However, `rotate_log()` at line 36 reads `${DEBUG:-false}` from the environment, not the loaded `$DEBUG` shell variable. If `load_config` sets `DEBUG="true"` but the environment variable `DEBUG` is unset, the parameter expansion `${DEBUG:-false}` still evaluates to `"true"` because shell variable assignment is in the same scope. This works today, but the `:-false` fallback obscures the actual dependency on `load_config()` running first. A future refactor moving `rotate_log` to a subshell or sourced file would silently break the debug log retention.
- Impact: Fragile implicit coupling between execution order and shell variable scope. Not a bug today but an architectural brittleness.
- Fix: Remove the environment-variable fallback in `rotate_log()` since `load_config()` always runs first now:
```bash
rotate_log() {
  if [ ! -f "$LOG_FILE" ]; then return; fi
  local max_lines=100
  local keep_lines=50
  if [ "$DEBUG" = "true" ]; then
    max_lines=500
    keep_lines=250
  fi
  # ...
```
This is already the case -- `${DEBUG:-false}` should just be `$DEBUG` since `load_config` initializes it to `"false"` as a default.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**SYNC comment between shell and TypeScript lacks structural enforcement** - `scripts/hooks/background-learning:91-92`, `src/cli/commands/learn.ts:197-198`
**Confidence**: 80%
- Problem: The `SYNC:` comments (`Config loading duplicated in ...` / `Synced fields: max_daily_runs, throttle_minutes, model, debug`) are the only mechanism ensuring the shell `load_config()` stays in sync with the TypeScript `loadLearningConfig()`. Adding `debug` required edits in both places. The next config field addition may miss one side. This is a known consequence of PF-004 (background hook as untestable god script) but this PR adds another synced field without addressing the structural gap.
- Impact: The config shape is now 4 fields. Each new field doubles the surface area for sync drift. The SYNC comment is easy to miss during code review.
- Fix (incremental, not blocking): Add a test that generates a config JSON with all fields, runs the shell `load_config()` via a subprocess, and asserts the loaded values match what `loadLearningConfig()` produces. This would catch sync drift in CI. Example:
```typescript
it('shell load_config matches TypeScript loadLearningConfig for all fields', async () => {
  // Write test config, run shell snippet, compare output
});
```

## Pre-existing Issues (Not Blocking)

### HIGH

**PF-004: background-learning is a 660-line shell script with 7+ responsibilities** - `scripts/hooks/background-learning`
**Confidence**: 95%
- Problem: Already documented as PF-004. This PR adds validation, debug logging, and config loading changes, further increasing the script's complexity (now 662 lines, up from ~560). The script handles: locking, config loading, transcript extraction, temporal decay, LLM invocation, response processing, observation management, artifact creation, and now validation + debug logging.
- Impact: The script is the single largest source of architecture debt. Each feature addition (like this one) makes the eventual migration to TypeScript harder.
- Note: Tracked in pitfalls. No action required in this PR, but the trajectory is concerning.

### MEDIUM

**PF-005: Validation logic now exists in 3 separate locations** - `learn.ts:39-52`, `post-install.ts:620-624`, `background-learning:398-410`
**Confidence**: 88%
- Problem: This PR introduces observation validation in the shell script (`process_observations`) and the migration auto-purge (`post-install.ts`), adding to the existing `isLearningObservation` type guard in `learn.ts`. All three check overlapping but not identical properties. The shell script validates `id`, `type`, `pattern` + id format prefix + type enum. The TypeScript type guard validates all fields including `confidence`, `observations`, `first_seen`, `last_seen`, `status`, `evidence`, `details`. The migration only checks `id`, `type`, `pattern` truthiness.
- Impact: Three-way validation drift risk. The shell script cannot easily share code with TypeScript, but the migration code in `post-install.ts` can and should reuse `isLearningObservation`.

## Suggestions (Lower Confidence)

- **Debug logging could leak sensitive session content to disk** - `scripts/hooks/background-learning:641-647` (Confidence: 70%) -- When `debug: true`, the first 500 chars of user messages and all existing observations are written to `~/.devflow/logs/`. The log directory is user-home-scoped but not explicitly restricted in permissions. Consider adding `chmod 700 "$_LOG_DIR"` after `mkdir -p`.

- **Migration auto-purge has no idempotency guard** - `src/cli/utils/post-install.ts:615-629` (Confidence: 65%) -- `migrateMemoryFiles` runs on every `devflow init`. The purge section reads and potentially rewrites `learning-log.jsonl` on every invocation even when no migration occurred. The `valid.length < lines.length` guard prevents unnecessary writes, but the read-parse-compare still happens every time. Minor concern for a file that's typically <100 lines.

- **`--purge` does not confirm with user before destructive write** - `src/cli/commands/learn.ts:444-470` (Confidence: 72%) -- The `--clear` command prompts for confirmation via `p.confirm`, but `--purge` writes directly. While purge is less destructive (removes only invalid entries), the asymmetry in UX could surprise users.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 1 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR is well-structured and adds meaningful defensive validation to a system that needed it. The log relocation from `.memory/` to `~/.devflow/logs/` is a clean separation of concerns. However, the main blocking issue -- duplicated validation logic with weaker semantics in `post-install.ts` -- should be fixed before merge to prevent a class of bugs where migration "cleans" entries but leaves them in a state the CLI commands consider invalid. The slug duplication across 5 files is a lower-priority DRY concern that compounds existing tracked debt (PF-004, PF-005).
