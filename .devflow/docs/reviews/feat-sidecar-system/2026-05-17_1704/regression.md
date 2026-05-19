# Regression Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: 8 hooks deleted, 3 hooks added, 3 TypeScript utilities deleted, 1 utility added, 7 CLI commands updated

## Issues in Your Changes (BLOCKING)

### HIGH

**session-start-context learning sentinel desync** - `src/cli/commands/learn.ts:684-704`, `scripts/hooks/session-start-context:34,80`
**Confidence**: 95%
- Problem: `session-start-context` (unchanged, always-on hook) still checks `.memory/.learning-disabled` sentinel at lines 34 and 80 to gate learning manifest reconciliation and learned behaviors injection. However, `devflow learn --enable/--disable` no longer creates or removes this sentinel -- it only writes to sidecar config. This means:
  1. `devflow learn --disable` updates sidecar config but does NOT create `.learning-disabled`, so `session-start-context` will still inject learned behaviors and run manifest reconciliation.
  2. If a user had `.learning-disabled` from a previous version, `devflow learn --enable` does NOT remove it, so `session-start-context` will block learned behaviors even though the sidecar hook evaluates learning.
- Fix: Either update `session-start-context` to read sidecar config instead of the sentinel (consistent with `pre-compact-memory` and `session-start-memory`), or add sentinel management back to `learn.ts --enable/--disable`. The first option is preferred for consistency:
```bash
# In session-start-context, replace:
if [ ! -f "$CWD/.memory/.learning-disabled" ]; then
# With:
LEARNING_ENABLED="true"
SIDECAR_CONFIG="$CWD/.memory/.sidecar/config.json"
if [ -f "$SIDECAR_CONFIG" ]; then
  LEARNING_ENABLED=$(json_field_file "$SIDECAR_CONFIG" "learning" "true")
fi
if [ "$LEARNING_ENABLED" != "false" ]; then
```

**Stale state file paths in --reset: learn and decisions** - `src/cli/commands/learn.ts:408-416`, `src/cli/commands/decisions.ts:405-411`
**Confidence**: 92%
- Problem: `devflow learn --reset` looks for transient state files (`.learning-session-count`, `.learning-batch-ids`, `.learning-runs-today`) in `.memory/` but `sidecar-evaluate` now writes them to `.memory/.sidecar/` (e.g., `$SIDECAR_DIR/.learning-runs-today`, `$SIDECAR_DIR/.learning-sessions`). Similarly, `devflow decisions --reset` looks for `.decisions-runs-today` and `.decisions-batch-ids` in `.memory/`. After a reset, sidecar state files persist and the daily cap / batch counter remain, causing unexpected throttling.
- Fix: Update the transient file lists to include the new sidecar paths, and also update the file name from `.learning-session-count` to `.learning-sessions` (the name used in sidecar-evaluate line 236):
```typescript
// learn.ts --reset: add sidecar state files
const transientFiles = [
  // Legacy locations (pre-sidecar)
  '.learning-session-count',
  '.learning-batch-ids',
  '.learning-runs-today',
  '.learning-notified-at',
  '.learning-notifications.json',
  '.learning-manifest.json',
  '.decisions-usage.json',
  // Sidecar locations
  '.sidecar/.learning-runs-today',
  '.sidecar/.learning-sessions',
  '.sidecar/learning.json',
];
```

**Orphan old hooks in settings.json on upgrade** - `src/cli/commands/memory.ts:16-22`, `src/cli/commands/init.ts:1070-1074`
**Confidence**: 90%
- Problem: `MEMORY_HOOK_CONFIG` was changed from `{UserPromptSubmit: 'prompt-capture-memory', Stop: 'stop-update-memory'}` to `{UserPromptSubmit: 'sidecar-dispatch', Stop: 'sidecar-capture', SessionEnd: 'sidecar-evaluate'}`. When `init.ts` runs `removeMemoryHooks(content)` then `addMemoryHooks(cleaned, devflowDir)`, the remove only matches the new marker names. For users upgrading, old hooks (`prompt-capture-memory`, `stop-update-memory`) remain as orphans in settings.json. Additionally, the old `session-end-learning`, `session-end-decisions`, and `session-end-knowledge-refresh` hooks are no longer removed by `removeLearningHook`/`removeDecisionsHook`/`removeKnowledgeHook` (those functions were deleted). These orphan hooks will fire but their scripts won't exist in `~/.devflow/scripts/hooks/`, causing run-hook to fail silently or log errors.
- Fix: Add the old hook markers to the `removeMemoryHooks` function or add a migration step in init.ts:
```typescript
// In init.ts, inside the legacy hook cleanup section:
const LEGACY_HOOK_FILES = [
  'ambient-prompt',
  'session-end-kb-refresh',
  'background-kb-refresh',
  'lib/feature-kb.cjs',
  'background-learning',
  // Sidecar consolidation: replaced by sidecar-dispatch/capture/evaluate
  'prompt-capture-memory',
  'stop-update-memory',
  'stop-update-learning',
  'session-end-learning',
  'session-end-decisions',
  'session-end-knowledge-refresh',
  'background-knowledge-refresh',
  'background-memory-update',
];
```
And add a legacy hook removal pass in the settings.json processing that strips hooks matching the old markers.

### MEDIUM

**sentinel.test.ts: pre-compact-memory test uses old sentinel** - `tests/sentinel.test.ts:116-125`
**Confidence**: 98%
- Problem: Test "exits cleanly when .working-memory-disabled exists" creates the old `.working-memory-disabled` sentinel, but `pre-compact-memory` now reads sidecar config. The test fails because the hook proceeds past the (now-absent) sentinel check and writes `backup.json`. This is a confirmed test failure (verified by running `vitest`).
- Fix: Update the test to use sidecar config instead of the old sentinel:
```typescript
it('exits cleanly when sidecar config has memory: false', () => {
  mkMemoryDir(tmpDir);
  const sidecarDir = path.join(tmpDir, '.memory', '.sidecar');
  fs.mkdirSync(sidecarDir, { recursive: true });
  fs.writeFileSync(path.join(sidecarDir, 'config.json'), JSON.stringify({ memory: false }));
  const input = sessionInput(tmpDir);
  expect(() => {
    execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
  }).not.toThrow();
  expect(fs.existsSync(path.join(tmpDir, '.memory', 'backup.json'))).toBe(false);
});
```

**Integration test references removed --run-background** - `tests/integration/learning/end-to-end.test.ts:231`
**Confidence**: 95%
- Problem: The integration test `devflow learn --run-background end-to-end pipeline` still calls `node dist/cli.js learn --run-background --cwd <dir>`, but the `--run-background` option was removed from `learn.ts`. This test will fail at runtime. The test file was not modified in this branch.
- Fix: Either remove the test (if the sidecar system replaces the --run-background flow entirely) or adapt it to test the new sidecar-evaluate + sidecar-dispatch marker-based flow.

**memory --disable no longer removes hooks from settings.json** - `src/cli/commands/memory.ts:350-365`
**Confidence**: 85%
- Problem: The old `memory --disable` removed all 4 memory hooks from settings.json. The new `memory --disable` only writes `memory: false` to sidecar config and drains queue files. This is intentional (hooks are shared across features), but the user-facing message and help text still say "Remove memory hooks" (line 209: `'--disable', 'Disable working memory via sidecar config'` but the help block at line 218 says `Remove memory hooks`). More importantly, if a user does `devflow memory --disable` followed by `devflow memory --status`, the status check at line 314 shows "disabled" (because `!featureEnabled`), which is correct. But if they then check `devflow learn --status`, it might show "enabled" with hooks present -- this is correct behavior but could confuse users since hooks are shared. The help text inconsistency should be fixed.
- Fix: Update the help text:
```typescript
`${color.cyan('devflow memory --disable')}  Disable working memory\n` +
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale comment in init.ts referencing --run-background** - `src/cli/commands/init.ts:1040`
**Confidence**: 90%
- Problem: Comment says "background-learning replaced by TypeScript CLI (devflow learn --run-background)" but `--run-background` was removed in this branch. The comment is now misleading.
- Fix: Update to: `// decisions agent decoupling: background-learning replaced by sidecar-evaluate marker system`

**No legacy hook cleanup in init for sidecar migration** - `src/cli/commands/init.ts:1032-1047`
**Confidence**: 88%
- Problem: The `LEGACY_HOOK_FILES` list in init.ts does not include the 8 deleted hook scripts. Users upgrading will have stale scripts in `~/.devflow/scripts/hooks/`. While these scripts are harmless (not referenced by any registered hook), they waste disk space and could confuse developers inspecting the hooks directory.
- Fix: Add the deleted hooks to `LEGACY_HOOK_FILES` (see fix in blocking issue above).

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **sidecar-evaluate: knowledge refresh uses .features/.knowledge-last-refresh** - `scripts/hooks/sidecar-evaluate:371` (Confidence: 65%) -- The knowledge throttle marker is written to `.features/.knowledge-last-refresh` (project directory, committed to git), while the sidecar config lives in `.memory/.sidecar/`. This dual-location pattern makes the throttle visible in version control. May be intentional (matches old behavior) but could cause surprises in CI environments.

- **Uninstall does not clean sidecar directory** - `src/cli/commands/uninstall.ts:336-368` (Confidence: 70%) -- The uninstall command offers to remove `.memory/` (which includes `.memory/.sidecar/`), but if the user declines, the sidecar config persists. A fresh install would then inherit old enable/disable settings. May be acceptable since `devflow init` writes a full sidecar config.

- **sidecar-evaluate jq user turn counting may over-count** - `scripts/hooks/sidecar-evaluate:71` (Confidence: 60%) -- Uses `jq -c 'select(.type == "user")'` then `wc -l`. If a transcript line contains nested JSON with `.type == "user"`, jq would match it. The old `session-end-decisions` used `grep -c '"type":"user"'` which had the same issue. Low risk since transcript format is controlled.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The core sidecar consolidation is well-structured -- the 3 new hooks correctly implement the functionality of the 8 deleted hooks. However, there are three HIGH-severity migration gaps that will cause user-visible regressions:

1. `session-start-context` still checks the old `.learning-disabled` sentinel that the CLI no longer manages, breaking the learning feature toggle for both new disables and existing sentinels.
2. `--reset` commands look for state files at the old paths, leaving sidecar state uncleaned.
3. Upgrading users will have orphan old hooks in settings.json that fire against non-existent scripts.

Additionally, there is one confirmed test failure (sentinel.test.ts) and one broken integration test (end-to-end.test.ts) that need fixing.
