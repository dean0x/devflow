# Security Review Report

**Branch**: refactor-rename-kb-to-knowledge -> main
**Date**: 2026-05-04

## Issues in Your Changes (BLOCKING)

### HIGH

**Orphaned hook entry causes session-end error on upgrade** - `src/cli/commands/knowledge/toggle.ts:10`, `src/cli/commands/init.ts:952`
**Confidence**: 90%
- Problem: The `removeKnowledgeHook` function only searches for the marker `session-end-knowledge-refresh`, but existing installations have the old hook registered as `session-end-kb-refresh`. During `devflow init` (the upgrade path), the code calls `removeKnowledgeHook` (remove-then-add pattern at line 952 of init.ts), which will NOT find or remove the old hook. The old script `scripts/hooks/session-end-kb-refresh` is deleted in this PR. After upgrade, sessions will trigger `run-hook session-end-kb-refresh` which executes `bash "$SCRIPT_DIR/session-end-kb-refresh"` — a file that no longer exists — causing a non-zero exit on every session end.
- Impact: While not a direct security vulnerability, this causes (1) error noise that may mask real hook failures, (2) potential denial of service on the SessionEnd hook pipeline if the error propagates, and (3) a stale entry in settings.json referencing a non-existent script — a pattern that in other contexts could be exploited if an attacker gains write access to the scripts directory and plants a file with the old name.
- Fix: The `removeKnowledgeHook` function (or a companion function called during init) should also strip entries containing the old marker `session-end-kb-refresh`:

```typescript
// In toggle.ts
const KNOWLEDGE_HOOK_MARKER = 'session-end-knowledge-refresh';
const LEGACY_KB_HOOK_MARKER = 'session-end-kb-refresh';

export function removeKnowledgeHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  let changed = false;

  const matchers = settings.hooks?.SessionEnd;
  if (matchers) {
    const filtered = matchers.filter(
      (m) => !m.hooks.some((h) =>
        h.command.includes(KNOWLEDGE_HOOK_MARKER) ||
        h.command.includes(LEGACY_KB_HOOK_MARKER)
      ),
    );
    if (filtered.length < matchers.length) changed = true;
    // ... rest unchanged
  }
  // ...
}
```

## Issues in Code You Touched (Should Fix)

_None identified._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`--dangerously-skip-permissions` in background agent spawns** - `scripts/hooks/background-knowledge-refresh:155`, `src/cli/utils/knowledge-agent.ts:78`
**Confidence**: 85%
- Problem: Background claude processes run with `--dangerously-skip-permissions`, bypassing all tool approval. This is a pre-existing pattern (identical in the old `background-kb-refresh` and `kb-agent.ts`) with mitigations (`--allowedTools` restricts to `Read,Grep,Glob,Write,Skill`). The tool allowlist reduces blast radius but does not eliminate risk — a compromised prompt or model could write arbitrary files within the worktree.
- Note: This is informational only; the pattern was accepted in the previous code and carries the same risk profile after the rename.

### LOW

**CJS module uses `require.main === module` CLI dispatch with user-supplied argv** - `scripts/hooks/lib/feature-knowledge.cjs:438`
**Confidence**: 80%
- Problem: The CLI interface accepts worktree paths and slugs from argv. The `validateSlug` function provides robust defense-in-depth (rejects `..`, `/`, `\`, leading `.`, enforces kebab-case regex). The `requireWorktree` function resolves and validates directory existence. This is a pre-existing pattern (identical in old `feature-kb.cjs`) with adequate mitigations. The architecture exception comment (lines 7-15) correctly documents the accepted risk.
- Note: No change in security posture from the rename. The defense-in-depth measures (slug validation, `execFileSync` with array args, directory existence checks) are preserved correctly.

## Suggestions (Lower Confidence)

- **Migration does not handle TOCTOU on rename** - `src/cli/utils/migrations.ts:153-155` (Confidence: 65%) — The migration checks `fs.access(oldPath)` then calls `fs.rename(oldPath, newPath)`. In theory another process could remove the file between access and rename. In practice this is a one-shot migration on local dev machines with low contention, making exploitation extremely unlikely.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 1 |

**Security Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The single blocking issue (orphaned old hook entry not cleaned during upgrade) should be addressed before merge. The fix is straightforward — add the legacy marker to the removal filter. All other security properties (slug validation, execFileSync with array args, path construction, no secret exposure, CJS module boundaries) are properly preserved from the old code.
