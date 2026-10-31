---
name: rust
description: This skill should be used when the user works with Rust files (.rs), asks about "ownership", "borrowing", "lifetimes", "traits", or discusses memory safety.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.rs"
  exclude:
    - "**/target/**"
---

# Rust Patterns

## Iron Law

> **MAKE ILLEGAL STATES UNREPRESENTABLE** [15][2, C-VALIDATE]
>
> Encode invariants in the type system. If a function can fail, return `Result`. If a value
> might be absent, return `Option`. If a state transition is invalid, make it uncompilable.
> Runtime checks are a fallback, not a strategy.

## Ownership & Borrowing

- Prefer borrowing over ownership and cloning: accept `&str` not `String`, `&[T]` not `&Vec<T>`.
- Do not `.clone()` to satisfy the borrow checker; restructure ownership.
- Add lifetime annotations only where elision rules can't resolve ambiguity.

See `references/ownership.md` for elision rules, interior mutability, Cow, and Pin.

## Error Handling

- Use `thiserror` for libraries (typed, matchable variants) and `anyhow` for applications (ergonomic propagation). Never use `Box<dyn Error>` in library APIs.
- Propagate with the `?` operator, and keep the source: `.map_err(|e| AppError::Io { path: path.into(), source: e })?` on a variant with a `#[source]` field.
- No `.unwrap()` in library or application code (ok in tests): use `?` or `.ok_or()`.
- Never discard a result with `let _ = write(...)`: handle or propagate it. Put `#[must_use]` on Result-returning functions.

## Type System

- Use newtypes for IDs (`struct UserId(String)`), so the compiler stops a swap.
- Use enums for state machines. Each state carries only its data, so invalid transitions don't compile: `enum Connection { Disconnected, Connecting { attempt: u32 }, Connected { session: Session } }`.
- Use typed structs and enums, not `HashMap<String, String>`.
- Use a builder with consuming setters (`fn port(mut self, p: u16) -> Self`) and defaults in `new()`.

## Concurrency & Safety

- Prefer bounded channels (`tokio::sync::mpsc::channel(100)`) over shared mutable state (`Mutex<Vec>`). `Send`/`Sync` prevent data races at compile time.
- In async contexts use `tokio::fs` or `spawn_blocking`, never `std::fs`: it blocks the runtime.
- No `unsafe` without a `// SAFETY:` comment.
- Clippy clean: `cargo clippy -- -D warnings`.

## Extended References

- `references/sources.md` — Full bibliography with access links
- `references/violations.md` — Violation patterns with citations
- `references/patterns.md` — Extended patterns with citations
- `references/ownership.md` — Lifetimes, interior mutability, Stacked Borrows, Pin
- `references/detection.md` — Clippy and grep patterns for automated detection
