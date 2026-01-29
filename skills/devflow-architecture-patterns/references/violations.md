# Architecture Violation Examples

Extended violation patterns for architecture reviews. Reference from main SKILL.md.

## SOLID Violations

### Single Responsibility Principle (SRP)

**Monolithic Controller**
```typescript
// VIOLATION: Controller handles HTTP, validation, business logic, DB, email, logging
class UserController {
  async createUser(req, res) {
    // Logging
    console.log(`Creating user: ${req.body.email}`);

    // Validation
    if (!req.body.email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (req.body.password.length < 8) {
      return res.status(400).json({ error: 'Password too short' });
    }

    // Business logic
    const existingUser = await db.users.findOne({ email: req.body.email });
    if (existingUser) {
      return res.status(409).json({ error: 'User exists' });
    }

    // Password hashing
    const hash = await bcrypt.hash(req.body.password, 12);

    // Database operation
    const user = await db.users.create({
      email: req.body.email,
      password: hash,
      createdAt: new Date()
    });

    // Email sending
    await sendEmail(user.email, 'Welcome!', welcomeTemplate(user));

    // Analytics
    await analytics.track('user_created', { userId: user.id });

    // Response formatting
    res.json({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt
    });
  }
}
```

**Reasons to Change Analysis**

| Responsibility | Reason to Change |
|----------------|------------------|
| HTTP handling | API contract changes |
| Validation | Business rules change |
| Password hashing | Security requirements change |
| Database access | Schema or ORM changes |
| Email sending | Email provider changes |
| Analytics | Tracking requirements change |
| Logging | Logging format changes |

Each reason = separate class.

---

### Open/Closed Principle (OCP)

**Payment Processing Without Strategy**
```typescript
// VIOLATION: Every new payment method requires modifying existing code
class PaymentProcessor {
  process(method: string, amount: number) {
    if (method === 'credit_card') {
      return this.processCreditCard(amount);
    } else if (method === 'paypal') {
      return this.processPayPal(amount);
    } else if (method === 'stripe') {
      // Stripe logic - added later, modified existing class
      return this.processStripe(amount);
    } else if (method === 'apple_pay') {
      // Apple Pay - yet another modification
      return this.processApplePay(amount);
    }
    throw new Error('Unknown payment method');
  }

  private processCreditCard(amount: number) { /* ... */ }
  private processPayPal(amount: number) { /* ... */ }
  private processStripe(amount: number) { /* ... */ }
  private processApplePay(amount: number) { /* ... */ }
}
```

---

### Liskov Substitution Principle (LSP)

**Subclass Changing Behavior**
```typescript
// VIOLATION: Subclass changes behavior unexpectedly
class FileStorage {
  read(path: string): string {
    return fs.readFileSync(path, 'utf8');
  }

  write(path: string, content: string): void {
    fs.writeFileSync(path, content);
  }

  delete(path: string): void {
    fs.unlinkSync(path);
  }
}

class ReadOnlyStorage extends FileStorage {
  write(path: string, content: string): void {
    throw new Error('Cannot write to read-only storage');  // Breaks LSP!
  }

  delete(path: string): void {
    throw new Error('Cannot delete from read-only storage');  // Breaks LSP!
  }
}

// Using the subclass breaks code expecting FileStorage behavior
function backup(storage: FileStorage, data: string) {
  storage.write('/backup/data.txt', data);  // Throws if ReadOnlyStorage!
}
```

---

### Interface Segregation Principle (ISP)

**Fat Interface**
```typescript
// VIOLATION: Fat interface forces unnecessary implementations
interface DocumentHandler {
  open(path: string): Document;
  save(doc: Document): void;
  print(doc: Document): void;
  email(doc: Document, to: string): void;
  fax(doc: Document, number: string): void;
  encrypt(doc: Document): Document;
  compress(doc: Document): Buffer;
  watermark(doc: Document, text: string): Document;
}

// PDF handler doesn't need fax capability
class PdfHandler implements DocumentHandler {
  open(path: string) { /* OK */ }
  save(doc: Document) { /* OK */ }
  print(doc: Document) { /* OK */ }
  email(doc: Document, to: string) { /* OK */ }
  fax(doc: Document, number: string) {
    throw new Error('PDF handler does not support fax');  // Forced implementation
  }
  encrypt(doc: Document) { /* OK */ }
  compress(doc: Document) { /* OK */ }
  watermark(doc: Document, text: string) { /* OK */ }
}
```

---

### Dependency Inversion Principle (DIP)

**High-Level Module Depends on Low-Level**
```typescript
// VIOLATION: High-level module depends on low-level implementations
class NotificationService {
  private twilioClient = new TwilioClient(process.env.TWILIO_KEY);
  private sendgridClient = new SendGridClient(process.env.SENDGRID_KEY);
  private slackClient = new SlackClient(process.env.SLACK_TOKEN);

  async notifyUser(userId: string, message: string) {
    const user = await db.users.findById(userId);

    if (user.preferences.sms) {
      await this.twilioClient.sendSMS(user.phone, message);
    }
    if (user.preferences.email) {
      await this.sendgridClient.sendEmail(user.email, 'Notification', message);
    }
    if (user.preferences.slack) {
      await this.slackClient.postMessage(user.slackId, message);
    }
  }
}

// Problems:
// 1. Can't test without real API keys
// 2. Adding new channel requires modifying this class
// 3. Tightly coupled to specific providers
// 4. Can't swap providers easily
```

---

## Coupling Violations

### Circular Dependencies

**User-Order Cycle**
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
// const userService = new UserService(???); // Need OrderService
// const orderService = new OrderService(???); // Need UserService
```

**Detection Pattern**
```bash
# Find potential circular dependencies
grep -rn "import.*from.*service" --include="*service*.ts" | \
  awk -F: '{print $1, $3}' | sort | uniq

# Check with tooling
npx madge --circular src/
```

---

### Feature Envy

**Order Processing Reaching Into Internals**
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
```

**Signs of Feature Envy**

| Pattern | Example | Problem |
|---------|---------|---------|
| Chain of dots | `order.customer.profile.contact.email` | Knows too much about structure |
| Repeated prefix | Many lines starting with `order.items.` | Should be method on Order |
| Type casting | `(item.product as SpecialProduct).specialProperty` | Missing polymorphism |
| Null checks | `order.customer?.addresses?.find(...)?.zone` | Missing null object pattern |

---

### Tight Coupling

**Report Generator Direct Instantiation**
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
```

---

## Layering Violations

### Skipping Layers

**Controller Bypassing Service Layer**
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
```

---

### Leaky Abstractions

**ORM Leakage Into Domain**
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
```

---

### Wrong Direction Dependencies

**Domain Depending on Infrastructure**
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
```

**Dependency Direction Rules**

```
+------------------+
|  Infrastructure  |  <- Implements domain interfaces
+------------------+
         |
         v
+------------------+
|   Application    |  <- Orchestrates domain, uses interfaces
+------------------+
         |
         v
+------------------+
|     Domain       |  <- Pure business logic, defines interfaces
+------------------+

Domain: No imports from other layers
Application: Imports from Domain only
Infrastructure: Imports from Domain and Application
```
