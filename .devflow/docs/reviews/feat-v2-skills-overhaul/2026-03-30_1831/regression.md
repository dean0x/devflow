# Regression Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-30_1831

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical blocking issues found.

### HIGH

No high-severity blocking issues found.

## Issues in Code You Touched (Should Fix)

No should-fix issues found.

## Pre-existing Issues (Not Blocking)

No pre-existing regression issues found.

## Suggestions (Lower Confidence)

- **Duplicate commit messages** - `git log` (Confidence: 65%) -- Two commits share `feat(testing): upgrade to V2 with literature citations` and two share `feat: migrate shadow skill overrides from old V2 names during init`. This is cosmetic and does not affect functionality, but may cause confusion during git bisect or blame. Consider interactive rebasing before merge to squash or disambiguate.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Analysis Detail

### Rename Migration Completeness (Confidence: 95%)

This PR renames 7 skills as part of a V2 naming convention overhaul:

| Old Name | New Name |
|----------|----------|
| `core-patterns` | `software-design` |
| `test-patterns` | `testing` |
| `security-patterns` | `security` |
| `architecture-patterns` | `architecture` |
| `performance-patterns` | `performance` |
| `input-validation` | `boundary-validation` |
| `frontend-design` | `ui-design` |

**Migration verified across all 9 reference surfaces:**

1. **Plugin manifests** (`plugin.json` files) -- All 6 affected plugins updated: devflow-ambient, devflow-code-review, devflow-core-skills, devflow-frontend-design, devflow-resolve, devflow-self-review.

2. **Plugin registry** (`src/cli/plugins.ts`) -- All `skills[]` arrays in `DEVFLOW_PLUGINS` use new names. Old names added to `LEGACY_SKILL_NAMES` for cleanup. New `SHADOW_RENAMES` map added for shadow override migration.

3. **Agent frontmatter** -- All 7 affected agents updated: coder.md, resolver.md, reviewer.md, scrutinizer.md, shepherd.md, simplifier.md, validator.md.

4. **Install path references** (`~/.claude/skills/devflow:NAME/SKILL.md`) -- All paths in reviewer.md, coder.md, code-review.md, code-review-teams.md, implement-teams.md updated.

5. **Source directory paths** (`shared/skills/NAME/`) -- Old directories deleted, new directories created. Cross-reference in self-review/references/stub-detection.md updated.

6. **Ambient router** -- SKILL.md skill tables and skill-catalog.md reference doc both updated.

7. **Review orchestration** -- SKILL.md conditional reviewer table and reviewer lists updated.

8. **Plugin READMEs** -- All 5 affected READMEs updated (ambient, code-review, core-skills, implement, frontend-design).

9. **Project docs** -- CLAUDE.md, README.md, docs/reference/skills-architecture.md, docs/reference/file-organization.md all updated.

**Residual old names verified as intentional:**
- `LEGACY_SKILL_NAMES` in `src/cli/plugins.ts:289-295` -- Prefixed old names for cleanup during init (correct).
- `SHADOW_RENAMES` in `src/cli/plugins.ts:313-319` -- Migration mapping (correct).
- `CHANGELOG.md` -- Historical entries referencing old names (correct, not updated).
- `devflow-frontend-design` plugin name -- This is the plugin name, not the skill name. The plugin name is unchanged; only the skill inside it was renamed to `ui-design` (correct).

### Reviewer Focus Area Mapping (Confidence: 95%)

The focus name `frontend-design` was renamed to `ui-design` across the reviewer agent, code-review commands, and review-orchestration skill. The focus name `tests` continues to map to the `testing` skill correctly (special case handled at `skill-references.test.ts:771`).

### Shadow Override Migration (Confidence: 92%)

New `migrateShadowOverrides()` function in `init.ts` handles users who had shadowed old skill names at `~/.devflow/skills/{old}/`. The function:
- Renames old shadow dirs to new names via `fs.rename()`
- Warns (does not overwrite) if both old and new shadow dirs exist
- Runs before skill installation so shadows are found at new names

Test coverage includes: happy path rename, conflict warning, no-op when old doesn't exist, batch migration of all 7 renames, and concurrent invocation safety.

### Test Suite Verification

All 574 tests pass across 23 test files. The new `tests/skill-references.test.ts` (29 tests) provides regression guards across 11 reference formats, including:
- Old-name detection in test data (Format 11)
- Cross-component runtime alignment between reviewer, code-review command, and review-orchestration
- Preamble drift detection between ambient-prompt hook and test helpers

### Deleted Files (24 files)

All 24 deleted files are old skill directories that have been replaced by their renamed counterparts with new content. No functionality was lost -- every deleted SKILL.md, patterns.md, violations.md, and detection.md has a corresponding new file under the renamed directory.

### Behavioral Change: Code-Review Command Invocation Template

The code-review command changed from:
```
"Review focusing on {focus}. Apply devflow:{focus}-patterns."
```
to:
```
"Review focusing on {focus}. Load the pattern skill for your focus from the Focus Areas table."
```

This is intentional and correct: the old template used a `{focus}-patterns` suffix which no longer works for renamed skills like `security` (was `security-patterns`). The new template directs the reviewer to its own Focus Areas lookup table, which maps each focus to the correct skill path.
