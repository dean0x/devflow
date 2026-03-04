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

> **MAKE ILLEGAL STATES UNREPRESENTABLE**
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

## Ownership & Borrowing

### Prefer Borrowing Over Cloning

```rust
// BAD: fn process(data: String) — takes ownership unnecessarily
// GOOD: fn process(data: &str) — borrows, caller keeps ownership

fn process(data: &str) -> usize {
    data.len()
}
```

### Lifetime Annotations When Needed

```rust
// Return reference tied to input lifetime
fn first_word(s: &str) -> &str {
    s.split_whitespace().next().unwrap_or("")
}

// Explicit when compiler can't infer
struct Excerpt<'a> {
    text: &'a str,
}
```

---

## Error Handling

### Use Result and the ? Operator

```rust
use std::fs;
use std::io;

fn read_config(path: &str) -> Result<Config, AppError> {
    let content = fs::read_to_string(path)
        .map_err(|e| AppError::Io { path: path.into(), source: e })?;
    let config: Config = toml::from_str(&content)
        .map_err(|e| AppError::Parse { source: e })?;
    Ok(config)
}
```

### Custom Error Types with thiserror

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error reading {path}")]
    Io { path: String, #[source] source: io::Error },
    #[error("parse error")]
    Parse { #[from] source: toml::de::Error },
    #[error("{entity} with id {id} not found")]
    NotFound { entity: String, id: String },
}
```

---

## Type System

### Newtype Pattern

```rust
// Prevent mixing up IDs
struct UserId(String);
struct OrderId(String);

fn get_order(user_id: &UserId, order_id: &OrderId) -> Result<Order, AppError> {
    // Can't accidentally swap parameters
    todo!()
}
```

### Enums for State Machines

```rust
enum Connection {
    Disconnected,
    Connecting { attempt: u32 },
    Connected { session: Session },
}

// Each state carries only its relevant data
// Invalid transitions are uncompilable
```

---

## Patterns

### Builder Pattern

```rust
pub struct ServerBuilder {
    port: u16,
    host: String,
}

impl ServerBuilder {
    pub fn new() -> Self { Self { port: 8080, host: "localhost".into() } }
    pub fn port(mut self, port: u16) -> Self { self.port = port; self }
    pub fn host(mut self, host: impl Into<String>) -> Self { self.host = host.into(); self }
    pub fn build(self) -> Server { Server { port: self.port, host: self.host } }
}
```

### Iterator Chains Over Loops

```rust
// BAD: manual loop with push
// GOOD:
let active_names: Vec<&str> = users.iter()
    .filter(|u| u.is_active)
    .map(|u| u.name.as_str())
    .collect();
```

---

## Anti-Patterns

| Pattern | Bad | Good |
|---------|-----|------|
| Unwrap in library | `.unwrap()` | `?` operator or `.ok_or()` |
| Clone to satisfy borrow checker | `.clone()` everywhere | Restructure ownership |
| String for everything | `HashMap<String, String>` | Typed structs and enums |
| Ignoring Result | `let _ = write(...)` | Handle or propagate error |
| Mutex<Vec> for message passing | Shared mutable state | Channels (`mpsc`) |

---

## Extended References

For additional patterns and examples:
- `references/violations.md` - Common Rust violations
- `references/patterns.md` - Extended Rust patterns
- `references/detection.md` - Detection patterns for Rust issues
- `references/ownership.md` - Advanced ownership and lifetime patterns

---

## Checklist

- [ ] No `.unwrap()` in library/application code (ok in tests)
- [ ] Custom error types with `thiserror`
- [ ] `?` operator for error propagation
- [ ] Borrow instead of clone where possible
- [ ] Newtype pattern for type-safe IDs
- [ ] Enums for state machines
- [ ] Iterator chains over manual loops
- [ ] `#[must_use]` on Result-returning functions
- [ ] No `unsafe` without safety comment
- [ ] Clippy clean (`cargo clippy -- -D warnings`)
