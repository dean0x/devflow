# Coupling Issue Examples

Extended examples for coupling issues. Reference from main SKILL.md.

## Circular Dependencies

### Extended Example: User-Order Cycle

```typescript
// VIOLATION: Services depend on each other creating a cycle
// user.service.ts
import { OrderService } from './order.service';

class UserService {
  constructor(private orderService: OrderService) {}

  async deleteUser(userId: string) {
    // Need to cancel all user's orders first
    await this.orderService.cancelAllUserOrders(userId);
    await this.repository.delete(userId);
  }

  async getUserWithOrderTotal(userId: string) {
    const user = await this.repository.findById(userId);
    user.totalSpent = await this.orderService.calculateUserTotal(userId);
    return user;
  }
}

// order.service.ts
import { UserService } from './user.service';

class OrderService {
  constructor(private userService: UserService) {}

  async createOrder(userId: string, items: Item[]) {
    // Need to check user's credit limit
    const user = await this.userService.getUser(userId);
    if (user.creditLimit < this.calculateTotal(items)) {
      throw new Error('Credit limit exceeded');
    }
    return this.repository.create({ userId, items });
  }

  async cancelAllUserOrders(userId: string) {
    // Check if user exists first
    const user = await this.userService.getUser(userId);
    if (!user) throw new Error('User not found');

    await this.repository.cancelByUserId(userId);
  }
}

// PROBLEM: Cannot instantiate either without the other
// This fails:
// const userService = new UserService(???); // Need OrderService
// const orderService = new OrderService(???); // Need UserService

// SOLUTION 1: Extract shared interface/events
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

// SOLUTION 2: Extract to orchestration layer
// user-order.facade.ts
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

### Detection Pattern

```bash
# Find potential circular dependencies
# Look for files that import each other

# Step 1: Find all imports in service files
grep -rn "import.*from.*service" --include="*service*.ts" | \
  awk -F: '{print $1, $3}' | \
  sort | uniq

# Step 2: Build dependency graph
# If A -> B and B -> A, you have a cycle

# Step 3: Check with tooling
npx madge --circular src/
```

---

## Feature Envy

### Extended Example: Order Processing

```typescript
// VIOLATION: OrderProcessor reaches deeply into Order internals
class OrderProcessor {
  async process(order: Order) {
    // Reaching into customer details
    const customerName = order.customer.profile.name;
    const customerEmail = order.customer.profile.contact.email;
    const customerPhone = order.customer.profile.contact.phone;
    const shippingAddress = order.customer.addresses.find(a => a.type === 'shipping');
    const billingAddress = order.customer.addresses.find(a => a.type === 'billing');

    // Reaching into order items
    let subtotal = 0;
    for (const item of order.items) {
      const basePrice = item.product.pricing.basePrice;
      const discount = item.product.pricing.activePromotions
        .filter(p => p.validUntil > new Date())
        .reduce((sum, p) => sum + p.discountPercent, 0);
      const quantity = item.quantity;
      const itemTotal = basePrice * quantity * (1 - discount / 100);
      subtotal += itemTotal;
    }

    // Reaching into shipping details
    const weight = order.items.reduce((sum, i) => sum + i.product.dimensions.weight * i.quantity, 0);
    const shippingCost = this.calculateShipping(weight, shippingAddress.zone);

    // Reaching into tax calculation
    const taxRate = order.customer.addresses
      .find(a => a.type === 'billing')
      ?.taxZone?.rate || 0;
    const tax = subtotal * taxRate;

    // ... 50 more lines of reaching into order internals
  }
}

// CORRECT: Move behavior to the objects that own the data
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

// Now OrderProcessor is simple
class OrderProcessor {
  async process(order: Order) {
    const total = order.getTotal();
    const shippingLabel = order.customer.formatForShipping();
    // Simple orchestration, not data manipulation
  }
}
```

### Signs of Feature Envy

| Pattern | Example | Problem |
|---------|---------|---------|
| Chain of dots | `order.customer.profile.contact.email` | Knows too much about structure |
| Repeated prefix | Many lines starting with `order.items.` | Should be method on Order |
| Type casting | `(item.product as SpecialProduct).specialProperty` | Missing polymorphism |
| Null checks | `order.customer?.addresses?.find(...)?.zone` | Missing null object pattern |

---

## Tight Coupling

### Extended Example: Report Generator

```typescript
// VIOLATION: ReportGenerator directly instantiates all dependencies
class ReportGenerator {
  async generateSalesReport(startDate: Date, endDate: Date) {
    // Direct instantiation - can't mock for tests
    const db = new PostgresDatabase({
      host: process.env.DB_HOST,
      password: process.env.DB_PASS
    });

    // Direct instantiation - tied to specific implementation
    const cache = new RedisCache({
      url: process.env.REDIS_URL
    });

    // Check cache first
    const cacheKey = `report:${startDate}:${endDate}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    // Query database directly
    const sales = await db.query(`
      SELECT * FROM sales
      WHERE date BETWEEN $1 AND $2
    `, [startDate, endDate]);

    // Direct instantiation of formatter
    const formatter = new ExcelFormatter();
    const report = formatter.format(sales);

    // Direct instantiation of storage
    const storage = new S3Storage({
      bucket: process.env.S3_BUCKET
    });
    await storage.upload(`reports/sales-${Date.now()}.xlsx`, report);

    // Direct instantiation of notifier
    const notifier = new SlackNotifier(process.env.SLACK_WEBHOOK);
    await notifier.send('Sales report generated');

    await cache.set(cacheKey, report, 3600);
    return report;
  }
}

// Problems:
// 1. Requires real DB/Redis/S3/Slack for testing
// 2. Can't change providers without modifying this class
// 3. All configuration is hardcoded to environment variables
// 4. No way to use different implementations for different contexts

// CORRECT: Inject all dependencies
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

    // Check cache
    const cached = await this.cache.get<ReportResult>(cacheKey);
    if (cached) {
      this.logger.info('Report served from cache', { cacheKey });
      return Ok(cached);
    }

    try {
      // Query data
      const sales = await this.dataSource.query<SaleRecord>(
        'SELECT * FROM sales WHERE date BETWEEN $1 AND $2',
        [startDate, endDate]
      );

      // Format report
      const report = this.formatter.format(sales);

      // Store report
      const url = await this.storage.upload(
        `reports/sales-${Date.now()}.xlsx`,
        report
      );

      // Notify
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
