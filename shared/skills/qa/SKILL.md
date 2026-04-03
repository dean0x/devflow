---
name: qa
description: This skill should be used when performing scenario-based acceptance testing,
  designing QA test plans, or validating that implementation behavior matches acceptance
  criteria beyond unit tests.
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash
---

# QA Patterns

Scenario-based acceptance testing methodology. Ensures implementations satisfy user-observable requirements beyond what unit tests cover.

## Iron Law

> **VERIFY BEHAVIOR FROM THE USER'S PERSPECTIVE** [1][2]
>
> Test what the user asked for, not implementation details. Every acceptance criterion
> gets at least one scenario. Every scenario produces observable evidence. If you can't
> demonstrate it works from the outside, it doesn't work. [3][8]

---

## Scenario Types [1][2][6]

Five categories ensure comprehensive coverage:

| Type | Purpose | Example |
|------|---------|---------|
| **Happy path** | Core functionality works as described | "Add item → item appears in list" |
| **Boundary/edge** | Limits, empty, maximum, minimum values | "Add item with 1000-char name → truncated or rejected" |
| **Negative path** | Invalid inputs, missing permissions, errors | "Add item without auth → 401 returned" |
| **Integration** | Components work together correctly | "Add item → appears in search results" |
| **Regression** | Existing behavior preserved after changes | "Old items still load after schema migration" |

**Minimum coverage**: At least one scenario per acceptance criterion. At least one boundary and one negative scenario per feature. [1][6]

## Scenario Design from Acceptance Criteria [4][8][9]

Extract testable claims using Given/When/Then:

```
Acceptance criterion: "Users can upload files up to 10MB"

S1 (happy):    Given auth user, When upload 5MB file, Then 200 + file accessible
S2 (boundary): Given auth user, When upload 10MB file, Then 200 (exact limit)
S3 (boundary): Given auth user, When upload 10.1MB file, Then 413 rejected
S4 (negative): Given no auth, When upload 5MB file, Then 401
S5 (negative): Given auth user, When upload empty file, Then 400
```

**Extracting criteria** [4]: If no explicit acceptance criteria, derive from the request:
1. What new behavior was requested? → happy path scenarios
2. What inputs does it accept? → boundary scenarios [7][10]
3. What should it reject? → negative scenarios
4. What existing behavior must survive? → regression scenarios

## Equivalence Partitioning & Boundary Analysis [1][6][7]

Reduce infinite inputs to representative cases:

- **Valid partition**: One representative value from each valid class
- **Invalid partition**: One representative from each invalid class
- **Boundary values**: On, just below, just above each boundary [10]

```
Input: age (integer, 0-120 allowed)
├── Valid: 25 (mid-range), 0 (minimum), 120 (maximum)
├── Invalid: -1 (below min), 121 (above max), "abc" (wrong type)
└── Boundary: 0, 1, 119, 120
```

## Exploratory Testing Heuristics [2][3][11]

When acceptance criteria are vague, use structured exploration:

- **CRUD tour** [11]: Create, Read, Update, Delete — does each operation work end-to-end?
- **Configuration tour** [11]: Change every configurable value — does the system adapt?
- **Error tour** [3]: Force every error path — are messages helpful, is state clean?
- **Boundary tour** [3][11]: Push every input to its limits

## Evidence Collection

Every scenario must produce verifiable evidence:

| Evidence Type | How to Capture | When to Use |
|--------------|----------------|-------------|
| Exit codes | `echo $?` after command | CLI tools, scripts |
| Stdout/stderr | Redirect to capture | All command execution |
| File state | `ls -la`, `diff`, `cat` | File creation/modification |
| HTTP status | Response code from curl/fetch | API endpoints |
| Log output | Grep logs after action | Background processes |

## Browser-Based Scenarios [8][12]

When implementation includes web-facing changes (.tsx, .jsx, .html, routes, pages):

| Scenario Type | Browser Action | Evidence |
|--------------|---------------|----------|
| Page renders | Navigate → read page text | Page content, no console errors |
| Form works | Find fields → input → submit | Redirect or DOM state change |
| Validation fires | Input invalid data → check | Error messages visible in page |
| Console clean | Navigate → read console | No errors/warnings logged |
| Navigation works | Click links → verify URL change | Correct page loaded |

**Dev server lifecycle**: Check for running server first. If none, auto-start from package.json scripts, poll for readiness, kill after testing. Never kill pre-existing servers.
**Testability assessment**: Before designing scenarios, assess what local infrastructure is available (DB, Redis, external APIs). Mark scenarios requiring unavailable infrastructure as SKIPPED.
**Graceful degradation**: If browser tools or dev server unavailable, fall back to curl/API testing. Always report what was skipped and why alongside what was tested.

## Severity Classification

| Level | Meaning | Action |
|-------|---------|--------|
| **BLOCKING** | Acceptance criterion violated — feature does not work as requested | Report FAIL — Coder must fix |
| **WARNING** | Edge case concern — feature works but edge behavior is unexpected | Report PASS with warnings — note for improvement |

---

## Extended References

For additional scenario templates and anti-patterns:
- `references/sources.md` — Full bibliography with access details
- `references/patterns.md` — Correct scenario design patterns
- `references/violations.md` — QA anti-patterns to avoid
- `references/scenario-templates.md` — Templates for common feature types

---

## Success Criteria

- [ ] Every acceptance criterion has at least one scenario
- [ ] At least one boundary and one negative scenario per feature
- [ ] Every scenario has Given/When/Then structure
- [ ] Every result has captured evidence (stdout, exit code, file state)
- [ ] Severity correctly assigned: BLOCKING for criteria violations, WARNING for edge cases
- [ ] Non-testable changes (docs, config) correctly identified and skipped
