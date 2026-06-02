# Security Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main (PR #233)
**Date**: 2026-06-02_0013
**Diff**: `git diff main...HEAD`

## Scope

Deletion/refactor of CLI install plumbing in `src/cli/commands/ambient.ts` plus a
docs/manifest/test sweep. Security focus per orchestrator brief: path handling,
error swallowing that could hide security-relevant failures, and injection in
shell/file operations. No runtime data-handling, auth, crypto, or network code is
touched. `applies ADR-001` / `avoids PF-001` — the change is a clean-break deletion
with best-effort legacy cleanup and correctly adds no migration/compat code.

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

Note on the `removeLegacyCommandsRule` catch-all (`ambient.ts:65-73`): the function
now swallows ALL errors when unlinking `COMMANDS_RULE_PATH`. This was flagged and
intentionally resolved in cycle 1 (PRIOR_RESOLUTIONS: "made fail-safe — swallows ALL
errors so best-effort cleanup never aborts the caller"). Re-verified as NOT a security
issue and NOT regressed:
- `COMMANDS_RULE_PATH` is a fixed constant (`os.homedir()` + literal segments,
  `ambient.ts:21`) — no user/attacker input flows into the path, so no traversal or
  injection surface.
- The swallowed operation is `unlink` of a deprecated documentation file. The only
  failure outcome is that a benign stale `commands.md` survives — this grants no
  access, leaks no data, and weakens no security control. Swallowing here does not
  hide a security-relevant failure.
Per Cross-Cycle Awareness, not re-raised.

## Pre-existing Issues (Not Blocking)

The `devflowDir` inference at `ambient.ts:196-212` derives a directory from the
`Stop` hook command string in `settings.json` (`stopHook.split(' ')[0]` →
`path.resolve(..)`), then `addAmbientHook` interpolates it into the hook command
written back to `settings.json` (`path.join(devflowDir, 'scripts','hooks','run-hook') + ' preamble'`,
`ambient.ts:98`). This code is unchanged by this PR (context lines only — not added
or modified in the diff), so it is pre-existing and out of scope per the Iron Law.
It is also low-risk in practice: the source is the user's own local `settings.json`
(a trust boundary the user already controls), and the value is written as a hook
command path, not executed by this CLI. Noting for awareness only — not blocking.

## Suggestions (Lower Confidence)

None.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 1 |

**Security Score**: 10
**Recommendation**: APPROVED

### Rationale
- Pure deletion/refactor of install plumbing. No new injection, path-traversal, auth,
  crypto, secret, or network surface introduced.
- File path (`COMMANDS_RULE_PATH`) is a fixed, non-tainted constant — no traversal risk.
- File ops use `fs.unlink` on a constant path; no shell invocation, no string-built
  commands, no `exec`/`spawn`.
- The catch-all error swallowing is best-effort cleanup of a benign deprecated file
  and hides no security-relevant failure; intentionally resolved in cycle 1 and not
  regressed.
- All references to removed exports (`installCommandsRule`, `removeCommandsRule`,
  `COMMANDS_RULE_CONTENT`) are fully cleaned from `src/` and `tests/` — verified no
  dangling imports.
- Aligns with ADR-001 (clean break, no migration code) and avoids PF-001.
