# Rust Extended Patterns

Extended correct patterns for Rust. Reference from main SKILL.md.

## Typestate Pattern

Encode valid state transitions in the type system so invalid sequences don't compile.

```rust
// States are zero-sized types — no runtime cost
struct Draft;
struct Published;
struct Archived;

struct Article<State> {
    title: String,
    body: String,
    _state: std::marker::PhantomData<State>,
}

impl Article<Draft> {
    pub fn new(title: String, body: String) -> Self {
        Article { title, body, _state: std::marker::PhantomData }
    }

    pub fn publish(self) -> Article<Published> {
        Article { title: self.title, body: self.body, _state: std::marker::PhantomData }
    }
}

impl Article<Published> {
    pub fn archive(self) -> Article<Archived> {
        Article { title: self.title, body: self.body, _state: std::marker::PhantomData }
    }
}

// article.archive() on Draft won't compile — transition enforced at compile time
```

---

## Error Handling Hierarchy

Layer errors from specific to general using `thiserror` for libraries and `anyhow` for applications.

```rust
// Library: precise, typed errors
#[derive(thiserror::Error, Debug)]
pub enum RepoError {
    #[error("entity {entity} with id {id} not found")]
    NotFound { entity: &'static str, id: String },
    #[error("duplicate key: {0}")]
    Duplicate(String),
    #[error("connection failed")]
    Connection(#[from] sqlx::Error),
}

// Application: ergonomic error propagation
use anyhow::{Context, Result};

fn run() -> Result<()> {
    let config = load_config()
        .context("failed to load configuration")?;
    let db = connect_db(&config.database_url)
        .context("failed to connect to database")?;
    serve(db, config.port)
        .context("server exited with error")
}
```

---

## Trait Objects vs Generics

### Use Generics for Performance (Monomorphization)

```rust
fn largest<T: PartialOrd>(list: &[T]) -> Option<&T> {
    list.iter().reduce(|a, b| if a >= b { a } else { b })
}
```

### Use Trait Objects for Heterogeneous Collections

```rust
trait Handler: Send + Sync {
    fn handle(&self, request: &Request) -> Response;
}

struct Router {
    routes: Vec<Box<dyn Handler>>, // Different concrete types in one Vec
}
```

### Decision Guide

| Criteria | Generics | Trait Objects |
|----------|----------|--------------|
| Known types at compile time | Yes | No |
| Heterogeneous collection | No | Yes |
| Performance-critical | Yes | Acceptable overhead |
| Binary size concern | Increases | Minimal |

---

## Smart Pointers

### Box — Heap Allocation

```rust
// Recursive types require indirection
enum List<T> {
    Cons(T, Box<List<T>>),
    Nil,
}
```

### Rc/Arc — Shared Ownership

```rust
use std::sync::Arc;

// Shared read-only config across threads
let config = Arc::new(load_config()?);
let config_clone = Arc::clone(&config);
tokio::spawn(async move {
    use_config(&config_clone).await;
});
```

### When to Use Each

| Pointer | Use Case |
|---------|----------|
| `Box<T>` | Single owner, heap allocation, recursive types |
| `Rc<T>` | Multiple owners, single-threaded |
| `Arc<T>` | Multiple owners, multi-threaded |
| `Cow<'a, T>` | Clone-on-write, flexible borrowing |

---

## From/Into Conversions

```rust
// Implement From for automatic Into
impl From<CreateUserRequest> for User {
    fn from(req: CreateUserRequest) -> Self {
        User {
            id: Uuid::new_v4(),
            name: req.name,
            email: req.email,
            created_at: Utc::now(),
        }
    }
}

// Callers get Into for free
fn save_user(user: impl Into<User>) -> Result<(), DbError> {
    let user: User = user.into();
    // ...
    Ok(())
}
```

---

## Derive and Trait Best Practices

```rust
// Derive the standard set for data types
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct UserId(String);

// Derive serde for serialization boundaries
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApiResponse<T> {
    pub data: T,
    pub metadata: Metadata,
}
```

### Trait Implementation Order Convention

1. Standard library traits (`Debug`, `Display`, `Clone`, `PartialEq`)
2. Conversion traits (`From`, `Into`, `TryFrom`)
3. Iterator traits (`Iterator`, `IntoIterator`)
4. Serde traits (`Serialize`, `Deserialize`)
5. Custom traits (domain-specific)

---

## Module Organization

```
src/
├── lib.rs          # Public API re-exports
├── error.rs        # Crate-level error types
├── domain/
│   ├── mod.rs      # Domain re-exports
│   ├── user.rs     # User entity and logic
│   └── order.rs    # Order entity and logic
├── repo/
│   ├── mod.rs      # Repository trait definitions
│   └── postgres.rs # Concrete implementation
└── api/
    ├── mod.rs      # Route registration
    └── handlers.rs # HTTP handlers
```

Keep `lib.rs` thin — re-export only the public API. Internal modules use `pub(crate)`.
