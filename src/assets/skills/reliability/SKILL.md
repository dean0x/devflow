---
name: reliability
description: This skill should be used when reviewing code for unbounded loops, missing assertions, excessive allocation, or deep indirection.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Reliability Patterns

Domain expertise for runtime reliability and defensive bounds analysis. Use alongside `devflow:review-methodology` for complete reliability reviews.

## Iron Law

> **EVERY OPERATION MUST TERMINATE AND EVERY RESOURCE MUST BE BOUNDED**
>
> Adapted from NASA/JPL's "Power of Ten" rules for safety-critical code [1]: every loop must
> have a fixed upper bound, every resource must have a known lifetime, and every assumption
> must be checked by an assertion. Unbounded operations are latent outages.

---

## Reliability Categories

### 1. Bounded Iteration [1]

All loops, retries, and pagination must terminate after a known maximum.

**Violation**: Unbounded retry loop
```typescript
while (true) {
  const res = await fetch(url);
  if (res.ok) break;
  await sleep(1000);
}
```

**Solution**: Fixed upper bound with explicit failure
```typescript
const MAX_RETRIES = 5;
for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  const res = await fetch(url);
  if (res.ok) return res;
  await sleep(1000 * 2 ** attempt);
}
throw new Error(`Failed after ${MAX_RETRIES} attempts`);
```

### 2. Assertion Density [1]

Assert preconditions and invariants in production code, not just tests.

**Violation**: Silent assumption
```typescript
function processPayment(order: Order) {
  const total = order.items.reduce((sum, i) => sum + i.price, 0);
  chargeCard(order.paymentMethod, total);
}
```

**Solution**: Explicit precondition checks
```typescript
function processPayment(order: Order) {
  assert(order.items.length > 0, 'Cannot process empty order');
  assert(order.paymentMethod != null, 'Missing payment method');
  const total = order.items.reduce((sum, i) => sum + i.price, 0);
  assert(total > 0, 'Order total must be positive');
  chargeCard(order.paymentMethod, total);
}
```

### 3. Allocation Discipline [1]

Minimize allocation in hot paths — prefer pre-sized collections, pools, or arenas.

**Violation**: Allocation in tight loop
```go
func processEvents(events []Event) []Result {
    var results []Result
    for _, e := range events {
        buf := make([]byte, 4096)  // alloc per iteration
        results = append(results, process(e, buf))
    }
    return results
}
```

**Solution**: Pre-allocate outside loop
```go
func processEvents(events []Event) []Result {
    results := make([]Result, 0, len(events))
    buf := make([]byte, 4096)  // single allocation
    for _, e := range events {
        results = append(results, process(e, buf))
    }
    return results
}
```

### 4. Indirection Limits [1]

Restrict pointer depth — no pointer-to-pointer, `Box<Box<T>>`, or triple-nested references.

**Violation**: Excessive indirection
```rust
fn update(data: &mut Box<Box<Vec<Item>>>) {
    (***data).push(item);
}
```

**Solution**: Flatten indirection
```rust
fn update(data: &mut Vec<Item>) {
    data.push(item);
}
```

### 5. Metaprogramming Restraint [1]

Restrict to simple constructs — no reflection-heavy magic, multi-level macros, or recursive generics.

**Violation**: Recursive generic type
```typescript
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;
type Config = DeepPartial<DeepPartial<AppConfig>>;  // unbounded recursion risk
```

**Solution**: Bounded, explicit type
```typescript
type ShallowPartial<T> = { [K in keyof T]?: T[K] };
type ConfigOverrides = Pick<AppConfig, 'timeout' | 'retries'>;
```

---

## Extended References

| Reference | Content |
|-----------|---------|
| `references/sources.md` | Full bibliography |
| `references/patterns.md` | Correct patterns with citations |
| `references/violations.md` | Violation examples with citations |
| `references/detection.md` | Grep patterns for automated scanning |

## Severity Guidelines

| Level | Criteria | Examples |
|-------|----------|----------|
| **CRITICAL** | Unbounded operation on external I/O | Infinite retry on network call, allocation in tight loop processing unbounded input |
| **HIGH** | Implicit-only bounds, zero assertions in critical path | Retry with no max, validation function with no precondition checks |
| **MEDIUM** | Missing bound on bounded data, low assertion density | Pagination without page limit on known-finite dataset, sparse assertions |
| **LOW** | Style-level reliability improvement | Unnecessary indirection, overly complex generic type |
