# Architecture Violation Examples

Extended violation patterns for architecture reviews. Reference from main SKILL.md. Full bibliography: `sources.md`.

## SOLID Violations [2]

### Single Responsibility Principle (SRP) [1][2][8]

Martin (2000): "A class should have one, and only one, reason to change." [2] Stevens, Myers & Constantine (1974): mixing concerns creates temporal cohesion — the weakest form. [8]

```typescript
// VIOLATION: Controller handles HTTP, validation, business logic, DB, email, logging
class UserController {
  async createUser(req, res) {
    console.log(`Creating user: ${req.body.email}`);
    if (!req.body.email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
    if (req.body.password.length < 8) return res.status(400).json({ error: 'Password too short' });
    const existingUser = await db.users.findOne({ email: req.body.email });
    if (existingUser) return res.status(409).json({ error: 'User exists' });
    const hash = await bcrypt.hash(req.body.password, 12);
    const user = await db.users.create({ email: req.body.email, password: hash });
    await sendEmail(user.email, 'Welcome!', welcomeTemplate(user));
    await analytics.track('user_created', { userId: user.id });
    res.json({ id: user.id, email: user.email });
  }
}
```

**Reasons to Change** [2]: HTTP contract, validation rules, password hashing, DB schema, email provider, analytics — 6 separate reasons. Each = separate class.

---

### Open/Closed Principle (OCP) [2]

Every new feature requires modifying existing code — accumulates risk with each change. [2]

```typescript
// VIOLATION: Every new payment method requires modifying PaymentProcessor
class PaymentProcessor {
  process(method: string, amount: number) {
    if (method === 'credit_card') return this.processCreditCard(amount);
    else if (method === 'paypal') return this.processPayPal(amount);
    else if (method === 'stripe') return this.processStripe(amount);
    else if (method === 'apple_pay') return this.processApplePay(amount);
    throw new Error('Unknown payment method');
  }
}
// Adding apple_pay required modifying existing tested code — OCP violation
```

---

### Liskov Substitution Principle (LSP) [3]

Liskov & Wing (1994) formal precondition rule: a subtype cannot strengthen preconditions (it may weaken them). Throwing where the parent doesn't throw is the most common violation. [3]

```typescript
// VIOLATION: Subclass throws where parent does not — breaks substitutability
class FileStorage {
  write(path: string, content: string): void { fs.writeFileSync(path, content); }
}

class ReadOnlyStorage extends FileStorage {
  write(path: string, content: string): void {
    throw new Error('Cannot write to read-only storage');  // Breaks LSP [3]
  }
}

function backup(storage: FileStorage, data: string) {
  storage.write('/backup/data.txt', data);  // Throws at runtime if ReadOnlyStorage
}
```

---

### Interface Segregation Principle (ISP) [2]

Fat interfaces force unnecessary implementations — "interface pollution." [2]

```typescript
// VIOLATION: Fat interface forces all implementors to handle fax
interface DocumentHandler {
  open(path: string): Document;
  save(doc: Document): void;
  print(doc: Document): void;
  email(doc: Document, to: string): void;
  fax(doc: Document, number: string): void;    // Not all handlers support fax
  encrypt(doc: Document): Document;
  compress(doc: Document): Buffer;
}

class PdfHandler implements DocumentHandler {
  fax(doc: Document, number: string) {
    throw new Error('PDF handler does not support fax');  // Forced ISP violation [2]
  }
  // ... other methods
}
```

---

### Dependency Inversion Principle (DIP) [2][18]

High-level module depends on low-level implementations — untestable, brittle to provider changes. [2][18]

```typescript
// VIOLATION: High-level module hard-codes low-level dependencies
class NotificationService {
  private twilioClient = new TwilioClient(process.env.TWILIO_KEY);
  private sendgridClient = new SendGridClient(process.env.SENDGRID_KEY);

  async notifyUser(userId: string, message: string) {
    const user = await db.users.findById(userId);
    if (user.preferences.sms) await this.twilioClient.sendSMS(user.phone, message);
    if (user.preferences.email) await this.sendgridClient.sendEmail(user.email, 'Notification', message);
  }
  // Problems: requires real API keys to test; adding a channel modifies this class [18]
}
```

---

## Coupling Violations [8][17][19]

### Circular Dependencies [19]

Moseley & Marks (2006): circular dependencies are accidental complexity — they exist because of poor module decomposition, not business requirements. [19]

```typescript
// VIOLATION: Services depend on each other — neither can be instantiated alone
// user.service.ts
import { OrderService } from './order.service';
class UserService {
  constructor(private orderService: OrderService) {}
  async deleteUser(userId: string) {
    await this.orderService.cancelAllUserOrders(userId);  // Needs OrderService
    await this.repository.delete(userId);
  }
}

// order.service.ts
import { UserService } from './user.service';
class OrderService {
  constructor(private userService: UserService) {}
  async createOrder(userId: string, items: Item[]) {
    const user = await this.userService.getUser(userId);  // Needs UserService
    if (user.creditLimit < this.calculateTotal(items)) throw new Error('Credit exceeded');
  }
}
// Cannot instantiate either without the other [19]
```

---

### Feature Envy [21][17]

Fowler: feature envy means a method seems more interested in a class other than the one it is in. [21] Violates Law of Demeter. [17]

```typescript
// VIOLATION: OrderProcessor reaches deeply into Order internals
class OrderProcessor {
  async process(order: Order) {
    // Violates Law of Demeter — too many dots [17]
    const customerName = order.customer.profile.name;
    const email = order.customer.profile.contact.email;
    const shippingAddress = order.customer.addresses.find(a => a.type === 'shipping');

    // Business logic that belongs in Order
    let subtotal = 0;
    for (const item of order.items) {
      const basePrice = item.product.pricing.basePrice;
      const discount = item.product.pricing.activePromotions
        .filter(p => p.validUntil > new Date())
        .reduce((sum, p) => sum + p.discountPercent, 0);
      subtotal += basePrice * item.quantity * (1 - discount / 100);
    }
    // This logic should be order.getSubtotal() [17][21]
  }
}
```

---

### Tight Coupling [8][18]

Stevens et al. (1974): content coupling (direct instantiation) is the tightest and worst form. [8]

```typescript
// VIOLATION: Direct instantiation — requires real services for every test [8][18]
class ReportGenerator {
  async generateSalesReport(startDate: Date, endDate: Date) {
    const db = new PostgresDatabase({ host: process.env.DB_HOST });
    const cache = new RedisCache({ url: process.env.REDIS_URL });
    const formatter = new ExcelFormatter();
    const storage = new S3Storage({ bucket: process.env.S3_BUCKET });
    const notifier = new SlackNotifier(process.env.SLACK_WEBHOOK);
    // Can't test without real DB/Redis/S3/Slack; can't swap providers [8]
    // ...
  }
}
```

---

## Layering Violations [5][7][9][10]

### Skipping Layers [5][7]

Clean Architecture (Martin, 2017): the Dependency Rule — each layer may only depend on the layer directly inside it. [5]

```typescript
// VIOLATION: Controller bypasses service — accesses DB, cache, external APIs directly
class ProductController {
  async getProduct(req, res) {
    const cached = await redis.get(`product:${req.params.id}`);  // Direct cache
    if (cached) return res.json(JSON.parse(cached));
    const product = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);  // Direct DB
    const inventory = await fetch(`http://inventory-service/api/stock/${req.params.id}`).then(r => r.json());
    const result = { ...product, inStock: inventory.quantity > 0 };
    await redis.setex(`product:${req.params.id}`, 300, JSON.stringify(result));  // Direct cache write
    res.json(result);
    // Business logic, caching, external API calls all in controller [5]
  }
}
```

---

### Leaky Abstractions [9][7]

Ousterhout (2018): shallow modules expose more complexity than they hide. ORM decorators on domain models make the domain layer shallow — it exposes infrastructure decisions. [9]

```typescript
// VIOLATION: ORM/database details leak into domain model
@Entity('users')
class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 255 }) email: string;
  @ManyToOne(() => Organization, { lazy: true }) organization: Promise<Organization>;  // Lazy loading = infra detail
  @DeleteDateColumn() deletedAt: Date | null;  // Soft delete = infra pattern
  // Domain polluted with @Column, @Entity, TypeORM-specific types [9]
}

// Service layer leaks ORM syntax
class UserService {
  async getUser(id: string) {
    const user = await this.repository.findOne({
      where: { id, deletedAt: IsNull() },  // ORM-specific syntax in service [7]
      relations: ['organization'],
    });
    const org = await user.organization;  // Manually handling lazy loading — infra in service
  }
}
```

---

### Wrong Direction Dependencies [5][10]

Hexagonal Architecture (Cockburn, 2005): the application core must not depend on adapters. [10] Clean Architecture (Martin, 2017): domain imports no infrastructure. [5]

```typescript
// VIOLATION: Domain layer imports from infrastructure
// domain/order.ts
import { PostgresClient } from '../infrastructure/postgres';
import { StripeClient } from '../infrastructure/stripe';

class Order {
  async save() {
    await PostgresClient.getInstance().query('INSERT INTO orders ...', [this.id]);
  }
  async processPayment() {
    const stripe = new StripeClient(process.env.STRIPE_KEY);
    await stripe.charges.create({ amount: this.total });
  }
  // Domain knows about specific providers — violates Dependency Rule [5]
  // Cannot test domain logic without running real infrastructure
}
```

**Correct dependency direction** [5][10]:
```
Infrastructure → Application → Domain
(adapters)       (services)    (pure rules, defines interfaces)
```

---

## Modularity Violations [1][9]

### God Class [1][6]

Parnas (1972): information hiding means each module should hide a design decision. A god class hides nothing — it exposes everything. [1] Evans (2003): bounded contexts prevent god objects by containing model scope. [6]

**Signs** [1][9]:
- 500+ lines
- More than 10 public methods
- Constructor with more than 7 parameters
- Class name ending in `Manager`, `Handler`, `Processor`, `Utils`
- Deep nesting (4+ levels)

### Inappropriate Intimacy [21][17]

Accessing private/internal state of another class via type assertions or deep dot chains. [21][17]

```typescript
// VIOLATION: Accessing private implementation details
const cart = new ShoppingCart();
const spy = jest.spyOn(cart as any, '_updateTotal');  // Accessing private member [21]

// VIOLATION: Deep chain — knowing too much about structure [17]
const rate = order.customer?.addresses?.find(a => a.type === 'billing')?.taxZone?.rate || 0;
// Should be: order.getBillingTaxRate()
```
