# Code Review Summary

**Branch**: refactor-remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-01_2352

## Merge Recommendation: CHANGES_REQUESTED

Two blocking issues must be resolved before merge:

1. **Reliability**: `removeLegacyCommandsRule` propagates non-ENOENT errors (EACCES, EPERM), causing cleanup failures to abort `devflow init` and `ambient --enable/--disable` entirely. A best-effort cleanup of a deprecated artifact must be fail-safe and never block primary operations.

2. **Documentation**: README.md:56 still claims "13 ultra-condensed engineering principles" when the actual rule set is 12 (commands.md deleted). This directly contradicts all other docs (CLAUDE.md, KNOWLEDGE.md, cli-reference) and undermines the PR's stated goal of a complete rule-count sweep.

Additionally, one should-fix issue in cli-rules KNOWLEDGE.md cites an incorrect PF number for the plugin-bucket partition contract.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 1 |

---

## Blocking Issues

**1. Cleanup failure aborts init settings-configuration pass** — `src/cli/commands/ambient.ts:63-69`
- **Severity**: HIGH
- **Confidence**: 90%
- **Problem**: `removeLegacyCommandsRule` propagates EACCES/EPERM/EBUSY errors from `fs.unlink`. In `init.ts:1131-1132`, this function is called unconditionally before applying memory hooks, HUD, context hooks, flags, and viewMode. If the legacy `~/.claude/rules/devflow/commands.md` file is not writable, the throw aborts the entire settings-configuration block. The outer `catch {}` silently swallows the error, so users get no feedback that their init failed.
- **Impact**: A previously-working `devflow init` now silently fails to apply memory/HUD/flags/viewMode configuration due to a cleanup failure on a *deprecated* file unrelated to those features. Before this PR, there was no unlink in this path — this is a regression.
- **Fix**: Make the legacy purge non-fatal. Swallow all errors from cleanup (it is best-effort removal of a deprecated artifact):
  ```typescript
  export async function removeLegacyCommandsRule(): Promise<void> {
    try {
      await fs.unlink(COMMANDS_RULE_PATH);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return; // already gone — success
      // Best-effort cleanup of deprecated file; never abort caller's
      // primary operation (enable/disable/init). Log warning if desired,
      // but do not throw.
    }
  }
  ```

**2. `devflow ambient --enable` crashes on cleanup failure** — `src/cli/commands/ambient.ts:103` and `:124`
- **Severity**: HIGH
- **Confidence**: 88%
- **Problem**: Unlike `init.ts`, the `ambientCommand` action (lines 210-230) wraps no try/catch around `addAmbientHook`/`removeAmbientHook`. A propagated EACCES from `removeLegacyCommandsRule` escapes to the top level as an unhandled rejection with stack trace.
- **Impact**: A user who previously could run `devflow ambient --enable` successfully will now get a hard crash if the legacy rule file is not writable — a regression from prior success to failure. The failure occurs in cleanup of a *deprecated* file, after which the actual hook write never happens (fail-safe defaults violated).
- **Fix**: Same root fix as issue #1 — make `removeLegacyCommandsRule` non-fatal. Once cleanup cannot throw, both `init.ts` and the ambient command paths retain prior success behavior.
- **Note**: This is the same root cause as issue #1 (error propagation), but surfaces differently in the two call paths (silently eaten vs. unhandled).

**3. README.md still claims "13 rules" instead of 12** — `README.md:56`
- **Severity**: HIGH
- **Confidence**: 98% (deduplicated from consistency + documentation reviewers)
- **Problem**: The PR description states "13→12 rules" in a complete sweep, but `README.md:56` was not updated:
  > "**Always-on rules.** 13 ultra-condensed engineering principles (~10 lines each) load on every prompt..."
  All other docs were correctly updated (CLAUDE.md:65, CLAUDE.md:82, KNOWLEDGE.md:30/249, cli-reference, plugin.json). This single line in the user-facing README is now the only place claiming 13 — directly contradicting the actual `shared/rules/` count (12 = accessibility, engineering, go, java, python, quality, react, reliability, rust, security, typescript, ui-design).
- **Impact**: Users reading the headline feature list get a wrong count that conflicts with `devflow rules --list` and all internal docs. Actively misleading during the most visible user interaction (README).
- **Fix**: Change "13 ultra-condensed engineering principles" → "12 ultra-condensed engineering principles" at `README.md:56`.
- **Note**: `README.md:67` ("3 MCPs 2 rules" in the HUD sample) is a per-project *installed-count* example and is correct.

---

## Suggestions (Lower Confidence)

**No test covers the non-ENOENT error path** — `tests/ambient.test.ts`, `src/cli/commands/ambient.ts:66-68`
- **Severity**: MEDIUM
- **Confidence**: 85%
- **Problem**: All tests stub `fs.unlink` to resolve successfully. The error-handling branch — `if (code !== 'ENOENT') throw err` — has zero coverage. The ENOENT-swallow branch is also untested.
- **Impact**: The exact behavior the PR calls out (propagate non-ENOENT) is unverified. A future change to error handling could flip behavior silently with no failing test.
- **Fix**: After fixing the error-propagation issue (#1/#2), add two test cases:
  1. `fs.unlink` rejects with `{ code: 'ENOENT' }` → function resolves (no throw)
  2. `fs.unlink` rejects with `{ code: 'EACCES' }` → function resolves without throwing (after fix)

---

## Should-Fix Issues

**Inaccurate PF citation in KNOWLEDGE.md** — `.devflow/features/cli-rules/KNOWLEDGE.md:241`
- **Severity**: MEDIUM
- **Confidence**: 90%
- **Problem**: New gotcha text states:
  > "The workflow-bucket predicate is `commands.length > 0` — the language-bucket comment notes this implicit contract is **PF-007** (source only; not enforced by types)."
  Two inaccuracies: (1) the actual source comment in `src/cli/plugins.ts:732-735` makes **no PF reference**; (2) **PF-007** (`.devflow/decisions/pitfalls.md:60`) is "Editing globally installed hook scripts directly instead of source + rebuild + reinstall" — unrelated to plugin-bucket partitioning.
- **Impact**: A future maintainer following the PF-007 pointer lands on an unrelated pitfall; code-comment drift. KNOWLEDGE.md is auto-consumed as FEATURE_KNOWLEDGE by every workflow, so inaccuracy propagates.
- **Fix**: Either drop the "is PF-007" claim and cite the actual source comment, or find/create the correct pitfall if one genuinely covers this topic.

---

## Pre-existing Issues (Not Blocking)

**Eventual removal of temporary cleanup code** — `src/cli/commands/ambient.ts:21,63`
- **Severity**: LOW (informational only)
- **Confidence**: 70%
- **Problem**: Per KNOWLEDGE.md pruning convention, cleanup code like `removeLegacyCommandsRule` + `COMMANDS_RULE_PATH` can be removed after 2 major versions. Currently unmarked.
- **Recommendation**: Consider adding a version marker or TODO noting when this temporary code can be deleted, so it doesn't become permanent cruft (the exact concern ADR-001 guards against).

---

## Convergence Status

**Cycle**: 1 (first review)
**Prior Resolution**: None (no prior cycles)
**Assessment**: First cycle — no baseline comparison available

---

## Action Plan

1. **Fix error propagation in `removeLegacyCommandsRule`** — Make cleanup non-fatal by swallowing all errors except distinguishing ENOENT. This unblocks both the init path and the ambient-command path.
2. **Update README.md:56** — Change "13 ultra-condensed" → "12 ultra-condensed".
3. **Fix or drop the PF-007 citation** in cli-rules KNOWLEDGE.md:241 — verify against actual source and correct the cross-reference.
4. **Add error-path tests** for `removeLegacyCommandsRule` after fixing the error contract.
5. **Consider version-marking** the temporary purge code for eventual removal (optional, LOW priority).
