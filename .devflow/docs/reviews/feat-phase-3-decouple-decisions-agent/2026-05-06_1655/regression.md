# Regression Review Report

**Branch**: feat-phase-3-decouple-decisions-agent -> main
**Date**: 2026-05-06
**PR**: #203

## Issues in Your Changes (BLOCKING)

### CRITICAL

_(none)_

### HIGH

**Notification file path mismatch between learning render-ready and learn --dismiss-capacity / --review capacity** - `src/cli/commands/learn.ts:577`, `src/cli/commands/learn.ts:1310`, `src/cli/commands/learn.ts:1258`
**Confidence**: 95%
- Problem: The learning pipeline's `render-ready` call at line 577 does NOT pass `--notifications-path`, so json-helper.cjs defaults to writing capacity notifications to `.memory/.notifications.json`. However, `devflow learn --dismiss-capacity` (line 1310) and `--review capacity` (line 1258) both read from `.memory/.learning-notifications.json`. After the split migration renames `.notifications.json` to `.decisions-notifications.json`, the learning pipeline recreates `.notifications.json` on next render, while the dismiss/review commands look at `.learning-notifications.json` which never gets written. Result: users cannot dismiss learning-originated capacity notifications.
- Fix: Either (a) pass `--notifications-path .memory/.learning-notifications.json` to the render-ready call in learn.ts line 577, or (b) change the dismiss-capacity and review-capacity paths back to `.notifications.json`. Option (a) is the correct fix since it matches the new split architecture.

```typescript
// learn.ts line 577 — add --notifications-path
execFileSync('node', [
  jsonHelperPath, 'render-ready', logFile, cwd,
  '--notifications-path', path.join(memoryDir, '.learning-notifications.json'),
], { stdio: 'pipe' });
```

**learn --reset transient files list misses `.notifications.json` (legacy) and references non-existent `.learning-notifications.json`** - `src/cli/commands/learn.ts:847`
**Confidence**: 85%
- Problem: The `--reset` transient files list was changed from `.notifications.json` to `.learning-notifications.json`. But since the learning pipeline's render-ready still writes to `.notifications.json` (as noted above), `--reset` won't clean up the actual file. Even after the render-ready path is fixed to use `.learning-notifications.json`, the reset should also clean the legacy `.notifications.json` for users who ran the old pipeline before upgrading.
- Fix: Include both `.notifications.json` and `.learning-notifications.json` in the transient files list.

```typescript
const transientFiles = [
  '.learning-session-count',
  '.learning-batch-ids',
  '.learning-runs-today',
  '.learning-notified-at',
  '.notifications.json',          // legacy (pre-split)
  '.learning-notifications.json', // post-split
  '.decisions-usage.json',
  '.learning-manifest.json',
];
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Decision/pitfall threshold change from required=2 to required=1 alters promotion timing** - `scripts/hooks/json-helper.cjs:92-93`
**Confidence**: 80%
- Problem: The `THRESHOLDS` for `decision` and `pitfall` changed from `required: 2` to `required: 1`. While this is intentional for the new single-session decisions pipeline (batch_size=1), it changes behavior for any existing projects that already have decision/pitfall observations at count=1 and quality_ok=true. On the very next `process-observations` run (even from the learning pipeline), those observations will jump from 0.33 confidence to 0.95 on their second sighting and immediately promote to `ready`, whereas previously they needed a third sighting. This is a behavioral change, not a bug, but it should be documented or at least flagged since it changes the bar for promotion.
- Fix: Consider documenting the threshold change in commit messages or CLAUDE.md. The change itself is logically correct for a batch_size=1 pipeline.

## Pre-existing Issues (Not Blocking)

_(none)_

## Suggestions (Lower Confidence)

- **Split migration runs on every session start until sentinel is written** - `scripts/hooks/session-start-memory:109` (Confidence: 65%) -- The split migration is invoked on every session start before the sentinel exists. For fresh projects with no `.memory/` directory, the migration creates the sentinel on first run, but the overhead of spawning a Node process on every session start (even if it exits immediately after the sentinel check) adds latency. Consider moving the sentinel check into the bash hook itself before invoking Node.

- **decisions --reset removes `decisions/` directory entirely including `.disabled` sentinel** - `src/cli/commands/decisions.ts:508` (Confidence: 70%) -- The `--reset` attempts `rmdir` on `.memory/decisions/` which contains both the `.disabled` sentinel and the decisions/pitfalls markdown files. If the directory is non-empty (contains `decisions.md` or `pitfalls.md`), `rmdir` will fail silently. But if only `.disabled` was present and no markdown files exist, the sentinel gets removed and decisions become re-enabled without the user explicitly opting in. This edge case likely only matters for users who disabled decisions before any observations were generated.

- **No `background-learning` in LEGACY_HOOK_FILES cleanup list** - `src/cli/commands/init.ts:940-952` (Confidence: 75%) -- The deleted `background-learning` bash script should be added to `LEGACY_HOOK_FILES` so that `devflow init` cleans it up from `~/.devflow/scripts/hooks/` on upgrade. Currently it will persist as a dead file in the devflow install directory.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The core decoupling architecture is sound -- splitting the monolithic bash script into TypeScript utilities, creating separate session-end hooks, split migration, and dual log/manifest/notification files is well-designed. The main regression risk is the notification file path mismatch between the learning pipeline's render-ready (writes `.notifications.json`) and the learn CLI's dismiss/review commands (read `.learning-notifications.json`). This breaks the capacity notification dismiss workflow for the learning pipeline. The fix is straightforward: pass `--notifications-path` to the learning render-ready call. The threshold change (required 2 -> 1) is an intentional behavioral shift that aligns with the batch_size=1 decisions pipeline design. applies ADR-001 -- the split migration is appropriate here since it preserves user data rather than adding backward-compat API surface; avoids PF-001 -- no rename compat shims were added.
