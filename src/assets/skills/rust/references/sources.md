# Rust — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | "The Rust Programming Language" (The Book) | Klabnik & Nichols | 2023 | [Free](https://doc.rust-lang.org/book/) | Ownership, borrowing, lifetimes, traits, error handling, concurrency |
| 2 | Rust API Guidelines | Rust Team | 2024 | [Free](https://rust-lang.github.io/api-guidelines/) | C-NEWTYPE, C-BUILDER, C-BORROW, C-VALIDATE, naming, docs |
| 3 | The Rustonomicon | Rust Team | 2024 | [Free](https://doc.rust-lang.org/nomicon/) | Unsafe Rust, memory layout, FFI, aliasing rules |
| 4 | "Rust Design Patterns" | Rust Community | 2024 | [Free](https://rust-unofficial.github.io/patterns/) | Builder, newtype, RAII, typestate, strategy patterns |
| 5 | "Effective Rust" | David Drysdale | 2024 | [Free](https://effective-rust.com) | 35 items for idiomatic Rust, API design, error handling |
| 6 | "RustBelt: Securing the Foundations of the Rust Programming Language" | Jung et al. | 2018 | [Free](https://plv.mpi-sws.org/rustbelt/) | Formal verification of Rust type system and ownership semantics |
| 7 | Clippy Lint Documentation | Rust Team | 2024 | [Free](https://rust-lang.github.io/rust-clippy/) | 700+ lints, idiomatic Rust enforcement |
| 8 | "Error Handling in Rust" | Andrew Gallant (BurntSushi) | 2015 | [Free](https://blog.burntsushi.net/rust-error-handling/) | Error handling philosophy, trait objects vs enums, composition |
| 9 | thiserror / anyhow documentation | David Tolnay | 2024 | [Free](https://docs.rs/thiserror) | Error type design, library vs application error strategy |
| 10 | "Rust for Rustaceans" | Jon Gjengset | 2021 | Purchase | Advanced patterns, unsafe, macros, API design |
| 11 | "Stacked Borrows: An Aliasing Model for Rust" | Ralf Jung | 2019 | [Free](https://plv.mpi-sws.org/stacked-borrows/) | Aliasing model formalization, unsafe code correctness |
| 12 | serde Documentation | David Tolnay | 2024 | [Free](https://serde.rs) | Serialization framework, derive macros, custom implementations |
| 13 | tokio Documentation | Tokio Team | 2024 | [Free](https://tokio.rs) | Async runtime, task spawning, channels, spawn_blocking |
| 14 | Rust Reference | Rust Team | 2024 | [Free](https://doc.rust-lang.org/reference/) | Language specification, type system rules, unsafe operations |
| 15 | "Making Illegal States Unrepresentable" | Yaron Minsky (adapted for Rust) | 2011 | [Free](https://blog.janestreet.com/effective-ml-video/) | Type-driven design, eliminating invalid states at compile time |
| 16 | "Choosing an Error Library" (talk) | Jane Lusby (yaahc) | 2020 | [Free](https://www.youtube.com/watch?v=rAF8mLI0naQ) | Error handling ecosystem, thiserror vs anyhow vs error-stack |
| 17 | Rust Performance Book | Nicholas Nethercote | 2024 | [Free](https://nnethercote.github.io/perf-book/) | Optimization patterns, profiling, heap allocation reduction |
| 18 | "Zero-cost abstractions" | Rust Blog | 2015 | [Free](https://blog.rust-lang.org/2015/05/11/traits.html) | Core design principle: monomorphization, trait dispatch |
| 19 | Rust Edition Guide | Rust Team | 2024 | [Free](https://doc.rust-lang.org/edition-guide/) | Edition migration patterns, compatibility guarantees |
| 20 | "Abstraction without overhead: traits in Rust" | Aaron Turon | 2015 | [Free](https://blog.rust-lang.org/2015/05/11/traits.html) | Trait design philosophy, static vs dynamic dispatch |

## Standards & Style Guides

| # | Source | Org | Access | Topics |
|---|--------|-----|--------|--------|
| 21 | Rust API Guidelines — Naming (C-CASE) | Rust Team | [Free](https://rust-lang.github.io/api-guidelines/naming.html) | Casing, affixes, method naming conventions |
| 22 | Rust API Guidelines — Type Safety (C-NEWTYPE) | Rust Team | [Free](https://rust-lang.github.io/api-guidelines/type-safety.html) | Newtype wrappers, type-safe distinctions |
| 23 | Rust API Guidelines — Flexibility (C-BORROW) | Rust Team | [Free](https://rust-lang.github.io/api-guidelines/flexibility.html) | Borrow vs own, generic inputs, C-CALLER-CONTROL |
| 24 | Rust API Guidelines — Builder (C-BUILDER) | Rust Team | [Free](https://rust-lang.github.io/api-guidelines/type-safety.html) | Builder pattern requirements, consuming vs non-consuming |
| 25 | Rust API Guidelines — Validation (C-VALIDATE) | Rust Team | [Free](https://rust-lang.github.io/api-guidelines/dependability.html) | Constructor validation, error types for invalid input |

## Academic & Research

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 26 | "Ownership Types for Safe Programming" | Clarke et al. | 2013 | Free | Ownership type theory: formal foundation for Rust's model |
| 27 | "Typestate-Oriented Programming" | Aldrich et al. | 2009 | [Free](https://www.cs.cmu.edu/~aldrich/papers/onward2009-state.pdf) | Typestate pattern — encoding protocol states in types |
| 28 | "A Formalization of Rust's Type System" | Benitez | 2016 | Free | Formal type-theoretic treatment of lifetimes and borrowing |
| 29 | "Fearless Concurrency with Rust" | Aaron Turon | 2015 | [Free](https://blog.rust-lang.org/2015/04/10/Fearless-Concurrency.html) | Send/Sync traits, data race prevention at compile time |
| 30 | "Linear Types Can Change the World!" | Wadler | 1990 | Free | Linear type theory — conceptual foundation for Rust's ownership |
