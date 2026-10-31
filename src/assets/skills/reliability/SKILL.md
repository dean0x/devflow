---
name: reliability
description: This skill should be used when reviewing code for unbounded loops or missing assertions.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Reliability Patterns

Detection patterns for runtime reliability and defensive bounds. Use with `devflow:review-methodology`.

## Iron Law

> **Every operation must terminate and every resource must be bounded.**
>
> Adapted from NASA/JPL's "Power of Ten" rules for safety-critical code: every loop must
> have a fixed upper bound, every resource must have a known lifetime, and every assumption
> must be checked by an assertion. Unbounded operations are latent outages.

## Reliability Categories

1. **Bounded iteration**: every loop, retry and pagination terminates after a known maximum. Violation: `while (true)` retry on a fetch. Fix: a fixed `MAX_RETRIES` with backoff and an explicit failure after the last attempt.
2. **Assertion density**: assert preconditions and invariants in production code, not just tests. Violation: a payment function that silently assumes non-empty items, a payment method and a positive total.
3. **Allocation discipline**: minimize allocation in hot paths; prefer pre-sized collections, pools or arenas. Violation: a buffer allocated on each loop iteration. Fix: allocate once outside the loop and pre-size the result.
4. **Indirection limits**: no pointer-to-pointer, `Box<Box<T>>` or triple-nested references. Flatten them.
5. **Metaprogramming restraint**: simple constructs only; no reflection-heavy magic, multi-level macros or recursive generics (`DeepPartial<DeepPartial<T>>`). Use bounded, explicit types.

## Extended References

| Reference | Content |
|-----------|---------|
| `references/sources.md` | Full bibliography |
| `references/patterns.md` | Correct patterns |
| `references/violations.md` | Violation examples |
| `references/detection.md` | Grep patterns for automated scanning |

## Severity Guidelines

| Level | Criteria | Examples |
|-------|----------|----------|
| **CRITICAL** | Unbounded operation on external I/O | Infinite retry on network call, allocation in tight loop processing unbounded input |
| **HIGH** | Implicit-only bounds, zero assertions in critical path | Retry with no max, validation function with no precondition checks |
| **MEDIUM** | Missing bound on bounded data, low assertion density | Pagination without page limit on known-finite dataset, sparse assertions |
| **LOW** | Style-level reliability improvement | Unnecessary indirection, overly complex generic type |
