# Reliability Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-02_0013

## Scope

Focus: reliability of the unconditional best-effort cleanup call
(`removeLegacyCommandsRule`) and its fail-safe error handling, per Cycle 1
resolution. Primary file under review: `src/cli/commands/ambient.ts`. Callers
verified: `addAmbientHook`, `removeAmbientHook` (ambient.ts), and the init
read-modify-write pass (`src/cli/commands/init.ts:1126-1132`).

Cross-cycle awareness applied: PRIOR_RESOLUTIONS reports Cycle 1 fixed exactly
this fail-safe behavior. Per instructions, I did NOT re-raise the original
propagation bug as new; I verified the fix is correct, complete, and
appropriately scoped.

Decisions applied: change is a clean-break removal of a deprecated rule with
purge-on-toggle cleanup (consistent with `applies ADR-001` clean-break posture).

## Verification of Cycle 1 Fix (no new blocking findings)

The fail-safe is **correct, complete, and correctly scoped**. Evidence:

1. **Swallow is minimal and correctly scoped** — `ambient.ts:66-72`. The
   `try` block wraps exactly one statement: `await fs.unlink(COMMANDS_RULE_PATH)`.
   The surrounding hook logic (`JSON.parse`, `filterHookEntries`,
   `JSON.stringify`) lives in the *caller* functions, entirely outside this
   try/catch. The fail-safe therefore cannot mask errors from `addAmbientHook` /
   `removeAmbientHook` — those still propagate normally (e.g. a corrupt
   settings.json still throws at `JSON.parse`, `ambient.ts:83`/`122`). This was
   the key concern in the review brief and it checks out.

2. **Unconditional execution before early-return is real** — the call sits at
   `ambient.ts:107` (before `if (!changed) return`) and `ambient.ts:128`
   (before `if (!removedPrompt && !removedClassification) return`). The
   ordering invariant is locked by a regression test (`ambient.test.ts:94-105`,
   "purges legacy rule even when preamble hook already present").

3. **Swallowing ALL errors (not just ENOENT) is the right call here.** The
   try body is a single `unlink` of one fixed, deprecated path. The complete
   error universe is non-actionable: ENOENT (already gone — the idempotent
   happy path), EACCES/EPERM/EROFS (unwritable filesystem — nothing the caller
   can do, and never worth aborting `devflow init` / ambient toggle). There is
   no genuine logic bug a narrower catch could surface, because the function
   performs no computation that could be wrong — only a side-effecting unlink.
   A narrow `if (code !== 'ENOENT') throw` would *reintroduce* the Cycle 1
   defect. Swallow-all is justified and the inline comment documents the
   reasoning accurately.

4. **Idempotency / quiet on absent file** — `fs.unlink` on a missing path
   rejects with ENOENT, which is swallowed → no output, no throw. Safe and
   quiet. Covered by `ambient.test.ts:335-339`.

5. **No unbounded behavior** — no loops, retries, or pagination. A single
   fixed-path unlink. Iron Law (bounded termination) satisfied trivially.

6. **Test coverage is complete for the fail-safe contract** — ENOENT swallow
   (`:335`), non-ENOENT/EACCES swallow (`:341`), happy-path unlink (`:329`),
   and ordering invariant (`:94`) are all asserted.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

## Pre-existing Issues (Not Blocking)

None at reportable confidence within the reliability lens.

## Suggestions (Lower Confidence)

- **Silent swallow emits no debug trace** - `src/cli/commands/ambient.ts:68`
  (Confidence: 65%) — A persistent EACCES/EPERM means the deprecated
  `commands.md` survives forever with zero diagnostic signal, so the cleanup
  silently never converges. This is acceptable for a deprecated-file purge, but
  a one-line debug log (gated on the existing `DEVFLOW_HOOK_DEBUG` / debug-trace
  facility) inside the catch would make a stuck cleanup observable without
  changing the fail-safe contract. Not blocking — purely diagnostic.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Reliability Score**: 9
**Recommendation**: APPROVED
