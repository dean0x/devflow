# Resolution Summary

**Branch**: feat/phase-3-decouple-decisions-agent -> main
**Date**: 2026-05-06
**Review**: .docs/reviews/feat-phase-3-decouple-decisions-agent/2026-05-06_1655
**Command**: /resolve

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 44 |
| Fixed | 17 |
| False Positive | 1 |
| Deferred | 11 |
| Skipped (Low/Suggestion) | 15 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Notification path: render-ready missing --notifications-path | learn.ts:577 | 0b35af6 |
| decisions-append writes to wrong notifications file | json-helper.cjs:1841 | 0b35af6 |
| HUD directs all notifications to "devflow learn --review" | notifications.ts:88 | 0b35af6 |
| learn --reset missing .notifications.json in transient list | learn.ts:847 | 0b35af6 |
| Temp file permissions world-readable (0o644) | decisions-agent.ts:112, learning-agent.ts:64 | 0520752 |
| --cwd flag not validated before filesystem operations | decisions.ts:170 | 0520752 |
| Unvalidated type assertion on LLM structured output | decisions-agent.ts:273 | 0520752 |
| Per-session node subprocess in extractBatchMessages | background-runner.ts:249-272 | ea4b890 |
| Sync readFileSync/existsSync in async extractBatchMessages | background-runner.ts:240,251 | ea4b890 |
| Async _loadObservationsFromLog uses only readFileSync | background-runner.ts:388 | ea4b890 |
| Signal handlers don't call process.exit() | background-runner.ts:116-117 | ea4b890 |
| 231-char boolean expression with 11 disjuncts | decisions.ts:148 | 0520752 |
| rmdir on non-empty decisions/ directory | decisions.ts:508 | 0520752 |
| Unused debug field in agent opts interfaces | decisions-agent.ts:80, learning-agent.ts:34 | 0520752 |
| Redundant final writeObservations after review loop | decisions.ts:629 | 0520752 |
| Redundant `as string` cast | decisions.ts:409 | 0520752 |
| background-learning not in LEGACY_HOOK_FILES | init.ts:940 | d920e8e |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| learn --review capacity reads wrong notification file | learn.ts:1258,1293 | Correct post-split: learn manages .learning-notifications.json. Real fix was issue #6 (render-ready path). |

## Deferred to Tech Debt
| Issue | File:Line | Risk Factor |
|-------|-----------|-------------|
| decisions.ts duplicates learn.ts structure (726 vs 896 lines) | decisions.ts | Architectural: ~1400 lines across 2 files, separate PR |
| --run-background pipeline duplication | decisions.ts:168, learn.ts:516 | Architectural: extract shared pipeline runner |
| Monolithic 580-line action handler | decisions.ts:147-726 | Architectural: extract per-subcommand functions |
| Nesting depth 7 in --review block | decisions.ts:544-638 | Architectural: part of handler extraction |
| Tests re-implement inline logic | cli-subcommands.test.ts:116-209 | Testing methodology: separate effort |
| No unit test for extractBatchMessages | background-runner.ts:225-276 | Testing gap: add dedicated tests |
| No unit test for loadExistingObservations | background-runner.ts:366-386 | Testing gap: add dedicated tests |
| --dismiss-capacity test re-implements logic | cli-subcommands.test.ts:350-423 | Testing methodology |
| --reset test validates static list | cli-subcommands.test.ts:311-344 | Testing methodology |
| Redundant capEntries alias test | background-runner.test.ts:341-360 | Test cleanup |
| Temp file leak risk in agent tests | decisions-agent.test.ts, learning-agent.test.ts | Testing robustness |

**Tech Debt Issue**: #204
