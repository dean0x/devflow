# Resolution Summary

**Branch**: feat/phase5-devflow-dir → main
**Date**: 2026-05-19
**Review**: .docs/reviews/feat-phase5-devflow-dir/2026-05-18_2329
**Command**: /resolve

## Decisions Citations

- applies ADR-001 — batch-7 (migration tests validate clean-break migration logic)
- avoids PF-001 — batch-2 (orphan cleanup checks both old/new paths — defensive scan, not compat shim)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 22 |
| Fixed | 22 |
| False Positive | 0 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Broken ensure_docs_dir() inline fallback (dropped $1) | shared/skills/docs-framework/SKILL.md:107 | d8aa459 |
| Destroyed grep regex pattern (literal '...' instead of regex) | shared/skills/docs-framework/references/violations.md:205 | d8aa459 |
| Missed find .docs → .devflow/docs path update | shared/skills/docs-framework/references/violations.md:211 | d8aa459 |
| Stale .features/ comments (4 locations) | scripts/hooks/lib/feature-knowledge.cjs:4,5,108,414 | d8aa459 |
| Stale .features/ comment in knowledge-agent | src/cli/utils/knowledge-agent.ts:52,65 | d8aa459 |
| TOCTOU race in moveFile (access+rename non-atomic) | src/cli/utils/migrations.ts:15 | d212b71 |
| Sequential mkdir (6 independent calls) | src/cli/utils/migrations.ts:348 | d212b71 |
| Sequential file moves (26 entries in for loop) | src/cli/utils/migrations.ts:387 | d212b71 |
| moveDirContents sequential loop | src/cli/utils/migrations.ts:48 | d212b71 |
| Redundant type assertion | src/cli/utils/migrations.ts:46 | d212b71 |
| Hot-path guard for ensure-devflow-init (6 mkdir no-ops per turn) | scripts/hooks/ensure-devflow-init:13 | c50d696 |
| Features index.json bootstrap not atomic | scripts/hooks/ensure-devflow-init:23 | c50d696 |
| Misleading memoryDir variable name in decisions-append | scripts/hooks/json-helper.cjs:1829 | c50d696 |
| Missing getLearningLockDir() in project-paths.ts | src/cli/utils/project-paths.ts | 0510916 |
| Missing getLearningLockDir() in project-paths.cjs | scripts/hooks/lib/project-paths.cjs | 0510916 |
| Inline learning lock path in learn.ts (2 sites) | src/cli/commands/learn.ts:378,578 | 0510916 |
| Inline learning lock path in json-helper.cjs | scripts/hooks/json-helper.cjs:1535 | 0510916 |
| Missing consolidate-to-devflow-dir migration tests | tests/migrations.test.ts | 632533b |
| Missing rename-kb-to-knowledge migration tests | tests/migrations.test.ts | 632533b |
| Gitignore content triplication (3 identical copies) | src/cli/utils/migrations.ts, project-paths.ts/.cjs | b3fb221 |
| MEMORY_SKIP_FILES manual duplication of memMap keys | src/cli/utils/migrations.ts:106 | b3fb221 |
| Stale JSDoc + user-facing message + orphan path fix | src/cli/utils/legacy-decisions-purge.ts, post-install.ts | d212b71 |

## False Positives
_(none)_

## Deferred to Tech Debt
_(none)_

## Blocked
_(none)_

## Simplification Pass
Post-resolution simplifier applied:
- Removed unused `MigrationContext` type import from tests
- Extracted `resolveDecisionsPaths()` helper in legacy-decisions-purge.ts (deduplicated 5-line preamble from both public functions)
- Removed extra blank line in post-install.ts
