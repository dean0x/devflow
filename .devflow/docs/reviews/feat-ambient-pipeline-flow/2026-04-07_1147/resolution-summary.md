# Resolution Summary

**Branch**: feat-ambient-pipeline-flow
**Review**: 2026-04-07_1147
**Resolved**: 2026-04-07

## Results

| Category | Fixed | Dismissed | False Positive | Deferred |
|----------|-------|-----------|----------------|----------|
| Blocking | 3 | 2 | 0 | 0 |
| Should-fix | 4 | 0 | 1 | 0 |
| Pre-existing | 2 | 0 | 0 | 1 |
| **Total** | **9** | **2** | **1** | **1** |

## Fixed (9)

### Batch 1: Orch skill frontmatter + hook guard
- Removed `allowed-tools` from all 7 orchestration skills (unrestricted, matching router pattern)
- Added 4KB size guard to `session-start-classification` hook

### Batch 2: CLI ambient.ts
- `hasAmbientHook` now checks both SessionStart and UserPromptSubmit hooks
- Enable message updated to "hooks registered" (plural)
- Option descriptions updated to reference both hooks

### Batch 3: Documentation sync
- CLAUDE.md: `~25 lines` → `~30 lines`
- README: added SessionStart hook mention, synced GUIDED skill tables (DEBUG +TDD, PLAN +TDD +security)
- skill-catalog.md: DEBUG/RESOLVE domain skills narrowed to GUIDED-only depth, PLAN TDD to GUIDED-only

### Batch 4: Test narrowing
- Replaced `!` non-null assertions with `if (!x) return` narrowing guards in ambient.test.ts

## Dismissed (2)
- **Pipeline user gates removed** — intentional design decision
- **Router dropped skills for ORCHESTRATED DEBUG/RESOLVE** — correct design (ORCHESTRATED delegates to agents with their own skills)

## False Positive (1)
- **`filterHookEntries` mutation** — mutates freshly-parsed JSON in contained parse→modify→serialize pipeline

## Deferred (1)
- **Shell hooks JSON validation** — project-wide pattern, `jq 2>/dev/null` already degrades gracefully; would require touching all hooks

## Commits
- `9acf1c4` fix(skills): remove allowed-tools from orch skills, add size guard to classification hook
- `c4d17d6` fix(ambient): hasAmbientHook checks both hooks, update CLI messages
- `745838a` docs: sync ambient docs with router skill tables
- `84982c3` fix(tests): replace non-null assertions with narrowing guards

## Verification
- Build: 71 skill copies + 33 agent copies
- Tests: 614/614 passing
- Zero `allowed-tools` in orch skills
- Zero `Task` references in orch skills
