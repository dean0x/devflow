---
name: architecture
description: This skill should be used when reviewing code for SOLID or layering issues.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Architecture Patterns

Detection patterns for architecture and design review.

## Iron Law

> **Separation of concerns is non-negotiable.**
>
> Every module has one reason to change. Every layer has clear boundaries. Every dependency
> points in one direction. Decompose by information hiding, not by task (Parnas, 1972).
> Violations compound into unmaintainable systems.

## SOLID Violations

- **SRP**: one class, one reason to change. Violation: UserController handles HTTP, validation, DB and email. Fix: inject UserService and UserValidator.
- **OCP**: extend without modifying. Violation: `if (type === 'credit') ... else if (type === 'paypal')`. Fix: strategy pattern, a new payment is a new class.
- **LSP**: subtypes must be substitutable and cannot strengthen preconditions. A subclass that throws where the parent does not (`ReadOnlyStorage.write()` throws) is a violation. Fix: segregated interfaces (Readable, Writable).
- **ISP**: no forced unused implementations (`interface Worker { work(); eat(); sleep(); }` forces a Robot to implement `eat()`). Fix: split the interface.
- **DIP**: depend on abstractions. Violation: `private db = new PostgresDatabase()` in a service. Fix: constructor injection of a repository interface.

## Coupling Issues

- **Tight coupling**: direct instantiation (`new DatabaseService()` inside a method), the tightest coupling form. It cannot be mocked or swapped. Inject through the constructor.
- **Circular dependencies**: A imports B, B imports A. Extract the shared concern or use events.
- **Feature envy / Law of Demeter**: `order.customer.profile.contact.email` knows too much. Behavior belongs to the data owner (`order.getTotal()`).

## Layering Violations

Dependency Rule (Clean Architecture): source dependencies point inward only.

- **Skipping layers**: a controller queries the database directly. Go Controller → Service → Repository.
- **Leaky abstractions**: infrastructure details in the domain (`_mongoId`, `__v` on a domain `User`). Map them in the repository.
- **Wrong direction**: the domain imports infrastructure. Ports (Hexagonal Architecture) define what the core needs; adapters implement them.

## Modularity Issues

- **Deep vs shallow modules**: a deep module has a simple interface over a rich implementation. A shallow module exposes more complexity than it hides.
- **God class**: split into bounded contexts. Signs: 500+ lines, `*Manager`, `*Processor`, 7+ constructor parameters.
- **Inappropriate intimacy**: `a.b().c()` chains. Tell, don't ask.

## Severity Guidelines

| Severity | Examples |
|----------|----------|
| **CRITICAL** | Circular dependencies, domain depends on infrastructure, god class 1000+ lines |
| **HIGH** | SOLID violations in core logic, tight coupling between services, leaky abstractions |
| **MEDIUM** | Dependencies not injected, minor layering violations, missing interfaces |
| **LOW** | Naming issues, minor organization, missing architecture docs |

## Extended References

- `references/sources.md` — Full bibliography (25 sources)
- `references/patterns.md` — Extended correct patterns
- `references/violations.md` — Extended violations
- `references/detection.md` — Grep patterns and bash commands for automated detection
