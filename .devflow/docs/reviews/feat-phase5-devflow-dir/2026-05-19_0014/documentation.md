# Documentation Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Duplicate JSDoc `@param` has stale wording** - `src/cli/utils/legacy-decisions-purge.ts:149`
**Confidence**: 82%
- Problem: The `@param options.memoryDir` description was updated from `.memory/` to `.devflow/memory/` in the diff, but the actual current file at line 173 reads `legacy fallback: absolute path to the `.memory/` directory` -- the new and old descriptions now coexist inconsistently. The diff changed line 149 to say `.devflow/memory/` but the live file's resolved JSDoc at line 173 says `legacy fallback: absolute path to the `.memory/` directory`. The parameter still accepts the old `.memory/` path as a legacy fallback so the `legacy fallback` wording is accurate and intentional. However, the second function (`purgeAllPreV2DecisionsEntries` at line 247) has the exact same `@param` wording (`legacy fallback: absolute path to the `.memory/` directory`), but the diff at line 230 shows its description was updated to say `.devflow/decisions/` while the `@param` was not touched. This creates a mild inconsistency where the function-level description says `.devflow/decisions/` but the `@param` still says `.memory/`.
- Fix: Keep the `@param options.memoryDir` comment as `legacy fallback` since that accurately describes its role, but consider adding a note that `projectRoot` is the preferred parameter (already done at line 172 for `purgeLegacyDecisionsEntries` but missing from `purgeAllPreV2DecisionsEntries`).

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Three-way sync between TS, CJS, and shell heredoc has no automated enforcement** - `src/cli/utils/project-paths.ts:288`, `scripts/hooks/lib/project-paths.cjs:284`, `scripts/hooks/ensure-devflow-init:37` (Confidence: 70%) -- The gitignore content is now maintained in three places with only comment-based cross-references. Currently all three are in sync, but the comment-based synchronization mechanism is fragile. A future edit to one could easily miss the others. Consider a build-time assertion or test that compares the three outputs.

- **`MEMORY_LEGACY_SKIP_FILES` JSDoc says "entries NOT present in memMap" but the list also includes directory names handled by `moveDirContents`** - `src/cli/utils/migrations.ts:58-80` (Confidence: 65%) -- The comment at line 58-67 describes the array as "files in .memory/ that no longer exist in any meaningful sense" but the last two entries (`.sidecar`, `decisions`) are directories still migrated via `moveDirContents`. The inline comment at line 77 explains this, but the top-level JSDoc is slightly misleading since it implies these are purely dead entries.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Documentation Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The documentation changes in this PR are thorough and well-executed. Key strengths:

1. **JSDoc updates are comprehensive**: All four documentation-bearing source files (`feature-knowledge.cjs`, `knowledge-agent.ts`, `legacy-decisions-purge.ts`, `post-install.ts`) had their path references updated from `.memory/` / `.features/` / `.docs/` to the new `.devflow/` hierarchy. The `moveFile` function gained a new JSDoc explaining the TOCTOU race avoidance.

2. **`MEMORY_SKIP_FILES` rename and JSDoc**: The rename to `MEMORY_LEGACY_SKIP_FILES` with the explanatory JSDoc about the derived skip set is a clear documentation improvement -- it explains both what the list is and how it is consumed.

3. **`getDevflowGitignoreContent()` canonical source pattern**: The three-way duplication (TS, CJS, shell heredoc) is well-documented with cross-reference comments (`CJS COUNTERPART`, `TS COUNTERPART`, `CANONICAL SOURCE`). All three copies are byte-identical in content.

4. **Docs-framework skill updated**: `shared/skills/docs-framework/SKILL.md` and its `references/violations.md` were updated to reflect `.devflow/docs/` paths, `ensure_docs_dir()` parameter fix, and the detection commands now use the correct paths.

5. **Test documentation**: The 380 new lines of tests for `rename-kb-to-knowledge` and `consolidate-to-devflow-dir` migrations serve as living documentation of the migration behavior -- covering idempotency, partial state, empty old dirs, and gitignore cleanup. Applies ADR-001 (clean break philosophy) by testing the migration thoroughly rather than adding backward-compat shims.

6. **CLAUDE.md and README.md already use `.devflow/` paths** -- no stale references detected. The PR description accurately describes the consolidation.

The single MEDIUM blocking issue is a minor JSDoc inconsistency in the legacy purge file that does not affect runtime behavior.
