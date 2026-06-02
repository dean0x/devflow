# Complexity Review Report

**Branch**: refactor-remove-ambient-commands-rule (PR #233) -> main
**Date**: 2026-06-01_2352
**Focus**: Verify the code-removal refactor actually reduced complexity, left no dead code, no orphaned constants/imports, no vestigial indirection, and no confusing leftover comments.

## Summary of Verification

This is a net-deletion refactor (+150 / -233). I verified each removal-specific concern:

| Check | Result |
|-------|--------|
| Removed symbols (`COMMANDS_RULE_CONTENT`, `installCommandsRule`, `removeCommandsRule`) fully gone | PASS — zero references in `src/` or `tests/` |
| `COMMANDS_RULE_PATH` still genuinely used (not vestigial) | PASS — referenced by `removeLegacyCommandsRule` (unlink target) + 2 call sites + tests |
| `removeLegacyCommandsRule` wired into both add/remove paths | PASS — `ambient.ts:103` and `ambient.ts:124` |
| Orphaned imports after deletion | PASS — `path` import in test still used at line 478+; `tsc --noEmit` clean |
| Dead test scaffolding | PASS — `installCommandsRule`/`COMMANDS_RULE_CONTENT` describe blocks + dual-source drift guard removed; replacement ordering-invariant test added |
| Build/manifest references to deleted `shared/rules/commands.md` | PASS — ambient plugin `rules: []` was already empty (rule was always ambient.ts-managed, never in manifest); no build logic references the deleted file |
| Plugin metadata cleanup (`plugin.json` keywords/description) | PASS — `commands`/`awareness` keywords removed, description narrowed |
| TypeScript typecheck | PASS — `npx tsc --noEmit` produced no errors |

The refactor genuinely reduces complexity: it removes a ~27-line embedded heredoc constant (`COMMANDS_RULE_CONTENT`), an entire `installCommandsRule` function, a dual-source synchronization invariant (the constant had to be kept byte-identical with `shared/rules/commands.md`, guarded by a drift test), and the corresponding test surface. The remaining `removeLegacyCommandsRule` is a focused single-purpose cleanup function.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

## Pre-existing Issues (Not Blocking)

None reported (Iron Law: pre-existing issues block only if CRITICAL; none found).

## Suggestions (Lower Confidence)

- **Stale-ish historical comment referencing "commands rule"** - `src/cli/commands/init.ts:1088` (Confidence: 65%) — The legacy-cleanup comment `// Ambient simplification: session-start-classification removed (plan detection + commands rule)` still names "commands rule" as a thing the removed classification hook related to. Now that the commands rule itself is also gone, the parenthetical reads slightly anachronistically. It is a historical annotation on a legacy-file purge list (not load-bearing), so this is borderline. Optional: trim to `(plan detection)` for clarity. Not flagged higher because the comment documents *why* a legacy file is being purged, and the reference is historically accurate.

- **Filesystem side-effect inside JSON-transform functions** - `src/cli/commands/ambient.ts:103,124` (Confidence: 60%) — `addAmbientHook`/`removeAmbientHook` are named/shaped like pure `(json) -> json` transforms but perform an `fs.unlink` via `removeLegacyCommandsRule`. This mixed concern predates the PR (the old code called `installCommandsRule` in the same spot writing a file), so the refactor does not worsen it — it is arguably cleaner now (unlink vs mkdir+write). Noting only because the refactor was an opportunity to separate the purge into the CLI action handler. Not blocking; out of scope for a deletion-only PR.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Complexity Score**: 9
**Recommendation**: APPROVED

The refactor accomplishes its stated goal cleanly. Complexity is genuinely reduced (removed a duplicated heredoc constant, a synchronization invariant + its drift test, and an install function). No dead code, no orphaned constants or imports, no vestigial indirection. `COMMANDS_RULE_PATH` remains genuinely used as the unlink target for purging legacy files from prior installs. The two suggestions are minor, out-of-scope-for-deletion-PR observations, both below the 80% reporting threshold.
