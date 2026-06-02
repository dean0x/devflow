# Architecture Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-02_0013

## Summary of Verification

Reviewed the collapse of ambient mode from two components (preamble hook + commands.md rule)
to one (preamble hook only). Focus areas: cleanup-ordering invariant, single-component
architectural cleanliness, layering, and dead-reference detection.

Verification performed:
- Read full `src/cli/commands/ambient.ts` — confirmed cleanup-ordering invariant holds.
- `tsc` clean compile (`npm run build:cli`) — no dangling references to removed symbols.
- `npx vitest run tests/ambient.test.ts` — 40/40 pass, including invariant tests (lines 96-104).
- grep across `src/ tests/ shared/ plugins/ scripts/ docs/` — zero dead references to
  `COMMANDS_RULE_CONTENT`, `installCommandsRule`, or the deleted `shared/rules/commands.md`.
- Confirmed `devflow-ambient` plugin manifest `rules: []` (commands rule fully de-registered).
- Read ADR-001 + PF-001 full bodies via decisions files.

**The cleanup-ordering invariant is correctly implemented.** `removeLegacyCommandsRule()` is
called at `ambient.ts:107` (before the `if (!changed) return` at line 109) and at `ambient.ts:128`
(before the `if (!removedPrompt && !removedClassification) return` at line 130). The init path
(`init.ts:1131`) always calls `removeAmbientHook` regardless of enable/disable, so all three entry
points (enable, disable, init) unconditionally purge the stale file. Tests at
`tests/ambient.test.ts:96-104` assert the purge runs even when the hook is unchanged.

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

The single-component collapse is architecturally clean. Removing the `commands.md` rule eliminates
a redundant concern (the preamble hook already documents plan auto-execution; the static rule was
duplicative passive reference). This **improves** separation of concerns — ambient mode now has one
reason to change (plan detection) rather than two. No SOLID, coupling, or leaky-abstraction
violations introduced. The `removeLegacyCommandsRule` function is appropriately deep: a simple
interface (no args, void return, idempotent, fail-safe) hiding the legacy-cleanup concern.

The clean-break-with-cleanup approach `applies ADR-001` — which explicitly sanctions "one-time
cleanup items (legacy hook file removal)" as the permitted exception to the no-compat-code rule —
and `avoids PF-001` by not introducing a migration registry entry, version tracking, or
backward-compat layer for what is a simple rename/removal refactor.

## Pre-existing Issues (Not Blocking)

None identified in the reviewed scope.

## Suggestions (Lower Confidence)

- **Legacy-cleanup placement vs migration registry** - `src/cli/commands/ambient.ts:65-73`
  (Confidence: 65%) — The codebase has a dedicated migration registry
  (`src/cli/utils/migrations.ts`, e.g. `purge-orphaned-sidecar-judgment-state`) for one-time
  legacy-file purges, whereas this cleanup lives inline in the ambient lifecycle. This is a
  defensible choice — it matches the module's existing `LEGACY_HOOK_MARKER`/`isLegacy` inline
  cleanup convention and runs on every ambient toggle (more frequent than a once-per-machine
  migration), giving stronger purge guarantees. Noting only as a layering observation; no action
  required. A future cleanup pass could consolidate inline legacy-purges into the migration
  registry for a single cleanup locus, but that is out of scope here and would arguably reduce
  the purge frequency that makes the current approach robust.

## Cross-Cycle Awareness

PRIOR_RESOLUTIONS (Cycle 1) reported 3 fixed issues: `removeLegacyCommandsRule` made fail-safe,
README rule count corrected to 12, and the fabricated PF-007 citation removed from KNOWLEDGE.md.
Verified against current code:
- `removeLegacyCommandsRule` swallows all errors via bare `catch` (`ambient.ts:66-72`) — confirmed fixed.
- Rule count is 12 in `CLAUDE.md:65` ("4 core + 8 language/UI") — confirmed fixed.
- No PF-007 citation present in the KNOWLEDGE.md diff — confirmed fixed.

None of these are re-raised.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 9/10
**Recommendation**: APPROVED
