# Consistency Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-30

## Issues in Your Changes (BLOCKING)

### HIGH

**Focus name mismatch: `testing` vs `tests` in review-methodology** - `shared/skills/review-methodology/SKILL.md:110`
**Confidence**: 95%
- Problem: The review-methodology SKILL.md Integration table was changed to use `testing` as the focus name (line 110: `| \`testing\` | devflow:testing |`), but the canonical focus name used by the reviewer agent, code-review commands, and the review-orchestration skill is `tests`. The reviewer agent's Focus Areas table (reviewer.md:32) maps `tests` -> `devflow:testing/SKILL.md`. The code-review.md Phase 2 table (line 97) lists `tests` as the focus. The review-orchestration.md lists `tests` in its core reviewers. The skill directory is `testing` but the focus identifier is `tests` -- these are two distinct concepts: the focus name is the label passed to the reviewer, the skill directory is where the SKILL.md lives. This table in review-methodology conflates them.
- Fix: Change line 110 of `shared/skills/review-methodology/SKILL.md` from:
  ```
  | `testing` | devflow:testing |
  ```
  to:
  ```
  | `tests` | devflow:testing |
  ```
  This matches the pattern used everywhere else: the Focus column uses the focus identifier (`tests`), the Pattern Skill column uses the skill reference (`devflow:testing`).

### MEDIUM

**Partial naming convention applied: some `-patterns` suffixes removed, others kept** - Multiple files
**Confidence**: 82%
- Problem: This PR renames 7 skills by dropping the `-patterns` suffix (security-patterns -> security, architecture-patterns -> architecture, performance-patterns -> performance, test-patterns -> testing, core-patterns -> software-design, input-validation -> boundary-validation, frontend-design -> ui-design). However, 6 skills retain the `-patterns` suffix: complexity-patterns, consistency-patterns, regression-patterns, database-patterns, dependencies-patterns, documentation-patterns, implementation-patterns. The resulting naming convention is inconsistent -- some review pattern skills have the suffix, others do not. While this may be intentional (e.g., the renamed skills got entirely rewritten with `sources.md` bibliographies while the others were left as-is for a future pass), there is no explicit justification in the PR for why these 6 were excluded from the rename.
- Fix: If this is intentional and the remaining skills will be renamed in a follow-up PR, no action needed but consider adding a comment or tracking issue. If this was an oversight, rename the remaining skills for full consistency.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**core-skills README lists `typescript` and `react` skills not in plugin.json** - `plugins/devflow-core-skills/README.md:23-24`
**Confidence**: 90%
- Problem: The core-skills README "Skills Included" table and "Iron Laws" table list `typescript` and `react`, but these skills are not in the core-skills plugin.json skills array (they were moved to optional plugins in a prior release). This PR updated the renamed skills in this README but did not address this pre-existing drift.
- Fix: Remove `typescript` and `react` rows from both tables in the README, or add a note that they are provided by optional plugins.

**resolve README skill list does not match plugin.json** - `plugins/devflow-resolve/README.md:49-55`
**Confidence**: 88%
- Problem: The README lists skills from the resolver agent's frontmatter (software-design, git-safety, git-workflow, implementation-patterns, security) rather than the plugin's own plugin.json skills array (agent-teams, implementation-patterns, knowledge-persistence, security, worktree-support). This drift predates this PR but was deepened by the rename (the PR correctly updated `core-patterns` -> `software-design` and `security-patterns` -> `security` in the README, and fixed `commit` -> `git-workflow`).
- Fix: Align the README skills list to match the plugin.json, or clearly label the two different skill sets (plugin skills vs agent frontmatter skills).

## Suggestions (Lower Confidence)

- **Naming convention documentation** - No file (Confidence: 70%) -- The rationale for which skills were renamed and which were not is not documented anywhere in the PR. A brief note in a commit message, PR description, or skills-architecture.md would help future contributors understand the partial rename was deliberate.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The V2 skill rename is executed with high fidelity across 143 files. The new `skill-references.test.ts` (950 lines) provides excellent rename-proof guardrails against future drift. The one blocking issue is the `testing` vs `tests` focus name mismatch in review-methodology, which would cause confusion for any agent or documentation consumer that uses the focus name from that table. The partial `-patterns` suffix removal is noted but not blocking since it may be intentional phasing.
