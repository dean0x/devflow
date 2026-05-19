# Performance Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**CI Status Gate polling introduces unbounded wall-clock delay (up to 10 minutes)** - `shared/skills/resolve:orch/SKILL.md:125`, `shared/skills/implement:orch/SKILL.md:161`, `plugins/devflow-resolve/commands/resolve.md:261`, `plugins/devflow-resolve/commands/resolve-teams.md:261`
**Confidence**: 85%
- Problem: The CI Status Gate phase polls every 60 seconds with max 10 iterations (10 minutes worst-case). This is applied identically across all four skill/command files (implement:orch, resolve:orch, resolve.md, resolve-teams.md). When CI is slow or stuck in PENDING, the model session sits idle burning context tokens on each re-spawn of the Git agent. Each poll re-spawns a full Git agent sub-agent, which is significantly more expensive than a lightweight shell check.
- Fix: Consider reducing max iterations for the ambient orch variants (implement:orch, resolve:orch) to 3-5 iterations (3-5 minutes) since these are lighter-weight pipelines. For the full `/resolve` command, 10 iterations may be acceptable. Additionally, the poll could use a direct `gh pr checks` bash call for intermediate polls rather than spawning a full Git agent each time, reserving the agent spawn for the initial check and final confirmation only:
  ```
  # Lightweight poll (no agent spawn):
  gh pr checks {number} --json state,conclusion 2>/dev/null | ...
  # Only spawn Git agent for initial status and when action is needed (FAILING)
  ```

### MEDIUM

**Triage layer adds an extra Skill tool invocation on every non-QUICK prompt** - `shared/skills/router/SKILL.md:28-36`, `shared/skills/implement:triage/SKILL.md:1-35` (and all 7 triage skills)
**Confidence**: 82%
- Problem: Before this change, the router dispatched directly to a guided or orch skill (1 Skill load after classification). Now every non-QUICK, non-RESOLVE, non-PIPELINE prompt loads: (1) router, then (2) triage skill, then (3) guided or orch skill -- three sequential Skill loads instead of two. Each Skill tool invocation consumes a model turn and adds latency. The triage skills are small (~35 lines) so the token overhead per-load is minimal, but the sequential turn overhead is meaningful for perceived responsiveness.
- Fix: This is an intentional architectural trade-off (scope assessment before committing to a workflow depth) and the PR description acknowledges it ("gates costly agent orchestration"). The latency cost is justified when it prevents unnecessary orchestration. However, document this latency trade-off in the router's SKILL.md or classification-rules.md so future maintainers understand the cost. For the "Orchestration Hint Override" fast-path (user says "orchestrate" / "thorough"), the triage skill could skip its scope assessment checks and route immediately to orch, which it already does -- good.

**implement:triage invokes `gh issue view` on every issue-referencing prompt** - `shared/skills/implement:triage/SKILL.md:23`
**Confidence**: 80%
- Problem: The implement:triage skill calls `gh issue view NNN --json body,labels --jq '{body: .body[0:500], labels: [.labels[].name]}' 2>/dev/null` during scope assessment. GitHub API calls add 200-500ms network latency. This runs on every IMPLEMENT-classified prompt that mentions `#NNN`, even for simple "implement #42" requests where the triage decision may not change the outcome.
- Fix: The `2>/dev/null` fallback on failure is good (graceful degradation). The latency is acceptable given this only fires for issue-referencing prompts and the data is used to make a meaningful routing decision. No change needed, but consider caching the result if the same issue is referenced multiple times in a session.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**review:triage runs a 3-command shell pipeline for commit counting** - `shared/skills/review:triage/SKILL.md:27`
**Confidence**: 82%
- Problem: The review:triage scope assessment runs `git rev-list --count HEAD ^$(git merge-base HEAD $(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)) 2>/dev/null` -- a nested command substitution with 3 git operations and a sed pipe. This is executed as a Bash tool call during triage, adding shell spawn overhead to every REVIEW-classified prompt.
- Fix: This is a single-shot shell command with short output (one number), so the actual execution time is fast (typically <100ms). The `2>/dev/null` fallback handles errors gracefully. No fix needed -- the overhead is negligible compared to the Skill tool invocation cost. However, if git operations fail (e.g., detached HEAD, no remote), the fallback to GUIDED is correct and avoids wasting time.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Sequential skill loading chain could benefit from batching** - `shared/skills/router/SKILL.md:28-36` (Confidence: 65%) -- In theory, the router could pass the scope assessment criteria directly to the guided/orch skill to eliminate the triage layer's separate Skill tool invocation. This would reduce the chain from 3 loads to 2. However, this would couple scope assessment logic into the router, which the PR explicitly decouples. Architectural clarity likely outweighs the latency cost.

- **CI fix loop spawns heavyweight Coder agent for CI failures** - `shared/skills/implement:orch/SKILL.md:162` (Confidence: 70%) -- When CI fails, a full Coder agent is spawned to fix failures. Coder is a heavyweight agent with TDD enforcement, quality gates, etc. For simple CI fixes (lint errors, type errors), a lighter-weight agent or direct Bash fixes might be faster. However, using Coder ensures fixes go through proper quality gates, which is the safer default.

- **CI gate added to resolve:orch but not gated by fix count** - `shared/skills/resolve:orch/SKILL.md:118` (Confidence: 62%) -- The text says "If no issues were fixed... skip" which is correct. But the polling loop (60s x 10) could still fire for a single trivial fix. Consider scaling max iterations based on fix complexity (1 fix = max 3 polls, 5+ fixes = max 10 polls).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The triage layer introduces a measured latency trade-off: one additional Skill tool invocation per non-QUICK prompt in exchange for preventing unnecessary orchestration (which is far more expensive). This is a net performance win for the common case (simple prompts that would have been over-orchestrated). The CI Status Gate polling pattern is sound but the 10-iteration ceiling with full agent re-spawns per poll is heavier than necessary -- consider lightweight bash polling for intermediate checks. Overall, the architectural change favors performance by defaulting to GUIDED (cheaper) and requiring explicit signals for ORCHESTRATED (expensive).
