---
name: performance
description: This skill should be used when reviewing code for N+1 queries, memory leaks, or I/O bottlenecks.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Performance Patterns

Domain expertise for performance optimization and bottleneck detection. Use alongside `devflow:review-methodology` for complete performance reviews.

## Iron Law

> **MEASURE BEFORE OPTIMIZING**
>
> Profile first, optimize second. Every performance claim requires benchmarks. Brendan
> Gregg's USE Method [1] (Utilization, Saturation, Errors) and Tom Wilkie's RED Method [2]
> (Rate, Errors, Duration) are the systematic starting points — not guesswork.
> Gil Tene's coordinated omission warning [8]: averages lie — monitor P99, not mean latency.

---

## Measurement Foundation [1][2][7][8][9]

| Method | For | Measures |
|--------|-----|---------|
| USE Method [1] | System resources | Utilization, Saturation, Errors per resource |
| RED Method [2] | Services | Rate, Errors, Duration per endpoint |
| Flame Graphs [9] | CPU hot paths | Widest frames = hottest code — optimize those |
| HDR Histogram [8] | Latency | Full distribution without coordinated omission |

**Latency hierarchy** [7]: L1 cache ~1ns · L2 ~4ns · L3 ~40ns · RAM ~100ns · SSD ~100µs · Network (DC) ~500µs · HDD ~10ms. Knowing these prevents optimizing the wrong layer [4].

---

## Performance Categories

### 1. Algorithmic Issues [5][12]

**N+1 Query Problem** — database query inside a loop. O(n) round-trips [5].

```typescript
// VIOLATION: 1 + N queries — O(n) round-trips [5]
for (const user of users) {
  user.orders = await db.orders.findByUserId(user.id);
}

// CORRECT: Batch query with Map lookup — O(1) per access [5]
const orders = await db.orders.findAll({ where: { userId: userIds } });
const ordersByUser = new Map(groupBy(orders, 'userId'));
users.forEach(u => u.orders = ordersByUser.get(u.id) || []);
```

**O(n²) Patterns** — linear search inside a loop [12].

```typescript
// VIOLATION: Array.includes is O(n), called n times → O(n²) [12]
items.filter(item => selected.includes(item.id));

// CORRECT: Set lookup is O(1) → total O(n) [12]
const selectedSet = new Set(selected);
items.filter(item => selectedSet.has(item.id));
```

### 2. Memory Issues [4][10]

**Memory Leaks** — resources not cleaned up. Hidden by GC until OOM [4].
**Cache line false sharing** — hot fields on the same 64-byte line cause inter-core invalidation in high-throughput code [4][10].
**Unbounded caches** — collections that grow forever. Use LRU with a `max` limit [4].

### 3. I/O Issues [3][16]

**Blocking Operations** — synchronous I/O in request path blocks the event loop [3][16].

```typescript
const config = fs.readFileSync('./config.json');           // VIOLATION [3]
const config = await fs.promises.readFile('./config.json'); // CORRECT [16]
```

**Sequential When Parallel Possible** — independent operations run serially [5].

```typescript
// VIOLATION: total = sum of all [5]
const user = await getUser(id); const orders = await getOrders(id);
// CORRECT: total = max of all
const [user, orders] = await Promise.all([getUser(id), getOrders(id)]);
```

### 4. Database Issues [20]

Missing indexes, SELECT *, OFFSET pagination on large tables, LIKE with leading wildcard. See `references/violations.md`.

### 5. Frontend / Web Vitals [6][17][21]

| Metric | Good | Poor | Measures |
|--------|------|------|---------|
| LCP [6] | < 2.5s | > 4s | Largest element load |
| INP [21] | < 200ms | > 500ms | Input responsiveness |
| CLS [6] | < 0.1 | > 0.25 | Layout stability |

Unnecessary re-renders, missing virtualization, missing code splitting. See `references/violations.md`.

---

## Extended References

| Reference | Content |
|-----------|---------|
| `references/sources.md` | Full bibliography (25 sources) |
| `references/violations.md` | Extended violations with citations [n] |
| `references/patterns.md` | Correct patterns with citations [n] |
| `references/detection.md` | Grep commands, profiling, CI integration |

---

## Severity Guidelines

| Severity | Examples |
|----------|----------|
| **CRITICAL** | N+1 with unbounded data [5], memory leaks [4], blocking I/O in handlers [3] |
| **HIGH** | Sequential async [5], SELECT * [20], unbounded caches [4], LCP > 4s [6] |
| **MEDIUM** | Suboptimal algorithm on small data [12], missing memoization, INP > 200ms [21] |
| **LOW** | Micro-optimizations, premature optimization candidates [1] |

---

## Quick Detection

```bash
grep -rn "for.*await\|\.forEach.*async" --include="*.ts"  # N+1
grep -rn "readFileSync\|writeFileSync" --include="*.ts"   # Sync I/O
grep -rn "SELECT \*" --include="*.ts" --include="*.sql"   # SELECT *
```

See `references/detection.md` for comprehensive detection patterns.
