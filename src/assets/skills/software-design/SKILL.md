---
name: software-design
description: This skill should be used when the user asks to "handle errors", "inject dependencies", "return Result", "make it immutable", or implements business logic or error handling.
user-invocable: false
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Core Engineering Patterns

The canonical source of architectural patterns and principles for consistent, high-quality code.

## Iron Law

> **Never throw in business logic**
>
> Every operation that can fail must return a Result type. Exceptions are allowed
> only at system boundaries (API handlers, database adapters). A `throw` statement
> in business logic is a violation.

## Philosophy

1. **Functional Core, Imperative Shell** — Pure business logic, side effects at boundary
2. **Explicit Error Handling** — Result types, no exceptions in business logic
3. **Immutability by Default** — Return new objects, never mutate
4. **Dependency Injection** — All deps injected, nothing instantiated internally
5. **Make Illegal States Unrepresentable** — Types enforce invariants at compile time; discriminated unions with exhaustive switches
6. **Parse, Don't Validate** — Schema transforms at boundaries
7. **Compose with pipes**, and clean up resources in `finally`

`references/patterns.md` shows each pattern in code.

## Consistency Rules

- Result types: if one method returns Result, all must
- DI: apply consistently throughout
- Async: single pattern (don't mix callbacks/promises)

## Anti-Patterns

- Throwing in business logic — use Result
- Silent failures — swallowed catch blocks
- Mutable state — return new objects
- Service locator — inject instead

### Workaround Labeling (Required)

`HACK:` `MOCK:` `TODO:` `TEMPORARY:` `NOT-PRODUCTION:` `ARCHITECTURE EXCEPTION:`

Unlabeled workarounds are violations. See `references/code-smell-violations.md`.

## Extended References

- `references/sources.md` — Full bibliography (25 sources with access links)
- `references/violations.md` — Violation patterns with citations
- `references/patterns.md` — The core patterns and extended correct patterns, with citations
- `references/checklist.md` — Pre-implementation and review checklists
- `references/code-smell-violations.md` — Fake solutions, deceptive code, magic values
- `references/detection.md` — Grep patterns for automated detection
