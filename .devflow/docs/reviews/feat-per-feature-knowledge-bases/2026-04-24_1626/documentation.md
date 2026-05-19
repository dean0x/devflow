# Documentation Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24

## Issues in Your Changes (BLOCKING)

### HIGH

**GUIDED section step numbering duplicated after renumbering** - `shared/skills/plan:orch/SKILL.md:27-31`
**Confidence**: 92%
- Problem: The GUIDED Behavior section renumbered steps 0 and 0.5 to 1 and 2, but the subsequent steps (Spawn Skimmer, Design, Present) were not renumbered from 1/2/3 to 3/4/5. This produces the sequence `1, 2, 1, 2, 3` -- duplicate step numbers that will confuse agents following the GUIDED path.
- Fix: Renumber the Spawn Skimmer step to 3, Design to 4, and Present to 5:
  ```markdown
  3. **Spawn Skimmer** — `Agent(subagent_type="Skimmer")` ...
  4. **Design** — Using Skimmer findings ...
  5. **Present** — Deliver structured plan ...
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**file-organization.md shared agents count is 12, should be 13** - `docs/reference/file-organization.md:18,141`
**Confidence**: 95%
- Problem: The file-organization.md lists "12 shared agents" in both the source tree comment (line 18) and the Shared vs Plugin-Specific section (line 141), but there are 13 shared agents (`kb-builder` is missing from the list). This PR modified file-organization.md (lines 183-184) to fix the knowledge source column, so this stale count in the same file should be fixed while here.
- Fix: Update both locations:
  - Line 18: `# SINGLE SOURCE OF TRUTH (13 shared agents)`
  - Line 141: `- **Shared** (13): \`git\`, \`synthesizer\`, \`skimmer\`, \`simplifier\`, \`coder\`, \`reviewer\`, \`resolver\`, \`evaluator\`, \`tester\`, \`scrutinizer\`, \`validator\`, \`designer\`, \`kb-builder\``

## Pre-existing Issues (Not Blocking)

### MEDIUM

**CONTRIBUTING.md shared agents count is 12, should be 13** - `CONTRIBUTING.md:28`
**Confidence**: 95%
- Problem: CONTRIBUTING.md still says "12 shared agents" in the project structure tree. This was not touched by this PR and should be fixed in a separate commit.
- Fix: Update to `# 13 shared agents (single source of truth)` in a follow-up.

## Suggestions (Lower Confidence)

- **Self-referential phase pointer in Discovery examples** - `shared/skills/plan:orch/SKILL.md:109` (Confidence: 65%) -- "Discover examples (run Phase 3)" is self-referential since the reader is already in Phase 3 (Requirements Discovery). While technically correct (it means "these examples trigger running this phase"), it may confuse agents. Consider rephrasing to "(these trigger discovery)".

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 0 |

**Documentation Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR performs a thorough and well-executed phase renumbering across 7 orchestration skills and 4 command files, plus meaningful code improvements to feature-kb.cjs (JSDoc, directory-boundary matching, dispatch table refactor). The one blocking issue is a simple numbering oversight in the GUIDED section of plan:orch where three steps kept their old numbers after the first two were renumbered. The should-fix item in file-organization.md is straightforward since the file was already being edited. Overall documentation quality is high -- the renumbering is internally consistent across all orchestration skills and their phase completion checklists, cross-references between skills were updated correctly, and the CLAUDE.md Feature Knowledge Bases section accurately reflects the new phase numbers and debug:orch locality note.
