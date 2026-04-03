---
name: pipeline
description: End-to-end meta-orchestrator chaining implement → review → resolve with user gates between stages
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash, Task, AskUserQuestion
---

# Pipeline Orchestration

Meta-orchestrator chaining implement → review → resolve with user gates between stages. For ambient PIPELINE intent ("implement this end to end", "build and review").

## Iron Law

> **USER GATES BETWEEN STAGES**
>
> Never auto-chain from review to resolve without user confirmation.
> Critical findings require human judgment. Each gate is mandatory.

---

## Cost Communication

Classification statement must warn about scope:
`DevFlow: PIPELINE/ORCHESTRATED. This runs implement → review → resolve (15+ agents across stages).`

## Phase 1: Implement

Follow devflow:implement pipeline (Phases 1-6).

If implementation returns **BLOCKED**: halt entire pipeline, report blocker.

Cleanup: delete `.docs/handoff.md` if it exists (no longer needed before review).

## Phase 2: Gate — Review Decision

Use AskUserQuestion:
> "Implementation complete ({n} files changed, all quality gates passed). Proceed with multi-agent review? (This spawns 7+ reviewer agents)"

- **User says NO** → stop pipeline, report implementation results only
- **User says YES** → continue to Phase 3

## Phase 3: Review

Follow devflow:review pipeline (Phases 1-6).

Report review results (merge recommendation, issue counts).

## Phase 4: Gate — Resolve Decision

If **blocking issues found**:
> Use AskUserQuestion: "Found {n} blocking issues. Auto-resolve? (Spawns resolver agents per batch)"

If **no blocking issues**:
> "Review clean — no resolution needed." → stop pipeline with success summary

- **User says NO** → stop pipeline, report implementation + review results
- **User says YES** → continue to Phase 5

## Phase 5: Resolve

Follow devflow:resolve pipeline (Phases 1-6).

## Phase 6: Summary

End-to-end report:
- **Implementation**: files changed, commits, quality gate results
- **Review**: issue counts by severity, merge recommendation
- **Resolution**: issues fixed vs deferred vs false positives
- **Final state**: branch status, remaining work (if any)

## Error Handling

- **Implementation BLOCKED**: Halt at Phase 1, report blocker
- **User declines gate**: Stop cleanly, report completed stages
- **Review finds no changes**: Skip review, report implementation only
- **All issues resolved**: Report full success
- **Partial resolution**: Report what was fixed and what remains
