---
name: pipeline:orch
description: End-to-end meta-orchestrator chaining implement → review → resolve with status reporting between stages
user-invocable: false
---

# Pipeline Orchestration

Meta-orchestrator chaining implement → review → resolve with status reporting between stages. For ambient PIPELINE intent ("implement this end to end", "build and review").

## Iron Law

> **FULL PIPELINE, NO INTERRUPTIONS**
>
> Pipeline runs end-to-end without pausing. Report status between stages
> but never stop to ask. Each stage auto-proceeds to the next.

---

## Cost Communication

Classification statement must warn about scope:
`Devflow: PIPELINE/ORCHESTRATED. This runs implement → review → resolve (15+ agents across stages).`

## Phase 1: Implement

Load `devflow:implement:orch` via the Skill tool, then execute its full pipeline (Phases 1-6: pre-flight → plan synthesis → Coder → FILES_CHANGED detection → quality gates → completion). The quality gates are non-negotiable: Validator → Simplifier → Scrutinizer → re-Validate → Evaluator → Tester.

If implementation returns **BLOCKED**: halt entire pipeline, report blocker.

Cleanup: delete `.docs/handoff.md` if it exists (no longer needed before review).

## Phase 2: Status — Review Decision

Log implementation results:
> "Implementation complete ({n} files changed, all quality gates passed). Proceeding to multi-agent review."

Auto-proceed to Phase 3.

## Phase 3: Review

Load `devflow:review:orch` via the Skill tool, then execute its full pipeline (Phases 1-6: pre-flight → incremental detection → file analysis → parallel reviewers (7 core + conditional) → synthesis → finalize). All 7 core reviewers (security, architecture, performance, complexity, consistency, testing, regression) are mandatory.

Report review results (merge recommendation, issue counts).

## Phase 4: Status — Resolve Decision

If **blocking issues found**:
> Log: "Found {n} blocking issues. Auto-resolving."

Auto-proceed to Phase 5.

If **no blocking issues**:
> "Review clean — no resolution needed." → skip to Phase 6 with success summary.

## Phase 5: Resolve

Load `devflow:resolve:orch` via the Skill tool, then execute its full pipeline (Phases 1-6: target review directory → parse issues → analyze & batch → parallel resolvers → collect & simplify → report).

## Phase 6: Summary

End-to-end report:
- **Implementation**: files changed, commits, quality gate results
- **Review**: issue counts by severity, merge recommendation
- **Resolution**: issues fixed vs deferred vs false positives
- **Final state**: branch status, remaining work (if any)

## Error Handling

- **Implementation BLOCKED**: Halt at Phase 1, report blocker
- **Review finds no changes**: Skip review, report implementation only
- **All issues resolved**: Report full success
- **Partial resolution**: Report what was fixed and what remains
