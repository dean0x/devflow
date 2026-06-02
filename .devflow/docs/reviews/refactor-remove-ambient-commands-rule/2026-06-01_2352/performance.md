# Performance Review Report

**Branch**: refactor-remove-ambient-commands-rule (PR #233) -> main
**Date**: 2026-06-01 23:52

## Scope & Verification

PR removes the always-on `commands.md` ambient rule (`shared/rules/commands.md`, 26
lines) and collapses ambient mode to the preamble hook only. A new
`removeLegacyCommandsRule()` purges the stale rule file from prior installs.

The review focus was: (1) confirm no new per-prompt / per-session I/O, and (2) confirm
the new `fs.unlink` is not on a hot path.

**Verification performed:**

- `scripts/hooks/preamble` (the per-prompt UserPromptSubmit hook) — **unchanged** in this
  diff (`git diff main...HEAD -- scripts/hooks/preamble` returns nothing). The hot path is
  untouched. Confirmed.
- `removeLegacyCommandsRule()` (`ambient.ts:63-69`) performs a single `fs.unlink` on
  `~/.claude/rules/devflow/commands.md`, swallowing ENOENT.
- Call-graph traced — `removeLegacyCommandsRule` is invoked only from `addAmbientHook`
  (`ambient.ts:103`) and `removeAmbientHook` (`ambient.ts:124`). Those two are called only
  from:
  - `ambient.ts:211,223` — `devflow ambient --enable/--disable` CLI handlers
  - `init.ts:1131-1132` — one-time `devflow init` settings pass
  - `uninstall.ts:275,371` — `devflow uninstall`

  All are cold, operator-invoked CLI commands. None run per-prompt or per-session at
  runtime. The unlink is NOT on any hot path. Confirmed.

**Net runtime effect:** one fewer always-on rule file loaded into every Claude Code
session context (a per-session context reduction, as the PR claims). No new runtime I/O
is introduced — the only added I/O (`fs.unlink`) lives on cold CLI paths. The plan's
performance claims hold.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None relevant to performance.

## Suggestions (Lower Confidence)

- **Idempotent unlink runs unconditionally on every init/enable/disable** -
  `ambient.ts:103,124` (Confidence: 70%) — `removeLegacyCommandsRule` issues an `fs.unlink`
  syscall even when the legacy file was already purged on a prior run, so steady-state
  `devflow init` runs pay one wasted ENOENT syscall. This is negligible (sub-100µs, cold
  path, runs at most once per CLI invocation) and the unconditional design is intentional
  per the doc comment (guarantees cleanup). Not worth changing; noted only for
  completeness.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 10
**Recommendation**: APPROVED
