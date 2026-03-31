# Architecture Correct Patterns

Extended correct patterns for architecture reviews. Reference from main SKILL.md. Full bibliography: `sources.md`.

## SOLID Patterns [2]

### Single Responsibility Principle (SRP) [1][2][8]

One class, one reason to change. Stevens, Myers & Constantine (1974) defined cohesion as the strength of association between elements within a module — functional cohesion is the strongest form. [8]

```typescript
// CORRECT: Each class has one responsibility
class UserController {
  constructor(
    private userService: UserService,
    private validator: UserValidator
  ) {}

  async createUser(req, res) {
    const validation = this.validator.validateCreateUser(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    const result = await this.userService.create(validation.data);
    if (!result.ok) {
      return res.status(result.error.statusCode).json({ error: result.error.message });
    }
    res.json(result.value);
  }
}

class UserService {
  constructor(
    private repository: UserRepository,
    private hasher: PasswordHasher,
    private emailer: EmailService,
    private logger: Logger
  ) {}

  async create(data: CreateUserData): Promise<Result<UserDTO, ServiceError>> {
    this.logger.info('Creating user', { email: data.email });
    const existing = await this.repository.findByEmail(data.email);
    if (existing) return Err({ type: 'conflict', message: 'User exists', statusCode: 409 });
    const hashedPassword = await this.hasher.hash(data.password);
    const user = await this.repository.create({ email: data.email, password: hashedPassword });
    this.emailer.sendWelcome(user.email).catch(e => this.logger.error('Welcome email failed', e));
    return Ok(toUserDTO(user));
  }
}
```

**Reasons to Change Analysis** [2]

| Class | Single Responsibility |
|-------|----------------------|
| UserController | HTTP request/response mapping |
| UserValidator | Input validation rules |
| UserService | User creation business logic |
| UserRepository | Database access |
| EmailService | Email delivery |

---

### Open/Closed Principle (OCP) [2]

Strategy pattern: open for extension by adding new implementations, closed for modification of the processor. [2]

```typescript
// CORRECT: Adding new payment = new class, no modification to PaymentProcessor
interface PaymentStrategy {
  readonly name: string;
  process(amount: number): Promise<PaymentResult>;
}

class PaymentProcessor {
  private strategies: Map<string, PaymentStrategy>;

  constructor(strategies: PaymentStrategy[]) {
    this.strategies = new Map(strategies.map(s => [s.name, s]));
  }

  register(strategy: PaymentStrategy) {
    this.strategies.set(strategy.name, strategy);
  }

  async process(method: string, amount: number): Promise<PaymentResult> {
    const strategy = this.strategies.get(method);
    if (!strategy) return { ok: false, error: 'Unknown payment method' };
    return strategy.process(amount);
  }
}
```

---

### Liskov Substitution Principle (LSP) [3][4]

Liskov & Wing (1994) formal definition: if S is a subtype of T, objects of T may be replaced by objects of S without altering correctness of the program. [3] Behavioral subtyping requires not just signature compatibility, but contract compatibility (preconditions/postconditions/invariants).

```typescript
// CORRECT: Interfaces match actual capabilities — compile-time enforcement
interface Readable { read(path: string): string; }
interface Writable { write(path: string, content: string): void; }

class FileStorage implements Readable, Writable {
  read(path: string): string { /* ... */ }
  write(path: string, content: string): void { /* ... */ }
}

class ReadOnlyStorage implements Readable {
  read(path: string): string { /* ... */ }
  // No write — doesn't claim to support it; compile error prevents misuse
}

function backup(storage: Writable, data: string) {
  storage.write('/backup/data.txt', data);
}
// ReadOnlyStorage cannot be passed — type error at compile time, not runtime exception
```

---

### Interface Segregation Principle (ISP) [2]

No client should be forced to depend on methods it does not use. [2]

```typescript
// CORRECT: Small, focused interfaces
interface DocumentReader { open(path: string): Document; }
interface DocumentWriter { save(doc: Document): void; }
interface Printable { print(doc: Document): void; }
interface Emailable { email(doc: Document, to: string): void; }
interface Encryptable { encrypt(doc: Document): Document; }

// Implement only what you support
class PdfHandler implements DocumentReader, DocumentWriter, Printable, Emailable, Encryptable {
  open(path: string) { /* ... */ }
  save(doc: Document) { /* ... */ }
  print(doc: Document) { /* ... */ }
  email(doc: Document, to: string) { /* ... */ }
  encrypt(doc: Document) { /* ... */ }
}

class LegacyFaxHandler implements DocumentReader {
  open(path: string) { /* ... */ }
  // Only what it actually supports
}
```

---

### Dependency Inversion Principle (DIP) [2][18]

High-level modules should not depend on low-level modules. Both should depend on abstractions. Fowler (2004): constructor injection is the cleanest form — dependencies are explicit and testable. [18]

```typescript
// CORRECT: High-level module depends on abstractions; concrete wiring in composition root
interface NotificationChannel {
  readonly type: string;
  send(recipient: string, message: string): Promise<Result<void, Error>>;
}

class NotificationService {
  constructor(
    private channels: Map<string, NotificationChannel>,
    private userRepository: UserRepository,
    private logger: Logger
  ) {}

  async notifyUser(userId: string, message: string): Promise<Result<void, Error>> {
    const user = await this.userRepository.findById(userId);
    if (!user.ok) return user;
    // ... fan out to channels
  }
}

// Composition root — only place that knows concrete implementations [5][18]
const service = new NotificationService(
  new Map([['sms', new SMSChannel(twilioClient)], ['email', new EmailChannel(sendgridClient)]]),
  userRepository,
  logger
);
```

---

## Coupling Solutions [8][17][18]

### Breaking Circular Dependencies [19]

Extract shared concern to a third module, or use event bus. [19]

```typescript
// CORRECT: Event-based decoupling breaks the user/order cycle
class UserService {
  constructor(private repository: UserRepository, private eventBus: EventBus) {}

  async deleteUser(userId: string) {
    await this.eventBus.emit('user.deleting', { userId });
    await this.repository.delete(userId);
  }
}

class OrderService {
  // Registers as handler — no import of UserService
  async onUserDeleting(userId: string) {
    await this.repository.cancelByUserId(userId);
  }

  async createOrder(userId: string, items: Item[], creditLimit: number) {
    // CreditLimit passed in — no UserService dependency
    if (creditLimit < this.calculateTotal(items)) return Err({ type: 'credit_exceeded' });
    return this.repository.create({ userId, items });
  }
}
```

---

### Eliminating Feature Envy [21][17]

Move behavior to the data owner. Law of Demeter [17]: a method should only call methods on its own fields, parameters, and objects it creates.

```typescript
// CORRECT: Objects own their behavior — no external reaching into internals
class Order {
  getSubtotal(): number {
    return this.items.reduce((sum, item) => sum + item.getTotal(), 0);
  }
  getShippingCost(): number {
    return this.shippingMethod.calculate(this.getWeight(), this.getShippingAddress());
  }
  getTotal(): number {
    return this.getSubtotal() + this.getShippingCost() + this.getTax();
  }
}

// OrderProcessor is now simple orchestration — no reaching into Order internals
class OrderProcessor {
  async process(order: Order) {
    const total = order.getTotal();
    const label = order.customer.formatForShipping();
  }
}
```

---

## Layering Patterns [5][7][10]

### Proper Layer Separation [5]

Clean Architecture (Martin, 2017) Dependency Rule: source code dependencies can only point inward — toward higher-level policies. [5]

| Layer | Responsibility | Depends On |
|-------|---------------|------------|
| Controller | HTTP, request/response, auth | Service |
| Service | Business logic, orchestration | Repository, Clients |
| Repository | Data access, mapping | Database |
| Domain | Pure business rules, defines interfaces | Nothing |

```typescript
// Layer 1: Controller — HTTP concerns only
class ProductController {
  constructor(private productService: ProductService) {}

  async getProduct(req, res) {
    const result = await this.productService.findById(req.params.id);
    if (!result.ok) {
      return res.status(result.error.type === 'not_found' ? 404 : 500)
        .json({ error: result.error.message });
    }
    res.json(result.value);
  }
}

// Layer 2: Service — business logic
class ProductService {
  constructor(
    private repository: ProductRepository,
    private cache: CacheService
  ) {}

  async findById(id: string): Promise<Result<ProductDTO, ServiceError>> {
    const cached = await this.cache.get<ProductDTO>(`product:${id}`);
    if (cached) return Ok(cached);
    const product = await this.repository.findById(id);
    if (!product.ok) return product;
    await this.cache.set(`product:${id}`, product.value, 300);
    return Ok(product.value);
  }
}

// Layer 3: Repository — data access only
class ProductRepository {
  constructor(private db: Database) {}

  async findById(id: string): Promise<Result<Product, RepositoryError>> {
    const row = await this.db.query('SELECT * FROM products WHERE id = $1', [id]);
    if (!row) return Err({ type: 'not_found', message: `Product ${id} not found` });
    return Ok(this.toDomain(row));
  }

  private toDomain(row: ProductRow): Product {
    return { id: row.id, name: row.name, price: new Money(row.price_cents, row.currency) };
  }
}
```

---

### Hexagonal Architecture (Ports & Adapters) [10]

Cockburn (2005): the application core is in the center. Ports are interfaces the core defines. Adapters implement them. [10]

```typescript
// domain/ports.ts — Core defines what it needs (ports)
interface OrderRepository { findById(id: OrderId): Promise<Result<Order, NotFoundError>>; }
interface PaymentGateway { charge(amount: Money, source: PaymentSource): Promise<Result<PaymentId, PaymentError>>; }

// infrastructure/postgres-order-repository.ts — Adapter implements the port
class PostgresOrderRepository implements OrderRepository {
  constructor(private db: PostgresClient) {}
  async findById(id: OrderId): Promise<Result<Order, NotFoundError>> { /* ... */ }
}

// infrastructure/stripe-gateway.ts — Another adapter
class StripePaymentGateway implements PaymentGateway {
  constructor(private client: StripeClient) {}
  async charge(amount: Money, source: PaymentSource): Promise<Result<PaymentId, PaymentError>> { /* ... */ }
}

// Composition root — wires adapters to ports
function createOrderService(): OrderService {
  return new OrderService(
    new PostgresOrderRepository(new PostgresClient(config.database)),
    new StripePaymentGateway(new StripeClient(config.stripe))
  );
}
```

---

### Clean Abstraction Boundaries [7][9]

Data Mapper pattern (Fowler, 2004): repository maps between domain objects and database rows. Domain model stays pure. [7] Deep modules (Ousterhout, 2018): repository hides all ORM complexity behind a simple interface. [9]

```typescript
// Pure domain model — no infrastructure concerns [5][9]
interface User {
  readonly id: UserId;
  readonly email: Email;
  readonly organizationId: OrganizationId;
  readonly createdAt: Date;
}

// Repository handles all ORM mapping — Data Mapper pattern [7]
class UserRepository {
  constructor(private orm: TypeORM) {}

  async findById(id: UserId): Promise<Result<User, NotFoundError>> {
    const entity = await this.orm.findOne(UserEntity, {
      where: { id: id.value, deletedAt: IsNull() }
    });
    if (!entity) return Err({ type: 'not_found', entity: 'User', id: id.value });
    return Ok(this.toDomain(entity));
  }

  private toDomain(entity: UserEntity): User {
    return {
      id: UserId.from(entity.id),
      email: Email.from(entity.email),
      organizationId: OrganizationId.from(entity.organization_id),
      createdAt: entity.createdAt
    };
  }
}
```
