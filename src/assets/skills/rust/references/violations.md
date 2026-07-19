# Rust Violation Examples

Extended violation patterns for Rust reviews with literature citations. Reference from main SKILL.md.

## Unwrap Abuse [8][7]

`.unwrap()` in library or application code panics at runtime and gives callers no way to
recover. The `?` operator is always available; reach for it first [8].

### Unwrap in Library Code [8]

```rust
// VIOLATION: Panics on None — caller has no way to handle failure [8]
pub fn get_username(users: &HashMap<u64, String>, id: u64) -> &str {
    users.get(&id).unwrap() // Panics if id not found
}

// VIOLATION: Unwrap on parse without context [7]
let port: u16 = std::env::var("PORT").unwrap().parse().unwrap();
```

### Expect Without Useful Message [8]

```rust
// VIOLATION: Message doesn't help diagnose the problem [8]
let config = load_config().expect("failed");

// CORRECT: Actionable message with remediation hint [8]
let config = load_config().expect("failed to load config from config.toml — does file exist?");
```

---

## Unnecessary Cloning [2, C-BORROW][17]

Cloning to satisfy the borrow checker signals a design issue. Restructure ownership or
accept slices/borrows. Clones in hot loops cause heap allocation per iteration [17].

### Clone to Satisfy Borrow Checker [2, C-BORROW]

```rust
// VIOLATION: Cloning entire Vec to work around borrow issues [2, C-BORROW]
fn process_items(items: &Vec<Item>) {
    let cloned = items.clone(); // Entire Vec cloned — unnecessary allocation
    for item in &cloned {
        println!("{}", item.name);
    }
}

// CORRECT: Accept &[Item] and just borrow [2, C-BORROW]
fn process_items(items: &[Item]) {
    for item in items {
        println!("{}", item.name);
    }
}
```

### Clone in Hot Loop [17]

```rust
// VIOLATION: String allocation on every iteration — performance regression [17]
for record in &records {
    let key = record.id.clone();
    map.insert(key, record);
}

// CORRECT: Borrow or use references — zero allocation [2, C-BORROW]
for record in &records {
    map.insert(&record.id, record);
}
```

---

## Stringly-Typed APIs [2, C-NEWTYPE][15]

Using `String` or `&str` where a typed enum or newtype belongs allows typos to compile
and failures to occur at runtime instead of compile time [15].

### String Where Enum Belongs [2, C-NEWTYPE]

```rust
// VIOLATION: Any typo compiles and fails at runtime [15]
fn set_status(status: &str) {
    match status {
        "active" => { /* ... */ }
        "inactive" => { /* ... */ }
        _ => panic!("unknown status"), // Runtime failure — compiler can't help
    }
}

// CORRECT: Compiler enforces valid values — exhaustive match [2, C-NEWTYPE][15]
enum Status { Active, Inactive }

fn set_status(status: Status) {
    match status {
        Status::Active => { /* ... */ }
        Status::Inactive => { /* ... */ }
    } // Exhaustive — no default needed
}
```

### String IDs Instead of Newtypes [2, C-NEWTYPE]

```rust
// VIOLATION: OrderId passed where UserId expected — no compile error [15]
fn charge_user(user_id: &str, order_id: &str) { /* ... */ }
charge_user(order_id, user_id); // Silent logic bug

// CORRECT: Newtype makes the swap a compile error [2, C-NEWTYPE]
struct UserId(String);
struct OrderId(String);
fn charge_user(user_id: &UserId, order_id: &OrderId) { /* ... */ }
```

---

## Unsafe Without Justification [3][11]

Every `unsafe` block must have a `// SAFETY:` comment explaining the invariants that
make the operation sound. The Stacked Borrows model formalizes what "sound" means [11].

### Bare Unsafe Block [3][11]

```rust
// VIOLATION: No safety comment explaining invariants [3][11]
unsafe {
    let ptr = data.as_ptr();
    std::ptr::copy_nonoverlapping(ptr, dest, len);
}

// CORRECT: Document why this is safe — sufficient for Stacked Borrows soundness [3][11]
// SAFETY: `data` is guaranteed to be valid for `len` bytes because
// it was allocated by `Vec::with_capacity(len)` and filled by `read_exact`.
// `dest` is a valid pointer from `alloc::alloc(layout)` with matching size.
// No aliasing exists: `data` and `dest` are disjoint allocations.
unsafe {
    std::ptr::copy_nonoverlapping(data.as_ptr(), dest, len);
}
```

### Unnecessary Unsafe [7]

```rust
// VIOLATION: Using unsafe when safe alternative exists [7]
unsafe fn get_element(slice: &[u8], index: usize) -> u8 {
    *slice.get_unchecked(index)
}

// CORRECT: Safe indexing with bounds check [7]
fn get_element(slice: &[u8], index: usize) -> Option<u8> {
    slice.get(index).copied()
}
```

---

## Ignoring Results [8][7]

Discarding `Result` values silently swallows errors. Clippy lint `must_use` catches this;
`let _ =` is always a red flag [7][8].

### Discarding Write Errors [8]

```rust
// VIOLATION: Write failure silently ignored — data loss possible [8]
let _ = file.write_all(data);
let _ = file.flush();

// CORRECT: Propagate errors with ? [1, Ch.9]
file.write_all(data)?;
file.flush()?;
```

### Ignoring Lock Poisoning [1, Ch.16]

```rust
// VIOLATION: Silently ignoring poisoned mutex — undefined program state [1, Ch.16]
let guard = mutex.lock().unwrap_or_else(|e| e.into_inner());

// CORRECT: Handle or propagate the poison explicitly [1, Ch.16]
let guard = mutex.lock().map_err(|_| AppError::LockPoisoned)?;
```

---

## Concurrency Violations [1, Ch.16][29]

Rust's `Send` and `Sync` traits prevent data races at compile time. Violations require
`unsafe` to bypass these guarantees [6][29].

### Shared Mutable State Without Synchronization [1, Ch.16]

```rust
// VIOLATION: Data race — undefined behavior under concurrency [1, Ch.16]
static mut COUNTER: u64 = 0;

fn increment() {
    unsafe { COUNTER += 1; } // UB — compiler/CPU may reorder or tear [6]
}

// CORRECT: Use atomics for simple counters [29]
use std::sync::atomic::{AtomicU64, Ordering};
static COUNTER: AtomicU64 = AtomicU64::new(0);

fn increment() {
    COUNTER.fetch_add(1, Ordering::Relaxed);
}
```

### Blocking in Async Context [13]

```rust
// VIOLATION: Blocks the async runtime thread — starves other tasks [13]
async fn read_file(path: &str) -> Result<String, io::Error> {
    std::fs::read_to_string(path) // Blocking syscall in async fn
}

// CORRECT: Use async I/O or spawn_blocking for CPU/blocking work [13]
async fn read_file(path: &str) -> Result<String, io::Error> {
    tokio::fs::read_to_string(path).await
}
```

---

## API Design Violations [2][5]

### Accepting Owned String When Borrow Suffices [2, C-BORROW]

```rust
// VIOLATION: Forces allocation at every call site [2, C-BORROW]
fn print_greeting(name: String) {
    println!("Hello, {}", name);
}

// CORRECT: Accept &str — callers keep ownership; String derefs to &str [2, C-BORROW]
fn print_greeting(name: &str) {
    println!("Hello, {}", name);
}
```

### Missing #[must_use] on Result [7][2]

```rust
// VIOLATION: Result silently discarded — caller gets no warning [7]
pub fn flush_buffer(&mut self) -> Result<(), IoError> { /* ... */ }

// CORRECT: #[must_use] forces callers to handle or explicitly discard [7]
#[must_use]
pub fn flush_buffer(&mut self) -> Result<(), IoError> { /* ... */ }
```
