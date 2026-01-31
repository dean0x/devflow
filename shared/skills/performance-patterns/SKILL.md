---
name: performance-patterns
description: Performance analysis for Reviewer agent. Loaded when focus=performance. Detects N+1 queries, memory leaks, I/O bottlenecks.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Performance Patterns

Domain expertise for performance optimization and bottleneck detection. Use alongside `review-methodology` for complete performance reviews.

## Iron Law

> **MEASURE BEFORE OPTIMIZING**
>
> Premature optimization is the root of all evil. Profile first, then optimize. Every
> performance claim requires benchmarks. "It feels slow" is not a metric. O(n) with small n
> beats O(1) with huge constants. Optimize for the real bottleneck, not the imagined one.

---

## Performance Categories

### 1. Algorithmic Issues

**N+1 Query Problem** - Database query inside a loop.

```typescript
// VIOLATION: 1 + N queries
for (const user of users) {
  user.orders = await db.orders.findByUserId(user.id);
}

// CORRECT: Batch query with Map lookup
const orders = await db.orders.findAll({ where: { userId: userIds } });
const ordersByUser = new Map(groupBy(orders, 'userId'));
users.forEach(u => u.orders = ordersByUser.get(u.id) || []);
```

**O(n^2) Patterns** - Nested loops or linear search in loop.

```typescript
// VIOLATION: includes() is O(n), called n times
items.filter(item => selected.includes(item.id));

// CORRECT: Use Set for O(1) lookup
const selectedSet = new Set(selected);
items.filter(item => selectedSet.has(item.id));
```

### 2. Memory Issues

**Memory Leaks** - Resources not cleaned up.

```typescript
// VIOLATION: Listener never removed
window.addEventListener('resize', this.handleResize);

// CORRECT: Track and cleanup
this.cleanup = () => window.removeEventListener('resize', this.handleResize);
```

**Unbounded Caches** - Collections that grow forever.

```typescript
// VIOLATION: Cache grows indefinitely
const cache = new Map<string, Result>();

// CORRECT: LRU cache with limit
const cache = new LRU<string, Result>({ max: 1000 });
```

### 3. I/O Issues

**Blocking Operations** - Synchronous I/O in request path.

```typescript
// VIOLATION: Blocks event loop
const config = fs.readFileSync('./config.json');

// CORRECT: Async I/O
const config = await fs.promises.readFile('./config.json');
```

**Sequential When Parallel Possible** - Independent operations run serially.

```typescript
// VIOLATION: Sequential execution
const user = await getUser(id);
const orders = await getOrders(id);

// CORRECT: Parallel execution
const [user, orders] = await Promise.all([getUser(id), getOrders(id)]);
```

### 4. Database Issues

Missing indexes, SELECT *, missing pagination. See `references/violations.md`.

### 5. Frontend Issues

Unnecessary re-renders, missing virtualization, missing code splitting. See `references/violations.md`.

---

## Extended References

For comprehensive examples and detection techniques:

| Reference | Content |
|-----------|---------|
| `references/violations.md` | Extended violation examples by category |
| `references/patterns.md` | Correct implementation patterns |
| `references/detection.md` | Grep commands, profiling, CI integration |

---

## Severity Guidelines

| Severity | Criteria | Examples |
|----------|----------|----------|
| **CRITICAL** | Severe degradation, production risk | N+1 with unbounded data, memory leaks, blocking I/O in handlers |
| **HIGH** | Significant impact | Sequential async, SELECT *, unbounded caches, missing pagination |
| **MEDIUM** | Moderate concern | Suboptimal algorithm (small data), missing memoization |
| **LOW** | Minor opportunity | Micro-optimizations, premature optimization candidates |

---

## Performance Metrics Reference

| Operation | Good | Warning | Critical |
|-----------|------|---------|----------|
| API response | < 100ms | 100-500ms | > 500ms |
| Database query | < 10ms | 10-100ms | > 100ms |
| Page load (FCP) | < 1s | 1-2.5s | > 2.5s |
| Memory per request | < 10MB | 10-50MB | > 50MB |
| Bundle size | < 200KB | 200-500KB | > 500KB |

---

## Quick Detection

```bash
# N+1 patterns (await in loop)
grep -rn "for.*await\|\.forEach.*async" --include="*.ts"

# Synchronous I/O
grep -rn "readFileSync\|writeFileSync" --include="*.ts"

# SELECT *
grep -rn "SELECT \*" --include="*.ts" --include="*.sql"
```

See `references/detection.md` for comprehensive detection patterns.
