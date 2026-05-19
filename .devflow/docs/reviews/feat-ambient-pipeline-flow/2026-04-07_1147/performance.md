# Performance Review Report

**Branch**: feat/ambient-pipeline-flow -> main
**Date**: 2026-04-07

## Issues in Your Changes (BLOCKING)

No CRITICAL or HIGH blocking performance issues found.

## Issues in Code You Touched (Should Fix)

No should-fix performance issues found.

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing performance issues found.

## Suggestions (Lower Confidence)

- **SessionStart hook reads file on every session startup** - `scripts/hooks/session-start-classification:19-20` (Confidence: 70%) — The `session-start-classification` hook runs `cat "$CLASSIFICATION_RULES"` to read classification-rules.md on every SessionStart event. This is a single small file (~25 lines per CLAUDE.md) and a single `cat` invocation, so real-world impact is negligible (sub-millisecond). However, combined with the fallback `awk` path (line 23) that parses SKILL.md with a regex, there are two potential I/O paths. The primary path is fast; the fallback `awk` parse is slightly heavier but only triggers during upgrade windows. No action needed unless this hook is called at very high frequency.

- **Preamble injection on every user prompt** - `scripts/hooks/preamble` (Confidence: 65%) — The preamble hook injects text on every UserPromptSubmit. The change reduces the preamble from a multi-line classification ruleset (~6 lines with all intents/depths) to a single sentence ("Classify this request's intent and depth, then load devflow:router via Skill tool."). This is a clear performance improvement: the old preamble injected ~400 bytes per prompt; the new one injects ~75 bytes. Classification rules are now injected once at SessionStart via additionalContext instead of per-prompt. This is a positive change — noting for completeness.

- **Repeated JSON parse-serialize cycles in addAmbientHook** - `src/cli/commands/ambient.ts` (Confidence: 62%) — `addAmbientHook` calls `JSON.parse` and `JSON.stringify` once per invocation, and `filterHookEntries` mutates the parsed object. This is correct and efficient for a CLI command that runs at most once per `devflow init` or `devflow ambient --enable`. No real-world concern, but the function now performs 3 separate existence checks (legacy removal, preamble check, classification check) on the same parsed object. All are O(n) array scans where n is the number of hook entries — typically 1-5. Negligible.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

This PR is primarily a performance-positive refactoring of the ambient mode architecture. The key changes from a performance perspective:

1. **Preamble token reduction (positive)**: The UserPromptSubmit preamble shrinks from ~400 bytes of classification rules to a single ~75-byte instruction sentence. Classification rules are now injected once at SessionStart as additionalContext rather than repeated on every prompt. This reduces per-message token overhead significantly for sessions with many messages.

2. **Router SKILL.md size reduction (positive)**: The router skill shrinks from ~180 lines (including full classification rules, edge cases, step-by-step instructions) to ~50 lines (pure lookup tables). This means less content loaded via Skill tool when GUIDED/ORCHESTRATED classification triggers router loading. The classification rules (~25 lines) are now in a separate `classification-rules.md` loaded once at session start.

3. **New SessionStart hook (neutral)**: Adds one `cat` of a ~25-line file per session start. This is negligible overhead — sub-millisecond I/O.

4. **Pipeline orchestration removes user gates (neutral/positive)**: The `pipeline:orch` skill changes from user-gated (AskUserQuestion between implement/review/resolve) to auto-proceed. This reduces latency in the pipeline by eliminating human wait time between stages, though this is more of a workflow change than a computational performance change.

5. **Task->Agent rename (neutral)**: Pure string replacement across command/skill markdown files. No runtime impact — these are prompt instructions, not executable code.

6. **PF-006 pitfall check**: The known pitfall PF-006 (per-line jq spawning in session-start hooks) is in `session-start-memory`, not in the new `session-start-classification` hook. The new hook uses a single `cat` or `awk` invocation — no per-line jq loops. The pitfall pattern is not reintroduced.

No N+1 queries, no synchronous blocking I/O in hot paths, no unbounded collections, no algorithmic regressions. The changes are well-structured from a performance perspective.
