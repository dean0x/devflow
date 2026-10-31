---
name: patterns
description: This skill should be used when the user asks to "create an API endpoint", "add CRUD operations", "implement event handlers", "set up logging", or adds database operations, REST/GraphQL APIs, pub/sub.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Implementation Patterns

Reference for common implementation patterns.

## Iron Law

> **FOLLOW EXISTING PATTERNS**
>
> Match the codebase style, don't invent new conventions. If the project uses Result types,
> use Result types. If it uses exceptions, use exceptions. Consistency trumps personal
> preference. The best pattern is the one already in use.

## Pattern Categories

### CRUD Operations

**Core pattern**: Validate -> Transform -> Persist -> Return

Return `Result<T, E>`: a failed validation returns a `validation` error, a failed save a `persistence` error, and success returns the saved value.

### API Endpoints

**Core pattern**: Parse request -> Validate auth -> Execute -> Format response

A bad parameter returns 400 and a failed authentication 401 before any work runs. Map a domain error to its status in one handler, and return the success value as JSON.

### Event Handlers

**Core pattern**: Validate event -> Process -> Handle errors -> Acknowledge

Make each handler idempotent, so a redelivered event does no harm. Log an invalid event as a warning and drop it; do not throw.

### Configuration

**Core pattern**: Define schema -> Load from env -> Validate -> Export frozen

Parse `process.env` once at startup through a schema (coerced types, defaults, required URLs), fail fast on an error, and export the result with `Object.freeze`.

### Logging

**Core pattern**: Context -> Level -> Message -> Data

Create the logger with request context (`requestId`, `userId`), and log a message with structured data (`{ orderId, items }`).

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| God functions | 500-line functions doing everything | Compose small, focused functions |
| Implicit dependencies | Using global state (`db.query(...)`) | Inject dependencies explicitly |
| Swallowing errors | Empty catch blocks | Handle or propagate with Result types |
| Magic values | Unexplained numbers/strings | Extract to named constants |

## Build Optimization

Production builds must exclude test files, debug artifacts, and sourcemaps (for example `"exclude": ["**/*.test.ts", "**/*.spec.ts", "**/tests/**"]` in `tsconfig.prod.json`).

## Implementation Checklist

Before implementing, verify:

- [ ] Handling all error cases explicitly
- [ ] Using transactions for multi-step operations
- [ ] No hardcoded values (use config)
- [ ] Input validated at system boundaries; operations idempotent where possible

## Extended References

- `references/violations.md` - Extended violation examples (CRUD, API, Events, Config, Logging)
- `references/patterns.md` - Extended correct patterns (CRUD, API, Events, Config, Logging)
