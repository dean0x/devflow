---
name: devflow-architecture-patterns
description: Software architecture and design pattern analysis. Load when reviewing code structure, SOLID violations, coupling issues, or module boundaries. Used by Reviewer agent with architecture focus.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Architecture Patterns

Domain expertise for software architecture and design pattern analysis. Use alongside `devflow-review-methodology` for complete architecture reviews.

## Iron Law

> **SEPARATION OF CONCERNS IS NON-NEGOTIABLE**
>
> Every module has one reason to change. Every layer has clear boundaries. Every dependency
> points in one direction. Violations compound into unmaintainable systems. A shortcut today
> becomes technical debt tomorrow. There are no exceptions.

## Architecture Categories

### 1. SOLID Violations

**Single Responsibility Principle (SRP)**
```typescript
// VIOLATION: Class handles HTTP, validation, DB, and email
class UserController {
  async createUser(req, res) {
    // Validates input
    if (!req.body.email.includes('@')) throw new Error('Invalid email');

    // Hashes password
    const hash = await bcrypt.hash(req.body.password, 12);

    // Saves to database
    const user = await db.users.create({ ...req.body, password: hash });

    // Sends welcome email
    await sendEmail(user.email, 'Welcome!', template);

    res.json(user);
  }
}

// CORRECT: Separate concerns
class UserController {
  constructor(
    private userService: UserService,
    private validator: UserValidator
  ) {}

  async createUser(req, res) {
    const data = this.validator.validateCreateUser(req.body);
    const user = await this.userService.create(data);
    res.json(user);
  }
}
```

**Open/Closed Principle (OCP)**
```typescript
// VIOLATION: Modify existing code to add new types
function calculateDiscount(type: string, amount: number) {
  if (type === 'regular') return amount * 0.1;
  if (type === 'premium') return amount * 0.2;
  if (type === 'vip') return amount * 0.3;  // Adding new type = modifying
  return 0;
}

// CORRECT: Extend without modifying
interface DiscountStrategy {
  calculate(amount: number): number;
}

class RegularDiscount implements DiscountStrategy {
  calculate(amount: number) { return amount * 0.1; }
}

class PremiumDiscount implements DiscountStrategy {
  calculate(amount: number) { return amount * 0.2; }
}

// Adding VIP = new class, no modification to existing code
```

**Liskov Substitution Principle (LSP)**
```typescript
// VIOLATION: Subclass breaks parent contract
class Rectangle {
  setWidth(w: number) { this.width = w; }
  setHeight(h: number) { this.height = h; }
  area() { return this.width * this.height; }
}

class Square extends Rectangle {
  setWidth(w: number) {
    this.width = w;
    this.height = w;  // Breaks expectation!
  }
}

// CORRECT: Use composition or proper abstraction
interface Shape {
  area(): number;
}

class Rectangle implements Shape { /* ... */ }
class Square implements Shape { /* ... */ }
```

**Interface Segregation Principle (ISP)**
```typescript
// VIOLATION: Fat interface forces unnecessary implementations
interface Worker {
  work(): void;
  eat(): void;
  sleep(): void;
}

class Robot implements Worker {
  work() { /* OK */ }
  eat() { throw new Error('Robots do not eat'); }  // Forced to implement
  sleep() { throw new Error('Robots do not sleep'); }
}

// CORRECT: Segregated interfaces
interface Workable { work(): void; }
interface Eatable { eat(): void; }
interface Sleepable { sleep(): void; }

class Robot implements Workable {
  work() { /* OK */ }
}
```

**Dependency Inversion Principle (DIP)**
```typescript
// VIOLATION: High-level depends on low-level
class OrderService {
  private db = new PostgresDatabase();  // Concrete dependency

  async createOrder(data: OrderData) {
    return this.db.insert('orders', data);
  }
}

// CORRECT: Depend on abstractions
interface OrderRepository {
  create(data: OrderData): Promise<Order>;
}

class OrderService {
  constructor(private repository: OrderRepository) {}

  async createOrder(data: OrderData) {
    return this.repository.create(data);
  }
}
```

### 2. Coupling Issues

**Tight Coupling**
```typescript
// VIOLATION: Direct instantiation creates coupling
class ReportGenerator {
  generate() {
    const data = new DatabaseService().query('SELECT...');
    const formatted = new FormattingService().format(data);
    new EmailService().send('admin@example.com', formatted);
  }
}

// CORRECT: Inject dependencies
class ReportGenerator {
  constructor(
    private dataSource: DataSource,
    private formatter: Formatter,
    private notifier: Notifier
  ) {}

  generate() {
    const data = this.dataSource.fetch();
    const formatted = this.formatter.format(data);
    this.notifier.notify(formatted);
  }
}
```

**Circular Dependencies**
```typescript
// VIOLATION: A imports B, B imports A
// user.service.ts
import { OrderService } from './order.service';
class UserService {
  constructor(private orders: OrderService) {}
}

// order.service.ts
import { UserService } from './user.service';
class OrderService {
  constructor(private users: UserService) {}
}

// CORRECT: Extract shared concern or use events
// user-order.events.ts
interface UserOrderEvents {
  onOrderCreated(userId: string, orderId: string): void;
}

// Or extract to third module both depend on
```

**Feature Envy**
```typescript
// VIOLATION: Method uses another class's data excessively
class OrderPrinter {
  print(order: Order) {
    console.log(`Customer: ${order.customer.name}`);
    console.log(`Address: ${order.customer.address.street}, ${order.customer.address.city}`);
    console.log(`Phone: ${order.customer.phone}`);
    console.log(`Items: ${order.items.length}`);
    // Most access is to order.customer, not order
  }
}

// CORRECT: Move behavior to the class with the data
class Customer {
  formatForPrint(): string {
    return `${this.name}\n${this.address.format()}\n${this.phone}`;
  }
}
```

### 3. Layering Violations

**Skipping Layers**
```typescript
// VIOLATION: Controller directly accesses database
class UserController {
  async getUser(req, res) {
    const user = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    res.json(user);
  }
}

// CORRECT: Proper layering
// Controller -> Service -> Repository -> Database
class UserController {
  constructor(private userService: UserService) {}

  async getUser(req, res) {
    const user = await this.userService.findById(req.params.id);
    res.json(user);
  }
}
```

**Leaky Abstractions**
```typescript
// VIOLATION: Domain leaks infrastructure details
interface User {
  id: string;
  name: string;
  _mongoId: ObjectId;  // Infrastructure leak!
  __v: number;         // Infrastructure leak!
}

// CORRECT: Clean domain model
interface User {
  id: string;
  name: string;
  email: string;
}

// Map in repository layer
class MongoUserRepository {
  toDomain(doc: MongoDocument): User {
    return { id: doc._id.toString(), name: doc.name, email: doc.email };
  }
}
```

**Wrong Direction Dependencies**
```typescript
// VIOLATION: Domain depends on infrastructure
// domain/user.ts
import { PostgresClient } from '../infrastructure/postgres';

class User {
  save() {
    PostgresClient.insert(this);  // Domain knows about DB!
  }
}

// CORRECT: Infrastructure depends on domain
// domain/user.ts
interface UserRepository {
  save(user: User): Promise<void>;
}

// infrastructure/postgres-user-repository.ts
import { User, UserRepository } from '../domain/user';

class PostgresUserRepository implements UserRepository {
  async save(user: User) { /* ... */ }
}
```

### 4. Modularity Issues

**God Class**
```typescript
// VIOLATION: Class does everything
class ApplicationManager {
  // User management
  createUser() {}
  deleteUser() {}
  updateUser() {}

  // Order management
  createOrder() {}
  cancelOrder() {}
  shipOrder() {}

  // Reporting
  generateReport() {}
  exportToPdf() {}

  // Email
  sendWelcomeEmail() {}
  sendOrderConfirmation() {}

  // 1000+ more lines...
}

// CORRECT: Separate bounded contexts
class UserService { /* user operations */ }
class OrderService { /* order operations */ }
class ReportService { /* reporting */ }
class EmailService { /* email sending */ }
```

**Inappropriate Intimacy**
```typescript
// VIOLATION: Class knows too much about another's internals
class Order {
  calculateTotal() {
    let total = 0;
    for (const item of this.items) {
      // Reaches deep into Product internals
      total += item.product._pricing._basePrice *
               item.product._pricing._taxRate *
               (1 - item.product._pricing._discountPercent);
    }
    return total;
  }
}

// CORRECT: Ask, don't tell
class Product {
  getPrice(): number {
    return this.pricing.calculate();
  }
}

class Order {
  calculateTotal() {
    return this.items.reduce((sum, item) => sum + item.product.getPrice(), 0);
  }
}
```

---

## Severity Guidelines

**CRITICAL** - Fundamental architecture broken:
- Circular dependencies between modules
- Domain layer depends on infrastructure
- No separation between HTTP and business logic
- God classes with 1000+ lines

**HIGH** - Significant architecture issues:
- SOLID violations in core business logic
- Tight coupling between services
- Leaky abstractions exposing infrastructure
- Feature envy across module boundaries

**MEDIUM** - Moderate architecture concerns:
- Some dependencies not injected
- Minor layering violations
- Inconsistent abstraction levels
- Missing interfaces for testability

**LOW** - Minor architecture improvements:
- Naming doesn't reflect domain
- Minor code organization issues
- Could benefit from more abstraction
- Documentation missing for architecture decisions

---

## Detection Patterns

Search for these patterns in code:

```bash
# God classes (large files)
find . -name "*.ts" -exec wc -l {} \; | sort -rn | head -20

# Direct database access in controllers
grep -rn "db\.\|prisma\.\|mongoose\." --include="*controller*.ts"

# Circular imports (look for patterns)
grep -rn "import.*from.*service" --include="*service*.ts" | grep -v node_modules

# Concrete instantiation (new keyword in services)
grep -rn "new [A-Z].*Service\|new [A-Z].*Repository" --include="*.ts"

# Infrastructure in domain
grep -rn "import.*postgres\|import.*mongo\|import.*redis" --include="*/domain/*.ts"

# Missing dependency injection
grep -rn "class.*{" -A5 --include="*.ts" | grep -B5 "private.*= new"
```

---

## Architecture Principles Reference

| Principle | Violation Sign | Fix Pattern |
|-----------|----------------|-------------|
| SRP | Class has multiple reasons to change | Extract classes |
| OCP | Adding feature requires modifying existing code | Use strategy/plugin pattern |
| LSP | Subclass throws "not supported" | Use composition over inheritance |
| ISP | Implementing unused interface methods | Split interfaces |
| DIP | `new ConcreteClass()` in business logic | Inject via constructor |
| DRY | Copy-paste code blocks | Extract to shared module |
| YAGNI | Premature abstractions | Remove until needed |

