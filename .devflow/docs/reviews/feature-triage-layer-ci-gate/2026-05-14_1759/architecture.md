# Architecture Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**CI Status Gate duplicated across 4 files without structural enforcement** - `shared/skills/implement:orch/SKILL.md:155`, `shared/skills/resolve:orch/SKILL.md:115`, `plugins/devflow-resolve/commands/resolve.md:203`, `plugins/devflow-resolve/commands/resolve-teams.md:250`
**Confidence**: 85%
- Problem: The CI Status Gate logic (poll cadence, budget limits, fix attempt count, classification flow) is replicated verbatim across 4 files. The `<!-- SYNC: ci-status-gate -->` comment markers are a convention-based sync mechanism with no tooling enforcement. If one copy is updated and another is missed, the orchestration pipelines will diverge silently. This is a classic DRY violation -- the same algorithm expressed in 4 places creates content coupling between files that have different ownership contexts (skills vs commands).
- Fix: The SYNC markers are a good documentation convention acknowledging this risk, but the project currently has no build-time or CI check that verifies the content between SYNC markers is identical across all files. Consider adding a `build:plugins` post-step or a standalone script that extracts content between `<!-- SYNC: {id} -->` markers across all `.md` files and asserts byte-identical content. This would convert the convention into an enforced invariant. Example approach:
  ```bash
  # scripts/verify-sync-markers.sh
  # Extract content between SYNC markers, hash, assert all hashes equal per marker-id
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CI Status Gate variations are not truly identical across the 4 copies** - `shared/skills/implement:orch/SKILL.md:155` vs `shared/skills/resolve:orch/SKILL.md:115`
**Confidence**: 88%
- Problem: While the SYNC markers suggest identical content, there are intentional contextual differences between the copies:
  - `implement:orch` has `**Requires:** PR_URL, CODER_COMMITS` and spawns Git agent with `PR_NUMBER from PR_URL`
  - `resolve:orch` has `**Requires:** RESOLUTION_RESULTS` and spawns Git agent with just `OPERATION: check-ci-status` (no explicit PR_NUMBER)
  - `resolve.md` and `resolve-teams.md` add `WORKTREE_PATH` and use "for each worktree with fixes" framing
  - The skip condition also differs: implement:orch has no skip (it always runs after Coder creates a PR), while resolve:orch/resolve.md check "if no issues were fixed"
  
  These are legitimate context-specific differences, but the SYNC markers imply the content should be identical, which is misleading. The markers create a false expectation of byte-identical content.
- Fix: Either (a) narrow the SYNC markers to wrap only the truly shared logic (steps 1-6: the polling/classification/budget algorithm), excluding the context-specific **Requires** and skip conditions, or (b) rename the markers to something like `<!-- PATTERN: ci-status-gate -->` to communicate "same pattern, adapted to context" rather than "identical content."

**Ambiguous old classification in git agent check-ci-status** - `shared/agents/git.md:292`
**Confidence**: 80%
- Problem: The old wording "Classify: all conclusions are `SUCCESS` -> `PASSING`, any `FAILURE` -> `FAILING`, any state `IN_PROGRESS` or `PENDING` -> `PENDING`" was ambiguous about evaluation order -- what happens when both FAILURE and PENDING checks coexist? The new priority-based wording resolves this correctly (PENDING takes priority, which matches CI conventions -- a pending check might still pass). This is a good fix. However, the CI Status Gate sections in the 4 consumer files (implement:orch, resolve:orch, resolve.md, resolve-teams.md) still describe the flow as separate branches (PASSING/NO_PR/NO_CI/PENDING/FAILING) without explicitly stating the priority order. If the Git agent evaluates priority but the orchestrator expects a different priority, the behavior could be surprising.
- Fix: The Git agent now documents the classification priority clearly. The consumer files don't need to duplicate the priority logic since they branch on the single returned status value. No action required, but consider adding a one-line note to the consumer files: "Status priority (PENDING > FAILING > PASSING) is evaluated by the Git agent."

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Phase numbering is fragile and error-prone across the documentation ecosystem** - multiple files
**Confidence**: 82%
- Problem: The entire PR commit `7af0dfa` is dedicated to correcting phase number references that went stale after inserting Phase 7 (CI Status Gate). This demonstrates a structural fragility: phase numbers are hard-coded as integers across skills, commands, and cross-references. Inserting, removing, or reordering a phase requires a manual search-and-replace across the entire documentation ecosystem. This is a form of content coupling -- the phase numbering scheme creates implicit dependencies between files. The commit message itself ("correct all stale phase references") confirms this is a recurring maintenance burden.
- Fix: This is a documentation architecture issue. Consider phase naming over numbering for cross-references (e.g., "proceed to the Completion phase" instead of "proceed to Phase 8"). Phase numbers would remain in headings for sequential reading but cross-references would use names, making them insertion-stable. This is a larger refactor and not blocking.

## Suggestions (Lower Confidence)

- **SYNC marker scope could be formalized** - multiple files (Confidence: 70%) -- The `<!-- SYNC: ci-status-gate -->` convention is novel to this PR. If more SYNC-marked sections are added in the future, a brief entry in CLAUDE.md documenting the convention (what SYNC means, how to verify, what's allowed to differ) would prevent misinterpretation by future contributors or agents.

- **`PIPELINE/ORCHESTRATED` to `PIPELINE` label change in pipeline:orch** - `shared/skills/pipeline:orch/SKILL.md:27` (Confidence: 65%) -- The cost label changed from `PIPELINE/ORCHESTRATED` to `PIPELINE`. This applies ADR-001 (clean break philosophy -- removing the old `/DEPTH` format). However, PIPELINE is inherently orchestrated (there is no PIPELINE/GUIDED). The simplification is correct, but the rationale could be explicit in the commit message for traceability.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architecture is sound. The CI Status Gate is a well-bounded cross-cutting concern correctly inserted at Phase 7 across implement:orch and resolve:orch pipelines. The total budget constraint (max 10 polls + max 2 fix attempts) provides explicit bounds -- avoids PF-001 (no unbounded retry loops). The check-ci-status classification priority fix in the Git agent resolves a genuine ambiguity. The INTENT/DEPTH format cleanup and CHAT removal are clean breaks (applies ADR-001). The primary architectural concern is the 4-way content duplication of the CI Status Gate, mitigated by SYNC markers but not enforced by tooling. Consider adding a verification script to make this a hard invariant.
