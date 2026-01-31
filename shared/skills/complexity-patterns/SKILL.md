---
name: complexity-patterns
description: Complexity analysis for Reviewer agent. Loaded when focus=complexity. Detects high cyclomatic complexity, readability issues.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Complexity Patterns

Domain expertise for code complexity and maintainability analysis. Use alongside `review-methodology` for complete complexity reviews.

## Iron Law

> **IF YOU CAN'T UNDERSTAND IT IN 5 MINUTES, IT'S TOO COMPLEX**
>
> Every function should be explainable to a colleague in under 5 minutes. If you need a
> diagram to understand control flow, refactor. If you need comments to explain what
> (not why), the code is too clever. Simplicity is a feature, complexity is a bug.

---

## Complexity Categories

### 1. Cyclomatic Complexity

High decision path count makes code hard to test and understand.

**Violation**: Deep nesting (5+ levels)
```typescript
if (order) {
  if (order.items) {
    for (const item of order.items) {
      if (item.quantity > 0) {
        if (item.product?.inStock) {
          // Buried logic
```

**Solution**: Early returns and extraction
```typescript
function processOrder(order: Order) {
  if (!order?.items) return;
  for (const item of order.items) processItem(item);
}

function processItem(item: OrderItem) {
  if (item.quantity <= 0 || !item.product?.inStock) return;
  // Logic at top level
}
```

### 2. Readability Issues

Code that requires mental effort to parse.

**Violation**: Magic values
```typescript
if (status === 3) {
  setTimeout(callback, 86400000);
}
```

**Solution**: Named constants
```typescript
const OrderStatus = { COMPLETED: 3 } as const;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

if (status === OrderStatus.COMPLETED) {
  setTimeout(callback, ONE_DAY_MS);
}
```

### 3. Maintainability Issues

Code that's expensive to change.

**Violation**: Long parameter lists
```typescript
function createUser(name, email, password, role, dept, manager, startDate, salary) { }
```

**Solution**: Object parameter
```typescript
interface CreateUserParams {
  name: string; email: string; password: string;
  role: string; department: string; manager?: string;
  startDate: Date; salary: number;
}
function createUser(params: CreateUserParams) { }
```

### 4. Boolean Complexity

Conditions that are hard to reason about.

**Violation**: Complex boolean expression
```typescript
if (user.active && !user.deleted && (user.role === 'admin' || user.role === 'moderator') && user.verified && (!user.suspended || user.suspendedUntil < Date.now())) { }
```

**Solution**: Extract to named predicate
```typescript
const canModerate = (user: User): boolean => {
  if (!user.active || user.deleted || !user.verified) return false;
  if (!['admin', 'moderator'].includes(user.role)) return false;
  if (user.suspended && user.suspendedUntil >= Date.now()) return false;
  return true;
};

if (canModerate(user)) { }
```

---

## Extended References

For extended examples and detection techniques:

| Reference | Content |
|-----------|---------|
| `references/violations.md` | Extended violation examples for all categories |
| `references/patterns.md` | Detailed refactoring solutions |
| `references/detection.md` | Bash commands and static analysis setup |

---

## Severity Guidelines

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Functions > 200 lines, complexity > 20, nesting > 6, duplication in 5+ places |
| **HIGH** | Functions 50-200 lines, complexity 10-20, nesting 4-6, 5+ boolean conditions, 5+ parameters |
| **MEDIUM** | Functions 30-50 lines, complexity 5-10, magic values, minor duplication |
| **LOW** | Could be more readable, naming improvements, comments would help |

## Metrics Quick Reference

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Function length | < 30 | 30-50 | > 50 |
| Cyclomatic complexity | < 5 | 5-10 | > 10 |
| Nesting depth | < 3 | 3-4 | > 4 |
| Parameters | < 3 | 3-5 | > 5 |
| File length | < 300 | 300-500 | > 500 |
