---
paths: ["**/*.rs"]
---
# Rust

**Make illegal states unrepresentable — encode invariants in types.**

- Prefer borrowing over cloning — measure before you allocate
- `?` operator for error propagation — no `.unwrap()` outside tests
- Small, focused traits — one capability per trait
- `#[must_use]` on functions with important return values
