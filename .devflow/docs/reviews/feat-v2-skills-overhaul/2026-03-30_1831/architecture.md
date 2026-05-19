# Architecture Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-30

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Focus name inconsistency: `tests` vs `testing` in review-methodology** - `shared/skills/review-methodology/SKILL.md:110`
**Confidence**: 90%
- Problem: The PR changed the focus name in `review-methodology/SKILL.md` from `tests` to `testing` (line 110: `` | `testing` | devflow:testing | ``). However, the reviewer agent (`shared/agents/reviewer.md:32`) and both code-review commands (`code-review.md:97`, `code-review-teams.md:167`) all use `tests` as the focus name that maps to `devflow:testing`. The review-methodology table is informational (not used for dispatch), so this does not break runtime behavior, but it creates a documentation inconsistency between the canonical focus name (`tests`) and what this table now claims (`testing`).
- Fix: Revert the focus column to `tests` while keeping the pattern skill column as `devflow:testing`:
  ```markdown
  | `tests` | devflow:testing |
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**SHADOW_RENAMES is a manually-maintained duplicate of knowledge already in the system** - `src/cli/plugins.ts:312-319`
**Confidence**: 80%
- Problem: The `SHADOW_RENAMES` constant is a hand-maintained `[string, string][]` mapping old skill names to new names. This same knowledge (which skills were renamed) is implicit in the diff between old and new `DEVFLOW_PLUGINS` skill arrays and could drift if a future rename is added to one list but not the other. There is no programmatic link between `SHADOW_RENAMES` and the canonical `DEVFLOW_PLUGINS` or `LEGACY_SKILL_NAMES`. This is a DRY concern — the rename mapping is stated in three places: `SHADOW_RENAMES`, `LEGACY_SKILL_NAMES` (which lists both old prefixed and new bare names), and the `DEVFLOW_PLUGINS` skills arrays themselves.
- Fix: This is a should-fix, not blocking. Consider adding a test that verifies every entry in `SHADOW_RENAMES` has its old name in `LEGACY_SKILL_NAMES` and its new name in `getAllSkillNames()`, which would catch drift. Alternatively, derive `SHADOW_RENAMES` from a single authoritative rename table that also feeds the legacy cleanup arrays.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-002 (init monolith) is not worsened but not improved** - `src/cli/commands/init.ts`
**Confidence**: 85%
- Problem: Known pitfall PF-002 flags the init command handler as a monolith. This PR adds `migrateShadowOverrides()` as a well-extracted pure function (good), but inserts its call site into the monolithic `.action()` handler (line 787-796). The extraction pattern is correct. The monolith itself remains a pre-existing concern.
- Note: The new `migrateShadowOverrides()` function follows good architecture: pure function, injected path dependency, returns a structured result, well-tested. This is the right pattern for incremental improvement of PF-002.

## Suggestions (Lower Confidence)

- **Plugin name / skill name divergence** - `src/cli/plugins.ts:156-160` (Confidence: 65%) -- The plugin `devflow-frontend-design` now maps to skill `ui-design`. While the plugin name is user-facing (install selection) and the skill name is internal (file system), this asymmetry between `frontend-design` (plugin) and `ui-design` (skill) could cause confusion. Not blocking since the mapping is explicit and tested, but worth noting for a potential future plugin rename.

- **Nested try/catch pattern in migrateShadowOverrides** - `src/cli/commands/init.ts:69-83` (Confidence: 60%) -- The nested try/catch using `fs.access` for existence checks is idiomatic Node.js but could be simplified with a helper like `pathExists()` for readability. The current implementation is functionally correct and well-tested.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Assessment

This PR executes a well-planned atomic rename of 7 skills across the entire system. The architectural approach is sound:

1. **Single source of truth preserved**: `DEVFLOW_PLUGINS` in `plugins.ts` remains the canonical registry. All plugin.json manifests, agent frontmatter, command files, skill catalogs, and hook scripts were updated consistently.

2. **Migration strategy is correct**: `SHADOW_RENAMES` + `migrateShadowOverrides()` handles the user-facing migration path (shadow overrides at old names). The function is pure, testable, and placed in the correct execution order (before install).

3. **Legacy cleanup is comprehensive**: `LEGACY_SKILL_NAMES` includes both old prefixed (`devflow:security-patterns`) and new bare (`security`) names, covering all historical install formats.

4. **Test coverage is strong**: 950-line new `skill-references.test.ts` provides rename-proof validation across 11 reference formats. Integration tests verify migration-before-install ordering. This is the correct investment for a rename of this scope.

5. **No old name leakage**: Grep confirms zero stale references in active code paths (agents, skills, plugins, scripts, docs, README, CLAUDE.md). Old names only appear in legacy/migration arrays where they belong.

**Condition for approval**: Fix the `tests` vs `testing` focus name inconsistency in `review-methodology/SKILL.md` (line 110). This is a minor documentation fix but matters because the review-methodology skill is loaded by every reviewer agent and the focus name table should match what the orchestrator actually sends.
