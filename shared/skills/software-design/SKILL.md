---
name: software-design
description: This skill should be used when the user asks to "handle errors", "inject dependencies", "return Result", "make it immutable", "compose with pipes", or implements business logic, error handling, or service composition. Provides Result type patterns, dependency injection, immutability by default, pipe composition, and structured logging for robust application architecture.
user-invocable: false
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Core Engineering Patterns

The canonical source of architectural patterns and principles for consistent, high-quality code.

## Iron Law

> **NEVER THROW IN BUSINESS LOGIC** [1][11]
>
> All operations that can fail MUST return Result types. Exceptions are allowed
> ONLY at system boundaries (API handlers, database adapters). Any `throw` statement
> in business logic is a violation. No exceptions.

## Philosophy

1. **Functional Core, Imperative Shell** [11] — Pure business logic, side effects at boundary
2. **Explicit Error Handling** [1][8] — Result types, no exceptions in business logic
3. **Immutability by Default** [7][14] — Return new objects, never mutate
4. **Dependency Injection** [3] — All deps injected, nothing instantiated internally
5. **Make Illegal States Unrepresentable** [4][2] — Types enforce invariants at compile time
6. **Parse, Don't Validate** [12] — Schema transforms at boundaries

---

## Pattern 1: Result Types [1][5][6][18]

```typescript
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

function createUser(data: unknown): Result<User, ValidationError> {
  if (!valid(data)) return Err({ type: 'ValidationFailed', details: validate(data).errors });
  return Ok(buildUser(data));
}
// Libraries: neverthrow [18], ts-results [19]. Theory: Moggi [5] + Wadler [6].
```

## Pattern 2: Dependency Injection [3]

```typescript
class UserService {
  constructor(private db: Database, private emailer: EmailService) {}
  // Test: new UserService(mockDb, mockEmailer) — never new Database() inside [3]
}
```

## Pattern 3: Immutability [7][14]

```typescript
// New object, never mutate input; copy before .sort() [7][14]
function updateUser(user: User, changes: Partial<User>): User {
  return { ...user, ...changes };
}
```

## Pattern 4: Functional Core, Imperative Shell [11]

```typescript
// PURE CORE: no I/O, deterministic [11]
function calculateTotal(items: Item[], taxRate: number): number {
  return items.reduce((sum, i) => sum + i.price, 0) * (1 + taxRate);
}
// IMPERATIVE SHELL: I/O at boundary only [11]
async function processOrder(id: string): Promise<Result<Order, Error>> {
  const order = await db.getOrder(id);
  return Ok(await db.save({ ...order, total: calculateTotal(order.items, 0.1) }));
}
```

## Pattern 5: Type Safety [4][2][21]

```typescript
// Discriminated unions — compiler enforces exhaustiveness [4][21]
type UserError =
  | { type: 'NotFound'; userId: string }           // carries full context [2]
  | { type: 'ValidationFailed'; field: string; message: string };

type Status = 'pending' | 'completed' | 'failed';
function handleStatus(status: Status): string {
  switch (status) {
    case 'pending': return 'Waiting';
    case 'completed': return 'Done';
    case 'failed': return 'Error';
  }  // Exhaustive — no default needed [21]
}
```

## Pattern 6: Pipe Composition [20][13]

```typescript
const pipe = <T>(...fns: Array<(x: T) => T>) => (x: T) => fns.reduce((v, f) => f(v), x);
const process = pipe(validate, normalize, enrich); // Composition as glue [20][13]
```

## Pattern 7: Resource Cleanup + Documentation [7]

```typescript
const handle = await fs.open(path);
try { return Ok(parse(await handle.readFile())); }
finally { await handle.close(); }

// ARCHITECTURE: Repository returns domain objects only
// ARCHITECTURE EXCEPTION: Direct DB for health check — must work if service layer down
```

---

## Consistency Rules

- Result types: if one method returns Result, ALL must [1]
- DI: apply consistently throughout [3]
- Async: single pattern (don't mix callbacks/promises)

## Anti-Patterns

| Pattern | Source |
|---------|--------|
| Throwing in business logic — use Result | [1][11] |
| Silent failures — swallowed catch blocks | [10] |
| Mutable state — return new objects | [7][14] |
| Service locator — inject instead | [3] |

### Workaround Labeling (Required)

`HACK:` `MOCK:` `TODO:` `TEMPORARY:` `NOT-PRODUCTION:` `ARCHITECTURE EXCEPTION:`

Unlabeled workarounds are violations. See `references/code-smell-violations.md`.

---

## Extended References

- `references/sources.md` — Full bibliography (25 sources with access links)
- `references/violations.md` — Violation patterns with citations
- `references/patterns.md` — Extended correct patterns with citations
- `references/checklist.md` — Pre-implementation and review checklists
- `references/code-smell-violations.md` — Fake solutions, deceptive code, magic values
- `references/detection.md` — Grep patterns for automated detection
