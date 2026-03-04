# Rust Ownership Deep Dive

Advanced ownership patterns, lifetime elision, interior mutability, and pinning.

## Lifetime Elision Rules

The compiler applies three rules to infer lifetimes. When they don't resolve, annotate manually.

### Rule 1: Each Reference Parameter Gets Its Own Lifetime

```rust
// Compiler sees: fn first(s: &str) -> &str
// Compiler infers: fn first<'a>(s: &'a str) -> &'a str
fn first(s: &str) -> &str {
    &s[..1]
}
```

### Rule 2: Single Input Lifetime Applies to All Outputs

```rust
// One input reference — output borrows from it
fn trim(s: &str) -> &str {
    s.trim()
}
```

### Rule 3: &self Lifetime Applies to All Outputs in Methods

```rust
impl Config {
    // &self lifetime flows to return
    fn database_url(&self) -> &str {
        &self.db_url
    }
}
```

### When Elision Fails

```rust
// Two input lifetimes — compiler can't decide which output borrows from
// Must annotate: output borrows from `a`, not `b`
fn longest<'a>(a: &'a str, b: &str) -> &'a str {
    if a.len() >= b.len() { a } else { a }
}
```

---

## Interior Mutability

Mutate data behind a shared reference when ownership rules are too strict.

### Cell — Copy Types Only

```rust
use std::cell::Cell;

struct Counter {
    count: Cell<u32>, // Mutate through &self
}

impl Counter {
    fn increment(&self) {
        self.count.set(self.count.get() + 1);
    }
}
```

### RefCell — Runtime Borrow Checking

```rust
use std::cell::RefCell;

struct Cache {
    data: RefCell<HashMap<String, String>>,
}

impl Cache {
    fn get_or_insert(&self, key: &str, value: &str) -> String {
        let mut data = self.data.borrow_mut(); // Panics if already borrowed
        data.entry(key.to_string())
            .or_insert_with(|| value.to_string())
            .clone()
    }
}
```

### Mutex — Thread-Safe Interior Mutability

```rust
use std::sync::Mutex;

struct SharedState {
    data: Mutex<Vec<String>>,
}

impl SharedState {
    fn push(&self, item: String) -> Result<(), AppError> {
        let mut data = self.data.lock()
            .map_err(|_| AppError::LockPoisoned)?;
        data.push(item);
        Ok(())
    }
}
```

### Decision Guide

| Type | Thread-Safe | Cost | Use Case |
|------|-------------|------|----------|
| `Cell<T>` | No | Zero | Copy types, single-threaded |
| `RefCell<T>` | No | Runtime borrow check | Non-Copy, single-threaded |
| `Mutex<T>` | Yes | Lock overhead | Multi-threaded mutation |
| `RwLock<T>` | Yes | Lock overhead | Multi-threaded, read-heavy |
| `Atomic*` | Yes | Hardware atomic | Counters, flags |

---

## Cow — Clone on Write

Defer cloning until mutation is actually needed.

```rust
use std::borrow::Cow;

// Returns borrowed if no processing needed, owned if modified
fn normalize_path(path: &str) -> Cow<'_, str> {
    if path.contains("//") {
        Cow::Owned(path.replace("//", "/"))
    } else {
        Cow::Borrowed(path)
    }
}

// Function accepts both owned and borrowed transparently
fn process(input: Cow<'_, str>) {
    println!("{}", input); // No allocation if already borrowed
}
```

### Cow in APIs

```rust
// Accept Cow for flexible ownership — caller decides allocation
pub fn log_message(msg: Cow<'_, str>) {
    eprintln!("[LOG] {}", msg);
}

// Caller with borrowed data — zero-copy
log_message(Cow::Borrowed("static message"));

// Caller with owned data — no extra clone
log_message(Cow::Owned(format!("dynamic: {}", value)));
```

---

## Pin for Async and Self-Referential Types

### Why Pin Exists

Self-referential structs break if moved in memory. `Pin` guarantees the value won't move.

```rust
use std::pin::Pin;
use std::future::Future;

// Async functions return self-referential futures
// Pin ensures the future stays in place while polled
fn fetch_data(url: &str) -> Pin<Box<dyn Future<Output = Result<Data, Error>> + '_>> {
    Box::pin(async move {
        let response = reqwest::get(url).await?;
        let data = response.json::<Data>().await?;
        Ok(data)
    })
}
```

### Pin in Practice

```rust
use tokio::pin;

async fn process_stream(stream: impl Stream<Item = Data>) {
    // pin! macro pins the stream to the stack
    pin!(stream);

    while let Some(item) = stream.next().await {
        handle(item).await;
    }
}
```

### When You Need Pin

| Scenario | Need Pin? |
|----------|-----------|
| Returning `async` blocks as trait objects | Yes |
| Implementing `Future` manually | Yes |
| Using `tokio::select!` on futures | Yes (automatically handled) |
| Normal async/await | No (compiler handles it) |
| Storing futures in collections | Yes (`Pin<Box<dyn Future>>`) |

---

## Ownership Transfer Patterns

### Take Pattern — Move Out of Option

```rust
struct Connection {
    session: Option<Session>,
}

impl Connection {
    fn close(&mut self) -> Option<Session> {
        self.session.take() // Moves out, leaves None
    }
}
```

### Swap Pattern — Replace In Place

```rust
use std::mem;

fn rotate_buffer(current: &mut Vec<u8>, new_data: Vec<u8>) -> Vec<u8> {
    mem::replace(current, new_data) // Returns old, installs new
}
```

### Entry Pattern — Conditional Insertion

```rust
use std::collections::HashMap;

fn get_or_create(map: &mut HashMap<String, Vec<Item>>, key: &str) -> &mut Vec<Item> {
    map.entry(key.to_string()).or_insert_with(Vec::new)
}
```
