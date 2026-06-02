# Architecture Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-01_2352

## Summary Verdict

This is a clean subtractive refactor. The cleanup-via-toggle pattern is **architecturally
sound** and explicitly sanctioned by ADR-001 (clean-break philosophy permits "one-time cleanup
items: legacy hook file removal" as the named exception to no-migration). No new abstractions
introduced; the change collapses ambient to a single component (preamble hook) and reduces the
ambient.ts surface area (81 lines net reduction in source, 102 → fewer in tests). No SOLID,
coupling, or layering violations found in the changed lines. No dangling references to the
removed exports (`installCommandsRule`, `COMMANDS_RULE_CONTENT`, `removeCommandsRule`). No
migration entry added to `migrations.ts` — avoids PF-001, applies ADR-001.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence. The refactor is internally consistent and well-documented.

## Pre-existing Issues (Not Blocking)

None surfaced that meet the CRITICAL bar for pre-existing reporting.

## Focus-Question Findings

### 1. Is the cleanup-via-toggle pattern (vs migration) architecturally sound? — YES

The pattern delegates legacy-file purging to `removeLegacyCommandsRule()`, invoked
unconditionally from both `addAmbientHook` (ambient.ts:103) and `removeAmbientHook`
(ambient.ts:124), and reached on every `devflow init` via the always-run
`removeAmbientHook` → conditional `addAmbientHook` pass (init.ts:1131-1132).

This is the correct home for the cleanup, not a migration, because:
- The `commands` rule was **never** part of the plugin rules system — it was always
  ambient-managed (confirmed: `commands` appears in no plugin manifest `rules` array, and
  `LEGACY_RULE_NAMES` was already `[]` on main, untouched by this PR). The generic
  rule-cleanup loop (init.ts:1065) operates on plugin-system rules; routing an
  ambient-managed file through it would have leaked an ambient concern into the generic
  rules path. Keeping cleanup in ambient.ts preserves the existing ownership boundary
  documented in the cli-rules KNOWLEDGE.md.
- ADR-001 names "legacy hook file removal" as a permitted clean-break exception. A rule
  file purged via the feature's own toggle is the direct analogue — applies ADR-001.
- It avoids PF-001 (no compat/migration layer added for a removal refactor).

The `removeLegacyCommandsRule` error contract is correct: swallows ENOENT (idempotent),
propagates EACCES and other errors (ambient.ts:63-69). This matches the established
ambient hook-cleanup discipline.

### 2. Is COMMANDS_RULE_PATH retention justified? — YES

`COMMANDS_RULE_PATH` (ambient.ts:21) must survive because it is the only remaining
identifier of the file to purge. `COMMANDS_RULE_CONTENT` was correctly deleted (no longer
written), but the path constant is load-bearing for the cleanup and for the test assertion
(`tests/ambient.test.ts` asserts `fs.unlink` called with `COMMANDS_RULE_PATH`). The doc
comment was updated to reflect its new purpose (purge-only). Retention is necessary and
correctly scoped — no architectural debt.

### 3. Does the ordering invariant (cleanup before early-return) belong here? — YES, with a minor durability note

The invariant — `removeLegacyCommandsRule()` must run *before* the `if (!changed) return`
early-return in `addAmbientHook` (ambient.ts:103-105) and before
`if (!removedPrompt && !removedClassification) return` in `removeAmbientHook`
(ambient.ts:124-126) — is the right design. If purge ran after the early-return, an install
whose hook is already registered would silently skip cleanup, leaving the stale file
forever. Placing the unconditional side-effect before the conditional return is the cleanest
expression of "settings unchanged, but disk side-effect still required."

This ordering is now protected by an explicit regression test
(`tests/ambient.test.ts`: "purges legacy rule even when preamble hook already present
(ordering invariant)"), which is the correct safeguard for an invariant that is otherwise
invisible to the type system. This is the right home — the invariant is intrinsic to these
two functions' contracts and is co-located with the code it governs.

Minor observation (LOW, non-blocking): the two functions now mix a pure settings transform
(returns new JSON string, no I/O) with an impure filesystem side-effect
(`removeLegacyCommandsRule`). This is a small departure from "compose pure transforms"
(global engineering principle #4/immutability and the project's parse-at-boundary leaning).
It is justified here by the pragmatic need to guarantee the side-effect across all call
paths (init + enable + disable) without duplicating the call at three sites, and the
side-effect is idempotent and well-documented. Not worth changing — flagging only for
awareness that `addAmbientHook` is no longer a pure function despite its
string-in/string-out signature.

### 4. Boundary between ambient-managed rules and the plugin rules system — CLEAN

The boundary is correctly preserved and, if anything, simplified:
- Plugin rules system: `LEGACY_RULE_NAMES` (plugins.ts:693, still `[]`) + the init.ts:1065
  loop handle *plugin-declared* rule cleanup. Untouched by this PR.
- Ambient-managed cleanup: `removeLegacyCommandsRule` handles the one historically
  ambient-owned rule file. Self-contained in ambient.ts.

There is no overlap or double-ownership: the two mechanisms target disjoint sets (plugin
rules vs the single ambient `commands.md`). `shared/rules/commands.md` was deleted, the
ambient plugin manifest declares no `rules` field (so the build's "declared rule missing
from shared/rules" guard cannot trip), and no plugin manifest references `commands`. The
KNOWLEDGE.md was updated to reflect the removal accurately. The boundary remains a clean
single-owner-per-file model.

## Suggestions (Lower Confidence)

- **Eventual removal of `removeLegacyCommandsRule` + `COMMANDS_RULE_PATH`** -
  `src/cli/commands/ambient.ts:21,63` (Confidence: 70%) — Per the KNOWLEDGE.md pruning
  convention for `LEGACY_RULE_NAMES` ("entries can be removed after 2 major versions"),
  this purge path is itself temporary cleanup code. Consider adding a TODO/version marker
  noting when it can be deleted, so it does not become permanent cruft (the exact concern
  ADR-001 guards against).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 1 |

**Architecture Score**: 9
**Recommendation**: APPROVED

Rationale: Subtractive refactor that removes a redundant component, preserves all ownership
boundaries, applies ADR-001 and avoids PF-001, and ships with a regression test for the one
non-obvious invariant (cleanup-before-early-return). The single LOW note (impure side-effect
inside an otherwise-pure transform) is justified and not worth changing. The 70% suggestion
(version-marking the temporary purge code) is the only forward-looking hygiene item.
