# Rust Violation Examples

Extended violation patterns for Rust reviews. Reference from main SKILL.md.

## Unwrap Abuse

### Unwrap in Library Code

```rust
// VIOLATION: Panics on None — caller has no way to handle failure
pub fn get_username(users: &HashMap<u64, String>, id: u64) -> &str {
    users.get(&id).unwrap() // Panics if id not found
}

// VIOLATION: Unwrap on parse without context
let port: u16 = std::env::var("PORT").unwrap().parse().unwrap();
```

### Expect Without Useful Message

```rust
// VIOLATION: Message doesn't help diagnose the problem
let config = load_config().expect("failed");

// CORRECT: Actionable message
let config = load_config().expect("failed to load config from config.toml — does file exist?");
```

---

## Unnecessary Cloning

### Clone to Satisfy Borrow Checker

```rust
// VIOLATION: Cloning to work around borrow issues
fn process_items(items: &Vec<Item>) {
    let cloned = items.clone(); // Entire Vec cloned
    for item in &cloned {
        println!("{}", item.name);
    }
}

// CORRECT: Just borrow
fn process_items(items: &[Item]) {
    for item in items {
        println!("{}", item.name);
    }
}
```

### Clone in Hot Loop

```rust
// VIOLATION: Allocating on every iteration
for record in &records {
    let key = record.id.clone(); // String allocation per iteration
    map.insert(key, record);
}

// CORRECT: Borrow or use references
for record in &records {
    map.insert(&record.id, record);
}
```

---

## Stringly-Typed APIs

### String Where Enum Belongs

```rust
// VIOLATION: Any typo compiles and fails at runtime
fn set_status(status: &str) {
    match status {
        "active" => { /* ... */ }
        "inactive" => { /* ... */ }
        _ => panic!("unknown status"), // Runtime failure
    }
}

// CORRECT: Compiler enforces valid values
enum Status { Active, Inactive }

fn set_status(status: Status) {
    match status {
        Status::Active => { /* ... */ }
        Status::Inactive => { /* ... */ }
    } // Exhaustive — no default needed
}
```

---

## Unsafe Without Justification

### Bare Unsafe Block

```rust
// VIOLATION: No safety comment explaining invariants
unsafe {
    let ptr = data.as_ptr();
    std::ptr::copy_nonoverlapping(ptr, dest, len);
}

// CORRECT: Document why this is safe
// SAFETY: `data` is guaranteed to be valid for `len` bytes because
// it was allocated by `Vec::with_capacity(len)` and filled by `read_exact`.
// `dest` is a valid pointer from `alloc::alloc(layout)` with matching size.
unsafe {
    std::ptr::copy_nonoverlapping(data.as_ptr(), dest, len);
}
```

### Unnecessary Unsafe

```rust
// VIOLATION: Using unsafe when safe alternative exists
unsafe fn get_element(slice: &[u8], index: usize) -> u8 {
    *slice.get_unchecked(index)
}

// CORRECT: Safe indexing with bounds check
fn get_element(slice: &[u8], index: usize) -> Option<u8> {
    slice.get(index).copied()
}
```

---

## Ignoring Results

### Discarding Write Errors

```rust
// VIOLATION: Write failure silently ignored
let _ = file.write_all(data);
let _ = file.flush();

// CORRECT: Propagate errors
file.write_all(data)?;
file.flush()?;
```

### Ignoring Lock Poisoning

```rust
// VIOLATION: Silently ignoring poisoned mutex
let guard = mutex.lock().unwrap_or_else(|e| e.into_inner());

// CORRECT: Handle or propagate the poison
let guard = mutex.lock().map_err(|_| AppError::LockPoisoned)?;
```

---

## Concurrency Violations

### Shared Mutable State Without Synchronization

```rust
// VIOLATION: Data race potential — no synchronization
static mut COUNTER: u64 = 0;

fn increment() {
    unsafe { COUNTER += 1; } // Undefined behavior under concurrency
}

// CORRECT: Use atomic or mutex
use std::sync::atomic::{AtomicU64, Ordering};
static COUNTER: AtomicU64 = AtomicU64::new(0);

fn increment() {
    COUNTER.fetch_add(1, Ordering::Relaxed);
}
```

### Blocking in Async Context

```rust
// VIOLATION: Blocks the async runtime thread
async fn read_file(path: &str) -> Result<String, io::Error> {
    std::fs::read_to_string(path) // Blocking call in async fn
}

// CORRECT: Use async file I/O or spawn_blocking
async fn read_file(path: &str) -> Result<String, io::Error> {
    tokio::fs::read_to_string(path).await
}
```
