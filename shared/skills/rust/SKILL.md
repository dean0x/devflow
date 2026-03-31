---
name: rust
description: This skill should be used when the user works with Rust files (.rs), asks about "ownership", "borrowing", "lifetimes", "Result/Option", "traits", or discusses memory safety and type-driven design. Provides patterns for ownership, error handling, type system usage, and safe concurrency.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.rs"
  exclude:
    - "**/target/**"
---

# Rust Patterns

Reference for Rust-specific patterns, ownership model, and type-driven design.

## Iron Law

> **MAKE ILLEGAL STATES UNREPRESENTABLE** [15][2, C-VALIDATE]
>
> Encode invariants in the type system. If a function can fail, return `Result`. If a value
> might be absent, return `Option`. If a state transition is invalid, make it uncompilable.
> Runtime checks are a fallback, not a strategy.

## When This Skill Activates

- Working with Rust codebases
- Designing type-safe APIs
- Managing ownership and borrowing
- Implementing error handling
- Writing concurrent code

---

## Ownership & Borrowing [1, Ch.4][11]

Prefer borrowing over cloning — accept `&str` not `String`, `&[T]` not `&Vec<T>` [2, C-BORROW].
The borrow checker enforces the Stacked Borrows aliasing model at compile time [6][11].
Lifetime annotations required when elision rules can't resolve ambiguity [1, Ch.10].

```rust
// BAD: fn process(data: String) — takes ownership unnecessarily
fn process(data: &str) -> usize { data.len() } // GOOD: borrow [2, C-BORROW]
```

See `references/ownership.md` for elision rules, interior mutability, Cow, and Pin.

---

## Error Handling [8][9][16]

Use `thiserror` for libraries (typed, matchable variants); `anyhow` for applications
(ergonomic propagation). Never use `Box<dyn Error>` in library APIs [8][16].

```rust
#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("IO error reading {path}")]
    Io { path: String, #[source] source: io::Error },
    #[error("{entity} with id {id} not found")]
    NotFound { entity: String, id: String },
}
// ? operator propagates with source context [1, Ch.9]
fn read_config(path: &str) -> Result<Config, AppError> {
    let raw = fs::read_to_string(path).map_err(|e| AppError::Io { path: path.into(), source: e })?;
    toml::from_str(&raw).map_err(|e| AppError::Parse { source: e })
}
```

---

## Type System

### Newtype Pattern [2, C-NEWTYPE][15]

```rust
struct UserId(String);   struct OrderId(String);
// Can't accidentally swap — compiler enforces [15]
fn get_order(user_id: &UserId, order_id: &OrderId) -> Result<Order, AppError> { todo!() }
```

### Enums for State Machines [4][15][27]

Each state carries only its relevant data; invalid transitions don't compile [15][27]:

```rust
enum Connection { Disconnected, Connecting { attempt: u32 }, Connected { session: Session } }
```

### Builder Pattern [2, C-BUILDER][4]

```rust
impl ServerBuilder {
    pub fn new() -> Self { Self { port: 8080, host: "localhost".into() } }
    pub fn port(mut self, p: u16) -> Self { self.port = p; self }
    pub fn build(self) -> Server { Server { port: self.port, host: self.host } }
}
```

---

## Concurrency [1, Ch.16][29]

Prefer channels over shared mutable state. `Send`/`Sync` traits prevent data races at
compile time — enforced by RustBelt's formal model [6][29]. Use `tokio::fs` or
`spawn_blocking` in async contexts — never `std::fs` (blocks the runtime) [13].

```rust
// mpsc channels over Mutex<Vec> for communication [1, Ch.16]
let (tx, mut rx) = tokio::sync::mpsc::channel::<Work>(100);
```

---

## Anti-Patterns [7][8][2]

| Bad | Good | Source |
|-----|------|--------|
| `.unwrap()` in library | `?` or `.ok_or()` | [8] |
| `.clone()` to satisfy borrow checker | Restructure ownership | [2, C-BORROW] |
| `HashMap<String, String>` | Typed structs and enums | [2, C-NEWTYPE] |
| `let _ = write(...)` | Handle or propagate | [7] |
| `std::fs::` in async fn | `tokio::fs::` or `spawn_blocking` | [13] |

---

## Extended References

- `references/sources.md` — Full bibliography (~30 sources with access links)
- `references/violations.md` — Violation patterns with citations
- `references/patterns.md` — Extended patterns with citations
- `references/ownership.md` — Lifetimes, interior mutability, Stacked Borrows, Pin
- `references/detection.md` — Clippy and grep patterns for automated detection

---

## Checklist

- [ ] No `.unwrap()` in library/application code (ok in tests) [8]
- [ ] `thiserror` for library errors; `anyhow` for application code [9][16]
- [ ] `?` operator for error propagation [1, Ch.9]
- [ ] Borrow instead of clone where possible [2, C-BORROW]
- [ ] Newtype pattern for type-safe IDs [2, C-NEWTYPE]
- [ ] Enums for state machines [4][15]
- [ ] `#[must_use]` on Result-returning functions [7]
- [ ] No `unsafe` without `// SAFETY:` comment [3][11]
- [ ] Clippy clean (`cargo clippy -- -D warnings`) [7]
- [ ] No blocking calls in async context [13]
