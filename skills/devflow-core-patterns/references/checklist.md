# Validation Checklist

Comprehensive checklist for code review and validation against core engineering patterns.

---

## Pre-Implementation Checklist

Before writing code, verify:

- [ ] Understood the existing patterns in the codebase
- [ ] Identified similar implementations to follow
- [ ] Determined if Result types are used (and will follow same pattern)
- [ ] Identified dependencies that need injection
- [ ] Planned separation of pure logic from side effects

---

## Result Types Checklist

### Functions That Can Fail

- [ ] All business functions return `Result<T, E>` types
- [ ] No `throw` statements in business logic
- [ ] Error types are discriminated unions (not generic Error)
- [ ] Each error type has all context needed to handle it
- [ ] Async functions return `Promise<Result<T, E>>`

### Exception Boundaries

- [ ] Try/catch ONLY at system boundaries (API handlers, DB adapters)
- [ ] Boundaries convert exceptions to Result types
- [ ] HTTP responses derived from Result errors
- [ ] No silent error swallowing (empty catch blocks)

### Error Handling

- [ ] All Result errors are handled explicitly
- [ ] No `if (!result.ok) return;` without proper handling
- [ ] Error propagation preserves context
- [ ] Logging happens before converting errors

---

## Dependency Injection Checklist

### Constructor Injection

- [ ] All dependencies passed through constructor
- [ ] No `new` keyword for dependencies inside classes
- [ ] No imported singletons used directly
- [ ] No static method calls on external services

### Interfaces

- [ ] Dependencies typed as interfaces, not implementations
- [ ] Interfaces are small and focused (ISP)
- [ ] Mock implementations easy to create
- [ ] No concrete class imports in business logic

### Testing

- [ ] Can instantiate class with mock dependencies
- [ ] No test requires real database/network
- [ ] No environment manipulation in tests
- [ ] Test setup is < 10 lines

---

## Immutability Checklist

### Objects

- [ ] All updates return new objects (spread operator)
- [ ] No direct property assignment on inputs
- [ ] No `delete` operator on inputs
- [ ] Nested updates also create new objects

### Arrays

- [ ] No `.push()`, `.pop()`, `.shift()`, `.unshift()`
- [ ] No `.splice()`, `.reverse()`, `.sort()` on originals
- [ ] Use `.map()`, `.filter()`, `.reduce()` for transformations
- [ ] Copy before sorting: `[...arr].sort()`

### State

- [ ] No module-level `let` or `var`
- [ ] No global mutable state
- [ ] Configuration is frozen after initialization
- [ ] Caches use immutable entries

---

## Pure Functions Checklist

### Business Logic

- [ ] Pure functions have no side effects
- [ ] Same input always produces same output
- [ ] No date/time access (inject clock)
- [ ] No random values (inject generator)
- [ ] No environment variable access

### Side Effect Isolation

- [ ] I/O operations in wrapper functions
- [ ] Pure calculations extracted and tested separately
- [ ] Side effects clearly documented
- [ ] Logging/metrics in wrappers, not core logic

### Dependencies

- [ ] Time/random injected as dependencies
- [ ] Environment config loaded once at startup
- [ ] File system access at boundaries only
- [ ] Network calls at boundaries only

---

## Type Safety Checklist

### Strict Types

- [ ] No `any` types (use `unknown` for dynamic data)
- [ ] All function parameters typed
- [ ] All return types explicit
- [ ] Strict null checks enabled

### Pattern Matching

- [ ] Switch statements are exhaustive
- [ ] Discriminated unions for state/variants
- [ ] No default case that hides missing patterns
- [ ] Type guards for runtime narrowing

### Type Design

- [ ] Domain types prevent primitive obsession
- [ ] Branded types for IDs that shouldn't mix
- [ ] Optional fields explicit (`field?: Type`)
- [ ] Readonly where appropriate

---

## Error Type Design Checklist

### Discriminated Unions

- [ ] Each error type has a `type` discriminator
- [ ] Error types include all context needed
- [ ] Related errors grouped in union types
- [ ] Error unions are exhaustive

### Error Information

- [ ] Error messages are actionable
- [ ] Technical details preserved for logging
- [ ] User-facing messages are sanitized
- [ ] Error codes are unique and documented

---

## Resource Cleanup Checklist

### File/Connection Handling

- [ ] All file handles closed in `finally`
- [ ] All connections released in `finally`
- [ ] Using context managers (Python) or `using` (TS)
- [ ] Pool resources released after use

### Subscriptions/Timers

- [ ] Event listeners removed on cleanup
- [ ] Intervals cleared when done
- [ ] Timeouts cleared if operation completes early
- [ ] Subscription manager for complex lifecycles

### Memory

- [ ] Large data structures released when done
- [ ] Caches have size limits or TTL
- [ ] Circular references avoided
- [ ] WeakMap/WeakSet for object keys

---

## API Consistency Checklist

### Error Handling Pattern

- [ ] Same error handling pattern across module
- [ ] All methods return Result OR all throw (not mixed)
- [ ] Error types consistent across related methods
- [ ] HTTP error mapping centralized

### Async Pattern

- [ ] Single async pattern (async/await preferred)
- [ ] No mixing callbacks and promises
- [ ] All async calls awaited (no fire-and-forget)
- [ ] Promise.all for parallel operations

### Naming

- [ ] Consistent naming across codebase
- [ ] PascalCase for types/classes
- [ ] camelCase for functions/variables
- [ ] SCREAMING_SNAKE_CASE for constants

---

## Architecture Documentation Checklist

### Code Comments

- [ ] Public APIs have JSDoc/docstrings
- [ ] Complex algorithms explained
- [ ] Non-obvious decisions documented
- [ ] Architecture boundaries marked

### Exceptions/Workarounds

- [ ] All workarounds labeled (HACK:, TODO:, TEMPORARY:)
- [ ] Architecture exceptions have justification
- [ ] Technical debt has tracking ticket
- [ ] Deadlines on temporary solutions

---

## Performance Checklist

### Measurement

- [ ] Performance claims have benchmarks
- [ ] Hot paths identified and measured
- [ ] No premature optimization
- [ ] Trade-offs documented

### Common Issues

- [ ] No N+1 queries
- [ ] Appropriate data structures (Map vs Array)
- [ ] Lazy evaluation for expensive operations
- [ ] Batch operations where possible

---

## Anti-Pattern Checklist

Verify NONE of these exist:

- [ ] No hardcoded responses simulating functionality
- [ ] No silent error swallowing
- [ ] No unlabeled magic values
- [ ] No global mutable state
- [ ] No tight coupling to concrete implementations
- [ ] No mixing error handling patterns
- [ ] No fire-and-forget async calls
- [ ] No resource leaks

---

## Final Review Checklist

Before considering code complete:

- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Code matches existing patterns
- [ ] Documentation updated
- [ ] No TODO without ticket
- [ ] No console.log in production code
- [ ] No commented-out code
