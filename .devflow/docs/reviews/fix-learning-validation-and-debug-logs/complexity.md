# Complexity Review Report

**Branch**: fix/learning-validation-and-debug-logs -> main
**Date**: 2026-03-25

## Issues in Your Changes (BLOCKING)

### HIGH

**`learnCommand.action()` handler grows to 287 lines (7 branches)** - `src/cli/commands/learn.ts:250-537`
**Confidence**: 85%
- Problem: The `.action()` handler is a single closure spanning 287 lines with 7 mutually-exclusive flag branches (`--status`, `--list`, `--configure`, `--purge`, `--clear`, `--enable`, `--disable`). This PR adds `--purge` as a new branch, growing the handler further. The handler already exceeds the 50-line function threshold (CRITICAL at >200 lines). Each branch repeats boilerplate (read log file, parse, check counts) rather than sharing extraction logic.
- Fix: Extract each `--flag` handler into a named async function (e.g., `handlePurge()`, `handleStatus()`, `handleList()`). The `.action()` handler becomes a dispatcher:
```typescript
.action(async (options: LearnOptions) => {
  if (!hasFlag(options)) { showUsage(); return; }
  const ctx = await loadContext(); // settings, cwd, logPath
  if (options.status) return handleStatus(ctx);
  if (options.list) return handleList(ctx);
  if (options.purge) return handlePurge(ctx);
  // ...
});
```

### MEDIUM

**Duplicated raw-line-count + invalid-detection pattern (3 occurrences)** - Confidence: 82%
- `src/cli/commands/learn.ts:289-303` (`--status` handler)
- `src/cli/commands/learn.ts:313-345` (`--list` handler)
- `src/cli/commands/learn.ts:457-459` (`--purge` handler)
- Problem: Three places independently compute `rawLineCount = logContent.split('\n').filter(l => l.trim()).length` and then derive `invalidCount = rawLineCount - observations.length`. This is inline duplication of the same "load + count + validate" logic within the same file.
- Fix: Extract a helper that returns `{ observations, invalidCount }`:
```typescript
function loadAndCountObservations(logContent: string): {
  observations: LearningObservation[];
  invalidCount: number;
} {
  const rawLines = logContent.split('\n').filter(l => l.trim()).length;
  const observations = parseLearningLog(logContent);
  return { observations, invalidCount: rawLines - observations.length };
}
```

**Duplicated purge/validation logic between `learn.ts --purge` and `post-install.ts migrateMemoryFiles`** - Confidence: 84%
- `src/cli/commands/learn.ts:457-468` (purge via `parseLearningLog` + `JSON.stringify` each valid entry)
- `src/cli/utils/post-install.ts:616-629` (purge via inline `JSON.parse` + truthiness check on `id/type/pattern`)
- Problem: Two implementations of "purge invalid JSONL entries" with subtly different validation criteria. `learn.ts` uses the full `isLearningObservation` type guard (checks all fields including `status`, `evidence`, `details`), while `post-install.ts` uses a loose `obj.id && obj.type && obj.pattern` truthiness check. This divergence means `migrateMemoryFiles` could keep entries that `--purge` would reject, or vice versa, leading to inconsistent cleanup behavior.
- Fix: Have `migrateMemoryFiles` import and use `parseLearningLog` from `learn.ts` (which uses the full type guard), then rewrite the valid entries. This consolidates the validation logic to one place:
```typescript
import { parseLearningLog } from '../commands/learn.js';
// In migrateMemoryFiles:
const content = await fs.readFile(logPath, 'utf-8');
const valid = parseLearningLog(content);
if (valid.length < content.split('\n').filter(l => l.trim()).length) {
  await fs.writeFile(logPath, valid.map(o => JSON.stringify(o)).join('\n') + '\n', 'utf-8');
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`background-learning` script is 661 lines with 13+ functions** - `scripts/hooks/background-learning:1-661`
**Confidence**: 85%
- Problem: This PR adds ~67 new lines to an already large script (was ~590, now 661). The script has been flagged as a known pitfall (PF-004) for concentrating 7+ responsibilities. The new validation logic in `process_observations()` (lines 398-410) and the filtered dedup in `build_sonnet_prompt()` (lines 252-257) are reasonable additions, but they further entrench logic in shell that would be more maintainable in TypeScript. The `process_observations()` function itself spans 135 lines (379-514) with nesting depth 4 in places.
- Fix: This is a pre-existing architectural issue (PF-004) exacerbated by this PR. No immediate fix required for this PR, but the validation logic added here (lines 398-410) is a good candidate to move to TypeScript in the planned refactoring since it mirrors the `isLearningObservation` type guard.

**Project slug computation duplicated across 4 hook scripts** - Confidence: 80%
- `scripts/hooks/background-learning:19-22`
- `scripts/hooks/background-memory-update:20-23`
- `scripts/hooks/stop-update-learning:35-38`
- `scripts/hooks/stop-update-memory:34-37`
- Problem: Identical 4-line slug computation (`sed + tr + mkdir -p`) is copy-pasted into all 4 modified hook scripts. If the slug algorithm changes (e.g., to handle special characters), all 4 scripts must be updated in lockstep.
- Fix: Add a `project_slug` helper to the existing `json-parse` shared library (which is already sourced by these scripts), or create a `common-init` script:
```bash
# In json-parse or a new common-init:
project_log_dir() {
  local slug=$(echo "$1" | sed 's|^/||' | tr '/' '-')
  local dir="$HOME/.devflow/logs/$slug"
  mkdir -p "$dir"
  echo "$dir"
}
```

## Pre-existing Issues (Not Blocking)

### HIGH

**`learnCommand.action()` handler was already ~260 lines before this PR** - `src/cli/commands/learn.ts`
**Confidence**: 90%
- Problem: The handler was already well above the 200-line CRITICAL threshold before this PR. This mirrors the pattern identified in PF-002 (`init.ts` monolith). The `--purge` addition (+26 lines) pushes it to 287 lines. The pattern of flat `if (options.X)` branches within a single closure is a common CLI anti-pattern that compounds with each new subcommand.
- Fix: Tracked as a separate concern. Extract to named handler functions in a future refactoring PR.

## Suggestions (Lower Confidence)

- **`build_sonnet_prompt` mixes data preparation with string templating** - `scripts/hooks/background-learning:244-308` (Confidence: 65%) -- The function loads existing observations, filters invalid entries, and constructs a multi-line prompt string. Separating data preparation from prompt construction would improve readability.

- **`rotate_log` uses `DEBUG` variable before `load_config` sets it** - `scripts/hooks/background-learning:36` (Confidence: 70%) -- The `rotate_log` function references `${DEBUG:-false}` with a fallback, and the main section now calls `load_config` before `rotate_log` (line 618-619), which is correct. However, if `rotate_log` were ever called before `load_config`, the `DEBUG` variable would silently default to `false` instead of failing visibly. The reordering in main (moving `load_config` before `rotate_log`) correctly addresses this, but the `${DEBUG:-false}` fallback masks potential ordering bugs elsewhere.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 1 | 0 | 0 |

**Complexity Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new code is well-structured in isolation -- validation logic is clear, debug logging is properly gated, and the purge command follows existing patterns. The conditions are:

1. The duplicated purge validation between `learn.ts` and `post-install.ts` should be consolidated to use the same type guard, preventing divergent cleanup behavior. This is a small change (import + 3 line replacement in `post-install.ts`).
2. The `action()` handler growth (287 lines) should be tracked for extraction in a near-term follow-up, ideally alongside the PF-002 init.ts refactoring.

The remaining items (project slug duplication, background-learning script size) are pre-existing patterns that this PR slightly exacerbates but does not fundamentally change. They are appropriately tracked in pitfalls (PF-004) and should not block this merge.
