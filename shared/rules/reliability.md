---
paths: []
---
# Reliability

**Every loop, retry, and resource has an explicit bound.**

- All loops and retries must have a fixed upper bound — no unbounded while(true) or infinite pagination
- Assert preconditions and invariants in production code — not just tests
- Minimize allocation after initialization — prefer pools, arenas, or pre-sized collections
- Limit indirection depth — no pointer-to-pointer, Box<Box<T>>, or triple-nested references
- Restrict metaprogramming to simple constructs — no reflection-heavy magic, multi-level macros, or recursive generics
