# Resolution Summary

**Branch**: feat/learning-wave2-quality → main
**Date**: 2026-03-25
**PR**: #162
**Command**: /resolve

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 40 |
| Fixed | 36 |
| False Positive | 2 |
| Deferred | 1 |
| Out of Scope | 1 |

## Fixed Issues

### Batch A: session-end-learning (10 fixes)
| Issue | Fix | Commit |
|-------|-----|--------|
| Race condition: cp+rm → atomic mv | `mv` replaces `cp`+`rm` for batch handoff | 1f56cf9 |
| Per-line subprocess in reinforce_loaded_artifacts | Single-pass jq with node fallback | 1f56cf9 |
| Session ID format validation | grep allowlist check before append | 1f56cf9 |
| CWD encoding inconsistency | Aligned with background-learning pattern | 1f56cf9 |
| Log timestamp format | ISO 8601 UTC matching other hooks | 1f56cf9 |
| Conditional logging inconsistency | Unconditional logging matching other hooks | 1f56cf9 |
| `source` vs `.` | Changed to `source` for consistency | 1f56cf9 |
| `set -euo pipefail` → `set -e` | Aligned with all other hooks | 1f56cf9 |
| Missing `disown` after background spawn | Added `disown` after `&` | 1f56cf9 |
| Top-level procedural code | Extracted `run_batch_check()` function | 1f56cf9 |

### Batch B: background-learning (11 fixes)
| Issue | Fix | Commit |
|-------|-----|--------|
| Per-line subprocess in extract_batch_messages | Single-pass jq/node extraction | e684589 |
| process_observations() decomposition | Extracted validate_observation, calculate_confidence, check_temporal_spread | e684589 |
| Duplicate temporal spread calculation | Single check_temporal_spread() call | e684589 |
| ART_DESC YAML escaping | `sed 's/"/\\"/g'` before frontmatter interpolation | e684589 |
| ART_NAME sanitization | Strict kebab-case allowlist: `tr -cd 'a-z0-9-'` | e684589 |
| Per-line subprocess in apply_temporal_decay | Single-pass jq with node fallback | e684589 |
| Per-line subprocess in create_artifacts status | Single jq pass for status update | e684589 |
| Dead increment_daily_counter function | Removed entirely | e684589 |
| create_artifacts() decomposition | Extracted write_command_artifact, write_skill_artifact | e684589 |
| 30K flat truncation limit | Per-session 8K cap (proportional contribution) | e684589 |
| build_sonnet_prompt readability | Added section comment markers | e684589 |

### Batch C: learn.ts (3 fixes)
| Issue | Fix | Commit |
|-------|-----|--------|
| hasLearningHook blind to legacy Stop | Returns `'current' \| 'legacy' \| false`; --status shows upgrade instructions | 83af508 |
| addLearningHook missing legacy cleanup | Calls removeLearningHook first (self-upgrading --enable) | 83af508 |
| batch_size not in TypeScript config | Added to LearningConfig, loadLearningConfig, --configure wizard | 83af508 |

### Batch D: Tests (5 fixes)
| Issue | Fix | Commit |
|-------|-----|--------|
| loadAndCountObservations untested | 4 test cases: mixed, all-valid, empty, invalidCount | 5582f70 |
| extract-text-messages string path untested | Test with string content input | 5582f70 |
| learning-new operation untested | Test verifying self-learning/ prefix | 5582f70 |
| learning-created unrealistic paths | Updated to production-realistic paths | 5582f70 |
| session-end-learning structural test | Shebang + json-parse sourcing check | 5582f70 |

### Markdown Documentation (4 fixes)
| Issue | Fix | Commit |
|-------|-----|--------|
| file-organization.md: stop-update-learning → session-end-learning | Updated file tree + prose | b5b1d8b |
| file-organization.md: session-end-learning missing from tree | Added to file tree | b5b1d8b |
| CHANGELOG.md: missing Wave 2 entries | Added Changed + Fixed sections | b5b1d8b |
| CLAUDE.md: hooks list incomplete | Added deprecated stub to list | b5b1d8b |

### Simplifier passes
| Issue | Fix | Commit |
|-------|-----|--------|
| learn.ts: duplicated observation-loading pattern | Extracted readObservations(), warnIfInvalid(), hoisted logPath | 5eeeda7 |

## False Positives
| Issue | Reasoning |
|-------|-----------|
| max_daily_runs configure wizard default | Already shows 5 — reviewer missed the Scrutinizer fix |
| batch-C issue 4 (max_daily_runs documentation) | Behavioral change documented in CHANGELOG — no code issue |

## Deferred to Tech Debt
| Issue | Risk Factor |
|-------|-------------|
| PF-004: background-learning monolith (~650 lines) | Major architectural refactor: moving JSON-heavy logic from bash to TypeScript. Decomposition within bash already done (helpers extracted). TypeScript migration is a separate initiative. |

## Out of Scope
| Issue | Reasoning |
|-------|-----------|
| batch-A issue 11 (batch_size in TypeScript) | Handled in Batch C, not session-end-learning |

## Verification
- Tests: 461/461 passing (20 test files)
- Build: clean (35 skills, 10 agents, 17 plugins)
- Shell syntax: all hooks pass `bash -n`
