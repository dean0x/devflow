# Reliability Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**CI Status Gate polling lacks total wall-clock timeout** - `shared/skills/implement:orch/SKILL.md:161`, `shared/skills/resolve:orch/SKILL.md:125`, `plugins/devflow-resolve/commands/resolve.md:214`, `plugins/devflow-resolve/commands/resolve-teams.md:261`
**Confidence**: 92%
- Problem: The CI Status Gate defines "poll every 60 seconds, max 10 iterations" for the PENDING state, but does not account for the FAILING fix-and-recheck loop that follows. After the 10-poll timeout, if the status transitions from PENDING to FAILING, the spec spawns a Coder agent to fix (max 2 attempts), each of which pushes and re-checks. Each re-check could itself enter a new PENDING state — but there is no specification for how to handle PENDING during the re-check after a fix attempt. This creates a potential unbounded chain: PENDING (10 polls) -> FAILING -> fix -> push -> re-check -> PENDING again (another 10 polls?). The spec does not clarify whether the post-fix re-check reuses the same poll budget or resets it.
- Fix: Add explicit language constraining the total CI gate wall-clock time. For example: "Total CI gate budget: max 10 poll iterations across all check/fix cycles combined. Each fix-then-recheck consumes from the same 10-poll budget." Alternatively, specify that the re-check after a fix attempt is a single check (no polling) — if PENDING, treat as "CI still running, verify manually."

**CI Status Gate classification order allows FAILING to mask PENDING** - `shared/agents/git.md:292`
**Confidence**: 85%
- Problem: The check-ci-status classification logic in step 5 is: "all SUCCESS -> PASSING, any FAILURE -> FAILING, any IN_PROGRESS or PENDING -> PENDING". This ordering means if there are both FAILURE and PENDING checks simultaneously (one check failed, another is still running), the status is classified as FAILING. The orchestrator then spawns a Coder to fix the failing check — but the still-pending check might also fail after the fix is pushed, triggering another round of fix attempts. The classification should handle the mixed FAILURE+PENDING case explicitly, since acting on partial results can waste fix attempts.
- Fix: Add a mixed-state classification: "If any FAILURE AND any IN_PROGRESS/PENDING -> `PARTIAL_FAILURE` — wait for pending checks to complete before attempting fixes." Alternatively, document that FAILING takes priority and the fix attempt is intentionally speculative, accepting that pending checks may introduce additional failures.

### MEDIUM

**CI polling re-spawns Git agent without backoff** - `shared/skills/implement:orch/SKILL.md:161`, `shared/skills/resolve:orch/SKILL.md:125`
**Confidence**: 82%
- Problem: The polling spec says "poll every 60 seconds, max 10 iterations. Re-spawn Git agent each poll." While the 60-second interval and 10-iteration cap provide bounded iteration (good), each poll re-spawns a full Git agent. If the GitHub API is experiencing rate limiting or degraded service, this creates 10 agent spawns and 10 API calls with no exponential backoff. The git agent's principles section mentions rate limit awareness for PR comments (1s delay, check X-RateLimit-Remaining), but the check-ci-status operation has no such awareness.
- Fix: Either add rate-limit awareness to the check-ci-status operation (check `X-RateLimit-Remaining` from `gh` responses), or note in the polling spec that if `gh pr checks` fails (e.g., rate limit), the poll should stop early rather than retry all 10 iterations.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Triage skill `gh issue view` error could silently downgrade scope** - `shared/skills/implement:triage/SKILL.md:23` (Confidence: 72%) — The implement:triage skill runs `gh issue view NNN --json ... 2>/dev/null` and treats any error as "no ORCHESTRATED signal detected." If `gh` is not authenticated or the network is down, a genuinely complex issue with >200 chars body would be silently routed to GUIDED. The `2>/dev/null` suppression makes this invisible. This is by design per "if any check errors -> GUIDED," but could lead to surprising under-orchestration.

- **review:triage commit count shell one-liner is fragile** - `shared/skills/review:triage/SKILL.md:27` (Confidence: 65%) — The commit count check `git rev-list --count HEAD ^$(git merge-base HEAD $(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)) 2>/dev/null` nests three subshells. If `git symbolic-ref` fails AND `echo main` fallback also has no merge-base (e.g., shallow clone), the entire expression fails silently, defaulting to GUIDED. This is the intended fallback, but the complexity of the one-liner makes failures hard to diagnose.

- **No edge case for CI Status Gate when PR is force-pushed during polling** - `shared/skills/implement:orch/SKILL.md:161` (Confidence: 60%) — If another process force-pushes to the branch while the CI gate is polling, the check results from the Git agent may reference stale commit SHAs. The fix attempt by the Coder would be based on outdated check context. This is an unlikely edge case but could cause confusing behavior.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The triage layer itself is clean from a reliability standpoint — each triage skill has bounded checks with safe fallbacks (default-to-GUIDED on error), which is a solid defensive pattern. The CI Status Gate introduces the only reliability concerns: the polling loop is bounded (good), but the interaction between PENDING polling and FAILING fix-and-recheck cycles lacks a clear total budget, and the classification logic has an ambiguous mixed-state case. These are HIGH because they affect an I/O-bound polling loop that interacts with external services (GitHub API) — exactly the domain where explicit bounds matter most.
