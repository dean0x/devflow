# Complexity Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-02_0013

## Summary Verdict

This is a clean net-deletion refactor that genuinely reduces complexity. The removal of
`COMMANDS_RULE_CONTENT` (a 26-line template literal) and `installCommandsRule()` eliminates a
whole responsibility (rule materialization) from `ambient.ts`, leaving only best-effort cleanup
of the deprecated file. No blocking or should-fix complexity issues were found.

Verification performed:
- `npm run build:cli` (tsc) compiles cleanly — no dead references break the build.
- `grep` across `src/ tests/ scripts/ shared/ plugins/` for `installCommandsRule`,
  `COMMANDS_RULE_CONTENT`, and `removeCommandsRule` (word-boundary) returns zero leftover
  references to removed symbols.
- `tests/ambient.test.ts` imports and mocks updated to match (`fs.unlink` stub replaces
  `fs.mkdir`/`fs.writeFile`); a new ordering-invariant test covers the early-return purge path.
- Feature knowledge (`cli-rules` KNOWLEDGE.md) already documents this exact design — the
  unconditional `removeLegacyCommandsRule()` call in both add/remove paths matches the
  documented Gotcha (line 239) and Key Files (line 253) notes. No deviation from documented patterns.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None at MEDIUM+ confidence/severity. The action handler in `ambientCommand` (`ambient.ts:157-235`,
~78 lines) is the longest unit in the file, exceeding the 50-line warning threshold. However it is
flat sequential CLI orchestration (read settings -> status branch -> resolve devflowDir -> enable
branch -> disable branch), each branch guarded by early-returns with max nesting depth 3. It reads
top-to-bottom without requiring a control-flow diagram, so it does not violate the 5-minute Iron Law.
This handler is also largely pre-existing (only comment/string lines changed in this PR). Not worth
refactoring in this deletion-focused PR.

## Suggestions (Lower Confidence)

- **Comment-to-code ratio on `removeLegacyCommandsRule`** - `ambient.ts:58-73` (Confidence: 65%) —
  The function is 3 lines of logic with 11 lines of doc/inline comments explaining the swallow-all-errors
  fail-safe rationale. The verbosity is justified (a bare `catch {}` swallowing EACCES/EPERM would
  otherwise look like a bug and invite a "re-throw non-ENOENT" regression — exactly the prior-cycle
  fix), so this is acceptable, not a defect. Optional: a one-line `// best-effort cleanup; see ADR/PF`
  pointer would be terser, but the current explicit form is defensible. No action required.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 1 |

**Complexity Score**: 9
**Recommendation**: APPROVED
