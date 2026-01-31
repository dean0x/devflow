---
name: documentation-patterns
description: Documentation analysis for Reviewer agent. Loaded when focus=documentation. Detects doc drift, missing docs, stale comments.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Documentation Patterns

Domain expertise for documentation quality and alignment. Use alongside `review-methodology` for complete documentation reviews.

## Iron Law

> **DOCUMENTATION MUST MATCH REALITY**
>
> Outdated documentation is worse than no documentation. It actively misleads. Every code
> change that affects behavior requires a documentation check. Comments that explain "what"
> instead of "why" are noise. The best documentation is code that doesn't need documentation.

---

## Documentation Categories

### 1. Code Documentation Issues

| Issue | Problem | Fix |
|-------|---------|-----|
| Missing docstrings | Complex functions without explanation | Add JSDoc with params, returns, throws |
| Outdated comments | Comments that contradict code | Update or remove |
| "What" comments | `// Loop through users` | Explain "why" instead |
| Magic algorithms | Complex logic without explanation | Document algorithm and rationale |

**Brief Example - Missing vs. Complete:**
```typescript
// BAD: No documentation on complex function
export function calculateProratedAmount(plan: Plan, startDate: Date, endDate: Date): number;

// GOOD: Purpose, params, returns, edge cases documented
/**
 * Calculates prorated billing amount when switching plans mid-cycle.
 * @param plan - The new plan to prorate to
 * @returns Prorated amount in cents (can be negative for downgrades)
 */
export function calculateProratedAmount(plan: Plan, startDate: Date, endDate: Date): number;
```

### 2. API Documentation Issues

| Issue | Problem | Fix |
|-------|---------|-----|
| Missing params | Callers don't know valid values | Document all params with types and constraints |
| Missing returns | Return shape unknown | Describe return structure and units |
| Missing errors | Callers don't know what to catch | List all thrown error types |

**Brief Example - Incomplete vs. Complete:**
```typescript
// BAD: No params, no errors documented
/** Creates a subscription. */
async function createSubscription(userId: string, planId: string): Promise<Subscription>;

// GOOD: Full contract documented
/**
 * @param userId - User's unique identifier
 * @param planId - Plan ID from /plans endpoint
 * @throws {UserNotFoundError} If userId doesn't exist
 * @throws {PlanNotFoundError} If planId doesn't exist
 */
async function createSubscription(userId: string, planId: string): Promise<Subscription>;
```

### 3. Alignment Issues

| Issue | Problem | Fix |
|-------|---------|-----|
| Code-comment drift | Comment says 3 retries, code does 5 | Update comment or use constant |
| Stale README | Examples use removed functions | Keep README in sync with code |
| Missing changelog | Breaking changes undocumented | Document all notable changes |

**Brief Example - Drift vs. Aligned:**
```typescript
// BAD: Comment doesn't match code
// Retries up to 3 times
for (let i = 0; i < 5; i++) { /* ... */ }

// GOOD: Use constant to keep aligned
const MAX_RETRIES = 5;
for (let i = 0; i < MAX_RETRIES; i++) { /* ... */ }
```

---

## Extended References

For extended examples and detection commands:

- **[references/violations.md](references/violations.md)** - Extended violation examples with explanations
- **[references/patterns.md](references/patterns.md)** - Complete correct pattern examples
- **[references/detection.md](references/detection.md)** - Bash commands for finding issues

---

## Severity Guidelines

| Severity | Description | Examples |
|----------|-------------|----------|
| **CRITICAL** | Actively misleading | Comments contradict code; API docs with wrong types; README with broken steps; Changelog missing breaking changes |
| **HIGH** | Significant gaps | Public APIs undocumented; Complex algorithms unexplained; Errors not documented; Migration guides missing |
| **MEDIUM** | Moderate issues | Some params undocumented; Examples could be clearer; "What" comments instead of "why" |
| **LOW** | Minor improvements | Could add more examples; Formatting inconsistencies; Typos |

---

## Documentation Checklist

Before approving changes:

- [ ] All public APIs have JSDoc/docstrings
- [ ] Parameters and return values documented
- [ ] Error conditions documented
- [ ] Complex algorithms explained
- [ ] Comments explain "why", not "what"
- [ ] README reflects current state
- [ ] CHANGELOG updated for notable changes
- [ ] No TODO comments for completed work
- [ ] Examples work with current API
