# Resolution Summary

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11
**Review**: .docs/reviews/feat-rules-system-for-devflow-always-on-engin/2026-05-11_0056
**Command**: /resolve

## Decisions Citations

- applies ADR-001 — batch-5, plugins.ts:rules-optional-field (LEGACY_RULE_NAMES starts empty, no migration code)
- avoids PF-001 — batch-1, batch-3 (no backward-compat migration code added)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 15 |
| Fixed | 9 |
| False Positive | 3 |
| Deferred | 0 |
| Blocked | 0 |
| Pre-existing (skipped) | 3 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| `--enable` stale rules cleanup | `src/cli/commands/rules.ts:74` | `53113d7` |
| Sequential file I/O → Promise.all | `src/cli/commands/rules.ts:77` | `53113d7` |
| Path traversal defense-in-depth | `src/cli/plugins.ts:605` | `53113d7` |
| Duplicated shadow logic → shared helper | `src/cli/utils/installer.ts:21` | `53113d7` |
| formatFeatures missing learn/knowledge/decisions | `src/cli/commands/list.ts:14` | `cb49917` |
| CLAUDE.md missing rules documentation (6 sub-items) | `CLAUDE.md` | `71389ee` |
| rules.ts untested → 17 new tests | `tests/rules.test.ts` | `fbb6bfa` |
| Test fixtures incomplete (list, uninstall, manifest) | `tests/*.test.ts` | `fbb6bfa` |
| rules field optional → required on PluginDefinition | `src/cli/plugins.ts:40` | `a29e815` |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| Module-level eager allRulesMap | `src/cli/commands/rules.ts:33` | CLI module loads once per invocation; documented as intentional in feature knowledge. Simplifier later removed it anyway for cleanliness (explicit param passing). |
| list-logic.test.ts fixtures | `tests/list-logic.test.ts` | Already fixed by batch-2 resolver (allOff baseline includes rules field). |
| getAllRuleNames ordering | `src/cli/plugins.ts` | Fixed as part of batch-5 alongside the required-field change. |

## Pre-existing (Skipped)
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| init.ts complexity >20 | `src/cli/commands/init.ts:165` | Pre-existing; this PR adds ~40 lines following established pattern |
| LEGACY_SKILL_NAMES 197 entries | `src/cli/plugins.ts:277` | Pre-existing; LEGACY_RULE_NAMES starts empty per ADR-001 |
| cli-reference.md missing flags | `docs/cli-reference.md:17` | Pre-existing from prior PRs |

## Simplification Pass
| File | Change |
|------|--------|
| `src/cli/utils/installer.ts` | Removed duplicate isValidRuleName export; simplified installRuleFile control flow |
| `src/cli/commands/rules.ts` | Removed module-level allRulesMap; formatRuleRow now takes explicit ownerMap parameter |
| `src/cli/commands/list.ts` | Fixed import ordering |

## Verification
- Build: PASS (110 skill + 47 agent + 11 rule copies)
- Tests: 1411 passed (30 new tests added)
