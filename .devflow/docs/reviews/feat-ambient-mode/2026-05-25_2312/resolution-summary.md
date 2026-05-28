# Resolution Summary

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-26
**Review**: .devflow/docs/reviews/feat-ambient-mode/2026-05-25_2312
**Command**: /resolve

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 7 |
| Fixed | 6 |
| False Positive | 1 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Missing direct tests for installCommandsRule/removeCommandsRule | tests/ambient.test.ts | 5e1c9f5 |
| Broad catch swallows all errors in settings.json read | src/cli/commands/ambient.ts:217 | 5e1c9f5 |
| Broad catch swallows all errors in devflowDir resolution | src/cli/commands/ambient.ts:244 | 5e1c9f5 |
| devflowDir resolution heuristic fragile (inverted priority) | src/cli/commands/ambient.ts:233 | 5e1c9f5 |
| Sequential fs.rm() loop over 224+ legacy skill names | src/cli/commands/init.ts:979 | caf6f00 |
| LEGACY_SKILL_NAMES exceeds maintainability threshold | src/cli/plugins.ts:300 | caf6f00 |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| Dual-source content duplication (COMMANDS_RULE_CONTENT vs shared/rules/commands.md) | src/cli/commands/ambient.ts:26 | Intentional design — inline constant is the install-time content. shared/rules/ path is not available post-install. Drift guard test at line 383 enforces sync. Converting to runtime fs.readFile would add I/O dependency with no safety improvement. |

## Deferred to Tech Debt
(none)

## Blocked
(none)
