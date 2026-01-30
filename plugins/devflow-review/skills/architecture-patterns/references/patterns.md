# Architecture Correct Patterns

Extended correct patterns for architecture reviews. Reference from main SKILL.md.

## SOLID Patterns

### Single Responsibility Principle (SRP)

**Proper Separation of Concerns**
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
    private analytics: AnalyticsService,
    private logger: Logger
  ) {}

  async create(data: CreateUserData): Promise<Result<UserDTO, ServiceError>> {
    this.logger.info('Creating user', { email: data.email });

    const existing = await this.repository.findByEmail(data.email);
    if (existing) {
      return Err({ type: 'conflict', message: 'User exists', statusCode: 409 });
    }

    const hashedPassword = await this.hasher.hash(data.password);
    const user = await this.repository.create({
      email: data.email,
      password: hashedPassword
    });

    // Fire-and-forget for non-critical operations
    this.emailer.sendWelcome(user.email).catch(e => this.logger.error('Welcome email failed', e));
    this.analytics.track('user_created', { userId: user.id });

    return Ok(toUserDTO(user));
  }
}
```

---

### Open/Closed Principle (OCP)

**Strategy Pattern for Extension**
```typescript
// CORRECT: Open for extension, closed for modification
interface PaymentStrategy {
  readonly name: string;
  process(amount: number): Promise<PaymentResult>;
  validate(data: PaymentData): ValidationResult;
}

class CreditCardPayment implements PaymentStrategy {
  readonly name = 'credit_card';

  async process(amount: number): Promise<PaymentResult> {
    // Credit card specific logic
  }

  validate(data: PaymentData): ValidationResult {
    // Credit card validation
  }
}

class PayPalPayment implements PaymentStrategy {
  readonly name = 'paypal';
  // PayPal implementation
}

// Adding new payment = new class, no modification to existing code
class ApplePayPayment implements PaymentStrategy {
  readonly name = 'apple_pay';
  // Apple Pay implementation
}

class PaymentProcessor {
  private strategies: Map<string, PaymentStrategy>;

  constructor(strategies: PaymentStrategy[]) {
    this.strategies = new Map(strategies.map(s => [s.name, s]));
  }

  // Register new strategies without modifying this class
  register(strategy: PaymentStrategy) {
    this.strategies.set(strategy.name, strategy);
  }

  async process(method: string, amount: number): Promise<PaymentResult> {
    const strategy = this.strategies.get(method);
    if (!strategy) {
      return { ok: false, error: 'Unknown payment method' };
    }
    return strategy.process(amount);
  }
}
```

---

### Liskov Substitution Principle (LSP)

**Proper Interface Segregation**
```typescript
// CORRECT: Interfaces match actual capabilities
interface Readable {
  read(path: string): string;
}

interface Writable {
  write(path: string, content: string): void;
}

interface Deletable {
  delete(path: string): void;
}

class FileStorage implements Readable, Writable, Deletable {
  read(path: string): string { /* ... */ }
  write(path: string, content: string): void { /* ... */ }
  delete(path: string): void { /* ... */ }
}

class ReadOnlyStorage implements Readable {
  read(path: string): string { /* ... */ }
  // No write or delete - doesn't claim to support them
}

// Function declares what it needs
function backup(storage: Writable, data: string) {
  storage.write('/backup/data.txt', data);
}
// ReadOnlyStorage can't be passed - compile error, not runtime error
```

---

### Interface Segregation Principle (ISP)

**Segregated Interfaces by Capability**
```typescript
// CORRECT: Small, focused interfaces
interface DocumentReader {
  open(path: string): Document;
}

interface DocumentWriter {
  save(doc: Document): void;
}

interface Printable {
  print(doc: Document): void;
}

interface Emailable {
  email(doc: Document, to: string): void;
}

interface Faxable {
  fax(doc: Document, number: string): void;
}

interface Encryptable {
  encrypt(doc: Document): Document;
}

// Implement only what you support
class PdfHandler implements DocumentReader, DocumentWriter, Printable, Emailable, Encryptable {
  open(path: string) { /* ... */ }
  save(doc: Document) { /* ... */ }
  print(doc: Document) { /* ... */ }
  email(doc: Document, to: string) { /* ... */ }
  encrypt(doc: Document) { /* ... */ }
  // No fax - we don't claim to support it
}

class LegacyFaxHandler implements Faxable {
  fax(doc: Document, number: string) { /* ... */ }
}
```

---

### Dependency Inversion Principle (DIP)

**Depend on Abstractions**
```typescript
// CORRECT: High-level module depends on abstractions
interface NotificationChannel {
  readonly type: string;
  send(recipient: string, message: string): Promise<Result<void, Error>>;
}

class SMSChannel implements NotificationChannel {
  readonly type = 'sms';

  constructor(private client: SMSProvider) {}

  async send(phone: string, message: string): Promise<Result<void, Error>> {
    try {
      await this.client.sendSMS(phone, message);
      return Ok(undefined);
    } catch (error) {
      return Err(error as Error);
    }
  }
}

class EmailChannel implements NotificationChannel {
  readonly type = 'email';

  constructor(private client: EmailProvider) {}

  async send(email: string, message: string): Promise<Result<void, Error>> {
    // Implementation
  }
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

    const results = await Promise.all(
      user.value.preferredChannels.map(async (channelType) => {
        const channel = this.channels.get(channelType);
        if (!channel) {
          this.logger.warn(`Unknown channel: ${channelType}`);
          return Ok(undefined);
        }
        return channel.send(user.value.contactInfo[channelType], message);
      })
    );

    const error = results.find(r => !r.ok);
    return error ?? Ok(undefined);
  }
}

// Composition root - wire dependencies
const smsChannel = new SMSChannel(new TwilioClient(config.twilioKey));
const emailChannel = new EmailChannel(new SendGridClient(config.sendgridKey));

const notificationService = new NotificationService(
  new Map([
    ['sms', smsChannel],
    ['email', emailChannel]
  ]),
  userRepository,
  logger
);
```

---

## Coupling Solutions

### Breaking Circular Dependencies

**Event-Based Decoupling**
```typescript
// CORRECT: Use events to break the cycle
// user-events.ts
interface UserEvents {
  onUserDeleting(userId: string): Promise<void>;
}

// order.service.ts - implements event handler
class OrderService implements UserEvents {
  async onUserDeleting(userId: string) {
    await this.repository.cancelByUserId(userId);
  }

  async createOrder(userId: string, items: Item[], creditLimit: number) {
    // Credit limit passed in, no user service dependency
    if (creditLimit < this.calculateTotal(items)) {
      return Err({ type: 'credit_exceeded' });
    }
    return this.repository.create({ userId, items });
  }
}

// user.service.ts - publishes events
class UserService {
  constructor(
    private repository: UserRepository,
    private eventBus: EventBus
  ) {}

  async deleteUser(userId: string) {
    await this.eventBus.emit('user.deleting', { userId });
    await this.repository.delete(userId);
  }
}
```

**Orchestration Layer**
```typescript
// CORRECT: Extract coordination to facade
class UserOrderFacade {
  constructor(
    private userService: UserService,
    private orderService: OrderService
  ) {}

  async createOrderForUser(userId: string, items: Item[]) {
    const user = await this.userService.getUser(userId);
    return this.orderService.createOrder(userId, items, user.creditLimit);
  }

  async deleteUserWithOrders(userId: string) {
    await this.orderService.cancelAllUserOrders(userId);
    await this.userService.deleteUser(userId);
  }
}
```

---

### Eliminating Feature Envy

**Move Behavior to Data Owner**
```typescript
// CORRECT: Objects own their behavior
class Order {
  getSubtotal(): number {
    return this.items.reduce((sum, item) => sum + item.getTotal(), 0);
  }

  getShippingCost(): number {
    return this.shippingMethod.calculate(this.getWeight(), this.getShippingAddress());
  }

  getTax(): number {
    return this.taxCalculator.calculate(this.getSubtotal(), this.getBillingAddress());
  }

  getTotal(): number {
    return this.getSubtotal() + this.getShippingCost() + this.getTax();
  }

  private getWeight(): number {
    return this.items.reduce((sum, item) => sum + item.getWeight(), 0);
  }
}

class OrderItem {
  getTotal(): number {
    return this.product.getPrice() * this.quantity;
  }

  getWeight(): number {
    return this.product.getWeight() * this.quantity;
  }
}

class Product {
  getPrice(): number {
    const discount = this.getActiveDiscount();
    return this.pricing.basePrice * (1 - discount);
  }

  private getActiveDiscount(): number {
    return this.pricing.activePromotions
      .filter(p => p.isValid())
      .reduce((max, p) => Math.max(max, p.discountPercent), 0) / 100;
  }
}

class Customer {
  getShippingAddress(): Address {
    return this.addresses.find(a => a.type === 'shipping') ?? this.defaultAddress;
  }

  getBillingAddress(): Address {
    return this.addresses.find(a => a.type === 'billing') ?? this.getShippingAddress();
  }

  formatForShipping(): ShippingLabel {
    return this.profile.formatForShipping(this.getShippingAddress());
  }
}

// OrderProcessor is now simple orchestration
class OrderProcessor {
  async process(order: Order) {
    const total = order.getTotal();
    const shippingLabel = order.customer.formatForShipping();
    // Simple orchestration, not data manipulation
  }
}
```

---

### Loose Coupling via Injection

**Dependency Injection Pattern**
```typescript
// CORRECT: All dependencies injected
interface DataSource {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
}

interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

interface ReportFormatter {
  format(data: unknown[]): Buffer;
}

interface FileStorage {
  upload(path: string, content: Buffer): Promise<string>;
}

interface Notifier {
  send(message: string): Promise<void>;
}

class ReportGenerator {
  constructor(
    private dataSource: DataSource,
    private cache: CacheService,
    private formatter: ReportFormatter,
    private storage: FileStorage,
    private notifier: Notifier,
    private logger: Logger
  ) {}

  async generateSalesReport(
    startDate: Date,
    endDate: Date
  ): Promise<Result<ReportResult, Error>> {
    const cacheKey = `report:sales:${startDate.toISOString()}:${endDate.toISOString()}`;

    const cached = await this.cache.get<ReportResult>(cacheKey);
    if (cached) {
      this.logger.info('Report served from cache', { cacheKey });
      return Ok(cached);
    }

    try {
      const sales = await this.dataSource.query<SaleRecord>(
        'SELECT * FROM sales WHERE date BETWEEN $1 AND $2',
        [startDate, endDate]
      );

      const report = this.formatter.format(sales);
      const url = await this.storage.upload(
        `reports/sales-${Date.now()}.xlsx`,
        report
      );

      await this.notifier.send(`Sales report generated: ${url}`);

      const result = { url, recordCount: sales.length };
      await this.cache.set(cacheKey, result, 3600);

      return Ok(result);
    } catch (error) {
      this.logger.error('Report generation failed', { error });
      return Err(error as Error);
    }
  }
}

// Composition root - wire dependencies
function createReportGenerator(config: Config): ReportGenerator {
  return new ReportGenerator(
    new PostgresDataSource(config.database),
    new RedisCache(config.redis),
    new ExcelFormatter(),
    new S3Storage(config.s3),
    new SlackNotifier(config.slack),
    new Logger('ReportGenerator')
  );
}

// For tests - inject mocks
const testGenerator = new ReportGenerator(
  mockDataSource,
  mockCache,
  mockFormatter,
  mockStorage,
  mockNotifier,
  mockLogger
);
```

---

## Layering Patterns

### Proper Layer Separation

**Clean Architecture Layers**
```typescript
// Layer 1: Controller (HTTP concerns only)
class ProductController {
  constructor(private productService: ProductService) {}

  async getProduct(req, res) {
    const result = await this.productService.findById(req.params.id);

    if (!result.ok) {
      const status = result.error.type === 'not_found' ? 404 : 500;
      return res.status(status).json({ error: result.error.message });
    }

    res.json(result.value);
  }

  async updateProduct(req, res) {
    const result = await this.productService.update(
      req.params.id,
      req.body,
      req.user.id // Auth context
    );

    if (!result.ok) {
      return res.status(400).json({ error: result.error.message });
    }

    res.json(result.value);
  }
}

// Layer 2: Service (Business logic)
class ProductService {
  constructor(
    private repository: ProductRepository,
    private inventoryClient: InventoryClient,
    private cacheService: CacheService,
    private auditService: AuditService
  ) {}

  async findById(id: string): Promise<Result<ProductDTO, ServiceError>> {
    const cached = await this.cacheService.get<ProductDTO>(`product:${id}`);
    if (cached) return Ok(cached);

    const product = await this.repository.findById(id);
    if (!product.ok) return product;

    const inventory = await this.inventoryClient.getStock(id);
    const enriched = this.enrichWithInventory(product.value, inventory);

    await this.cacheService.set(`product:${id}`, enriched, 300);

    return Ok(enriched);
  }

  async update(
    id: string,
    data: UpdateProductData,
    userId: string
  ): Promise<Result<ProductDTO, ServiceError>> {
    const updated = await this.repository.update(id, data);
    if (!updated.ok) return updated;

    await this.cacheService.invalidate(`product:${id}`);
    await this.cacheService.invalidate('products:list');

    await this.auditService.record({
      action: 'UPDATE',
      entity: 'product',
      entityId: id,
      userId,
      data
    });

    return Ok(toDTO(updated.value));
  }

  private enrichWithInventory(product: Product, inventory: InventoryData): ProductDTO {
    return {
      ...toDTO(product),
      inStock: inventory.quantity > 0,
      availability: this.calculateAvailability(inventory.quantity)
    };
  }
}

// Layer 3: Repository (Data access)
class ProductRepository {
  constructor(private db: Database) {}

  async findById(id: string): Promise<Result<Product, RepositoryError>> {
    const row = await this.db.query(
      'SELECT * FROM products WHERE id = $1',
      [id]
    );

    if (!row) {
      return Err({ type: 'not_found', message: `Product ${id} not found` });
    }

    return Ok(this.toDomain(row));
  }

  async update(id: string, data: UpdateProductData): Promise<Result<Product, RepositoryError>> {
    const row = await this.db.query(
      'UPDATE products SET name = $1, price = $2 WHERE id = $3 RETURNING *',
      [data.name, data.price, id]
    );

    return Ok(this.toDomain(row));
  }

  private toDomain(row: ProductRow): Product {
    return {
      id: row.id,
      name: row.name,
      price: new Money(row.price_cents, row.currency)
    };
  }
}
```

**Layer Responsibility Summary**

| Layer | Responsibility | Depends On |
|-------|---------------|------------|
| Controller | HTTP, request/response, auth | Service |
| Service | Business logic, orchestration | Repository, Clients |
| Repository | Data access, mapping | Database |
| Client | External service communication | External APIs |

---

### Clean Abstraction Boundaries

**Repository Handles All ORM Concerns**
```typescript
// Pure domain model - no infrastructure concerns
interface User {
  readonly id: UserId;
  readonly email: Email;
  readonly organizationId: OrganizationId;
  readonly createdAt: Date;
}

interface UserWithOrganization extends User {
  readonly organization: Organization;
}

// Repository handles all ORM concerns
class UserRepository {
  constructor(private orm: TypeORM) {}

  async findById(id: UserId): Promise<Result<User, NotFoundError>> {
    const entity = await this.orm.findOne(UserEntity, {
      where: { id: id.value, deletedAt: IsNull() }
    });

    if (!entity) {
      return Err({ type: 'not_found', entity: 'User', id: id.value });
    }

    return Ok(this.toDomain(entity));
  }

  async findWithOrganization(id: UserId): Promise<Result<UserWithOrganization, NotFoundError>> {
    const entity = await this.orm.findOne(UserEntity, {
      where: { id: id.value, deletedAt: IsNull() },
      relations: ['organization']
    });

    if (!entity) {
      return Err({ type: 'not_found', entity: 'User', id: id.value });
    }

    return Ok({
      ...this.toDomain(entity),
      organization: this.toOrganizationDomain(entity.organization)
    });
  }

  // All mapping happens here
  private toDomain(entity: UserEntity): User {
    return {
      id: UserId.from(entity.id),
      email: Email.from(entity.email),
      organizationId: OrganizationId.from(entity.organization_id),
      createdAt: entity.createdAt
    };
  }

  private toEntity(user: User): Partial<UserEntity> {
    return {
      id: user.id.value,
      email: user.email.value,
      organization_id: user.organizationId.value
    };
  }
}

// Service layer works with clean domain types
class UserService {
  constructor(private repository: UserRepository) {}

  async getUser(id: UserId): Promise<Result<User, ServiceError>> {
    return this.repository.findById(id);
  }

  async getUserWithOrganization(id: UserId): Promise<Result<UserWithOrganization, ServiceError>> {
    return this.repository.findWithOrganization(id);
  }
}
```

---

### Correct Dependency Direction

**Clean Architecture Implementation**
```typescript
// domain/order.ts - Pure domain, no infrastructure imports
class Order {
  readonly id: OrderId;
  readonly items: ReadonlyArray<OrderItem>;
  readonly customerId: CustomerId;
  readonly status: OrderStatus;

  // Domain logic only - no I/O
  get total(): Money {
    return this.items.reduce(
      (sum, item) => sum.add(item.total),
      Money.zero(this.currency)
    );
  }

  canBeCancelled(): boolean {
    return this.status === OrderStatus.Pending ||
           this.status === OrderStatus.Processing;
  }

  cancel(): Result<Order, DomainError> {
    if (!this.canBeCancelled()) {
      return Err({
        type: 'cannot_cancel',
        message: `Order in ${this.status} status cannot be cancelled`
      });
    }
    return Ok(this.withStatus(OrderStatus.Cancelled));
  }

  private withStatus(status: OrderStatus): Order {
    return new Order({ ...this, status });
  }
}

// domain/ports.ts - Interfaces defined by domain
interface OrderRepository {
  findById(id: OrderId): Promise<Result<Order, NotFoundError>>;
  save(order: Order): Promise<Result<void, PersistenceError>>;
}

interface PaymentGateway {
  charge(amount: Money, source: PaymentSource): Promise<Result<PaymentId, PaymentError>>;
}

interface NotificationService {
  notifyOrderConfirmation(order: Order): Promise<Result<void, NotificationError>>;
}

// application/order.service.ts - Orchestrates domain and infrastructure
class OrderService {
  constructor(
    private repository: OrderRepository,
    private paymentGateway: PaymentGateway,
    private notifications: NotificationService,
    private events: EventBus
  ) {}

  async createOrder(command: CreateOrderCommand): Promise<Result<Order, OrderError>> {
    const order = Order.create(command);

    const paymentResult = await this.paymentGateway.charge(
      order.total,
      command.paymentSource
    );
    if (!paymentResult.ok) return paymentResult;

    const saveResult = await this.repository.save(order);
    if (!saveResult.ok) return saveResult;

    await this.notifications.notifyOrderConfirmation(order);
    await this.events.publish(new OrderCreatedEvent(order));

    return Ok(order);
  }
}

// infrastructure/postgres-order-repository.ts - Implements domain interface
import { OrderRepository } from '../domain/ports';
import { Order } from '../domain/order';

class PostgresOrderRepository implements OrderRepository {
  constructor(private db: PostgresClient) {}

  async findById(id: OrderId): Promise<Result<Order, NotFoundError>> {
    const row = await this.db.query(
      'SELECT * FROM orders WHERE id = $1',
      [id.value]
    );

    if (!row) {
      return Err({ type: 'not_found', entity: 'Order', id: id.value });
    }

    return Ok(this.toDomain(row));
  }

  async save(order: Order): Promise<Result<void, PersistenceError>> {
    await this.db.query(
      'INSERT INTO orders (id, customer_id, status, total) VALUES ($1, $2, $3, $4)',
      [order.id.value, order.customerId.value, order.status, order.total.cents]
    );
    return Ok(undefined);
  }

  private toDomain(row: OrderRow): Order {
    // Mapping logic
  }
}

// Composition root - wire everything together
// This is the ONLY place that knows about concrete implementations
function createOrderService(): OrderService {
  const db = new PostgresClient(config.database);
  const stripe = new StripeClient(config.stripe);
  const sendgrid = new SendGridClient(config.sendgrid);

  return new OrderService(
    new PostgresOrderRepository(db),
    new StripePaymentGateway(stripe),
    new SendGridNotificationService(sendgrid),
    new EventBus()
  );
}
```
