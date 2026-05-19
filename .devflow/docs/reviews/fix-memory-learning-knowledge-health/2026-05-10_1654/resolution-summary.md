# Resolution Summary

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10_1654
**Review**: .docs/reviews/fix-memory-learning-knowledge-health/2026-05-10_1654
**Command**: /resolve

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 24 |
| Fixed | 7 |
| False Positive | 1 |
| Pre-existing (not actioned) | 6 |
| Suggestions (not actioned) | 8 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| TOCTOU race in chmod 600 — replaced touch+chmod with (umask 077 && touch) | `scripts/hooks/stop-update-memory:74-76` | d18b219 |
| chmod 600 missing in prompt-capture-memory — added umask guard + QUEUE_FILE variable | `scripts/hooks/prompt-capture-memory:33-40` | d18b219 |
| grep pattern over-broad — changed regex to grep -qF fixed-string match | `scripts/hooks/stop-update-memory:55` | d18b219 |
| Missing argument guard in ensure-memory-gitignore | `scripts/hooks/ensure-memory-gitignore:6` | 5a7b715 |
| Missing test for SEC-3 empty argument guard | `tests/shell-hooks.test.ts` | d18b219 |
| Untyped JSON.parse — added type assertions at 9 call sites | `tests/shell-hooks.test.ts` | d18b219 |
| Missing test for assistant-only queue auto-clean behavior | `tests/shell-hooks.test.ts` | d18b219 |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| Anchor grep pattern to ^{ | `scripts/hooks/stop-update-memory:55` | Reviewer explicitly marked as "no change needed beyond Issue 3" — compact JSON from jq/JSON.stringify guarantees correct matching. Resolved by grep -qF fix. |

## Pre-existing (Not Actioned)
| Issue | File:Line | Source |
|-------|-----------|-------|
| ensure-memory-gitignore lacks argument guard | `scripts/hooks/ensure-memory-gitignore:6` | security — **Fixed as part of this resolution** |
| Queue file double-open (grep + wc -l) on hot path | `scripts/hooks/stop-update-memory:54-58` | performance — <5ms overhead, capped at 200 lines |
| stop-update-memory approaching responsibility threshold (140 lines, 7+ sections) | `scripts/hooks/stop-update-memory` | complexity — linear structure with clear section comments |
| ExecFileMock type alias erases overload signatures | `tests/decisions/decisions-agent.test.ts:34` | typescript — pre-existing pattern |
| noUncheckedIndexedAccess not enabled | `tsconfig.json` | typescript — project-wide decision |

## Suggestions (Not Actioned)
| Issue | Source | Reason Skipped |
|-------|--------|---------------|
| Queue file permissions not verified on existing files | security (65%) | Below confidence threshold |
| No file permission tests in test suite | security (70%) | Below confidence threshold |
| SOH delimiter in response_text could corrupt field splitting | architecture (60%) | Below confidence threshold, ASCII SOH in LLM output practically impossible |
| Queue file double-open on orphan detection | performance (65%) | Below confidence threshold |
| Queue file path used inline vs variable in prompt-capture-memory | consistency (65%) | Fixed as part of QUEUE_FILE variable extraction |
| Test setup boilerplate repetition across auto-clean tests | complexity (65%) | Readable and self-contained, matches existing test style |
| Overflow test first-entry assertion fragile to implementation changes | testing (65%) | Existing assertions already validate contract |
| Duplicated test helper code across agent test files | typescript (65%) | Pre-existing pattern, style choice |

## Deferred to Tech Debt
_(none)_

## Blocked
_(none)_

## Commits Created
- `d18b219` test(hooks): add SEC-3 guard test, assistant-only queue test, and JSON.parse type assertions (also includes TOCTOU fix, prompt-capture permission guard, grep -qF)
- `5a7b715` fix(hooks): add empty-arg guard to ensure-memory-gitignore
- `e2b5e39` style(hooks): clarify queue permission comment in stop-update-memory
