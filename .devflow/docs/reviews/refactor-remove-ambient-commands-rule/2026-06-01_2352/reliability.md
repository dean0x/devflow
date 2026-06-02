# Reliability Review Report

**Branch**: refactor-remove-ambient-commands-rule -> main (PR #233)
**Date**: 2026-06-01_2352
**Focus**: Error-handling correctness in `removeLegacyCommandsRule` and its callers

## Verdict on the Posed Question

The PR_DESCRIPTION states the design intent: *"removeLegacyCommandsRule unlinks a path,
swallows ENOENT, propagates other errors. Called before the early-return in
addAmbientHook/removeAmbientHook."*

**Assessment: propagating non-ENOENT errors (EACCES etc.) from a best-effort legacy-file
purge is the wrong reliability posture.** A cleanup-of-a-deprecated-artifact step should be
fail-safe — its failure must never abort the primary operation (enabling/disabling ambient
mode, or initializing devflow) that previously succeeded. This violates the project
reliability rule's *"fail-safe defaults"* principle and creates a new failure mode where a
cosmetic cleanup error breaks unrelated, working functionality.

The clean-break purge itself is appropriate and aligns with the user's standing clean-break
philosophy (relevant context: PF-001) — the issue is purely the error-propagation posture of
the cleanup, not the decision to purge.

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Cleanup failure aborts the entire init settings-configuration pass** — `src/cli/commands/ambient.ts:63-69`, surfacing at `src/cli/commands/init.ts:1131-1132`
**Confidence**: 90%
- Problem: In `init.ts`, `removeAmbientHook` (line 1131) and `addAmbientHook` (line 1132)
  both call `removeLegacyCommandsRule()` unconditionally, before their early-returns. These
  run at the very top of a single read-modify-write block that subsequently configures
  **memory hooks, HUD statusLine, the always-on context hook, Claude Code flags, and
  viewMode** (lines 1134-1166). The whole block is wrapped in a silent `catch {}` at
  `init.ts:1176` whose comment only anticipates `settings.json may not exist yet`.
- Impact: If `~/.claude/rules/devflow/commands.md` exists but is not writable/unlinkable
  (EACCES, EPERM, EBUSY on Windows, EROFS), `removeLegacyCommandsRule` now throws. The throw
  fires before memory/HUD/context/flags/viewMode are applied, so `content` is never written
  (line 1168 is never reached) and the exception is silently eaten by the outer `catch {}`.
  Net effect: a single unwritable *deprecated* rule file silently disables memory hooks, HUD,
  the context hook, and flag configuration during `devflow init` — none of which have anything
  to do with the commands rule. Before this PR there was no commands-rule unlink in this path,
  so this is a newly introduced regression in a previously-working init flow.
- Fix: Make the legacy purge non-fatal. Swallow all errors from the cleanup (it is a
  best-effort purge of a deprecated artifact), or at most log a warning. Preferred:
  ```typescript
  export async function removeLegacyCommandsRule(): Promise<void> {
    try {
      await fs.unlink(COMMANDS_RULE_PATH);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return; // already gone — success
      // Best-effort cleanup of a deprecated file: never let it abort the
      // caller's primary operation (enable/disable/init). Log and continue.
      // (use the caller's logger if one is threaded through, otherwise swallow)
    }
  }
  ```
  If observability matters, thread a logger or return a `Result`/boolean the caller can
  surface as a dim warning — but do not `throw`.

**`devflow ambient --enable` now throws for a user lacking write perms to the legacy rule file** — `src/cli/commands/ambient.ts:103` and `:124`
**Confidence**: 88%
- Problem: Unlike `init.ts`, the `ambientCommand` action (lines 210-230) has **no
  surrounding try/catch** around `addAmbientHook`/`removeAmbientHook`. A propagated EACCES
  from `removeLegacyCommandsRule` therefore escapes to the top level and crashes the command
  with an unhandled rejection / stack trace.
- Impact: A user who previously could run `devflow ambient --enable` (or `--disable`)
  successfully will now get a hard failure — and crucially, the failure is in cleanup of a
  *deprecated* file, after which the actual hook write at `ambient.ts:217`/`:228` never
  happens. The primary operation regresses from "succeeds with a stale file left behind" to
  "fails entirely." Fail-safe defaults dictate that a deprecated-artifact purge must not be
  able to block enabling the feature.
- Fix: Same root fix as above — make `removeLegacyCommandsRule` non-fatal. Once the cleanup
  cannot throw on EACCES, both the init path and the ambient-command path retain their prior
  success behavior while still purging the file whenever permissions allow.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No test covers the non-ENOENT error path** — `tests/ambient.test.ts:16-105, 168`
**Confidence**: 85%
- Problem: Every test stubs `fs.unlink` to resolve successfully
  (`vi.spyOn(fs, 'unlink').mockResolvedValue(undefined)`). The branch that this PR
  deliberately introduces — `if (code !== 'ENOENT') throw err` at `ambient.ts:67` — has zero
  coverage. The ENOENT-swallow branch is also untested.
- Impact: The exact behavior the PR description calls out as the design decision (propagate
  non-ENOENT) is unverified, so a future change to the error posture (e.g. the fail-safe fix
  recommended above) could silently flip behavior with no failing test. For a function whose
  whole reason to exist is error discrimination, the error branches are the contract.
- Fix: Add two cases: (1) `fs.unlink` rejects with `{ code: 'ENOENT' }` → `removeLegacyCommandsRule`
  resolves (no throw); (2) `fs.unlink` rejects with `{ code: 'EACCES' }` → assert the chosen
  posture. If you adopt the fail-safe fix, this case asserts it resolves without throwing; if
  the current propagate-posture is kept, it asserts it rejects. Either way the contract is pinned.

---

## Pre-existing Issues (Not Blocking)

None material to reliability in the changed files. The `filterHookEntries` /
`isAmbient` / `isClassification` helpers are bounded (single `.filter`/`.some` over a
finite settings array) and contain no unbounded loops, retries, or allocation hot paths.
The devflow-dir inference block (`ambient.ts:193-208`) already guards `JSON.parse` with a
try/catch and falls back to a canonical default — that is correct fail-safe behavior and a
good model for the cleanup function to follow.

## Suggestions (Lower Confidence)

- **Cleanup ordering vs. write atomicity** — `ambient.ts:103`, `:124` (Confidence: 65%) — the
  legacy purge runs before the settings write, so on the `--enable` path you delete the rule
  file and then may still fail to write settings.json (line 217). The two side effects aren't
  atomic. Low impact since the rule file is deprecated, but worth noting that the purge commits
  an irreversible delete before the primary write succeeds.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | - | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Reliability Score**: 6
**Recommendation**: CHANGES_REQUESTED

The two HIGH findings share one root cause: a best-effort cleanup of a deprecated artifact
is allowed to throw on EACCES/EPERM, which aborts a previously-working operation. The answer
to the posed question is that cleanup failures here should be **non-fatal** (fail-safe), not
propagated. Making `removeLegacyCommandsRule` swallow (or log-and-continue on) all errors
resolves both blocking findings; add the EACCES/ENOENT tests to pin the contract.
