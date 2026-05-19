# Documentation Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-18

## Issues in Your Changes (BLOCKING)

### HIGH

**`ensure_docs_dir()` inline fallback lost `$1` parameter** - `shared/skills/docs-framework/SKILL.md:107`
**Confidence**: 95%
- Problem: The inline fallback for `ensure_docs_dir()` was changed from `mkdir -p ".docs/$1"` to `mkdir -p ".devflow/docs/"` -- dropping the `$1` subdirectory parameter. This means the function now always creates the bare `.devflow/docs/` directory instead of creating the requested subdirectory. Any agent using the inline fallback (when `docs-helpers.sh` is not found) will write all artifacts to the wrong directory.
- Fix: Restore the `$1` parameter:
  ```bash
  ensure_docs_dir() { mkdir -p ".devflow/docs/$1"; }
  ```
  Note: The full implementation in `references/patterns.md:188` and its inline fallback at `references/patterns.md:227` are both correct -- only the SKILL.md copy is broken.

**Grep regex pattern lost during path refactor** - `shared/skills/docs-framework/references/violations.md:205`
**Confidence**: 95%
- Problem: The detection pattern `grep -r "^\d{4}-\d{2}-\d{2}[^_]" .docs/` was replaced with `grep -r "..." .devflow/docs/` -- the actual regex was replaced with literal `"..."`. This renders the detection pattern useless for finding wrong timestamp formats.
- Fix: Restore the regex with the updated path:
  ```bash
  grep -r "^\d{4}-\d{2}-\d{2}[^_]" .devflow/docs/
  ```

### MEDIUM

**Missed `.docs` -> `.devflow/docs` update in detection pattern** - `shared/skills/docs-framework/references/violations.md:211`
**Confidence**: 92%
- Problem: One `find` command still references the old `.docs` path:
  ```bash
  find .docs -name "*.md" | grep -v "INDEX\|CATCH_UP\|KNOWLEDGE_BASE" | xargs -I {} basename {} | grep "^[A-Z]"
  ```
  All other detection patterns in this section were correctly updated to `.devflow/docs`.
- Fix:
  ```bash
  find .devflow/docs -name "*.md" | grep -v "INDEX\|CATCH_UP\|KNOWLEDGE_BASE" | xargs -I {} basename {} | grep "^[A-Z]"
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Stale artifact counts in `docs/reference/file-organization.md`** - `docs/reference/file-organization.md:12,18,23`
**Confidence**: 85%
- Problem: The source tree listing shows "44 skills", "13 shared agents", and "17 plugins" while CLAUDE.md states "58 skills", "14 shared agents", and "20 plugins". These counts predate this PR but are in a file that was touched by this refactor.
- Fix: Update the counts to match reality: 58 skills, 14 shared agents, 20 plugins. Also update the listed plugins under the tree (only 8 are listed, but there are 20).

**Stale hook filenames in `docs/reference/file-organization.md` source tree** - `docs/reference/file-organization.md:46-56`
**Confidence**: 82%
- Problem: The source tree listing shows legacy hook names (`stop-update-memory`, `prompt-capture-memory`, `background-memory-update`, `stop-update-learning`, `background-learning`, `session-end-knowledge-refresh`, `background-knowledge-refresh`) that no longer exist in `scripts/hooks/`. The actual hooks are the sidecar-based ones (`sidecar-capture`, `sidecar-dispatch`, `sidecar-evaluate`, `session-start-memory`, `session-start-context`, `pre-compact-memory`, `preamble`, etc.). This predates this PR.
- Fix: Update the source tree to list the current hook files.

## Suggestions (Lower Confidence)

(none -- all findings above meet the 80% confidence threshold)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | - | 2 | 1 | - |
| Should Fix | - | - | - | - |
| Pre-existing | - | - | 2 | - |

**Documentation Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The path consolidation refactor is thorough -- 60+ markdown files were updated and a comprehensive grep across all docs, skills, agents, and plugins found zero stale `.memory/`, `.docs/`, or `.features/` references remaining. The three blocking issues are localized to the docs-framework skill: a dropped function parameter, a destroyed regex pattern, and one missed path update. All are straightforward fixes. The PR applies ADR-001 (clean break philosophy) correctly by updating all paths without backward compatibility layers. The pre-existing issues in `file-organization.md` (stale counts and hook names) should be addressed in a follow-up.
