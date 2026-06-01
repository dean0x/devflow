# Complexity Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### HIGH

**eval-learning: 7-level nesting depth retained from monolith** - `scripts/hooks/eval-learning:68-132`
**Confidence**: 85%
- Problem: The decomposition successfully moved learning logic out of the 501-line monolith into its own 132-line module, but the deepest nesting path (7 levels: feature-enabled -> daily-cap -> batch-threshold -> lock-acquire -> recheck-under-lock -> user-signals-present -> jq/node branch) was preserved verbatim. The nesting exceeds the 4-level warning threshold and is at the 6+ critical threshold. Lines 68-110 contain a single control flow path that requires tracing through 7 nested conditions to understand when a learning marker is written.
- Fix: Extract the inner "write marker" logic (lines 82-123) into a separate function or sourced helper (e.g., `_learn_write_marker()`) that takes the pre-validated inputs. The lock acquisition + recheck + cap block (lines 69-80) could similarly become a helper that calls the write function. This would flatten the nesting to ~4 levels per function. Note: this is pre-existing complexity that was transplanted, not introduced by this PR -- but it was explicitly called out in the prior review cycle (Cycle 2 deferred item: "sidecar-evaluate at 496 lines with 7-level nesting") and this decomposition was the opportunity to flatten it.

### MEDIUM

**eval-reinforce: 6-level nesting with dual-implementation branches** - `scripts/hooks/eval-reinforce:10-84`
**Confidence**: 82%
- Problem: The reinforcement module has 6 levels of nesting (learning-enabled -> log-exists -> slugs-found -> lock-acquired -> jq-branch/node-branch -> inner conditionals). The jq branch (lines 23-46) and node branch (lines 47-75) each contain their own nested conditions, making the file's 84 lines harder to follow than its length suggests. The dual jq/node implementation pattern doubles the cognitive load at the deepest nesting level.
- Fix: Extract the jq reinforcement and node reinforcement into two named functions (`_reinforce_jq()` and `_reinforce_node()`), each called from a flat dispatch at level 4. This would keep each function at 3-4 levels of nesting.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No pre-existing issues found._

## Suggestions (Lower Confidence)

- **eval-decisions and eval-knowledge share a structural pattern that could be further DRYed** - `scripts/hooks/eval-decisions:34-62`, `scripts/hooks/eval-knowledge:36-52` (Confidence: 65%) -- Both modules follow an identical "if jq available, use jq to build JSON; else use node" pattern with the same atomic temp+mv write. A shared `write_json_marker()` helper in eval-helpers could accept the JSON arguments and handle the jq/node dispatch internally, reducing each caller to a single function call.

- **debug.ts status branch duplicates the read/try-catch pattern** - `src/cli/commands/debug.ts:68-93` (Confidence: 62%) -- The status branch has its own read+try/catch block separate from the enable/disable shared read at lines 96-102. The comment explains the intent ("keep the branch self-contained"), which is a reasonable design choice, but it does mean the file-read error handling logic appears twice. Minor given the file is 133 lines.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR achieves its stated goal: decomposing a 501-line monolith into a 118-line orchestrator plus 5 focused modules, and DRYing the debug bootstrap (4 lines x 7 hooks -> 1 source call) and log init (~10 lines x 6 hooks -> 1 source call). The orchestrator (`sidecar-evaluate`) is now clean and scannable. The debug.ts refactor correctly extracts pure functions following the applyFlags/stripFlags pattern (applies ADR-007), and the test rewrite removes duplicated test helpers in favor of testing the real exported functions.

The remaining complexity concern is that `eval-learning` retained the 7-level nesting from the monolith rather than flattening it during decomposition. This was the specific item deferred from Cycle 2. The module is small enough (132 lines) that the nesting is survivable, but the decomposition was the natural moment to flatten it. Recommend addressing as a follow-up before the nesting pattern propagates to future modules.
