# TypeScript Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**Date**: 2026-06-02_0013
**PR**: #233

## Scope

TypeScript-relevant changes are confined to `src/cli/commands/ambient.ts`. The
`src/cli/commands/init.ts` and `src/cli/plugins.ts` diffs are text/comment-only
(option description string `'...plan auto-detection and command awareness'` →
`'...plan auto-detection'`) — no functional TypeScript to review. `tests/ambient.test.ts`
was reviewed for type-safety regressions.

Verification performed:
- `npx tsc --noEmit` → exit 0 (clean typecheck, strict mode).
- `grep` across `src/` for `removeCommandsRule` / `installCommandsRule` /
  `COMMANDS_RULE_CONTENT` → zero dangling references (rename + deletion fully propagated).
- Read `Settings`/`HookMatcher` types in `src/cli/utils/hooks.ts`.
- Read ADR-001 (clean-break) and `cli-rules` KNOWLEDGE.md.

## Targeted Review (per prompt focus)

| Focus item | Finding | Verdict |
|------------|---------|---------|
| Renamed fn signature | `removeLegacyCommandsRule(): Promise<void>` — explicit return type, async | PASS |
| async/Promise of unlink | `await fs.unlink(...)` inside `try`; awaited at both call sites (`addAmbientHook` L107, `removeAmbientHook` L128) before early-return | PASS |
| Typed catch / error swallowing | `catch { }` (parameterless, documented) — no untyped `err`, no `any`, no type-info loss | PASS |
| Explicit return types | All exported fns annotated (`Promise<void>`, `Promise<string>`, `boolean`) | PASS |
| Settings immutability | In-place mutation of parsed object — see Pre-existing note below | ACCEPTABLE (boundary, local) |
| Result-type convention | Boundary exception is justified & codebase-consistent — see analysis | PASS |

## Issues in Your Changes (BLOCKING)

None. The changed TypeScript is type-clean under strict mode and the renamed
function is correctly typed.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

## Pre-existing Issues (Not Blocking)

**Settings object mutated in place rather than returned immutably** — `ambient.ts:24-45`, `82-132`
**Confidence**: 88%
- Problem: `filterHookEntries` mutates `settings.hooks[eventName]` (reassignment +
  `delete`) and `addAmbientHook`/`removeAmbientHook` push onto and delete keys of the
  parsed `settings` object directly. This violates the global "Immutable by default —
  return new objects, never mutate parameters" principle.
- Why not blocking: This is **pre-existing** structure — the mutation pattern predates
  this PR (the diff only renames a function and deletes the install path; it does not
  introduce new mutation). Per the review Iron Law, pre-existing non-CRITICAL issues are
  informational. The mutated object is a freshly `JSON.parse`d local (never a shared
  reference or a parameter the caller retains), so the blast radius is contained and there
  is no aliasing hazard. Severity is MEDIUM, not CRITICAL.
- Fix (separate PR, optional): have `filterHookEntries` return a new `Settings` rather than
  mutating, and build the updated hooks with spreads. Low value relative to churn given the
  object is parse-local.

## Boundary Exception Analysis (Result vs throw)

The prompt asks whether the no-throw / Result-type convention is honored OR a justified
boundary exception applies. **A justified boundary exception applies — and the new code
strengthens it rather than weakening it:**

- `addAmbientHook`/`removeAmbientHook` call `JSON.parse(settingsJson)` without a Result
  wrapper. This is unchanged by the PR and is consistent with the entire `src/cli/`
  module, which treats CLI commands as I/O boundaries that throw on malformed input
  (confirmed by `cli-rules` KNOWLEDGE.md: `buildRulesMap` "throws on invalid names" as an
  intentional early-catch boundary pattern, lines 97/219/238). The `JSON.parse` throw
  propagates to commander's action handler — acceptable for a CLI entry point.
- The one place the PR *adds* error handling — `removeLegacyCommandsRule`'s `catch {}` — is
  correctly a **non-throwing, non-Result best-effort cleanup**, which is the right call:
  it is fire-and-forget purge of a deprecated file and must never abort the caller's
  primary settings write. Swallowing here is intentional and well-documented (L69-72),
  and is covered by dedicated tests (ENOENT + EACCES, test L335-345). This is the correct
  shape for best-effort cleanup; a Result type would be over-engineering for a void cleanup
  whose failure the caller deliberately ignores.

## Decisions / Knowledge Applied

- **applies ADR-001** (clean-break): `removeLegacyCommandsRule` is precisely the
  "legacy hook file removal" one-time-cleanup item ADR-001 carves out as acceptable, while
  the compat payload (`COMMANDS_RULE_CONTENT`, `installCommandsRule`) was fully deleted
  rather than shimmed. The refactor is a clean break with no lingering backward-compat
  cruft — directly in line with the decision.
- **cli-rules KNOWLEDGE.md**: confirms the CLI layer's accepted throw-at-boundary
  convention, validating the Result-exception above.

## Cross-Cycle Awareness

PRIOR_RESOLUTIONS (Cycle 1) fixed: fail-safe error handling, README count→12, removed
fabricated citation. None re-raised here — the fail-safe `catch {}` is present and correct
in current code; this review does not cite any ADR/PF beyond ADR-001 which is verbatim in
DECISIONS_CONTEXT.

## Suggestions (Lower Confidence)

- **Parameterless `catch {}` loses the error object for any future diagnostic logging** -
  `ambient.ts:68` (Confidence: 62%) — Intentional and documented; only flag if you later
  want debug-trace visibility into unexpected unlink failures (e.g. EBUSY). Not an issue today.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**TypeScript Score**: 9/10
**Recommendation**: APPROVED
