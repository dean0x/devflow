# Validation Checklist

Comprehensive checklist for code review and validation against core engineering patterns.
All items cite `references/sources.md`.

---

## Pre-Implementation Checklist

Before writing code, verify:

- [ ] Understood the existing patterns in the codebase
- [ ] Identified similar implementations to follow
- [ ] Determined if Result types are used (and will follow same pattern) [1]
- [ ] Identified dependencies that need injection [3]
- [ ] Planned separation of pure logic from side effects [11]

---

## Result Types Checklist [1][5][6]

### Functions That Can Fail [1]

- [ ] All business functions return `Result<T, E>` types [1]
- [ ] No `throw` statements in business logic [1][11]
- [ ] Error types are discriminated unions (not generic Error) [2]
- [ ] Each error type has all context needed to handle it [2]
- [ ] Async functions return `Promise<Result<T, E>>` [1]

### Exception Boundaries [11]

- [ ] Try/catch ONLY at system boundaries (API handlers, DB adapters) [11]
- [ ] Boundaries convert exceptions to Result types [11]
- [ ] HTTP responses derived from Result errors
- [ ] No silent error swallowing (empty catch blocks) [10]

### Error Handling [1]

- [ ] All Result errors are handled explicitly [1]
- [ ] No `if (!result.ok) return;` without proper handling [1]
- [ ] Error propagation preserves context [1]
- [ ] Logging happens before converting errors

---

## Dependency Injection Checklist [3]

### Constructor Injection [3]

- [ ] All dependencies passed through constructor [3]
- [ ] No `new` keyword for dependencies inside classes [3]
- [ ] No imported singletons used directly [3]
- [ ] No static method calls on external services [3]

### Interfaces [3]

- [ ] Dependencies typed as interfaces, not implementations [3]
- [ ] Interfaces are small and focused (Interface Segregation) [3]
- [ ] Mock implementations easy to create [3]
- [ ] No concrete class imports in business logic [3]

### Testing [3]

- [ ] Can instantiate class with mock dependencies [3]
- [ ] No test requires real database/network [3]
- [ ] No environment manipulation in tests
- [ ] Test setup is < 10 lines [3]

---

## Immutability Checklist [7][14]

### Objects [7][14]

- [ ] All updates return new objects (spread operator) [7]
- [ ] No direct property assignment on inputs [14]
- [ ] No `delete` operator on inputs [14]
- [ ] Nested updates also create new objects [7]

### Arrays [14]

- [ ] No `.push()`, `.pop()`, `.shift()`, `.unshift()` [14]
- [ ] No `.splice()`, `.reverse()`, `.sort()` on originals [14]
- [ ] Use `.map()`, `.filter()`, `.reduce()` for transformations [14]
- [ ] Copy before sorting: `[...arr].sort()` [14]

### State [7][14]

- [ ] No module-level `let` or `var` [14]
- [ ] No global mutable state [15]
- [ ] Configuration is frozen after initialization [7]
- [ ] Caches use immutable entries [14]

---

## Pure Functions Checklist [8][11]

### Business Logic [11]

- [ ] Pure functions have no side effects [8]
- [ ] Same input always produces same output [8]
- [ ] No date/time access (inject clock) [8]
- [ ] No random values (inject generator) [8]
- [ ] No environment variable access [11]

### Side Effect Isolation [11]

- [ ] I/O operations in wrapper functions (imperative shell) [11]
- [ ] Pure calculations extracted and tested separately [11]
- [ ] Side effects clearly documented [11]
- [ ] Logging/metrics in wrappers, not core logic [11]

### Dependencies [3][8]

- [ ] Time/random injected as dependencies [8]
- [ ] Environment config loaded once at startup [3]
- [ ] File system access at boundaries only [11]
- [ ] Network calls at boundaries only [11]

---

## Type Safety Checklist [4][2][21][22]

### Strict Types [22]

- [ ] No `any` types (use `unknown` for dynamic data) [22]
- [ ] All function parameters typed [22]
- [ ] All return types explicit [22]
- [ ] Strict null checks enabled [22]

### Pattern Matching [4][21]

- [ ] Switch statements are exhaustive [21]
- [ ] Discriminated unions for state/variants [4]
- [ ] No default case that hides missing patterns [21]
- [ ] Type guards for runtime narrowing [21]

### Type Design [4][2]

- [ ] Domain types prevent primitive obsession [2]
- [ ] Branded types for IDs that shouldn't mix [4]
- [ ] Optional fields explicit (`field?: Type`)
- [ ] Readonly where appropriate [7]

---

## Error Type Design Checklist [1][2]

### Discriminated Unions [2]

- [ ] Each error type has a `type` discriminator [1]
- [ ] Error types include all context needed [2]
- [ ] Related errors grouped in union types [2]
- [ ] Error unions are exhaustive [4]

### Error Information [1][2]

- [ ] Error messages are actionable [1]
- [ ] Technical details preserved for logging [1]
- [ ] User-facing messages are sanitized
- [ ] Error codes are unique and documented [2]

---

## Resource Cleanup Checklist [7]

### File/Connection Handling [7]

- [ ] All file handles closed in `finally` [7]
- [ ] All connections released in `finally` [7]
- [ ] Using context managers (Python) or `using` (TS) [7]
- [ ] Pool resources released after use [7]

### Subscriptions/Timers [7]

- [ ] Event listeners removed on cleanup [7]
- [ ] Intervals cleared when done [7]
- [ ] Timeouts cleared if operation completes early [7]
- [ ] Subscription manager for complex lifecycles [7]

### Memory [7][15]

- [ ] Large data structures released when done [7]
- [ ] Caches have size limits or TTL [15]
- [ ] Circular references avoided [7]
- [ ] WeakMap/WeakSet for object keys [7]

---

## API Consistency Checklist [1][3]

### Error Handling Pattern [1]

- [ ] Same error handling pattern across module [1]
- [ ] All methods return Result OR all throw (not mixed) [1]
- [ ] Error types consistent across related methods [1]
- [ ] HTTP error mapping centralized [11]

### Async Pattern [3]

- [ ] Single async pattern (async/await preferred) [3]
- [ ] No mixing callbacks and promises [3]
- [ ] All async calls awaited (no fire-and-forget) [10]
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
- [ ] Non-obvious decisions documented [13]
- [ ] Architecture boundaries marked

### Exceptions/Workarounds

- [ ] All workarounds labeled (HACK:, TODO:, TEMPORARY:)
- [ ] Architecture exceptions have justification
- [ ] Technical debt has tracking ticket
- [ ] Deadlines on temporary solutions

---

## Anti-Pattern Checklist [1][3][7][14]

Verify NONE of these exist:

- [ ] No hardcoded responses simulating functionality
- [ ] No silent error swallowing [10]
- [ ] No unlabeled magic values [9]
- [ ] No global mutable state [14][15]
- [ ] No tight coupling to concrete implementations [3]
- [ ] No mixing error handling patterns [1]
- [ ] No fire-and-forget async calls [10]
- [ ] No resource leaks [7]

---

## Final Review Checklist

Before considering code complete:

- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Code matches existing patterns
- [ ] Documentation updated
- [ ] No TODO without ticket
- [ ] No console.log in production code [11]
- [ ] No commented-out code
