# Regression Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### HIGH

**`devflow memory --status` no longer reports runtime-disabled state** - `src/cli/commands/memory.ts:303-313`
**Confidence**: 90%
- Problem: The old code checked the `.working-memory-disabled` sentinel and warned users when hooks were present but memory was runtime-disabled. The new code only reports hook count (5/5 hooks) without consulting the sidecar config. A user who runs `devflow memory --disable` then `devflow memory --status` will see "enabled (5/5 hooks)" — a false positive, since the hooks are now shared and remain registered even when memory is disabled via sidecar config.
- Fix: After the hook-count check, read `isFeatureEnabled(gitRoot, 'memory')` and warn if sidecar config has `memory: false`:
```typescript
import { isFeatureEnabled } from '../utils/sidecar-config.js';
// ... after hook count report:
if (gitRoot) {
  const sidecarEnabled = await isFeatureEnabled(gitRoot, 'memory');
  if (!sidecarEnabled) {
    p.log.warn(color.yellow('Runtime-disabled: sidecar config has memory: false'));
    p.log.info(color.dim('Run devflow memory --enable to re-enable'));
  }
}
```

**`devflow memory --disable` no longer drains orphaned queue files** - `src/cli/commands/memory.ts:334-344`
**Confidence**: 85%
- Problem: The old `--disable` path had best-effort cleanup of `.pending-turns.jsonl` and `.pending-turns.processing` so stale turns would not be processed if memory was re-enabled later. The new code writes `memory: false` to sidecar config but does not drain the queue. If a user disables then re-enables memory, stale turns from before the disable may be processed.
- Fix: Add orphan queue drain after `updateFeature`:
```typescript
if (options.disable) {
  if (gitRoot) {
    await updateFeature(gitRoot, 'memory', false);
    // Best-effort: drain orphaned queue files so no stale turns are processed on re-enable
    const memDir = path.join(gitRoot, '.memory');
    try { await fs.unlink(path.join(memDir, '.pending-turns.jsonl')); } catch { /* already gone */ }
    try { await fs.unlink(path.join(memDir, '.pending-turns.processing')); } catch { /* already gone */ }
    p.log.success('Working memory disabled — sidecar config updated');
    ...
```

### MEDIUM

**Removed `--run-background` CLI option creates silent breakage for existing hook scripts** - `src/cli/commands/learn.ts:140`, `src/cli/commands/decisions.ts:159`
**Confidence**: 82%
- Problem: The deleted `session-end-learning` and `session-end-decisions` shell hooks previously invoked `devflow learn --run-background --cwd "$CWD"` and `devflow decisions --run-background --cwd "$CWD"`. If any user has old hooks still registered in their `settings.json` (from a previous install that was not re-initialized), those hooks will now fail silently because the `--run-background` option no longer exists. Commander.js does not error on unknown options by default, but the action handler will not find `runBackground` in the flags, skip all logic, and exit without doing anything — the background learning/decisions work never runs, with no error message.
- Impact: Users who upgrade the CLI without re-running `devflow init` will silently lose learning and decisions functionality until they re-initialize. This aligns with applies ADR-001 (clean break philosophy), but the failure is invisible.
- Fix: Consider adding a note in the upgrade output or adding the old hooks to `LEGACY_HOOK_FILES` cleanup in init.ts so they are proactively removed on next init. The existing `LEGACY_HOOK_FILES` array in init.ts should include `session-end-learning`, `session-end-decisions`, `session-end-knowledge-refresh`, `background-knowledge-refresh`, `background-memory-update`, `prompt-capture-memory`, and `stop-update-learning`.

**Uninstall no longer removes learning/decisions/knowledge hooks from settings.json** - `src/cli/commands/uninstall.ts:408-411`
**Confidence**: 92%
- Problem: The uninstall command removed the `removeLearningHook`, `removeDecisionsHook`, and `removeKnowledgeHook` calls from the settings cleanup pass. While the sidecar system means these hooks are no longer individually registered (all features flow through `sidecar-capture`/`sidecar-dispatch`/`sidecar-evaluate` which are part of memory hooks), if a user has OLD per-feature hooks still in their settings.json from a prior install, `devflow uninstall` will no longer clean them up.
- Fix: While this is a minor issue (old hooks would reference deleted scripts and fail silently), for clean uninstall it would be ideal to still attempt removal of legacy hook markers. Consider adding a pass that removes any hook command containing `session-end-learning`, `session-end-decisions`, or `session-end-knowledge-refresh`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`devflow decisions --status` removed daily-run-count display** - `src/cli/commands/decisions.ts:217`
**Confidence**: 88%
- Problem: The old status command displayed "Daily runs today: N" by reading `.decisions-runs-today`. This informational output was removed entirely. Users who relied on this to monitor decisions agent activity lose visibility. The sidecar system still uses `.sidecar/.decisions-runs-today` (different path from the old `.memory/.decisions-runs-today`), so reading from the old path would be stale anyway.
- Fix: Either restore the daily run count by reading from the new sidecar path (`$GITROOT/.memory/.sidecar/.decisions-runs-today`), or document that this diagnostic is now available only in logs.

## Pre-existing Issues (Not Blocking)

(None identified at CRITICAL level)

## Suggestions (Lower Confidence)

- **Missing `.sidecar/` directory in LEGACY_HOOK_FILES cleanup** - `src/cli/commands/init.ts:1032-1047` (Confidence: 65%) — The `LEGACY_HOOK_FILES` array does not include the 8 deleted hook scripts (`background-knowledge-refresh`, `background-memory-update`, `prompt-capture-memory`, `session-end-decisions`, `session-end-knowledge-refresh`, `session-end-learning`, `stop-update-learning`). Users upgrading from the previous version will have these orphaned scripts in `~/.devflow/scripts/hooks/` until removed manually.

- **`sidecar-evaluate` transcript path encoding assumes leading-slash removal** - `scripts/hooks/sidecar-evaluate:49` (Confidence: 60%) — The encoding `ENCODED_CWD=$(echo "$CWD" | sed 's|^/||' | tr '/' '-')` and `PROJECTS_DIR="$HOME/.claude/projects/-${ENCODED_CWD}"` replicates an assumption about Claude's internal project directory naming. If this convention changes, transcript discovery fails silently.

- **`updateFeature` calls in init are sequential (4 writes)** - `src/cli/commands/init.ts:1139-1142` (Confidence: 62%) — Four sequential `updateFeature` calls each do read-parse-merge-write. Since `writeConfig` always writes the full config, a single `writeConfig` call with all four features would be more efficient and atomic.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The sidecar refactoring is well-executed with proper backward compatibility in the shell hooks (session-start-memory checks both old sentinel and new sidecar config). All tests pass. The primary regression risks are in the CLI user experience: `--status` commands that no longer reflect the true runtime state (false "enabled" reports), and incomplete cleanup of orphaned state on `--disable`. The removed `--run-background` CLI options align with ADR-001 (clean break philosophy — avoids PF-001) but create invisible failure for users who upgrade without re-running init.
