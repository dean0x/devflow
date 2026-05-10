---
paths: []
---
# Engineering Principles

**Never throw in business logic.**

- Return Result types for all fallible operations
- Inject dependencies — constructors accept interfaces, not implementations
- Immutable by default — return new objects, never mutate parameters
- Parse at boundaries, trust internally — use schemas (Zod, io-ts) at entry points
- Compose with pipes — readable, testable transformation chains
- Explicit over implicit — no magic behaviors or hidden side effects
