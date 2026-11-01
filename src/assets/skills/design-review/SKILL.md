---
name: design-review
description: Use when reviewing implementation plans for anti-patterns.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Design Review

Anti-pattern detection for implementation plans.

## Iron Law

> **CATCH IT IN THE PLAN, NOT IN THE PR**
>
> A plan that implies N+1 queries will produce N+1 queries. A plan that omits error
> handling will produce code with no error handling. Review the plan as rigorously as
> the code: every implementation decision follows it.

## Anti-Pattern Detection Rules

### 1. N+1 Queries

**What to look for in a plan:**
- Steps that fetch a list, then loop to fetch related data per item
- "For each X, get Y" language without mentioning batch operations
- JOIN or batch-fetch never mentioned for related data
- "Display X with Y" without specifying how Y is fetched

**How to flag:**
```
[N+1 RISK] Step {N}: "{quoted plan text}" — fetches {entity} per iteration.
Resolution: Replace loop with batch query: {proposed batch operation}.
```

### 2. God Functions

**What to look for in a plan:**
- Single step handling more than 3 distinct responsibilities
- "Validate AND process AND notify AND log AND update" in one step
- Steps described as "the main handler" that touch multiple subsystems
- No clear single-sentence description of what the function does

**How to flag:**
```
[GOD FUNCTION RISK] Step {N}: "{quoted plan text}" — handles {n} responsibilities.
Resolution: Split into: {responsibility 1} → {responsibility 2} → {responsibility 3}.
```

### 3. Missing Parallelism

**What to look for in a plan:**
- Sequential steps with no data dependency between them
- "First do A, then do B, then do C" where B doesn't need A's output
- Multiple external API calls or DB queries listed sequentially
- Fan-out operations (notify all users, update all records) without parallel mention

**How to flag:**
```
[SEQUENTIAL BOTTLENECK] Steps {N}-{M}: "{quoted steps}" — no dependency between them.
Resolution: Execute {step A} and {step B} in parallel: {proposed parallel pattern}.
```

### 4. Error Handling Gaps

**What to look for in a plan:**
- Happy path fully described, failure paths absent or vague
- "If error, return error" without specifying what the caller does with it
- Partial operations (multi-step) without rollback plan
- External calls (API, DB, queue) without failure mode specification
- Retry logic absent for transient failures (network timeouts, rate limits)

**How to flag:**
```
[ERROR HANDLING GAP] Step {N}: "{quoted plan text}" — failure path unspecified.
Resolution: Add: {on failure scenario} → {specific recovery action}.
```

### 5. Missing Caching

**What to look for in a plan:**
- Expensive operations called on every request without cache mention
- "Fetch configuration on each request", "call third-party API per user action"
- Reference data (categories, settings, permissions) loaded repeatedly
- Computed aggregates recalculated on every read

**How to flag:**
```
[CACHING GAP] Step {N}: "{quoted plan text}" — {expensive operation} on every request.
Resolution: Cache {data} for {TTL}: {proposed cache strategy and invalidation}.
```

### 6. Poor Decomposition

**What to look for in a plan:**
- Steps combining unrelated concerns (auth + business logic + presentation)
- Unclear ownership — which module/layer owns each step?
- Cross-cutting steps that appear multiple times without abstraction
- "Also update X" or "also send to Y" appended to otherwise focused steps

**How to flag:**
```
[DECOMPOSITION ISSUE] Step {N}: "{quoted plan text}" — combines {concern A} and {concern B}.
Resolution: {concern A} belongs in {layer/module}; {concern B} belongs in {layer/module}.
```

## Extended References

| Reference | Content |
|-----------|---------|
| `references/anti-patterns.md` | Before/after plan examples for each anti-pattern |

## Severity Guidelines

| Level | An anti-pattern that |
|-------|----------|
| **CRITICAL** | will cause correctness failures (data loss, security breach) |
| **HIGH** | will cause significant performance or maintainability problems |
| **MEDIUM** | will require architectural rework post-implementation |
| **LOW** | reduces code quality but is easily refactored |
