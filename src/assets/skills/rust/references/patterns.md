# Rust Extended Patterns

Extended correct patterns for Rust with literature citations. Reference from main SKILL.md.

## Typestate Pattern [4][27]

Encode valid state transitions in the type system so invalid sequences don't compile.
Zero-sized phantom types add no runtime cost [4][15].

```rust
// States are zero-sized types — no runtime cost [18]
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

// article.archive() on Draft won't compile — transition enforced at compile time [15][27]
```

---

## Error Handling Hierarchy [8][9][16]

Layer errors from specific (library) to general (application). `thiserror` for precise
typed errors; `anyhow` for ergonomic propagation in binaries [8][16].

```rust
// Library: precise, typed errors — callers can match on variants [8][9]
#[derive(thiserror::Error, Debug)]
pub enum RepoError {
    #[error("entity {entity} with id {id} not found")]
    NotFound { entity: &'static str, id: String },
    #[error("duplicate key: {0}")]
    Duplicate(String),
    #[error("connection failed")]
    Connection(#[from] sqlx::Error),
}

// Application: ergonomic error propagation with context [9]
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

## Trait Objects vs Generics [1, Ch.17][20]

### Use Generics for Performance (Monomorphization) [18][20]

```rust
// Compiler generates specialized code per type — zero-cost [18]
fn largest<T: PartialOrd>(list: &[T]) -> Option<&T> {
    list.iter().reduce(|a, b| if a >= b { a } else { b })
}
```

### Use Trait Objects for Heterogeneous Collections [1, Ch.17]

```rust
trait Handler: Send + Sync {
    fn handle(&self, request: &Request) -> Response;
}

struct Router {
    routes: Vec<Box<dyn Handler>>, // Different concrete types in one Vec [1, Ch.17]
}
```

### Decision Guide [5, Item 12]

| Criteria | Generics | Trait Objects |
|----------|----------|--------------|
| Known types at compile time | Yes | No |
| Heterogeneous collection | No | Yes |
| Performance-critical | Yes | Acceptable overhead |
| Binary size concern | Increases | Minimal |

---

## Smart Pointers [1, Ch.15]

### Box — Heap Allocation [1, Ch.15]

```rust
// Recursive types require indirection — Box provides single ownership [1, Ch.15]
enum List<T> {
    Cons(T, Box<List<T>>),
    Nil,
}
```

### Rc/Arc — Shared Ownership [1, Ch.15]

```rust
use std::sync::Arc;

// Shared read-only config across threads — Arc enables this safely [29]
let config = Arc::new(load_config()?);
let config_clone = Arc::clone(&config);
tokio::spawn(async move {
    use_config(&config_clone).await;
});
```

### When to Use Each [5, Item 8]

| Pointer | Use Case |
|---------|----------|
| `Box<T>` | Single owner, heap allocation, recursive types |
| `Rc<T>` | Multiple owners, single-threaded |
| `Arc<T>` | Multiple owners, multi-threaded [29] |
| `Cow<'a, T>` | Clone-on-write, flexible borrowing [2, C-BORROW] |

---

## From/Into Conversions [2][5, Item 5]

Implement `From` to get `Into` for free. Prefer `From` over `Into` in implementations
(the orphan rule makes `From` more usable) [2].

```rust
// Implement From for automatic Into [2]
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

// Callers get Into for free — accept impl Into<User> for flexibility [2, C-BORROW]
fn save_user(user: impl Into<User>) -> Result<(), DbError> {
    let user: User = user.into();
    Ok(())
}
```

---

## Derive and Trait Best Practices [2][12]

```rust
// Derive the standard set for data types [2]
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct UserId(String);

// Derive serde for serialization boundaries — serde is the ecosystem standard [12]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApiResponse<T> {
    pub data: T,
    pub metadata: Metadata,
}
```

### Trait Implementation Order Convention [2]

1. Standard library traits (`Debug`, `Display`, `Clone`, `PartialEq`)
2. Conversion traits (`From`, `Into`, `TryFrom`)
3. Iterator traits (`Iterator`, `IntoIterator`)
4. Serde traits (`Serialize`, `Deserialize`) [12]
5. Custom traits (domain-specific)

---

## Async Patterns [13]

### spawn_blocking for CPU Work [13]

```rust
// Offload CPU-bound work to dedicated thread pool — never block the async runtime [13]
async fn process_file(path: &str) -> Result<Report, AppError> {
    let path = path.to_string();
    let report = tokio::task::spawn_blocking(move || {
        parse_large_file(&path) // CPU-bound, safe to block thread
    }).await??;
    Ok(report)
}
```

### Channel Patterns [1, Ch.16][13]

```rust
use tokio::sync::mpsc;

// Prefer channels over shared state for communication [1, Ch.16]
let (tx, mut rx) = mpsc::channel::<Work>(100);

tokio::spawn(async move {
    while let Some(work) = rx.recv().await {
        process(work).await;
    }
});
```

---

## Module Organization [2][10, Ch.3]

```
src/
├── lib.rs          # Public API re-exports only [2]
├── error.rs        # Crate-level error types [8]
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

Keep `lib.rs` thin — re-export only the public API. Internal modules use `pub(crate)` [2].
