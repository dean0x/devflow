# Reliability Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Sentinel check ordering allows partial work before guard in stop-update-memory** - `scripts/hooks/stop-update-memory:40`
**Confidence**: 85%
- Problem: The `.working-memory-disabled` sentinel check at line 40 runs after `ensure-memory-gitignore` (line 38), meaning the hook creates `.memory/` and updates `.gitignore` even when the feature is disabled. While not functionally dangerous, it produces side effects during a disabled state — violating the principle that a disabled feature should be inert. Other memory hooks (prompt-capture-memory:26, pre-compact-memory:25) check the sentinel earlier but still after `ensure-memory-gitignore`. Only `session-start-memory:21` and `background-memory-update:26` check the sentinel before any filesystem work.
- Fix: Move the sentinel check before `ensure-memory-gitignore` in `stop-update-memory` (and `prompt-capture-memory`) so disabled hooks produce zero filesystem side effects:
```bash
# Check sentinel BEFORE ensure-memory-gitignore
[ -f "$CWD/.memory/.working-memory-disabled" ] && exit 0

source "$SCRIPT_DIR/ensure-memory-gitignore" "$CWD" || exit 0
```

**Sentinel race: disable creates sentinel but does not drain pending queue** - `src/cli/commands/memory.ts:352-355`
**Confidence**: 82%
- Problem: When `devflow memory --disable` writes the `.working-memory-disabled` sentinel, it does not drain or remove the pending queue (`.pending-turns.jsonl`). A background updater may already be spawned (from a prior stop-hook invocation) and currently waiting on a lock. That spawned background process checks the sentinel at line 26 of `background-memory-update` and will abort, which is correct. However, the orphaned `.pending-turns.jsonl` file will remain on disk indefinitely. The user would need to manually run `devflow memory --clear` to clean it. This is not a data loss risk (the file is ephemeral), but it is a resource hygiene issue that could accumulate across disable/enable cycles.
- Fix: After writing the sentinel, attempt to clean the pending queue:
```typescript
// Write runtime sentinel
await fs.writeFile(sentinel, '', 'utf-8');
// Clean up orphaned queue files (best-effort)
try { await fs.unlink(path.join(memDir, '.pending-turns.jsonl')); } catch { /* may not exist */ }
try { await fs.unlink(path.join(memDir, '.pending-turns.processing')); } catch { /* may not exist */ }
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**session-start-context: `set -e` makes entire hook fragile to transient failures** - `scripts/hooks/session-start-context:11`
**Confidence**: 85%
- Problem: The hook uses `set -e` (line 11) which causes any non-zero exit to terminate the entire script. While individual sections use `2>/dev/null || true` patterns to suppress expected errors, any unexpected failure in bash built-ins, variable expansion, or unhandled command errors will silently kill the hook. This is the same pattern used in `session-start-memory` (line 11) so it is consistent across hooks, but it represents a reliability concern in an always-on hook that crosses feature boundaries. A failure in the decisions TL;DR section (Section 1.5) would prevent the learned behaviors section (Section 1.75) from executing, even though they are independent.
- Fix: Since the hook is designed as independently-gated sections, consider removing `set -e` and relying on the existing explicit error handling (`|| true`, `|| exit 0`) that is already in place for each section. Alternatively, wrap each section in a subshell:
```bash
# Section 1.5 in subshell — failure doesn't affect 1.75
(
  if [ ! -f "$CWD/.memory/decisions/.disabled" ]; then
    # ... decisions TL;DR logic ...
  fi
) 2>/dev/null || true
```

**`date +%s` written to NOTIFIED_MARKER without error handling** - `scripts/hooks/session-start-context:136`
**Confidence**: 80%
- Problem: `date +%s > "$NOTIFIED_MARKER"` will fail silently if the `.memory/` directory is read-only or the filesystem is full. Under `set -e`, this would terminate the hook before it outputs any context. The `LAST_NOTIFIED` read on line 122 has a fallback (`|| echo "0"`), but the write does not.
- Fix: Add error suppression:
```bash
date +%s > "$NOTIFIED_MARKER" 2>/dev/null || true
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**CI status gate polling loop lacks explicit sleep timeout** - `shared/skills/implement:orch/SKILL.md:162`, `shared/skills/resolve:orch/SKILL.md:126`, `plugins/devflow-resolve/commands/resolve.md:261`, `plugins/devflow-resolve/commands/resolve-teams.md:261`
**Confidence**: 82%
- Problem: The CI status gate pattern specifies "poll every 60 seconds (global budget, see step 6)" with a total budget of "max 10 polls and max 2 fix attempts." This is a bounded retry pattern (good), but the budget description is split across two non-adjacent steps (step 4 and step 6), making it possible for an implementer to misread the polling bound as step-local rather than global. The updated wording "global budget, see step 6" improves this but the enforcement is left to the orchestrator's interpretation.
- Fix: No code change needed since the budget is explicitly stated. This is an observation about documentation clarity.

## Suggestions (Lower Confidence)

- **Sentinel check in decisions-usage-scan.cjs uses synchronous fs** - `scripts/hooks/decisions-usage-scan.cjs:30` (Confidence: 70%) — The `fs.existsSync` sentinel check is synchronous and blocking. In a hot-path scenario (stop hook fires on every turn), this adds a synchronous filesystem stat on every assistant response. The scanner already exits early for missing `.memory/` on line 27, so the sentinel check is a second stat. Acceptable for a shell-script-invoked CJS module, but worth noting.

- **No timeout on `node "$_JSON_HELPER" reconcile-manifest` in session-start-context** - `scripts/hooks/session-start-context:35,40` (Confidence: 65%) — The reconciliation calls spawn a Node process without any timeout. If `json-helper.cjs reconcile-manifest` hangs (e.g., due to a corrupted JSONL file causing an infinite parse loop), the SessionStart hook would block indefinitely. The Claude Code hook system has a 10-second timeout configured in the hook entry, which provides an external bound, so this is mitigated.

- **memory.ts --disable does not verify sentinel was actually written** - `src/cli/commands/memory.ts:354` (Confidence: 62%) — `fs.writeFile(sentinel, '', 'utf-8')` could fail (ENOSPC, EACCES), and the error is not caught. The user would see "Working memory disabled" but the sentinel would be missing, leaving hooks active at runtime. A try/catch with a warning would be more defensive.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Reliability Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The sentinel-based disable guard pattern is well-designed and consistently applied across all hooks — every memory hook checks `.working-memory-disabled`, the learning hook checks `.learning-disabled`, and the decisions scanner checks `decisions/.disabled`. The bounded iteration patterns in the codebase (lock timeouts, queue overflow caps, retry limits) are solid. The CI status gate's total budget constraint (max 10 polls + max 2 fix attempts) provides a clear upper bound. applies ADR-001 — the sentinel pattern introduces no migration code; it is a purely additive mechanism that existing installs gain on next `devflow init`. avoids PF-001 — no backward-compat shims or migration scripts are introduced for the sentinel files.

The two blocking MEDIUM issues (sentinel check ordering and queue drain on disable) represent minor defensive gaps that should be addressed before merge. The `set -e` concern in the always-on `session-start-context` hook is a should-fix since a failure in one independent section should not prevent others from executing.
