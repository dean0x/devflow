# Resolution Summary

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24_1626
**Review**: .docs/reviews/feat-per-feature-knowledge-bases/2026-04-24_1626
**Command**: /resolve

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 14 |
| Fixed | 12 |
| False Positive | 2 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| plan:orch GUIDED step numbering duplicated (1,2,1,2,3 → 1-5) | `shared/skills/plan:orch/SKILL.md:27-31` | `d918bb7` |
| pipeline:orch says "Phases 1-6" should be 1-7 (3 locations) | `shared/skills/pipeline:orch/SKILL.md:35,56,78` | `d918bb7` |
| review:orch "Phase 3" should be "Phase 4" | `shared/skills/review:orch/SKILL.md:99` | `d918bb7` |
| checkAllStaleness duplicates per-entry staleness logic | `scripts/hooks/lib/feature-kb.cjs:166-199` | `031ba17` |
| removeEntry silently overwrites corrupt index.json | `scripts/hooks/lib/feature-kb.cjs:352-355` | `031ba17` |
| Rename kb-builder agent to knowledge | 13 files across shared/agents, plugins, src/cli, docs | `33048f3` |
| file-organization.md says "12 shared agents" should be 13 | `docs/reference/file-organization.md:18,141` | `33048f3` |
| CLAUDE.md agent list uses old name kb-builder | `CLAUDE.md:156` | `33048f3` |
| Lock failure test (T1) slow at 515ms — reduced to 200ms | `tests/feature-kb/feature-kb.test.ts` | `3bf20eb` |
| removeEntry early-return behavior untested | `tests/feature-kb/feature-kb.test.ts` | `3bf20eb` |
| Non-null assertions on loadIndex returns (6 sites) | `tests/feature-kb/feature-kb.test.ts` | `3bf20eb` |
| kb-builder-agent.test.ts references old agent name | `tests/feature-kb/knowledge-agent.test.ts` | `3bf20eb` |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| KB commands grant unrestricted Bash via --dangerously-skip-permissions | `src/cli/commands/kb.ts:214-218` | `--allowedTools` restricts to 5 tools (Read,Grep,Glob,Write,Bash); Bash is required for `node scripts/hooks/lib/feature-kb.cjs update-index`. The agent surface is already scoped. |
| checkAllStaleness positive path untested | `tests/feature-kb/feature-kb.test.ts` | After extracting `checkEntryFiles`, both `checkStaleness` and `checkAllStaleness` delegate to the same helper. T2 already tests the positive staleness path through `checkStaleness`, which exercises the shared helper. |

## Deferred to Tech Debt
(none)

## Blocked
(none)

## Commits Created
- `d918bb7` docs(skills): fix stale phase numbers in plan:orch, pipeline:orch, review:orch
- `031ba17` refactor(feature-kb): extract checkEntryFiles helper and fix removeEntry early-return
- `33048f3` refactor: rename kb-builder agent to knowledge
- `3bf20eb` test(feature-kb): batch-D test improvements

## Simplifier Fixes
- Removed double `releaseLock` in `removeEntry` catch path (redundant with try/finally)
- Removed inline re-require of already-imported `rmSync` in tests
