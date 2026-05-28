# Resolution Summary

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25_2233
**Review**: .devflow/docs/reviews/feat-ambient-mode/2026-05-25_2233
**Command**: /resolve

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 42 |
| Fixed | 9 |
| False Positive | 17 |
| Deferred | 0 |
| Blocked | 0 |
| Pre-existing (skipped) | 2 |
| Suggestions (skipped) | 14 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Extract rule file I/O into installCommandsRule/removeCommandsRule | src/cli/commands/ambient.ts:89 | 70b8733 |
| Fix removeAmbientHook discarding classification cleanup | src/cli/commands/ambient.ts:145 | 70b8733 |
| Narrow fs.unlink catch to ENOENT only | src/cli/commands/ambient.ts:148 | 70b8733 |
| Add 15 devflow:-prefixed skills to LEGACY_SKILL_NAMES | src/cli/plugins.ts:506 | 70b8733 |
| Fix "first message" wording in commands.md, ambient.ts, ambient README | shared/rules/commands.md:24, ambient.ts:49, README.md:15 | dc0e47d |
| Update README rule count 12→13 | README.md:56 | dc0e47d |
| Clarify ambient README skills section | plugins/devflow-ambient/README.md:39-47 | dc0e47d |
| Mock fs operations in ambient.test.ts | tests/ambient.test.ts:16-141 | 71d6e1b |
| Add stale-classification-only edge case test + COMMANDS_RULE_CONTENT sync test | tests/ambient.test.ts | 71d6e1b |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| hasAmbientHook incomplete detection | ambient.ts:161 | Hook is canonical signal by design; rule is supplementary |
| Integration test bypasses hook | ambient-activation.test.ts:38 | Tests model behavior; hook pattern matching tested in shell-hooks.test.ts |
| Preamble size guard | scripts/hooks/preamble:25 | 5-second hook timeout from Claude Code is sufficient implicit bound |
| README "See it work" example misleading | README.md:24-34 | Already clarifies "(or use /implement for the full agent pipeline)" |
| Plugin declares unnecessary agents | plugin.json:18 | Universal skill installation is by design — all plugins contribute |
| Plan detection markers too broad | preamble:25 | Low false-positive impact — hook injects suggestion, model decides |
| Plugin.json rules array empty vs commands.md | plugin.json | commands.md intentionally managed by ambient.ts, not rules pipeline |
| addAmbientHook file I/O on every call | ambient.ts:126 | Resolved by extraction into installCommandsRule — idempotent write is acceptable |
| removeAmbientHook async return type | ambient.ts:141 | Correctly async due to removeCommandsRule; callers already updated |
| runClaudeStreamingWithRetry removal | helpers.ts | Dead code, correctly removed by Simplifier |
| textResult helper JSDoc | ambient.test.ts:12 | Still needed by hasSkillInvocations tests, scope is clear |
| No negative test for empty prompts | preamble | Hook early-exits on empty DEVFLOW_USER_PROMPT; covered by existing shell-hooks.test.ts |
| CLAUDE.md rule lifecycle | CLAUDE.md:47 | Already documented as "managed by ambient.ts directly" |
| skill-catalog.md intent | skill-catalog.md:21 | Wording is accurate for current orch skill behavior |
| COMMANDS_RULE_CONTENT command format | ambient.ts:34 | /devflow:<name> is the installed format; correct |
| File write race | ambient.ts:126 | Both writers produce identical content; benign |
| LEGACY_SKILL_NAMES flat list | plugins.ts:300 | Pre-existing; managed with version-era comments |

## Deferred to Tech Debt
(none)

## Blocked
(none)
