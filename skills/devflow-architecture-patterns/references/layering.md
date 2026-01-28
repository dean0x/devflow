# Layering Violation Examples

Extended examples for layering violations. Reference from main SKILL.md.

## Skipping Layers

### Extended Example: Controller Bypassing Service Layer

```typescript
// VIOLATION: Controller directly accesses database, cache, and external APIs
class ProductController {
  async getProduct(req, res) {
    const productId = req.params.id;

    // Direct cache access
    const cached = await redis.get(`product:${productId}`);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // Direct database access
    const product = await db.query(
      'SELECT * FROM products WHERE id = $1',
      [productId]
    );

    if (!product) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Direct external API call
    const inventory = await fetch(
      `http://inventory-service/api/stock/${productId}`
    ).then(r => r.json());

    // Business logic in controller
    const result = {
      ...product,
      inStock: inventory.quantity > 0,
      availability: inventory.quantity > 10 ? 'high' : inventory.quantity > 0 ? 'low' : 'none'
    };

    // Direct cache write
    await redis.setex(`product:${productId}`, 300, JSON.stringify(result));

    res.json(result);
  }

  async updateProduct(req, res) {
    // Direct database update
    await db.query(
      'UPDATE products SET name = $1, price = $2 WHERE id = $3',
      [req.body.name, req.body.price, req.params.id]
    );

    // Direct cache invalidation
    await redis.del(`product:${req.params.id}`);
    await redis.del('products:list');

    // Direct audit log
    await db.query(
      'INSERT INTO audit_log (action, entity, entity_id, data) VALUES ($1, $2, $3, $4)',
      ['UPDATE', 'product', req.params.id, JSON.stringify(req.body)]
    );

    res.json({ success: true });
  }
}

// CORRECT: Proper layered architecture

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
    // Check cache
    const cached = await this.cacheService.get<ProductDTO>(`product:${id}`);
    if (cached) return Ok(cached);

    // Get from repository
    const product = await this.repository.findById(id);
    if (!product.ok) return product;

    // Enrich with inventory
    const inventory = await this.inventoryClient.getStock(id);
    const enriched = this.enrichWithInventory(product.value, inventory);

    // Cache result
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

    // Invalidate cache
    await this.cacheService.invalidate(`product:${id}`);
    await this.cacheService.invalidate('products:list');

    // Record audit
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

### Layer Responsibility Summary

| Layer | Responsibility | Depends On |
|-------|---------------|------------|
| Controller | HTTP, request/response, auth | Service |
| Service | Business logic, orchestration | Repository, Clients |
| Repository | Data access, mapping | Database |
| Client | External service communication | External APIs |

---

## Leaky Abstractions

### Extended Example: ORM Leakage

```typescript
// VIOLATION: ORM/database details leak into domain and service layers

// Domain model polluted with ORM decorators and infrastructure
@Entity('users')
class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255, select: false })
  password: string;

  @ManyToOne(() => Organization, { lazy: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Promise<Organization>;  // Lazy loading leaks into domain

  @OneToMany(() => Order, order => order.user)
  orders: Order[];

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;  // JSONB is infrastructure detail

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;  // Soft delete is infrastructure pattern
}

// Service layer knows about ORM internals
class UserService {
  async getUser(id: string) {
    const user = await this.repository.findOne({
      where: { id, deletedAt: IsNull() },  // ORM-specific query syntax
      relations: ['organization', 'orders'],  // ORM-specific loading
      select: ['id', 'email', 'createdAt']  // ORM-specific projection
    });

    // Manually handling lazy loading - ORM detail in service
    const org = await user.organization;

    return user;
  }
}

// CORRECT: Clean separation with mapping at repository boundary

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

## Wrong Direction Dependencies

### Extended Example: Domain Depending on Infrastructure

```typescript
// VIOLATION: Domain layer imports from infrastructure layer

// domain/order.ts
import { PostgresClient } from '../infrastructure/postgres';
import { RedisCache } from '../infrastructure/redis';
import { StripeClient } from '../infrastructure/stripe';
import { SendGridClient } from '../infrastructure/sendgrid';

class Order {
  async save() {
    // Domain knows about specific database
    await PostgresClient.getInstance().query(
      'INSERT INTO orders ...',
      [this.id, this.items, this.total]
    );

    // Domain knows about caching
    await RedisCache.getInstance().del(`user:${this.userId}:orders`);
  }

  async processPayment() {
    // Domain knows about specific payment provider
    const stripe = new StripeClient(process.env.STRIPE_KEY);
    await stripe.charges.create({
      amount: this.total,
      currency: 'usd',
      source: this.paymentSource
    });
  }

  async notifyCustomer() {
    // Domain knows about specific email provider
    const sendgrid = new SendGridClient(process.env.SENDGRID_KEY);
    await sendgrid.send({
      to: this.customerEmail,
      template: 'order_confirmation',
      data: { orderId: this.id }
    });
  }
}

// CORRECT: Clean Architecture - dependencies point inward

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
    // Create domain object
    const order = Order.create(command);

    // Use injected infrastructure
    const paymentResult = await this.paymentGateway.charge(
      order.total,
      command.paymentSource
    );
    if (!paymentResult.ok) return paymentResult;

    // Persist through interface
    const saveResult = await this.repository.save(order);
    if (!saveResult.ok) return saveResult;

    // Notify through interface
    await this.notifications.notifyOrderConfirmation(order);

    // Publish domain event
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

### Dependency Direction Rules

```
+------------------+
|  Infrastructure  |  ← Implements domain interfaces
+------------------+
         |
         ↓
+------------------+
|   Application    |  ← Orchestrates domain, uses interfaces
+------------------+
         |
         ↓
+------------------+
|     Domain       |  ← Pure business logic, defines interfaces
+------------------+

Domain: No imports from other layers
Application: Imports from Domain only
Infrastructure: Imports from Domain and Application
```
