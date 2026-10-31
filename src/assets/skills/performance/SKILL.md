---
name: performance
description: This skill should be used when reviewing code for N+1 queries or memory leaks.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Performance Patterns

Detection patterns for performance and bottleneck review. Use with `devflow:review-methodology`.

## Iron Law

> **Measure before optimizing.**
>
> Profile first, optimize second. Every performance claim requires benchmarks. Brendan
> Gregg's USE Method (Utilization, Saturation, Errors) and Tom Wilkie's RED Method
> (Rate, Errors, Duration) are the systematic starting points — not guesswork.
> Gil Tene's coordinated omission warning: averages lie — monitor P99, not mean latency.

Measurement tools: flame graphs for CPU hot paths (widest frames are hottest), HDR histograms for full latency distributions.

## Performance Categories

### 1. Algorithmic Issues

- **N+1 queries**: a database query inside a loop, O(n) round trips. Fix: one batch query, then a Map lookup.
- **O(n²) patterns**: linear search inside a loop (`items.filter(i => selected.includes(i.id))`). Fix: a Set lookup.

### 2. Memory Issues

- **Memory leaks**: resources not cleaned up, hidden by GC until OOM.
- **Cache line false sharing**: hot fields on the same 64-byte line cause inter-core invalidation in high-throughput code.
- **Unbounded caches**: collections that grow forever. Use LRU with a `max` limit.

### 3. I/O Issues

- **Blocking operations**: synchronous I/O (`readFileSync`) in a request path blocks the event loop.
- **Sequential when parallel is possible**: independent awaits run serially, so the total is the sum, not the max. Fix: `Promise.all`.

### 4. Database Issues

Missing indexes, SELECT *, OFFSET pagination on large tables, LIKE with leading wildcard. See `references/violations.md`.

### 5. Frontend / Web Vitals

| Metric | Good | Poor | Measures |
|--------|------|------|---------|
| LCP | < 2.5s | > 4s | Largest element load |
| INP | < 200ms | > 500ms | Input responsiveness |
| CLS | < 0.1 | > 0.25 | Layout stability |

Unnecessary re-renders, missing virtualization, missing code splitting. See `references/violations.md`.

## Extended References

| Reference | Content |
|-----------|---------|
| `references/sources.md` | Full bibliography (25 sources) |
| `references/violations.md` | Extended violations |
| `references/patterns.md` | Correct patterns |
| `references/detection.md` | Grep commands, profiling, CI integration |

## Severity Guidelines

| Severity | Examples |
|----------|----------|
| **CRITICAL** | N+1 with unbounded data, memory leaks, blocking I/O in handlers |
| **HIGH** | Sequential async, SELECT *, unbounded caches, LCP > 4s |
| **MEDIUM** | Suboptimal algorithm on small data, missing memoization, INP > 200ms |
| **LOW** | Micro-optimizations, premature optimization candidates |

## Quick Detection

```bash
grep -rn "for.*await\|\.forEach.*async" --include="*.ts"  # N+1
grep -rn "readFileSync\|writeFileSync" --include="*.ts"   # Sync I/O
grep -rn "SELECT \*" --include="*.ts" --include="*.sql"   # SELECT *
```
