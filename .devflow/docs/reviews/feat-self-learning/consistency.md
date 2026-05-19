# Consistency Review Report

**Branch**: feat/self-learning -> main
**Date**: 2026-03-23

## Issues in Your Changes (BLOCKING)

### HIGH

**Manifest `learn` field is optional while peer features are required** - `src/cli/utils/manifest.ts:15`
**Confidence**: 90%
- Problem: The `learn` field is declared `learn?: boolean` (optional) while the peer features `teams`, `ambient`, and `memory` are all required (`boolean`, not `boolean?`). Only `hud` shares the optional pattern, which was likely done for backwards compatibility when `hud` was added. Since `learn` is brand-new and the init flow always writes a value, making it optional introduces an asymmetry where code reading the manifest must null-check `learn` but not the others.
- Fix: Declare as `learn: boolean` (required) to match `teams`, `ambient`, `memory`. The default `false` in the fresh-manifest path in `init.ts:198` already ensures it is always written.

```typescript
features: {
  teams: boolean;
  ambient: boolean;
  memory: boolean;
  learn: boolean;   // not optional — always written by init
  hud?: boolean;    // remains optional for backwards compat
};
```

**devflowDir resolution inconsistency between learn.ts and ambient.ts** - `src/cli/commands/learn.ts:425-441`
**Confidence**: 85%
- Problem: The `learn` command resolves its fallback `devflowDir` via `getDevFlowDirectory()` (which respects `DEVFLOW_DIR` env var), while the `ambient` command uses `path.join(process.env.HOME || '~', '.devflow')` as its fallback. These should use the same resolution strategy. `getDevFlowDirectory()` is the stronger choice (env override support), but the inconsistency means the two commands could resolve to different directories in the same environment.
- Fix: This is actually learn.ts being MORE correct than ambient.ts. However, for consistency within this PR, either both should use `getDevFlowDirectory()` or both should use the hardcoded path. Recommend aligning ambient.ts to match learn.ts in a follow-up (learn.ts is fine as-is).

### MEDIUM

**Stop hook passes different arg count to background script** - `scripts/hooks/stop-update-learning:68` vs `scripts/hooks/stop-update-memory:78`
**Confidence**: 85%
- Problem: `stop-update-memory` passes 4 args to its background script (`$CWD`, `$SESSION_ID`, `$MEMORY_FILE`, `$CLAUDE_BIN`), while `stop-update-learning` passes only 3 (`$CWD`, `$SESSION_ID`, `$CLAUDE_BIN`). The `background-learning` script accepts only 3 positional args (`$1=CWD`, `$2=SESSION_ID`, `$3=CLAUDE_BIN`). This is functionally correct (learning has no equivalent of `$MEMORY_FILE`), but the positional arg interface pattern diverges. Not blocking because the scripts are self-consistent, but a reader familiar with the memory hooks will expect the same shape.
- Fix: Acceptable as-is since the scripts are self-contained. Consider adding a comment in `stop-update-learning` noting the intentional deviation: `# Note: no MEMORY_FILE arg — learning log path derived internally`.

**Missing `--status` early return for missing settings.json** - `src/cli/commands/learn.ts:1234-1236`
**Confidence**: 88%
- Problem: Both `ambient.ts` and `memory.ts` have a dedicated early return inside the settings.json catch block when `--status` is requested (`'disabled (no settings.json found)'`). The `learn` command does not — it falls through with `'{}'` which works but produces a less informative message (just `'disabled'` without the "no settings.json" explanation). This is a minor UX inconsistency.
- Fix: Add the same early-return pattern as ambient/memory inside the settings catch block:

```typescript
try {
  settingsContent = await fs.readFile(settingsPath, 'utf-8');
} catch {
  if (options.status) {
    const cwd = process.cwd();
    const logPath = path.join(cwd, '.memory', 'learning-log.jsonl');
    let observations: LearningObservation[] = [];
    try {
      const logContent = await fs.readFile(logPath, 'utf-8');
      observations = parseLearningLog(logContent);
    } catch { /* no log */ }
    const status = formatLearningStatus(observations, false);
    p.log.info(status);
    return;
  }
  settingsContent = '{}';
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Duplicated interface definitions across ambient.ts, memory.ts, learn.ts** - `src/cli/commands/learn.ts:11-23`
**Confidence**: 82%
- Problem: `HookEntry`, `HookMatcher`, and `Settings` interfaces are identically defined in `ambient.ts`, `memory.ts`, and now `learn.ts`. This is a pre-existing DRY violation that the new file perpetuates. Three identical interface blocks across three files.
- Fix: Not blocking for this PR since it follows the existing pattern. Recommend extracting to a shared `src/cli/utils/settings-types.ts` in a follow-up.

**`removeLearningHook` has a `before`-length early return that `removeAmbientHook` lacks** - `src/cli/commands/learn.ts:1082-1089`
**Confidence**: 80%
- Problem: `removeLearningHook` checks `if (settings.hooks.Stop.length === before) { return settingsJson; }` before re-serializing, while `removeAmbientHook` always re-serializes even when the filter removed nothing. The learn version is technically more correct (avoids unnecessary JSON round-trip whitespace changes), but the behavioral difference means the two remove functions have subtly different semantics: one is truly idempotent (returns exact same string), the other may change formatting. Since `addLearningHook` compares via string equality (`updated === settingsContent`), this matters.
- Fix: The learn.ts pattern is better. Not blocking since ambient.ts has the same practical effect (no matching hook means the early `if (!settings.hooks?.UserPromptSubmit)` catches it). Note for future: consider aligning ambient.ts.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`hud.ts` uses `node:` prefixed imports while all other command files use bare specifiers** - `src/cli/commands/hud.ts:2-3`
**Confidence**: 92%
- Problem: `hud.ts` imports `from 'node:fs'` and `from 'node:path'` while every other command file (ambient.ts, memory.ts, learn.ts, init.ts, uninstall.ts, skills.ts) uses `from 'fs'` and `from 'path'`. The new `learn.ts` correctly follows the majority pattern (`from 'fs'`, `from 'path'`).
- Fix: Out of scope for this PR. The new code is consistent with the majority.

### LOW

**PF-002 (init handler monolith) grows further** - `src/cli/commands/init.ts`
**Confidence**: 85%
- Problem: Known pitfall PF-002 documents that init.ts is a monolith (~765 lines). This PR adds ~30 more lines (learning prompt + hook registration). The resolution ("extract into collectInitChoices, executeInstallation, printSummary") has not been applied.
- Fix: Pre-existing architectural issue. The new code follows the existing pattern correctly. Track separately.

## Suggestions (Lower Confidence)

- **`background-learning` uses `date -j -f` (macOS-only) for date parsing** - `scripts/hooks/background-learning:290,478,493` (Confidence: 70%) -- The `date -j -f` fallback chain handles Linux via `date -d`, but this is a fragile cross-platform pattern. The existing `background-memory-update` script uses the same approach, so this is consistent, but worth noting.

- **Section numbering "1.75" in session-start-memory is unconventional** - `scripts/hooks/session-start-memory:130` (Confidence: 65%) -- The comment `# --- Section 1.75: Learned Behaviors ---` uses a fractional section number. While creative for insertion ordering, it signals the file is growing and may benefit from a more structured approach.

- **`parseLearningLog` casts without runtime validation beyond 3 fields** - `src/cli/commands/learn.ts:133-134` (Confidence: 72%) -- The function checks `parsed.id && parsed.type && parsed.pattern` but casts the full object as `LearningObservation` without verifying other required fields like `confidence`, `observations`, `status`. Follows the project's boundary validation guidance loosely.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new `learn` feature closely mirrors the existing `ambient` and `memory` patterns across TypeScript (hook add/remove/has functions, CLI command structure, imports, test style) and shell scripts (stop-hook + background-worker architecture, locking, throttling, logging). The consistency is strong overall.

Two HIGH issues warrant attention: the manifest type inconsistency (`learn?:` should be `learn:` to match peers) and the devflowDir resolution difference (minor, and learn.ts is actually the better version). The missing `--status` early return for absent settings.json is a MEDIUM UX gap compared to the ambient/memory commands. The duplicated interfaces are a pre-existing pattern and not blocking.

Shell scripts follow the same structural template as the memory hooks (stop hook -> background worker, mkdir-based locking, stale lock recovery, throttle markers, nohup+disown), demonstrating good pattern reuse.
