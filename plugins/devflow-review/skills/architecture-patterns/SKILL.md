---
name: architecture-patterns
description: Architecture analysis patterns for code review. Detects SOLID violations, tight coupling, layering issues, and dependency direction problems. Loaded by Reviewer agent when focus=architecture.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Architecture Patterns

Domain expertise for software architecture and design pattern analysis. Use alongside `review-methodology` for complete architecture reviews.

## Iron Law

> **SEPARATION OF CONCERNS IS NON-NEGOTIABLE**
>
> Every module has one reason to change. Every layer has clear boundaries. Every dependency
> points in one direction. Violations compound into unmaintainable systems.

---

## Architecture Categories

### 1. SOLID Violations

**Single Responsibility (SRP)**: One class, one reason to change.
```typescript
// VIOLATION: Handles HTTP, validation, DB, email
class UserController {
  async createUser(req, res) {
    if (!req.body.email.includes('@')) throw new Error('Invalid');
    const user = await db.users.create(req.body);
    await sendEmail(user.email, 'Welcome!');
    res.json(user);
  }
}
// CORRECT: Separate concerns via injected services
```

**Open/Closed (OCP)**: Extend without modifying.
```typescript
// VIOLATION: Adding type = modifying
if (type === 'regular') return amount * 0.1;
if (type === 'premium') return amount * 0.2;

// CORRECT: Strategy pattern
interface DiscountStrategy { calculate(amount: number): number; }
```

**Liskov Substitution (LSP)**: Subtypes must be substitutable.
```typescript
// VIOLATION: Subclass breaks contract
class Square extends Rectangle { setWidth(w) { this.width = this.height = w; } }

// CORRECT: Use composition/proper abstraction
interface Shape { area(): number; }
```

**Interface Segregation (ISP)**: No forced unused implementations.
```typescript
// VIOLATION: Robot forced to implement eat()
interface Worker { work(); eat(); sleep(); }

// CORRECT: Segregated interfaces
interface Workable { work(): void; }
```

**Dependency Inversion (DIP)**: Depend on abstractions.
```typescript
// VIOLATION: Concrete dependency
class OrderService { private db = new PostgresDatabase(); }

// CORRECT: Inject interface
class OrderService { constructor(private repo: OrderRepository) {} }
```

### 2. Coupling Issues

**Tight Coupling**: Direct instantiation creates coupling.
```typescript
// VIOLATION
class ReportGenerator {
  generate() { new DatabaseService().query('SELECT...'); }
}
// CORRECT: Inject dependencies via constructor
```

**Circular Dependencies**: A imports B, B imports A. Extract shared concern or use events.

**Feature Envy**: Method uses another class's data excessively. Move behavior to data owner.

### 3. Layering Violations

**Skipping Layers**: Controller directly accessing database.
```typescript
// VIOLATION: Controller -> DB (skips service)
const user = await db.query('SELECT...', [req.params.id]);

// CORRECT: Controller -> Service -> Repository
const user = await this.userService.findById(req.params.id);
```

**Leaky Abstractions**: Infrastructure details in domain.
```typescript
// VIOLATION: Domain exposes MongoDB internals
interface User { id: string; _mongoId: ObjectId; __v: number; }

// CORRECT: Clean domain, map in repository
interface User { id: string; name: string; }
```

**Wrong Direction**: Domain must not import infrastructure. Infrastructure implements domain interfaces.

### 4. Modularity Issues

**God Class**: Class does everything. Split into bounded contexts.

**Inappropriate Intimacy**: Class knows internals of another. Use "tell, don't ask."

---

## Extended References

For detailed examples and detection patterns:

- `references/solid.md` - Extended SOLID violation examples with full fixes
- `references/coupling.md` - Circular dependencies, feature envy, tight coupling
- `references/layering.md` - Layer skipping, leaky abstractions, wrong direction
- `references/detection.md` - Grep patterns and bash commands for automated detection

---

## Severity Guidelines

| Severity | Examples |
|----------|----------|
| **CRITICAL** | Circular dependencies, domain depends on infrastructure, god classes 1000+ lines |
| **HIGH** | SOLID violations in core logic, tight coupling between services, leaky abstractions |
| **MEDIUM** | Dependencies not injected, minor layering violations, missing interfaces |
| **LOW** | Naming issues, minor organization, missing architecture docs |

---

## Architecture Principles Reference

| Principle | Violation Sign | Fix Pattern |
|-----------|----------------|-------------|
| SRP | Multiple reasons to change | Extract classes |
| OCP | Modifying to add features | Strategy/plugin pattern |
| LSP | Subclass throws "not supported" | Composition over inheritance |
| ISP | Unused interface methods | Split interfaces |
| DIP | `new ConcreteClass()` in business | Inject via constructor |
| DRY | Copy-paste code blocks | Extract to shared module |
| YAGNI | Premature abstractions | Remove until needed |
