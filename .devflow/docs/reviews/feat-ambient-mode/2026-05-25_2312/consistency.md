# Consistency Review Report

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

No blocking issues found.

## Issues in Code You Touched (Should Fix)

No should-fix issues found.

## Pre-existing Issues (Not Blocking)

No pre-existing issues found.

## Suggestions (Lower Confidence)

- **Dual-source content maintenance** - `src/cli/commands/ambient.ts:26-52` (Confidence: 70%) — The `COMMANDS_RULE_CONTENT` string literal is duplicated between `ambient.ts` and `shared/rules/commands.md`. The new sync test (line 383-389) mitigates drift, but the codebase pattern for rules is to have a single source of truth in `shared/rules/` with build-time distribution. The ambient plugin is a justified exception (managed directly, not by the rules plugin system), and the test guards the invariant well.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

The changes in this PR are internally consistent and align well with established codebase patterns:

1. **Helper extraction pattern** — `installCommandsRule()` and `removeCommandsRule()` follow the same extraction style seen elsewhere in the codebase (small, exported, JSDoc-documented, async functions with clear idempotency contracts). The narrow ENOENT catch in `removeCommandsRule` matches the pattern in `memory.ts` (lines 383-384).

2. **LEGACY_SKILL_NAMES additions** — The new `devflow:`-prefixed triage/guided/router entries (lines 508-523) follow the established section comment pattern (`// v2.x ambient refinements: ...`) consistent with all prior entries. The naming follows the existing `'devflow:{name}:{variant}'` format exactly (applies ADR-001 — clean break, add to legacy list for one-time cleanup).

3. **filterHookEntries null-guard removal** — Removing the redundant `settings.hooks &&` check on line 72 is correct; `settings.hooks` is guaranteed non-null at that point due to the early return on line 60 (`if (!settings.hooks?.[eventName]) return false`) and the fact that the function only reaches line 72 after operating on the hooks object. This matches the defensive-but-not-redundant style in the codebase.

4. **removeAmbientHook return logic** — Now tracks `removedClassification` separately and uses `if (!removedPrompt && !removedClassification)` — this is consistent with how the function's JSDoc describes its contract and matches the idempotency pattern where returning the original input means "no changes detected."

5. **Test mocking pattern** — The `beforeEach`/`afterEach` with `vi.spyOn` + `vi.restoreAllMocks` is the standard Vitest pattern in this codebase. The tests correctly stub filesystem side-effects (mkdir, writeFile, unlink) to keep unit tests pure, matching the project's testing philosophy of testing behavior without real I/O.

6. **Documentation updates** — README rule count change (12 to 13), plan trigger wording update ("first message" to "a prompt"), and README plugin description are all consistent with each other and with the actual `shared/rules/commands.md` content.
