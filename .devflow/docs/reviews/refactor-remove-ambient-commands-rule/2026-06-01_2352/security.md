# Security Review Report

**Branch**: refactor-remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-01_2352

## Summary of Review Scope

Focused on the filesystem deletion path introduced by this PR
(`removeLegacyCommandsRule` -> `fs.unlink`), its error handling, and any
path-injection surface. Reviewed `src/cli/commands/ambient.ts`,
`src/cli/commands/init.ts`, `src/cli/plugins.ts`, `tests/ambient.test.ts`,
and the deleted `shared/rules/commands.md`. Docs changes are out of scope for
a security lens.

No blocking, should-fix, or pre-existing security issues at >=80% confidence.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None at CRITICAL severity. (Per the Iron Law, only CRITICAL pre-existing
issues are reported; none found.)

## Suggestions (Lower Confidence)

None.

## Security Assessment Detail

The deletion path was examined closely and is sound:

- **No path-injection surface** (`ambient.ts:21`, `ambient.ts:63-69`).
  `COMMANDS_RULE_PATH` is a hardcoded constant derived solely from
  `os.homedir()` via `path.join(os.homedir(), '.claude', 'rules', 'devflow',
  'commands.md')`. No user input, CLI argument, env var, or settings.json
  value flows into the path passed to `fs.unlink`. There is no traversal,
  concatenation, or interpolation. The unlink targets a single fixed file.

- **Correct, scoped error handling** (`ambient.ts:64-68`). ENOENT is swallowed
  for idempotency; all other errors (e.g. EACCES) propagate via `throw err`.
  This aligns with the "fail honestly" principle — it does not silently
  swallow permission errors. Behavior is verified by tests at
  `tests/ambient.test.ts:329-345` (exists, ENOENT-swallow, EACCES-rethrow).

- **Ordering invariant is safe** (`ambient.ts:102-103`, `ambient.ts:123-124`).
  The purge runs unconditionally before the early-return in both
  `addAmbientHook` and `removeAmbientHook`. Since the target is fixed and the
  operation idempotent, running it on every enable/disable/init carries no
  security risk (no TOCTOU concern — single atomic unlink of a constant path).
  Covered by `tests/ambient.test.ts:94-105`.

- **No mass-deletion risk.** The function deletes exactly one file. No
  globbing, no directory recursion (`rm -rf` style), no rmdir. Even if
  `os.homedir()` were unexpectedly empty, the resolved path would be a
  relative `.claude/rules/devflow/commands.md`, and unlink would simply
  ENOENT or fail — no broad deletion.

- **`devflowDir` inference unchanged** (`ambient.ts:194-208`). The
  `path.resolve(hookBinary, '..', '..', '..')` logic that consumes a value
  from `settings.json` is pre-existing on `main` (verified via
  `git show main:...`) and not modified by this PR. It reads from the CLI's
  own trusted local config, not external attacker input, so no injection
  surface regardless. Out of scope as unchanged code; no CRITICAL concern.

- **No secrets, no injection, no auth surface.** `plugins.ts` and `init.ts`
  changes are description/help-text string edits only. The deleted
  `shared/rules/commands.md` was static documentation content with no
  executable surface.

Decisions context: `applies ADR-001` (no migration code — the PR purges the
legacy file at the enable/disable boundary rather than via a migration, and
`avoids PF-001`). This is a clean-break cleanup, consistent with the
documented architecture and `ADR-008` (deterministic plumbing only).

## Summary

| Category     | CRITICAL | HIGH | MEDIUM | LOW |
|--------------|----------|------|--------|-----|
| Blocking     | 0        | 0    | 0      | -   |
| Should Fix   | -        | 0    | 0      | -   |
| Pre-existing | -        | -    | 0      | 0   |

**Security Score**: 10
**Recommendation**: APPROVED
