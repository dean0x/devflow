# SOLID Violation Examples

Extended examples for SOLID principle violations. Reference from main SKILL.md.

## Single Responsibility Principle (SRP)

### Extended Example: Monolithic Controller

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

// CORRECT: Proper separation of concerns
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

### Reasons to Change Analysis

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

## Open/Closed Principle (OCP)

### Extended Example: Payment Processing

```typescript
// VIOLATION: Every new payment method requires modifying existing code
class PaymentProcessor {
  process(method: string, amount: number) {
    if (method === 'credit_card') {
      // Credit card logic
      return this.processCreditCard(amount);
    } else if (method === 'paypal') {
      // PayPal logic
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

## Liskov Substitution Principle (LSP)

### Extended Example: File Storage

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

// CORRECT: Proper interface segregation
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

## Interface Segregation Principle (ISP)

### Extended Example: Document Handling

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

// CORRECT: Segregated interfaces by capability
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

## Dependency Inversion Principle (DIP)

### Extended Example: Notification System

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

// CORRECT: Depend on abstractions, inject implementations
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

    // Return first error or success
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
