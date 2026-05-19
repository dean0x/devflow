# Documentation Review Report

**Branch**: feat/wave-1 -> main
**Date**: 2026-03-13

## Issues in Your Changes (BLOCKING)

### HIGH

**README skill count not updated** - `README.md:27`
**Confidence**: 95%
- Problem: README says "30 quality skills" but CLAUDE.md was updated to 31, and the actual `shared/skills/` directory contains 31 skills. The CHANGELOG documents the search-first skill addition but README was not updated to match.
- Fix: Update line 27 of `README.md`:
```diff
-- **30 quality skills** — 8 auto-activating core, 8 optional language/ecosystem, plus specialized review and agent skills
+- **31 quality skills** — 9 auto-activating core, 8 optional language/ecosystem, plus specialized review and agent skills
```
Note: The core count changes from 8 to 9 because `search-first` was added to `devflow-core-skills` plugin.json.

**README auto-activating skills table missing search-first** - `README.md:109-122`
**Confidence**: 95%
- Problem: The "Auto-Activating Skills" table in README lists 8 skills from `devflow-core-skills`, but the `search-first` skill was added to that plugin's `plugin.json` in this PR. The table is now stale.
- Fix: Add a row to the table at `README.md:122`:
```diff
 | `input-validation` | Creating API endpoints |
+| `search-first` | Adding utilities, helpers, or infrastructure code |
```

### MEDIUM

**Reviewer agent step numbering mismatch with report template** - `shared/agents/reviewer.md:46-53`
**Confidence**: 82%
- Problem: The Responsibilities list was expanded from 7 to 10 steps (adding confidence assessment, confidence filtering, and consolidation). The report template section below still shows the same structure but does not include a "Consolidation" header or any indication of how grouped/consolidated findings should be formatted. Agents following this template will have to improvise the format for consolidated findings.
- Fix: Add a brief note in the report template showing how consolidated findings display:
```markdown
### HIGH
**{Issue} (N occurrences)** - `file1.ts:10`, `file2.ts:20`, `file3.ts:30`
**Confidence**: {n}%
- Problem: {description of pattern}
- Fix: {suggestion applicable to all locations}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CHANGELOG missing link for Unreleased diff** - `CHANGELOG.md:8-16`
**Confidence**: 85%
- Problem: The CHANGELOG follows Keep a Changelog format with link references at the bottom for version diffs. The `[Unreleased]` section was added with three features and a fix, but the bottom of the file likely needs a comparison link update for the new version tag once released. This is standard practice per keepachangelog.com. Currently informational since the release has not been cut yet, but the entries themselves should also include a version header when released.
- Fix: No action needed now, but ensure the release process updates the `[Unreleased]` header to a version number and adds the comparison link.

**compareSemver JSDoc missing pre-release/build metadata caveat** - `src/cli/utils/manifest.ts:63`
**Confidence**: 80%
- Problem: The `compareSemver` function's JSDoc says "Handles simple x.y.z versions" but does not explicitly document that pre-release suffixes (e.g., `1.4.0-beta.1`) are silently ignored since the regex uses `/^v?(\d+)\.(\d+)\.(\d+)/` (note: no end anchor). A version like `2.0.0-alpha` would compare as equal to `2.0.0`, which could produce incorrect upgrade detection for pre-release versions.
- Fix: Add a caveat to the JSDoc:
```typescript
/**
 * Compare two semver strings. Returns -1, 0, or 1.
 * Handles simple x.y.z versions; returns null for unparseable input.
 * Note: Pre-release suffixes (e.g., 1.0.0-beta.1) are ignored — only
 * major.minor.patch is compared.
 */
```

### LOW

**search-first SKILL.md Phase 2 references Explore subagent but skill is not an agent** - `shared/skills/search-first/SKILL.md:57-78`
**Confidence**: 80%
- Problem: The search-first skill's Phase 2 says "Spawn an Explore agent" with a `Task(subagent_type="Explore")` template. However, skills are read-only context (`allowed-tools: Read, Grep, Glob`) and cannot spawn subagents. The skill itself is not an agent -- it is guidance material that an agent (like Coder or ambient mode) reads. While this is technically correct (the agent reading the skill would spawn the subagent), the phrasing could confuse developers reading the skill in isolation. The `Task()` syntax suggests the skill itself performs the action.
- Fix: Add a clarifying sentence:
```markdown
### Phase 2: Search

Delegate research to an Explore subagent to keep main session context clean.
The agent reading this skill (e.g., Coder, ambient mode) should spawn the subagent:
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**docs/reference/skills-architecture.md missing search-first, test-driven-development, and ambient-router** - `docs/reference/skills-architecture.md`
**Confidence**: 90%
- Problem: The skills-architecture reference document lists all skills by tier but does not include `search-first`, `test-driven-development`, or `ambient-router`. These skills were added in a prior release (ambient mode feature) and this PR, but the reference document was never updated. The tier catalog is now incomplete.
- Note: This is a pre-existing gap -- the reference doc was not updated in the previous ambient-mode PR either. However, this PR adds `search-first` which compounds the gap. Consider adding all three missing skills to the appropriate tiers:
  - `search-first` -> Tier 2 (Specialized) or Tier 1 (Foundation)
  - `test-driven-development` -> Tier 2 (Specialized)
  - `ambient-router` -> Tier 2 (Specialized)

**README does not mention version manifest feature** - `README.md`
**Confidence**: 75% (borderline -- may be intentional to keep README user-focused)
- Problem: The version manifest (`manifest.json`) is a user-visible feature that enhances `devflow list` output and enables upgrade detection. It is documented in CHANGELOG but not mentioned in README's feature list or installation section. Users running `devflow list` will see manifest-driven output without understanding where it comes from.
- Note: This may be intentional if the manifest is considered an internal implementation detail. If it is user-facing, consider a brief mention in the Installation section.

## Suggestions (Lower Confidence)

- **evaluation-criteria.md scoring math inconsistency** - `shared/skills/search-first/references/evaluation-criteria.md:22` (Confidence: 70%) -- The "Adopt" threshold says "score >= 20/25" but with 5 criteria scored 1-5, maximum is 25 if License is scored numerically; however License is labeled "Required" (pass/fail), not scored 1-5. If License is excluded from the numeric total, max becomes 20/20, making the denominator "/25" misleading.

- **Synthesizer review mode confidence-boost rule undocumented in reviewer** - `shared/agents/synthesizer.md:133` (Confidence: 65%) -- The synthesizer introduces a "boost confidence by 10% per additional reviewer" aggregation rule, but this rule is not documented in the reviewer agent's confidence scale section. Reviewers setting 79% confidence may not realize that cross-reviewer agreement could push their finding above the 80% threshold in the final summary.

- **Deleted plugin-specific agents not noted in CHANGELOG** - `plugins/devflow-specify/agents/skimmer.md` (Confidence: 60%) -- Two plugin-specific agent files (`skimmer.md` and `synthesizer.md`) were deleted from `plugins/devflow-specify/agents/`. These appear to be duplicate copies of shared agents (the shared versions in `shared/agents/` remain). The deletion is likely a cleanup of build artifacts that were tracked in git, consistent with commit `cd315f5` ("untrack gitignored build artifacts"). Not a functional change, but could be noted under a "Changed" or "Chore" section for completeness.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | - | 0 | 2 | 1 |
| Pre-existing | - | - | 2 | 0 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The two HIGH blocking issues (README skill count drift and missing auto-activating skill table entry) represent documentation that actively contradicts the code changes in this PR. The CLAUDE.md skill count was updated to 31 but the README was missed, and the search-first skill was added to `devflow-core-skills` plugin.json but not reflected in the README's auto-activating skills table. These are straightforward fixes that should be applied before merge to prevent documentation-reality drift -- the exact anti-pattern the documentation-patterns Iron Law warns against.
