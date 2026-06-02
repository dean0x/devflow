# Consistency Review Report

**Branch**: refactor-remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-01_2352
**Focus**: Naming consistency, JSDoc style, docs-sweep internal consistency (rule count + command-awareness removal)

## Summary of Verification

- **Actual rule count**: `ls shared/rules/*.md` → **12 files** (accessibility, engineering, go, java, python, quality, react, reliability, rust, security, typescript, ui-design). The `commands.md` rule was deleted. Documentation claiming "12 rules" is therefore CORRECT against ground truth.
- **Docs sweep**: CLAUDE.md (3 spots), docs/cli-reference.md, docs/commands.md, plugin.json, plugin README, cli-rules KNOWLEDGE.md, and the Project Structure tree were all updated to "12 rules" / single-component ambient.
- **One straggler found**: README.md still says "13 ... engineering principles" (see HIGH below).
- **Naming**: `removeLegacyCommandsRule` follows the established `remove{Noun}` + `LEGACY_` qualifier conventions. Consistent.
- **Decisions alignment**: The legacy-file purge is explicitly sanctioned by ADR-001 ("one-time cleanup items (legacy hook file removal)") and avoids PF-001 (no migration/compat scaffolding added). Positive.

## Issues in Your Changes (BLOCKING)

### HIGH

**Docs sweep straggler — README.md still claims "13" rules** — `README.md:56`
**Confidence**: 96%
- Problem: The PR swept rule-count references everywhere except `README.md:56`, which still reads: `**Always-on rules.** 13 ultra-condensed engineering principles (~10 lines each) load on every prompt...`. The committed README diff only touched lines 19 and 44 (the two "command awareness" sentences) and missed the count on line 56. Ground truth is 12 rules (`shared/rules/*.md` = 12 files), and the sibling docs (CLAUDE.md line 65, cli-rules KNOWLEDGE.md line 30, Project Structure tree line 82) all now say "12". This is the exact internal-consistency drift the sweep was meant to eliminate.
- Impact: User-facing README contradicts CLAUDE.md and the actual shipped rule set. The PR description states the docs were "swept ... to reflect 12 rules" — this line falsifies that claim.
- Fix: Update `README.md:56` from `13 ultra-condensed engineering principles` to `12 ultra-condensed engineering principles`. (The parenthetical language list "TypeScript, React, Go, Python, Java, Rust" omits Java/accessibility/ui-design but that phrasing pre-dates this PR and is out of scope.)

## Issues in Code You Touched (Should Fix)

_None._ The `ambient.ts` rename, JSDoc rewrites, and test updates are internally consistent:
- `removeLegacyCommandsRule` matches the `remove{Hook|MemoryHooks|ContextHook|HudStatusLine}` verb-noun family, and the `Legacy` qualifier is consistent with the codebase's `LEGACY_HOOK_FILES` / `LEGACY_RULE_NAMES` / `LEGACY_SKILL_NAMES` / `LEGACY_COMMAND_NAMES` naming.
- `COMMANDS_RULE_PATH` retained as an UPPER_SNAKE const (matches `PREAMBLE_HOOK_MARKER`).
- The removed `D1:` JSDoc on `COMMANDS_RULE_CONTENT` left no orphaned D-series references (grep confirmed clean).
- No stale references to `installCommandsRule` / `removeCommandsRule` / `COMMANDS_RULE_CONTENT` anywhere in src/tests/docs/plugins (grep confirmed clean).
- Test file `tests/ambient.test.ts` import + comments + the new ordering-invariant test (`purges legacy rule even when preamble hook already present`) all match the new behavior.

## Pre-existing Issues (Not Blocking)

**Stale `referencedFiles` entry in feature index** — `.devflow/features/index.json:26`
**Confidence**: 88%
- Problem: The `cli-rules` knowledge base's `referencedFiles` array still lists `shared/rules/commands.md`, which this PR deletes. The KNOWLEDGE.md body (committed) was correctly updated to "12 rules total", but the index entry pointing at the now-deleted file would mark the KB perpetually `[STALE]` via git-log staleness detection.
- Why not blocking: `git diff main...HEAD` shows `.devflow/features/index.json` has **No changes** in this PR's commits — it appears in `git status` only as uncommitted working-tree state, so it is outside this PR's committed scope.
- Fix (separate, or fold into this PR if index.json gets committed): remove `"shared/rules/commands.md"` from the `cli-rules.referencedFiles` array via `devflow knowledge refresh cli-rules`, or hand-edit the entry.

## Suggestions (Lower Confidence)

_None._

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The refactor is clean and the naming/JSDoc/test consistency is excellent. One straggler (README.md "13" rules) directly contradicts the rest of the swept docs and the actual 12-file rule set — it should be fixed before merge to satisfy the PR's own stated goal. The index.json stale reference is informational (uncommitted, out of scope).
