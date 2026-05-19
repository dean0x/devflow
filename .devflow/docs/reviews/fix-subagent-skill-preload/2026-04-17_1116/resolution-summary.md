# Resolution Summary

**Branch**: fix/subagent-skill-preload -> main
**Date**: 2026-04-17
**Review**: .docs/reviews/fix-subagent-skill-preload/2026-04-17_1116
**Command**: /resolve

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 17 |
| Fixed | 13 |
| False Positive | 2 |
| Deferred | 0 |
| Blocked | 0 |
| Pre-existing (skipped) | 2 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Restore graceful degradation for optional domain skills | `shared/agents/coder.md:56` | `203ac2a` |
| Restore graceful degradation for optional focus skills | `shared/agents/reviewer.md:59` | `203ac2a` |
| Remove "First action" label conflict on step 2 | `shared/agents/coder.md:56` | `203ac2a` |
| Document dynamic-loading rationale (coder) | `shared/agents/coder.md:56` | `203ac2a` |
| Document dynamic-loading rationale (reviewer) | `shared/agents/reviewer.md:59` | `203ac2a` |
| Fix timing race: `mtime > since` → `mtime >= since` | `tests/integration/helpers.ts:276` | `8f058bf` |
| Decompose `getLatestSubagentPreloadedSkills` (complexity) | `tests/integration/helpers.ts:231-299` | `8f058bf` |
| Add COUPLING comment for Claude Code internals | `tests/integration/helpers.ts:234` | `8f058bf` |
| Bound session directory walk to 20 most recent | `tests/integration/helpers.ts:241` | `8f058bf` |
| Type-safe JSON.parse with `unknown` and type guard | `tests/integration/helpers.ts:298` | `8f058bf` |
| Document `hasDevFlowBranding` alias with JSDoc `@see` | `tests/integration/helpers.ts:215` | `8f058bf` |
| Add guard assertions for transcript discovery | `tests/integration/subagent-skill-preload.test.ts` | `d65cfac` |
| Assert all 12 agents have non-empty frontmatter skills | `tests/skill-references.test.ts` | `d65cfac` |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| Designer missing failure-handling for preloaded skills | `shared/agents/designer.md` | Preloaded skills are injected by the platform at spawn time, not loaded by agent instructions. If preload fails, the agent never starts — no instruction needed. |
| 6/12 agents missing integration tests | `tests/integration/subagent-skill-preload.test.ts` | Structural test in skill-references.test.ts already validates all 12 agents' frontmatter parses correctly. Integration tests cover all loading patterns (preload-only, preload+dynamic, preload+apply-knowledge). Added unit assertion for non-empty skills. |

## Pre-existing (Not Addressed)
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| `resolve` identifier shadows path import | `tests/integration/helpers.ts:60` | Pre-existing, not introduced by this PR |
| Frontmatter field ordering (model vs skills) | `shared/agents/simplifier.md`, `shared/agents/skimmer.md` | Cosmetic, pre-existing |

## Simplification Pass
| Change | File |
|--------|------|
| Extract `spawnAgentAndGetPreloads` helper, collapse 6 test scaffolds | `tests/integration/subagent-skill-preload.test.ts` |
| Remove 5 spurious `async` on synchronous test functions | `tests/skill-references.test.ts` |

## Commits Created
- `203ac2a` fix(agents): restore graceful degradation for optional skill failures
- `8f058bf` fix(tests): address batch-B review issues in integration helpers
- `d65cfac` test: add guard assertions for empty transcript and missing agent skills
- `c097886` refactor(tests): extract spawnAgentAndGetPreloads helper, remove spurious async
