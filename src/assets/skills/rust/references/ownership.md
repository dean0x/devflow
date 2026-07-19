# Rust Ownership Deep Dive

Advanced ownership patterns, lifetime elision, interior mutability, and pinning.
Citations reference `sources.md`.

## Lifetime Elision Rules [1, Ch.10]

The compiler applies three rules to infer lifetimes. When they don't resolve, annotate manually.
These rules are part of the formal type system verified by RustBelt [6].

### Rule 1: Each Reference Parameter Gets Its Own Lifetime [1, Ch.10]

```rust
// Compiler sees: fn first(s: &str) -> &str
// Compiler infers: fn first<'a>(s: &'a str) -> &'a str [1, Ch.10]
fn first(s: &str) -> &str {
    &s[..1]
}
```

### Rule 2: Single Input Lifetime Applies to All Outputs [1, Ch.10]

```rust
// One input reference — output borrows from it [1, Ch.10]
fn trim(s: &str) -> &str {
    s.trim()
}
```

### Rule 3: &self Lifetime Applies to All Outputs in Methods [1, Ch.10]

```rust
impl Config {
    // &self lifetime flows to return — elision rule 3 [1, Ch.10]
    fn database_url(&self) -> &str {
        &self.db_url
    }
}
```

### When Elision Fails [1, Ch.10]

```rust
// Two input lifetimes — compiler can't decide which output borrows from [1, Ch.10]
// Must annotate: output borrows from `a`, not `b`
fn longest<'a>(a: &'a str, b: &str) -> &'a str {
    if a.len() >= b.len() { a } else { a }
}
```

---

## Aliasing and the Stacked Borrows Model [11][3]

Rust's borrow checker enforces that at any point in time, you have either:
- Any number of immutable references (`&T`), OR
- Exactly one mutable reference (`&mut T`)

The **Stacked Borrows** model [11] formalizes this as a stack of "tags" tracking which
borrow is currently active. Any access through an expired tag is undefined behavior — even
in `unsafe` code. This is the theoretical foundation for why Rust code can be optimized
aggressively without data races [6][11].

```rust
// CORRECT: Immutable borrows can coexist [1, Ch.4]
let s = String::from("hello");
let r1 = &s;
let r2 = &s;
println!("{} {}", r1, r2); // Both valid — multiple shared refs [11]

// CORRECT: Mutable borrow is exclusive [1, Ch.4]
let mut s = String::from("hello");
let r = &mut s;
r.push_str(", world"); // Only r can access s [11]
// s is accessible again after r's scope ends
```

### Unsafe and Stacked Borrows [11][3]

When writing `unsafe` code that creates raw pointers, the Stacked Borrows invariant
must still hold. Violations cause undefined behavior that Miri can detect:

```rust
// SAFETY: We derive one mutable pointer and do not alias it.
// Stacked Borrows: the raw pointer is derived from a unique mutable reference,
// no other pointer accesses this memory during the operation. [11][3]
unsafe fn fill_bytes(dest: *mut u8, len: usize) {
    for i in 0..len {
        // SAFETY: caller guarantees dest points to len valid bytes.
        *dest.add(i) = 0;
    }
}
```

---

## Interior Mutability [1, Ch.15][14]

Mutate data behind a shared reference when ownership rules are too strict.
Each type trades compile-time safety for runtime checking at different granularities [1, Ch.15].

### Cell — Copy Types Only [1, Ch.15]

```rust
use std::cell::Cell;

struct Counter {
    count: Cell<u32>, // Mutate through &self — no runtime borrow check [1, Ch.15]
}

impl Counter {
    fn increment(&self) {
        self.count.set(self.count.get() + 1);
    }
}
```

### RefCell — Runtime Borrow Checking [1, Ch.15]

```rust
use std::cell::RefCell;

struct Cache {
    data: RefCell<HashMap<String, String>>,
}

impl Cache {
    fn get_or_insert(&self, key: &str, value: &str) -> String {
        let mut data = self.data.borrow_mut(); // Panics if already borrowed [1, Ch.15]
        data.entry(key.to_string())
            .or_insert_with(|| value.to_string())
            .clone()
    }
}
```

### Mutex — Thread-Safe Interior Mutability [1, Ch.16][29]

```rust
use std::sync::Mutex;

struct SharedState {
    data: Mutex<Vec<String>>,
}

impl SharedState {
    fn push(&self, item: String) -> Result<(), AppError> {
        let mut data = self.data.lock()
            .map_err(|_| AppError::LockPoisoned)?; // Handle poison explicitly [1, Ch.16]
        data.push(item);
        Ok(())
    }
}
```

### Decision Guide [1, Ch.15][29]

| Type | Thread-Safe | Cost | Use Case |
|------|-------------|------|----------|
| `Cell<T>` | No | Zero | Copy types, single-threaded |
| `RefCell<T>` | No | Runtime borrow check | Non-Copy, single-threaded [1, Ch.15] |
| `Mutex<T>` | Yes | Lock overhead | Multi-threaded mutation [29] |
| `RwLock<T>` | Yes | Lock overhead | Multi-threaded, read-heavy [29] |
| `Atomic*` | Yes | Hardware atomic | Counters, flags [29] |

---

## Cow — Clone on Write [2, C-BORROW][5, Item 10]

Defer cloning until mutation is actually needed. Ideal for functions that return
borrowed data in the common case and owned data in the exceptional case [2, C-BORROW].

```rust
use std::borrow::Cow;

// Returns borrowed if no processing needed, owned if modified [2, C-BORROW]
fn normalize_path(path: &str) -> Cow<'_, str> {
    if path.contains("//") {
        Cow::Owned(path.replace("//", "/"))
    } else {
        Cow::Borrowed(path)
    }
}

// Accept Cow for flexible ownership — caller decides allocation [2, C-BORROW]
pub fn log_message(msg: Cow<'_, str>) {
    eprintln!("[LOG] {}", msg);
}

log_message(Cow::Borrowed("static message")); // Zero allocation
log_message(Cow::Owned(format!("dynamic: {}", value))); // No extra clone
```

---

## Pin for Async and Self-Referential Types [1, Ch.17][13]

### Why Pin Exists [13]

Self-referential structs break if moved in memory. `Pin<P>` guarantees the pointed-to
value won't move, enabling async futures that hold references to their own stack frames [13].

```rust
use std::pin::Pin;
use std::future::Future;

// Async functions return self-referential futures — Pin ensures stability [13]
fn fetch_data(url: &str) -> Pin<Box<dyn Future<Output = Result<Data, Error>> + '_>> {
    Box::pin(async move {
        let response = reqwest::get(url).await?;
        let data = response.json::<Data>().await?;
        Ok(data)
    })
}
```

### Pin in Practice [13]

```rust
use tokio::pin;

async fn process_stream(stream: impl Stream<Item = Data>) {
    // pin! macro pins the stream to the stack — safe without Box [13]
    pin!(stream);

    while let Some(item) = stream.next().await {
        handle(item).await;
    }
}
```

### When You Need Pin [13]

| Scenario | Need Pin? |
|----------|-----------|
| Returning `async` blocks as trait objects | Yes |
| Implementing `Future` manually | Yes |
| Using `tokio::select!` on futures | Yes (automatically handled) |
| Normal async/await | No (compiler handles it) |
| Storing futures in collections | Yes (`Pin<Box<dyn Future>>`) |

---

## Ownership Transfer Patterns [1, Ch.4][5]

### Take Pattern — Move Out of Option [4]

```rust
struct Connection {
    session: Option<Session>,
}

impl Connection {
    fn close(&mut self) -> Option<Session> {
        self.session.take() // Moves out, leaves None — no partial move [4]
    }
}
```

### Swap Pattern — Replace In Place [4]

```rust
use std::mem;

fn rotate_buffer(current: &mut Vec<u8>, new_data: Vec<u8>) -> Vec<u8> {
    mem::replace(current, new_data) // Returns old, installs new — no clone [4]
}
```

### Entry Pattern — Conditional Insertion [1, Ch.8]

```rust
use std::collections::HashMap;

fn get_or_create(map: &mut HashMap<String, Vec<Item>>, key: &str) -> &mut Vec<Item> {
    map.entry(key.to_string()).or_insert_with(Vec::new) // Single lookup, no double-insert [1, Ch.8]
}
```
