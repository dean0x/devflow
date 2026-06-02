# Documentation Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-02_0013
**Focus**: Documentation drift after removal of the ambient `commands.md` rule

## Summary of Verification Performed

This PR is a documentation sweep removing all references to the deleted ambient
`commands-awareness` rule (`shared/rules/commands.md`, 26 lines, deleted). I verified
every changed doc against the actual current code state, and ran a repo-wide sweep for
stale tokens. The documentation is accurate and consistent. No blocking, should-fix, or
pre-existing documentation issues at >=80% confidence.

### Code-vs-doc accuracy checks (all PASS)

| Doc claim | Verified against | Result |
|-----------|------------------|--------|
| `removeLegacyCommandsRule()` exists, runs unconditionally in both `addAmbientHook` and `removeAmbientHook` before early-return (KNOWLEDGE.md:239, :253) | `src/cli/commands/ambient.ts:65,107,128` | Accurate |
| `COMMANDS_RULE_PATH` constant exists (KNOWLEDGE.md:253) | `ambient.ts:21` | Accurate |
| `installCommandsRule` / `COMMANDS_RULE_CONTENT` no longer live | Absent from `ambient.ts`; removed from `tests/ambient.test.ts` imports | Accurate |
| `devflow-ambient` has `rules: []` (KNOWLEDGE.md:93) | `src/cli/plugins.ts:172` | Accurate |
| `LEGACY_RULE_NAMES` currently empty (KNOWLEDGE.md:99, :217) | `src/cli/plugins.ts:693` `= []` | Accurate |
| "Currently 12 rules: 4 core + 8 language/UI" (CLAUDE.md, README, KNOWLEDGE.md:30,:249) | `shared/rules/` = 12 files (4 core + 8 lang) | Accurate (4+8=12) |
| "Build reports 12 rules" (PR desc) | `build-plugins.ts:230` logs dynamic `availableRules.size` | Accurate, not hardcoded |
| ADR-001 citation "clean break philosophy" (KNOWLEDGE.md:263) | `.devflow/decisions/decisions.md:6` heading verbatim | Valid verbatim citation |

### Repo-wide straggler sweep (all CLEAN)

Searched the full repo (excluding `node_modules`, `dist/`, `.devflow/docs/`, `.git/`):

- `commands-awareness`, `commands-rule`, `two-component`/`two component`: **0 hits**
- `13 rules`, `13 ultra`: **0 hits**
- `installCommandsRule`, `COMMANDS_RULE_CONTENT` (outside the deleted test code): **0 hits**
- `command awareness`, `command-awareness`, `passive command`: **0 hits** outside review docs
- `docs/reference/`: **0** stale rule counts or commands-rule references

Note: `shared/rules/commands.md` (the file shown in `git diff --stat`) IS the deleted
ambient rule — confirmed deleted (`ls` returns "No such file or directory"). It is distinct
from the `commands.md` documentation file under `docs/`, which was updated correctly.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None at CRITICAL severity.

## Cross-Cycle Awareness (PRIOR_RESOLUTIONS verified)

Cycle 1 fixed 3 issues. I verified each against current code — all hold, none re-raised:

1. **Fail-safe error handling** — `removeLegacyCommandsRule()` wraps `fs.unlink` in try/catch
   (`ambient.ts:66-67`); ENOENT/errors are swallowed. Confirmed fail-safe. Not re-raised.
2. **README "13 -> 12" correction** — `README.md:56` now reads "12 ultra-condensed engineering
   principles". Confirmed corrected. Not re-raised.
3. **Fabricated PF-007 citation removed** — KNOWLEDGE.md:241 (partition predicate gotcha) now
   contains a plain description with no PF-007 citation. The only ADR/PF citation in any changed
   doc is ADR-001 (KNOWLEDGE.md:263), which is verbatim-valid per DECISIONS_CONTEXT. No fabricated
   or unverifiable citations remain. Not re-raised.

## Suggestions (Lower Confidence)

- **KNOWLEDGE.md:199 phrasing** — `.devflow/features/cli-rules/KNOWLEDGE.md:199` (Confidence: 65%)
  — The init-flow section says stale rules "are cleaned up via `LEGACY_RULE_NAMES` loop." Since
  `LEGACY_RULE_NAMES` is currently empty and the deleted `commands` rule is deliberately handled by
  `removeLegacyCommandsRule()` in ambient.ts (not the init loop), a reader could momentarily infer
  the commands-rule cleanup flows through this loop. The doc is internally consistent (lines 99 and
  239 clarify the split), so this is a minor clarity nit, not drift. Optional: add "(the deleted
  `commands` rule is purged separately by `removeLegacyCommandsRule`, not this loop)".

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Documentation Score**: 10
**Recommendation**: APPROVED

The documentation sweep is accurate, internally consistent, and free of stale references to
the deleted rule. CLAUDE.md, README, docs/cli-reference.md, docs/commands.md, the ambient
plugin README/plugin.json, and the heavily-modified cli-rules KNOWLEDGE.md all correctly
describe ambient mode as a single-component (preamble-hook-only) system with 12 rules. All
ADR/PF citations are verbatim-valid. Prior cycle-1 fixes hold.
