# Consistency Review Report

**Branch**: fix/learning-validation-and-debug-logs -> main
**Date**: 2026-03-25

## Issues in Your Changes (BLOCKING)

### HIGH

**Validation logic inconsistency between `post-install.ts` purge and `isLearningObservation` type guard** - `src/cli/utils/post-install.ts:620-624`
**Confidence**: 90%
- Problem: The `migrateMemoryFiles` auto-purge uses a simplified truthiness check (`obj.id && obj.type && obj.pattern`) that does not match the stricter `isLearningObservation()` type guard used everywhere else. The type guard also validates `confidence` is a number, `observations` is a number, `status` is one of three enum values, `evidence` is an array, and `details` is a string. This means `migrateMemoryFiles` could preserve entries that `parseLearningLog`/`--purge`/`--status`/`--list` would reject, creating a situation where the migration "purges" but the CLI still reports invalid entries.
- Fix: Reuse the same validation. Extract lines into `parseLearningLog` (which uses `isLearningObservation`) and reserialize, matching the `--purge` handler:
```typescript
// In migrateMemoryFiles, replace the inline purge logic with:
const { parseLearningLog } = await import('../commands/learn.js');
const valid = parseLearningLog(content);
if (valid.length < lines.length) {
  await fs.writeFile(logPath, valid.map(o => JSON.stringify(o)).join('\n') + (valid.length ? '\n' : ''), 'utf-8');
}
```
Alternatively, if the circular import is a concern, extract `isLearningObservation` and `parseLearningLog` to a shared utility.

**Validation logic inconsistency between `background-learning` shell script and TypeScript type guard (3 locations)** - `scripts/hooks/background-learning:253-256`, `scripts/hooks/background-learning:399-401`, `scripts/hooks/background-learning:254`
**Confidence**: 85%
- Problem: The shell script validates observations with three separate check sets that differ from each other and from the TypeScript type guard:
  1. **Existing obs filter** (line 253-256): Checks `id != ""`, `type != ""`, `pattern != ""` via jq/node -- no `obs_` prefix check, no type enum check.
  2. **New observation validation** (line 399-410): Checks empty fields + `type` must be `workflow|procedural` + `id` must start with `obs_` -- the most thorough shell check.
  3. **TypeScript `isLearningObservation`**: Checks non-empty `id`, enum `type`, non-empty `pattern`, plus `confidence` number, `observations` number, `status` enum, `evidence` array, `details` string.
  These three levels of validation are inconsistent. The existing-obs filter (location 1) is weaker than the new-obs validator (location 2), which itself is weaker than the TypeScript guard.
- Fix: The existing-obs jq filter at line 253-254 should at minimum match the process_observations validator. Add type and id-prefix checks:
```bash
# jq path
EXISTING_OBS=$(echo "$EXISTING_OBS" | jq -c '[.[] | select(.id != "" and (.id | startswith("obs_")) and (.type == "workflow" or .type == "procedural") and .pattern != "")]')
# node path
EXISTING_OBS=$(echo "$EXISTING_OBS" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(JSON.stringify(d.filter(o=>o.id&&o.id.startsWith('obs_')&&(o.type==='workflow'||o.type==='procedural')&&o.pattern)))")
```

### MEDIUM

**`rotate_log` inconsistency between `background-learning` and `background-memory-update`** - `scripts/hooks/background-learning:32-42` vs `scripts/hooks/background-memory-update:32-36`
**Confidence**: 85%
- Problem: The `rotate_log` function in `background-learning` was updated to support debug-aware thresholds (500/250 lines when `DEBUG=true`, 100/50 otherwise), plus an early return guard. The same function in `background-memory-update` still uses the old hardcoded 100/50 pattern without the early return guard. Both scripts now write to the same `~/.devflow/logs/` directory, so a user enabling debug mode would expect consistent log retention behavior across both log files.
- Fix: Either apply the same debug-aware rotate_log to `background-memory-update`, or extract rotate_log into the shared `json-parse` source file. At minimum, add the `if [ ! -f "$LOG_FILE" ]; then return; fi` guard:
```bash
rotate_log() {
  if [ ! -f "$LOG_FILE" ]; then return; fi
  if [ "$(wc -l < "$LOG_FILE")" -gt 100 ]; then
    tail -50 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
}
```

**Duplicated raw-line counting pattern in `--status` and `--list` handlers** - `src/cli/commands/learn.ts:289-302`, `src/cli/commands/learn.ts:313-345`
**Confidence**: 82%
- Problem: The `--status` and `--list` handlers both independently compute `rawLineCount`, parse observations, and compute `invalidCount` with identical logic. This is a DRY violation that increases the surface area for future inconsistency (e.g., if the counting logic changes in one but not the other).
- Fix: Extract a helper function:
```typescript
async function loadObservationsWithDiagnostics(logPath: string): Promise<{
  observations: LearningObservation[];
  rawLineCount: number;
  invalidCount: number;
}> {
  const logContent = await fs.readFile(logPath, 'utf-8');
  const rawLineCount = logContent.split('\n').filter(l => l.trim()).length;
  const observations = parseLearningLog(logContent);
  return { observations, rawLineCount, invalidCount: rawLineCount - observations.length };
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**SYNC comment between shell and TypeScript could be more precise** - `scripts/hooks/background-learning:91-92`, `src/cli/commands/learn.ts:197-198`
**Confidence**: 80%
- Problem: The SYNC comments now list `debug` in the synced fields, which is good. However, the validation rules applied to observations differ significantly between the shell script and TypeScript (as noted in the blocking section). The SYNC comment gives a false sense of parity by only mentioning config fields while the validation logic divergence is undocumented.
- Fix: Add a separate SYNC comment near the shell validation block (line 398) referencing the TypeScript type guard:
```bash
# SYNC: Validation rules should match isLearningObservation() in src/cli/commands/learn.ts
# Shell validates: non-empty id/type/pattern, type enum, obs_ prefix
# TypeScript also validates: confidence number, observations number, status enum, evidence array, details string
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-005 (HookEntry/HookMatcher/Settings interfaces duplicated 4x) remains unaddressed** - `src/cli/commands/learn.ts:7`
**Confidence**: 90%
- Problem: The import `import type { HookMatcher, Settings } from '../utils/hooks.js'` shows that this pitfall has actually been resolved for `learn.ts` (it now imports from a shared utility). This is a positive finding -- the known pitfall PF-005 is partially addressed. The other files mentioned in PF-005 should be checked in a separate PR.

## Suggestions (Lower Confidence)

- **`--purge` placed after `--clear` in option processing but before it in handler code** - `src/cli/commands/learn.ts:444-470` (Confidence: 65%) -- The `--purge` handler is placed before `--clear` in the action handler, but `--clear` appears before `--purge` in the option definitions (line 248-249). Minor ordering inconsistency that could confuse future maintainers reading the code top-to-bottom.

- **`background-memory-update` does not have a `debug` config field** - `scripts/hooks/background-memory-update` (Confidence: 70%) -- The learning system now has a `debug` configuration field, but the memory updater currently logs all prompts and responses unconditionally (lines 177-212). If the intent is to give users control over verbose logging, the memory updater should respect the same pattern.

- **Test for migration writes to real `~/.devflow/logs/` directory** - `tests/memory.test.ts:350-372` (Confidence: 75%) -- The migration test writes to the actual `~/.devflow/logs/{slug}/` directory on the developer's machine (using `os.homedir()`). While it cleans up after itself, a test failure or interruption would leave artifacts in the user's home directory. Consider mocking `getDevFlowDirectory()` or using a temp path.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR demonstrates good consistency practices overall: the log relocation pattern is applied uniformly across all 4 hook scripts, the `debug` config field is added consistently to both shell and TypeScript config loaders with matching SYNC comments, and the new `--purge` command follows the same UI patterns as existing commands. The primary concern is the validation divergence between the three places that check observation validity (TypeScript type guard, shell process_observations, and post-install purge), which creates a risk of inconsistent data quality depending on which code path runs.
