---
name: qa
description: This skill should be used when designing or running scenario-based acceptance tests.
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash
---

# QA Patterns

Scenario-based acceptance testing: checks that an implementation satisfies user-observable requirements beyond what unit tests cover.

## Iron Law

> **VERIFY BEHAVIOR FROM THE USER'S PERSPECTIVE** [1][2]
>
> Test what the user asked for, not implementation details. Every acceptance criterion
> gets at least one scenario. Every scenario produces observable evidence. If you can't
> demonstrate it works from the outside, it doesn't work. [3][8]

## Scenario Types

| Type | Purpose | Example |
|------|---------|---------|
| **Happy path** | Core functionality works as described | "Add item → item appears in list" |
| **Boundary/edge** | Limits, empty, maximum, minimum values | "Add item with 1000-char name → truncated or rejected" |
| **Negative path** | Invalid inputs, missing permissions, errors | "Add item without auth → 401 returned" |
| **Integration** | Components work together correctly | "Add item → appears in search results" |
| **Regression** | Existing behavior preserved after changes | "Old items still load after schema migration" |

**Minimum coverage**: At least one scenario per acceptance criterion. At least one boundary and one negative scenario per feature.

## Scenario Design from Acceptance Criteria

Extract testable claims using Given/When/Then:

```
Acceptance criterion: "Users can upload files up to 10MB"

S1 (happy):    Given auth user, When upload 5MB file, Then 200 + file accessible
S2 (boundary): Given auth user, When upload 10MB file, Then 200 (exact limit)
S3 (boundary): Given auth user, When upload 10.1MB file, Then 413 rejected
S4 (negative): Given no auth, When upload 5MB file, Then 401
S5 (negative): Given auth user, When upload empty file, Then 400
```

**Extracting criteria**: If no explicit acceptance criteria, derive from the request:
1. What new behavior was requested? → happy path scenarios
2. What inputs does it accept? → boundary scenarios
3. What should it reject? → negative scenarios
4. What existing behavior must survive? → regression scenarios

**Partitions and boundaries**: Take one representative value from each valid and each invalid input class, plus the values on, just below and just above each boundary.

## Exploratory Testing Heuristics

When acceptance criteria are vague, use structured exploration:

- **CRUD tour**: Create, Read, Update, Delete — does each operation work end-to-end?
- **Configuration tour**: Change every configurable value — does the system adapt?
- **Error tour**: Force every error path — are messages helpful, is state clean?
- **Boundary tour**: Push every input to its limits

## Evidence

Every scenario produces verifiable evidence: the exit code and output of each command, plus the file state (`ls -la`, `diff`) for file changes, the HTTP status for an API endpoint, or the log lines for a background process.

## Browser-Based Scenarios

When implementation includes web-facing changes (.tsx, .jsx, .html, routes, pages):

| Scenario Type | Browser Action | Evidence |
|--------------|---------------|----------|
| Page renders | Navigate → read page text | Page content, no console errors |
| Form works | Find fields → input → submit | Redirect or DOM state change |
| Validation fires | Input invalid data → check | Error messages visible in page |
| Console clean | Navigate → read console | No errors/warnings logged |
| Navigation works | Click links → verify URL change | Correct page loaded |

**Graceful degradation**: If browser tools or dev server unavailable, fall back to curl/API testing. Always report what was skipped and why alongside what was tested.

## Extended References

For additional scenario templates and anti-patterns:
- `references/sources.md` — Full bibliography with access details
- `references/patterns.md` — Correct scenario design patterns
- `references/violations.md` — QA anti-patterns to avoid
- `references/scenario-templates.md` — Templates for common feature types

## Success Criteria

- [ ] Every acceptance criterion has at least one scenario
- [ ] At least one boundary and one negative scenario per feature
- [ ] Every scenario has Given/When/Then structure
- [ ] Every result has captured evidence (stdout, exit code, file state)
- [ ] Severity correctly assigned: BLOCKING for criteria violations, WARNING for edge cases
- [ ] Non-testable changes (docs, config) correctly identified and skipped
