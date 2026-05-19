# Documentation Review Report

**Branch**: refactor/rename-knowledge-to-decisions -> main
**Date**: 2026-05-03

## Issues in Your Changes (BLOCKING)

### HIGH

**Phase Completion Checklist items not renamed to match their Phase headings (3 occurrences)** - Confidence: 92%
- `shared/skills/debug:orch/SKILL.md:111`, `shared/skills/review:orch/SKILL.md:144`, `shared/skills/explore:orch/SKILL.md:164`
- Problem: The Phase headings were correctly renamed (e.g., "Phase 1: Load Decisions Index"), but the corresponding Phase Completion Checklist items at the bottom of each file still reference the old heading text ("Load Knowledge Index" or "Load Knowledge"). This creates internal contradictions within the same file -- the heading says one thing and the checklist says another.
  - `debug:orch/SKILL.md:27` heading says "Load Decisions Index" but line 111 checklist says "Load Knowledge Index"
  - `review:orch/SKILL.md:47` heading says "Load Decisions Index" but line 144 checklist says "Load Knowledge Index"
  - `explore:orch/SKILL.md:33` heading says "Load Decisions (Orchestrator-Local)" but line 164 checklist says "Load Knowledge (Orchestrator-Local)"
- Fix: Update each checklist item to match its corresponding phase heading:
  - `debug:orch/SKILL.md:111`: Change `Phase 1: Load Knowledge Index` to `Phase 1: Load Decisions Index`
  - `review:orch/SKILL.md:144`: Change `Phase 3: Load Knowledge Index` to `Phase 3: Load Decisions Index`
  - `explore:orch/SKILL.md:164`: Change `Phase 1: Load Knowledge (Orchestrator-Local)` to `Phase 1: Load Decisions (Orchestrator-Local)`

### MEDIUM

**Section heading "Knowledge Index + On-Demand Read Pattern" not renamed in docs/self-learning.md** - `docs/self-learning.md:101`
**Confidence**: 82%
- Problem: The section heading at line 101 still says `## Knowledge Index + On-Demand Read Pattern` while the internal content was fully renamed to use `DECISIONS_CONTEXT`, `decisions-index.cjs`, and `devflow:apply-decisions`. The heading is the entry point for readers navigating the document and creates a misleading impression that this section covers the old "knowledge" concept.
- Fix: Rename heading to `## Decisions Index + On-Demand Read Pattern`

**"Knowledge consumers" phrase not renamed in docs/self-learning.md** - `docs/self-learning.md:103`
**Confidence**: 80%
- Problem: Line 103 says "Knowledge consumers (slash commands and orch skills)" while the surrounding content has been renamed. This phrase refers to the decisions system consumers.
- Fix: Change to "Decisions consumers (slash commands and orch skills)"

**GUIDED step label "Load Knowledge" not renamed in explore:orch and plan:orch** - `shared/skills/explore:orch/SKILL.md:25`, `shared/skills/plan:orch/SKILL.md:28`
**Confidence**: 80%
- Problem: The GUIDED behavior steps in both files retain `**Load Knowledge**` as the step label, even though they now load `DECISIONS_CONTEXT` and use `decisions-index.cjs`. The ORCHESTRATED phases in the same files were renamed to "Load Decisions" but the GUIDED labels were not.
- Fix: Rename step labels to `**Load Decisions**` in both files.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Pitfall status field contradiction between SKILL.md and references/examples.md** - `shared/skills/decisions-format/references/examples.md:35` vs `shared/skills/decisions-format/SKILL.md:93`
**Confidence**: 85%
- Problem: The SKILL.md template (line 84-93) shows pitfall entries WITH a `- **Status**: Active` field and the Status Field Semantics section (lines 111-113) explicitly defines pitfall statuses (`Active`, `Deprecated`). However, `references/examples.md` line 35 states "Pitfalls have no status field -- they remain until manually removed" and the pitfall example on lines 18-26 omits the `- **Status**: Active` line. This is a carried-over contradiction that was not addressed during the rename.
- Fix: Either:
  (a) Add `- **Status**: Active` to the pitfall example in examples.md and change line 35 to "Pitfalls support `Active` and `Deprecated` statuses." OR
  (b) Remove `- **Status**: Active` from the SKILL.md template and remove the pitfall status entries from the Status Field Semantics section.
  Option (a) is recommended since the SKILL.md is the authoritative format spec and Status is used by the learning system.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**docs-framework Integration section is outdated** - `shared/skills/docs-framework/SKILL.md:148`
**Confidence**: 85%
- Problem: Line 148 says "Command flows: `/implement` appends ADRs to `decisions.md`; `/code-review`, `/debug`, `/resolve` append PFs to `pitfalls.md`". Per design decision D8/D9, commands no longer write decisions -- the background extractor does. This was inaccurate before this PR and remains inaccurate.
- Fix: Update to something like "Background learning: `scripts/hooks/background-learning` appends ADRs to `decisions.md` and PFs to `pitfalls.md` via `json-helper.cjs render-ready`"

## Suggestions (Lower Confidence)

- **"Knowledge Citations" section heading retained in resolve output template** - `plugins/devflow-resolve/commands/resolve.md:325`, `shared/skills/resolve:orch/SKILL.md:111`, `CLAUDE.md:152` (Confidence: 65%) -- The `## Knowledge Citations` heading in the resolution-summary output template was not renamed. This is a user-facing output artifact heading. Renaming to `## Decisions Citations` would be more consistent with the broader rename, but changing output format headings may affect downstream parsing or user expectations.

- **D8 design decision description uses "Knowledge" in prose** - `docs/self-learning.md:205` (Confidence: 62%) -- "D8: Knowledge writers removed from commands -- agent-summaries at command-end were low-signal. Knowledge now extracted directly from user transcripts." The word "Knowledge" here refers to the old system name. Could be updated to "Decisions writers" but the historical context may justify keeping it as-is since D8 was made when the system was named "knowledge."

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 3 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Documentation Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core rename is thorough -- all `KNOWLEDGE_CONTEXT`, `apply-knowledge`, `knowledge-context.cjs`, and `.memory/knowledge/` path references have been successfully updated across 84 files. The remaining issues are internal contradictions created by incomplete checklist updates (Phase headings renamed but their corresponding checklist items not) and a few section headings/labels that were missed. The blocking HIGH issue (3 checklist inconsistencies) is a clear documentation-code drift within the same files and should be fixed before merge.
