# Consistency Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24

## Issues in Your Changes (BLOCKING)

### HIGH

**Phase numbering in plan:orch GUIDED section restarted at 1 instead of continuing sequence** - `shared/skills/plan:orch/SKILL.md:27-31`
**Confidence**: 95%
- Problem: The GUIDED Behavior list was renumbered from `0., 0.5., 1., 2., 3.` to `1., 2., 1., 2., 3.` -- the first two items were renumbered but items 3-5 were left unchanged, resulting in a duplicate `1.` and `2.` in the markdown ordered list. This produces incorrect rendering and confusing agent instructions.
- Fix: Continue the sequence as `1., 2., 3., 4., 5.`:
```markdown
1. **Discover** — ...
2. **Load Feature KBs** — ...
3. **Spawn Skimmer** — ...
4. **Design** — ...
5. **Present** — ...
```

**pipeline:orch phase range references are stale after renumbering (3 occurrences)** - `shared/skills/pipeline:orch/SKILL.md:35,56,78`
**Confidence**: 95%
- Problem: All three sub-orchestrator descriptions say "Phases 1-6" but each now has 7 phases after the fractional-to-integer renumbering. The descriptions also omit the new integer-numbered knowledge-loading phase.
  - Line 35: implement:orch described as "Phases 1-6" but is now Phases 1-7 (missing "Load Feature Knowledge")
  - Line 56: review:orch described as "Phases 1-6" but is now Phases 1-7 (missing "Load Knowledge Index")
  - Line 78: resolve:orch described as "Phases 1-6" but is now Phases 1-7 (missing "Load Project Knowledge")
- Fix: Update each parenthetical to include the knowledge phase and correct range:
  - Line 35: `(Phases 1-7: pre-flight → load feature knowledge → plan synthesis → Coder → FILES_CHANGED detection → quality gates → completion)`
  - Line 56: `(Phases 1-7: pre-flight → incremental detection → load knowledge index → file analysis → parallel reviewers → synthesis → finalize)`
  - Line 78: `(Phases 1-7: target review directory → load project knowledge → parse issues → analyze & batch → parallel resolvers → collect & simplify → report)`

### MEDIUM

**review:orch Phase 5 still references "Phase 3 file analysis" after renumbering** - `shared/skills/review:orch/SKILL.md:99`
**Confidence**: 92%
- Problem: Line 99 says "Conditional reviewers (from Phase 3 file analysis)" but file analysis was renumbered to Phase 4. This is a leftover from the Phase 2b/3 renumbering pass. The cross-references on lines 107-108 ("from Phase 3") correctly refer to Phase 3 (Load Knowledge Index), but line 99's "Phase 3" incorrectly refers to file analysis.
- Fix: Change to `**Conditional reviewers** (from Phase 4 file analysis):`

**Stale comment reference to "Phase 1.5" in test file** - `tests/resolve/knowledge-citation.test.ts:16`
**Confidence**: 90%
- Problem: The header comment on line 16 still says "Phase 1.5 parity" while the actual test cases on lines 163-174 were correctly updated to use "Phase 2" and "Phase 5". The comment is stale.
- Fix: Update line 16 to `//   5. Structural tests: resolve:orch SKILL.md — Phase 2 parity`

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale phase reference in test file comment** - `tests/resolve/knowledge-citation.test.ts:12`
**Confidence**: 82%
- Problem: Line 12 references "Phase 4" for resolve.md (`resolve.md — Step 0d presence + KNOWLEDGE_CONTEXT in Phase 4`). With the renumbering, resolve:orch Phase 4 is now "Analyze & Batch" and the resolve step for KNOWLEDGE_CONTEXT is Phase 5. While this comment refers to the command file (resolve.md, not resolve:orch), it exists in the same test file that was modified and could cause confusion.
- Fix: Verify whether Phase 4 is still correct for resolve.md (command file), or update if the command was also renumbered.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**file-organization.md shared agents count (12) does not match CLAUDE.md (13)** - `docs/reference/file-organization.md:18,141`
**Confidence**: 85%
- Problem: `file-organization.md` lists 12 shared agents and omits `kb-builder` from the Shared list, while `CLAUDE.md` correctly states 13 agents including `kb-builder`. The kb-builder agent predates this PR but the discrepancy was not addressed when `file-organization.md` was touched in this branch (only the decisions.md/pitfalls.md source column was updated).
- Fix: Update line 18 to "12 shared agents" -> "13 shared agents" and add `kb-builder` to the list on line 141.

## Suggestions (Lower Confidence)

- **GUIDED vs ORCHESTRATED numbering independence** - `shared/skills/plan:orch/SKILL.md:27` (Confidence: 65%) -- The GUIDED section uses a simple numbered list (1-5) while ORCHESTRATED uses "Phase N:" headers. This is intentional (GUIDED is simpler), but the renumbering created a brief window where GUIDED numbers 1,2 could be confused with ORCHESTRATED Phase 1, Phase 2. Consider adding a note that GUIDED steps are independent of ORCHESTRATED phase numbers.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | - | 2 | 2 | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | 1 | - |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The phase renumbering from fractional (0, 0.5, 1, 2...) to integer (1, 2, 3, 4...) was applied thoroughly across skill files, commands, tests, and CLAUDE.md. The core logic changes (mark-stale -> find-overlapping, directory-boundary matching, dispatch table refactor) are internally consistent. However, three cross-reference sites were missed: the pipeline:orch parenthetical phase ranges, the review:orch "Phase 3 file analysis" inline reference, and the plan:orch GUIDED section numbering restart. These should be fixed before merge to avoid confusion for agents that follow phase references literally.
