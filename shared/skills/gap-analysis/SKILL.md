---
name: gap-analysis
description: This skill should be used when analyzing design documents, specifications, or plans for completeness gaps, architectural issues, security concerns, and performance implications. Provides focus-specific detection patterns for the designer agent.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Gap Analysis

Domain expertise for detecting gaps in design documents, specifications, and plans before implementation begins.

## Iron Law

> **GAPS IN DESIGN BECOME BUGS IN PRODUCTION**
>
> Every undefined error state, vague requirement, and missing integration point is a bug
> waiting to be written. Catch gaps in the plan so the implementation reflects reality,
> not assumption. Evidence-required: every gap must cite specific text from the artifact.

---

## Focus Areas

### 1. Completeness

Detect missing pieces that will block or break implementation.

**Detection patterns:**
- Missing acceptance criteria — requirements without testable success conditions
- Undefined error states — happy path described, failure paths absent
- Vague requirements — "fast", "secure", "user-friendly" without measurable thresholds
- Ambiguous user journeys — "user submits form" without specifying what happens next
- Missing rollback specification — no recovery path if operation partially fails
- Unspecified data constraints — fields mentioned without type, size, or validation rules

**Evidence trigger:** Any requirement phrase that cannot be directly translated into a test case.

### 2. Architecture

Detect design decisions that conflict with existing patterns or create structural problems.

**Detection patterns:**
- Implied patterns violating existing conventions — new module structure that contradicts codebase layout
- Missing integration points — feature touches shared state but integration method unspecified
- Layering issues — business logic pushed to wrong layer (e.g., validation in presentation layer)
- Undeclared dependencies — feature needs data/service not mentioned in scope
- Missing schema changes — new data structure implied but migration not mentioned
- Shared resource contention — multiple features/requests accessing same resource without concurrency plan

**Evidence trigger:** Any design element that references an existing system component without specifying the integration contract.

### 3. Security

Detect authentication, authorization, and data protection gaps.

**Detection patterns:**
- Auth gaps — feature creates new endpoints or data access without specifying auth requirements
- Input validation missing — user-provided data consumed without specifying sanitization
- Secret handling — credentials, tokens, or keys mentioned without specifying storage/transmission
- OWASP implications — mass assignment, IDOR, SSRF risks implied by the design
- Privilege escalation paths — role or permission changes without specifying boundary checks
- Audit trail missing — sensitive operations without logging or change tracking

**Evidence trigger:** Any data flow that crosses a trust boundary without specifying the security control.

### 4. Performance

Detect design decisions that will cause performance problems at scale.

**Detection patterns:**
- N+1 patterns implied — loop-based data fetching without batch operation specified
- Missing caching strategy — repeated expensive operations (DB queries, API calls) without cache layer
- Concurrency concerns — shared mutable state accessed without locking or isolation strategy
- Query patterns — filtering/sorting on unindexed fields implied by the feature
- Unbounded result sets — list operations without pagination or size limits
- Synchronous blocking — long-running operations blocking request threads without async design

**Evidence trigger:** Any data access pattern that scales linearly with user count or data volume without a mitigation strategy.

### 5. Consistency (multi-issue only)

Detect contradictions and duplications across multiple issue specifications.

**Detection patterns:**
- Cross-issue contradictions — Issue A says feature X works one way, Issue B implies another
- Duplicate requirements — same functionality specified in multiple issues without coordination
- Conflicting scope — one issue's in-scope is another issue's out-of-scope
- Naming conflicts — same entity called different names across issues
- Interface mismatches — Issue A produces output that Issue B consumes, but shapes differ

**Evidence trigger:** Any requirement in one issue that cannot coexist with a requirement in another issue.

### 6. Dependencies (multi-issue only)

Detect ordering constraints and shared resource conflicts across issues.

**Detection patterns:**
- Inter-issue ordering — Issue B depends on data/schema/interface created by Issue A
- Shared resources — multiple issues modify the same file, table, or API without coordination
- Breaking change propagation — one issue changes a contract that other issues assume stable
- Circular dependencies — two issues each require the other to be implemented first
- Implicit sequencing — implementation order not specified but technically required

**Evidence trigger:** Any issue that references state, contracts, or resources that may be in flux due to another issue in the batch.

---

## Extended References

| Reference | Content |
|-----------|---------|
| `references/check-layers.md` | Detailed detection checklists per focus area |

## Severity Guidelines

| Level | Criteria | Examples |
|-------|----------|----------|
| **CRITICAL** | Gap that will cause data loss, security breach, or system failure | Missing auth on sensitive endpoint, undefined error recovery for financial transaction |
| **HIGH** | Gap that will cause incorrect behavior or significant technical debt | Missing pagination on unbounded list, undefined race condition in concurrent update |
| **MEDIUM** | Gap that will require rework if unaddressed | Vague acceptance criteria, missing caching strategy for frequently-read data |
| **LOW** | Gap that is an improvement opportunity | Naming inconsistency, minor UX ambiguity with obvious resolution |

## Confidence Calibration

- **Report at 80%+**: Gap is clearly present, evidence directly cited
- **Suggest at 60-79%**: Plausible gap, depends on context not visible in artifact
- **Drop below 60%**: Speculation without textual evidence

Output format per gap:
```
**[FOCUS] Gap: {title}** — Severity: {CRITICAL/HIGH/MEDIUM/LOW} | Confidence: {n}%
Evidence: "{quoted text from artifact}"
Issue: {what is missing or contradictory}
Resolution: {concrete action to address the gap}
```
