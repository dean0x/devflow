---
name: architecture
description: This skill should be used when reviewing code for SOLID violations, tight coupling, or layering issues.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Architecture Patterns

Domain expertise for software architecture and design pattern analysis. Full bibliography: `references/sources.md`.

## Iron Law

> **SEPARATION OF CONCERNS IS NON-NEGOTIABLE** [1][2]
>
> Every module has one reason to change. Every layer has clear boundaries. Every dependency
> points in one direction. Parnas (1972): decompose by information hiding, not by task.
> Violations compound into unmaintainable systems. [1][19]

---

## SOLID Violations [2]

**SRP** — One class, one reason to change. [1][2][8]
```
VIOLATION: UserController handles HTTP + validation + DB + email
CORRECT:   Inject UserService, UserValidator — each class has one reason to change
```

**OCP** — Extend without modifying. [2]
```
VIOLATION: if (type === 'credit') ... else if (type === 'paypal') ...
CORRECT:   Strategy pattern — new payment = new class, existing code unchanged
```

**LSP** — Subtypes must be substitutable. [3] Liskov & Wing (1994): subtype cannot strengthen preconditions. Throwing where parent doesn't throw is a violation.
```
VIOLATION: ReadOnlyStorage extends FileStorage { write() { throw new Error(...) } }
CORRECT:   Segregated interfaces (Readable, Writable) — compile-time, not runtime
```

**ISP** — No forced unused implementations. [2]
```
VIOLATION: interface Worker { work(); eat(); sleep(); }  // Robot forced to implement eat()
CORRECT:   interface Workable { work(): void; }  — implement only what you support
```

**DIP** — Depend on abstractions, not concretions. [2][18] Fowler (2004): constructor injection is the cleanest form. [18]
```typescript
// VIOLATION: class OrderService { private db = new PostgresDatabase(); }
// CORRECT:   class OrderService { constructor(private repo: OrderRepository) {} }
```

---

## Coupling Issues [8][17]

Stevens, Myers & Constantine (1974): content coupling (direct instantiation) is the tightest and worst form. [8]

**Tight Coupling** [8][18]: Direct instantiation — can't mock, can't swap.
```
VIOLATION: class ReportGenerator { generate() { new DatabaseService().query(...) } }
CORRECT:   Inject dependencies via constructor
```

**Circular Dependencies** [19]: A imports B, B imports A. Extract shared concern or use events.

**Feature Envy** [21] / **Law of Demeter** [17]: `order.customer.profile.contact.email` — knows too much.
```
VIOLATION: OrderProcessor computes order.customer.profile.total
CORRECT:   order.getTotal() — behavior belongs to the data owner
```

---

## Layering Violations [5][7][10]

Clean Architecture (Martin, 2017) Dependency Rule: source code dependencies can only point inward. [5]

**Skipping Layers**: Controller directly accessing database. [5][7]
```typescript
// VIOLATION: Controller → DB (skips service)
const user = await db.query('SELECT...', [req.params.id]);
// CORRECT: Controller → Service → Repository [5][7]
const user = await this.userService.findById(req.params.id);
```

**Leaky Abstractions**: Infrastructure details in domain. [9]
```
VIOLATION: interface User { id: string; _mongoId: ObjectId; __v: number; }
CORRECT:   interface User { id: string; name: string; }  — map in repository [7]
```

**Wrong Direction**: Domain must not import infrastructure. [5][10] Hexagonal Architecture (Cockburn, 2005): ports define what core needs; adapters implement them. [10]

---

## Modularity Issues [1][9]

**Deep vs Shallow Modules** (Ousterhout, 2018): deep module = simple interface, rich implementation. Shallow = more complexity exposed than hidden. [9]

**God Class** [1][6]: Splits into bounded contexts. Warning signs: 500+ lines, `*Manager`, `*Processor`, 7+ constructor parameters.

**Inappropriate Intimacy** [17][21]: `a.b().c()` chains — use "tell, don't ask."

---

## Severity Guidelines

| Severity | Examples |
|----------|----------|
| **CRITICAL** | Circular dependencies, domain depends on infrastructure, god class 1000+ lines [5][19] |
| **HIGH** | SOLID violations in core logic, tight coupling between services, leaky abstractions [2][8] |
| **MEDIUM** | Dependencies not injected, minor layering violations, missing interfaces [18] |
| **LOW** | Naming issues, minor organization, missing architecture docs |

---

## Architecture Principles Reference

| Principle | Violation Sign | Source | Fix |
|-----------|----------------|--------|-----|
| SRP | Multiple reasons to change | [1][2] | Extract classes |
| OCP | Modifying to add features | [2] | Strategy pattern |
| LSP | Subclass throws "not supported" | [3] | Composition + segregated interfaces |
| ISP | Unused interface methods | [2] | Split interfaces |
| DIP | `new ConcreteClass()` in business | [2][18] | Inject via constructor |
| Law of Demeter | `a.b().c()` chains | [17] | Tell, don't ask |
| Deep Modules | Shallow abstractions | [9] | Encapsulate complexity |

---

## Extended References

- `references/sources.md` — Full bibliography (25 sources)
- `references/patterns.md` — Extended correct patterns with citations [2][3][5][7][10][18]
- `references/violations.md` — Extended violations with citations [1][2][3][8][17][19][21]
- `references/detection.md` — Grep patterns and bash commands for automated detection
