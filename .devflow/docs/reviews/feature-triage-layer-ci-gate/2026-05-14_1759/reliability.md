# Reliability Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### MEDIUM

**CI Status Gate poll/fix loop lacks inter-cycle budget sharing clarity (3 occurrences)** -- Confidence: 82%
- `shared/skills/implement:orch/SKILL.md:162-164`, `shared/skills/resolve:orch/SKILL.md:124-128`, `plugins/devflow-resolve/commands/resolve.md:214-216`
- Problem: The CI Status Gate specifies "max 10 polls" (step 4) and "max 2 fix attempts" (step 5) as separate limits, then step 6 adds "max 10 polls and max 2 fix attempts across all check/fix cycles combined." The interaction between steps 4-5 and step 6 is ambiguous: step 4 says "max 10 iterations" for a single PENDING poll loop, but step 6 says "max 10 polls ... across all check/fix cycles combined." If a fix attempt triggers a new PENDING state, does the 10-poll budget reset per cycle (step 4) or is it shared (step 6)? An agent interpreting step 4 literally could consume 10 polls per cycle, while step 6 intends 10 total. This ambiguity risks unbounded polling if the agent follows step 4's local limit rather than step 6's global budget.
- Fix: Clarify that steps 4-5 describe the behavior within each cycle, but step 6 is the authoritative global cap. Consider rewording step 4 to remove "max 10 iterations" and instead say "poll every 60 seconds (budget-limited, see step 6)." The fix applies identically to all three SYNC'd locations.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**CI Status Gate PENDING poll has no exponential backoff** -- Confidence: 85%
- `shared/skills/implement:orch/SKILL.md:162`, `shared/skills/resolve:orch/SKILL.md:126`, `plugins/devflow-resolve/commands/resolve.md:214`, `plugins/devflow-resolve/commands/resolve-teams.md:261`
- Problem: The PENDING poll loop polls every fixed 60 seconds. While the iteration count is bounded (max 10), a fixed-interval poll against a CI system experiencing slowness or rate limiting could contribute to load. Exponential backoff (e.g., 60s, 120s, 180s) would be more resilient and respectful of CI infrastructure under pressure.
- Fix: Consider changing to an increasing interval, e.g., "poll at 60s, then 120s, then 180s intervals (capped at 180s)" or note that fixed 60s is intentional for responsiveness. This is not blocking since the 10-iteration bound prevents runaway polling.

**check-ci-status classification priority change may mask failures during fix cycles** -- Confidence: 80%
- `shared/agents/git.md:292`
- Problem: The classification priority was changed from "all SUCCESS -> PASSING, any FAILURE -> FAILING, any PENDING -> PENDING" to "any PENDING -> PENDING first, then FAILURE, then SUCCESS." This means if one check is PENDING and another is FAILING, the status is now PENDING instead of FAILING. During the CI fix cycle (step 5 of the gate), after a Coder fix attempt is pushed, any remaining PENDING check will mask a pre-existing FAILURE from a different check, causing the gate to poll for the PENDING check to complete rather than immediately re-attempting the known failure. This extends the total wall-clock time of the gate but does not affect correctness since the FAILING status will surface once the PENDING check completes.
- Fix: Consider documenting the rationale for the priority order change. The new order is arguably more correct (you cannot know the final state until all checks finish), but the behavioral impact on the fix cycle should be noted.

## Suggestions (Lower Confidence)

- **SYNC marker lacks machine-enforceable validation** - `shared/skills/implement:orch/SKILL.md:155`, `shared/skills/resolve:orch/SKILL.md:115` (Confidence: 65%) -- The `<!-- SYNC: ci-status-gate -->` markers are comments only; there is no build-time or CI check verifying that all SYNC'd blocks stay identical. Drift between the three locations (implement:orch, resolve:orch, resolve commands) could introduce inconsistent reliability behavior across pipelines.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Reliability Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The CI Status Gate introduces well-bounded iteration (max 10 polls, max 2 fix attempts, total budget cap) with explicit termination on budget exhaustion -- this is solid reliability practice. The global budget in step 6 is the right instinct, applying the bounded iteration principle from NASA/JPL's Power of Ten rules. The one blocking MEDIUM is about clarifying the relationship between per-cycle limits (steps 4-5) and the global budget (step 6) to prevent ambiguous interpretation by the executing agent. The CHAT variant removal from CLASSIFICATION_PATTERN and the negative test for old INTENT/DEPTH format are clean changes with no reliability concerns (applies ADR-001 -- clean break, no backward compatibility for the old format). Phase number corrections are mechanical and reliability-neutral.
