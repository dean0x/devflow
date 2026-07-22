# Rust Detection Patterns

Grep and regex patterns for finding common Rust issues. Use with `Grep` tool.

## Unwrap and Expect

```bash
# Find .unwrap() calls (exclude tests)
grep -rn '\.unwrap()' --include='*.rs' --exclude-dir=tests --exclude='*_test.rs'

# Find .expect() without descriptive message
grep -rn '\.expect("")' --include='*.rs'

# Find unwrap_or_default hiding errors
grep -rn '\.unwrap_or_default()' --include='*.rs'
```

**Pattern**: `\.unwrap\(\)` — matches any `.unwrap()` call
**Pattern**: `\.expect\("` — matches `.expect("` to review message quality

---

## Clone Abuse

```bash
# Find .clone() calls — review each for necessity
grep -rn '\.clone()' --include='*.rs'

# Find clone in loop bodies (likely hot-path waste)
grep -rn -A2 'for.*in' --include='*.rs' | grep '\.clone()'

# Find to_string() where &str would work
grep -rn '\.to_string()' --include='*.rs'
```

**Pattern**: `\.clone\(\)` — all clone calls for manual review
**Pattern**: `\.to_owned\(\)` — ownership transfer that may be unnecessary

---

## Unsafe Blocks

```bash
# Find all unsafe blocks
grep -rn 'unsafe\s*{' --include='*.rs'

# Find unsafe without SAFETY comment
grep -rn -B2 'unsafe\s*{' --include='*.rs' | grep -v 'SAFETY'

# Find unsafe functions
grep -rn 'unsafe fn' --include='*.rs'
```

**Pattern**: `unsafe\s*\{` — unsafe blocks
**Pattern**: `unsafe fn` — unsafe function declarations

---

## Incomplete Code

```bash
# Find todo! and unimplemented! macros
grep -rn 'todo!\|unimplemented!' --include='*.rs'

# Find unreachable! that may hide bugs
grep -rn 'unreachable!' --include='*.rs'

# Find panic! in non-test code
grep -rn 'panic!' --include='*.rs' --exclude-dir=tests --exclude='*_test.rs'
```

**Pattern**: `todo!\(\)` — placeholder code
**Pattern**: `unimplemented!\(\)` — unfinished implementations
**Pattern**: `panic!\(` — explicit panics outside tests

---

## Error Handling Issues

```bash
# Find ignored Results (let _ = expr that returns Result)
grep -rn 'let _ =' --include='*.rs'

# Find empty match arms that may swallow errors
grep -rn '=> {}' --include='*.rs'

# Find catch-all match arms hiding missing cases
grep -rn '_ =>' --include='*.rs'
```

**Pattern**: `let _ =` — potentially ignored Result or important value
**Pattern**: `=> \{\}` — empty match arm (may swallow error)

---

## Concurrency Red Flags

```bash
# Find static mut (almost always wrong)
grep -rn 'static mut' --include='*.rs'

# Find blocking calls in async functions
grep -rn 'std::fs::' --include='*.rs' | grep -v 'test'
grep -rn 'std::thread::sleep' --include='*.rs'

# Find Mutex without Arc in multi-threaded context
grep -rn 'Mutex::new' --include='*.rs'
```

**Pattern**: `static mut` — mutable global state (data race risk)
**Pattern**: `std::fs::` — blocking I/O that may appear in async context
**Pattern**: `std::thread::sleep` — blocking sleep (use `tokio::time::sleep` in async)

---

## Clippy Lints

Run Clippy for automated detection of many patterns above:

```bash
cargo clippy -- -D warnings
cargo clippy -- -W clippy::pedantic
cargo clippy -- -W clippy::nursery
```

Key Clippy lints that catch issues:
- `clippy::unwrap_used` — flags unwrap calls
- `clippy::clone_on_ref_ptr` — unnecessary Arc/Rc clone
- `clippy::needless_pass_by_value` — should borrow instead
- `clippy::missing_errors_doc` — public Result fn without doc
- `clippy::wildcard_enum_match_arm` — catch-all hiding cases
