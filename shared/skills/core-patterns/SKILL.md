---
name: core-patterns
description: This skill should be used when the user asks to "handle errors", "inject dependencies", "return Result", "make it immutable", "compose with pipes", or implements business logic, error handling, or service composition. Provides Result type patterns, dependency injection, immutability by default, pipe composition, and structured logging for robust application architecture.
user-invocable: false
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Core Engineering Patterns

The canonical source of architectural patterns and principles for consistent, high-quality code.

## Iron Law

> **NEVER THROW IN BUSINESS LOGIC**
>
> All operations that can fail MUST return Result types. Exceptions are allowed
> ONLY at system boundaries (API handlers, database adapters). Any `throw` statement
> in business logic is a violation. No exceptions.

## Philosophy

1. **Type Safety First** - Strict type checking, avoid dynamic types
2. **Functional Core, Imperative Shell** - Business logic pure, side effects isolated
3. **Explicit Error Handling** - Result types instead of exceptions
4. **Immutability by Default** - Return new objects, don't mutate
5. **Dependency Injection** - Inject dependencies for testability
6. **Test Behaviors** - Simple tests that validate behavior, not implementation
7. **No Fake Solutions** - Be honest about limitations and workarounds
8. **Fix Root Causes** - Never work around bad architecture

---

## Pattern 1: Result Types

```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

function createUser(data: unknown): Result<User, ValidationError> {
  if (!valid(data)) return Err({ type: 'ValidationFailed', details: validate(data).errors });
  return Ok(buildUser(data));
}
```

## Pattern 2: Dependency Injection

```typescript
class UserService {
  constructor(private db: Database, private emailer: EmailService) {}
}
// Easy to test: new UserService(mockDb, mockEmailer)
```

Never: `private db = new Database()` - can't mock.

## Pattern 3: Immutability

```typescript
function updateUser(user: User, changes: Partial<User>): User {
  return { ...user, ...changes };  // New object, no mutation
}
```

Never mutate inputs. Copy before `.sort()`.

## Pattern 4: Pure Functions

```typescript
function calculateTotal(items: Item[], taxRate: number): number {
  return items.reduce((sum, i) => sum + i.price, 0) * (1 + taxRate);
}
```

No side effects in pure functions.

## Pattern 5: Type Safety

```typescript
type Status = 'pending' | 'completed' | 'failed';
function handleStatus(status: Status): string {
  switch (status) {
    case 'pending': return 'Waiting';
    case 'completed': return 'Done';
    case 'failed': return 'Error';
  }  // Exhaustive - no default needed
}
```

## Pattern 6: Error Type Design

```typescript
type UserError =
  | { type: 'NotFound'; userId: string }
  | { type: 'ValidationFailed'; field: string; message: string };
```

## Pattern 7: Resource Cleanup

```typescript
const handle = await fs.open(path);
try {
  return Ok(parse(await handle.readFile()));
} finally {
  await handle.close();
}
```

## Pattern 8: Architecture Documentation

```typescript
// ARCHITECTURE: Repository returns domain objects only
// ARCHITECTURE EXCEPTION: Direct DB for health check - must work if service layer down
```

## Pattern 9: Naming Conventions

- **Types/Classes**: PascalCase (`UserProfile`)
- **Functions/Variables**: camelCase (`calculateTotal`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_RETRY`)

## Pattern 10: Performance Awareness

```typescript
const customerMap = new Map(customers.map(c => [c.id, c]));  // O(1) vs O(n)
```

---

## Consistency Rules

- Result types: if one method returns Result, ALL must
- DI: apply consistently throughout
- Async: single pattern (don't mix callbacks/promises)

## Anti-Patterns

| Pattern | Description |
|---------|-------------|
| Fake Solutions | Hardcoded responses simulating functionality |
| Silent Failures | Catch blocks that swallow errors |
| Magic Values | Unlabeled constants with special meaning |
| Deceptive Code | Functions that pretend to work (e.g., `return true` with no logic) |

### Workaround Labeling (Required)

All workarounds, hacks, and temporary solutions MUST be labeled:

| Label | Use When |
|-------|----------|
| `HACK:` | Workaround for specific problem |
| `MOCK:` | Fake data for testing/development |
| `TODO:` | Work that needs to be done |
| `TEMPORARY:` | Short-term solution with deadline |
| `NOT-PRODUCTION:` | Code that should never ship |
| `ARCHITECTURE EXCEPTION:` | Violates pattern with justification |

Unlabeled workarounds, empty catch blocks, and early returns without rationale are violations. See `references/code-smell-violations.md` for extended examples.

---

## Extended References

See `references/` for: violations.md, patterns.md, detection.md, checklist.md
