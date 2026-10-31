---
name: quality-gates
description: Use when evaluating implementation quality before submission.
user-invocable: false
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Self-Review Framework

Self-review for the Harden agent: evaluate the implementation against 9 pillars, and fix the issues you find.

## Iron Law

> **Fix before returning**
>
> Self-review is a quality gate, not a report. If you find a P0 or P1 issue, fix it.
> Return only when every critical issue is resolved, or a P0 issue is BLOCKED.

## The 9 Pillars

| Priority | Action | Pillars |
|----------|--------|---------|
| **P0** | MUST fix | Design, Functionality, Security |
| **P1** | SHOULD fix | Complexity, Error Handling, Tests |
| **P2** | FIX if straightforward | Documentation (Naming and Consistency belong to the Polish agent: report them as SKIP) |

### P0 - Design
Does the implementation fit the architecture? Follows existing patterns, respects layer boundaries, dependencies injected.

If `FEATURE_KNOWLEDGE` is provided (Rules bullets and the KB path, no heading index), verify implementation respects each bullet's anti-pattern, gotcha or invariant; Read a KB section from its path for the architecture. Flag deviations as P0-Design issues when the documented pattern is clearly intentional.

### P0 - Functionality
Does the code work? Happy path, edge cases (null, empty, boundary), no race conditions.

### P0 - Security
Any vulnerabilities? No injection, input validated, no hardcoded secrets, no secrets or tokens in logs or debug output, auth checked.

### P1 - Complexity
Understandable in 5 minutes? Functions < 50 lines, nesting < 4 levels, no magic numbers.

### P1 - Error Handling
Errors handled explicitly? No swallowed exceptions, helpful messages, resources cleaned up.

### P1 - Tests
New code tested? Covers happy path, errors, edges. Tests behavior, not implementation.

### P2 - Documentation
Will others understand? Complex logic commented, public APIs documented, no outdated comments.

## Process

Evaluate P0, then P1, then P2, and fix each issue when you find it. If a P0 issue cannot be fixed, stop and report the blocker.

Report each pillar as PASS, FIXED or BLOCKED, Naming and Consistency as SKIP, and the overall Status: PASS / FIXED / BLOCKED.

## Extended References

Read one only when a pillar judgment needs more detail:
- `references/patterns.md`: 9-pillar evaluation patterns and issue classification
- `references/violations.md`: pillar-organized anti-patterns and P0/P1 red flags
- `references/stub-detection.md`: stub and wiring-gap patterns
- `references/report-template.md`: complete report templates and examples
