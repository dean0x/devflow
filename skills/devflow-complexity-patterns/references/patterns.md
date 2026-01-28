# Complexity Resolution Patterns

Correct patterns for addressing complexity issues.

---

## Deep Nesting Solutions

### Early Returns

```typescript
// Extract nested conditionals with early returns
function processOrder(order: Order) {
  if (!order?.items) return;

  for (const item of order.items) {
    processItem(item);
  }
}

function processItem(item: OrderItem) {
  if (item.quantity <= 0) return;
  if (!item.product?.inStock) return;

  // Actual logic at top level
}
```

### Guard Clauses

```typescript
// Validate preconditions first
async function updateUser(userId: string, data: UpdateData) {
  // Guards at the top
  if (!userId) return Err({ type: 'InvalidInput', field: 'userId' });
  if (!data) return Err({ type: 'InvalidInput', field: 'data' });

  const user = await userRepo.findById(userId);
  if (!user) return Err({ type: 'NotFound', id: userId });
  if (!user.canBeUpdated) return Err({ type: 'Forbidden' });

  // Happy path at normal indentation
  const updated = { ...user, ...data };
  return Ok(await userRepo.save(updated));
}
```

### Extract and Compose

```typescript
// Break nested try-catch into composed functions
async function fetchAndProcess(url: string): Promise<Result<void, Error>> {
  const response = await safeFetch(url);
  if (!response.ok) return response;

  const data = await safeParseJson(response.value);
  if (!data.ok) return data;

  return processItems(data.value.items);
}

async function safeFetch(url: string): Promise<Result<Response, Error>> {
  try {
    const response = await fetch(url);
    if (!response.ok) return Err(new Error(`HTTP ${response.status}`));
    return Ok(response);
  } catch (error) {
    return Err(error as Error);
  }
}
```

---

## Long Function Solutions

### Extract Logical Units

```typescript
// Break monolithic function into composed steps
async function handleCheckout(cart: Cart, user: User) {
  const validated = validateCart(cart);
  const priced = calculatePricing(validated);
  const reserved = await reserveInventory(priced);
  const payment = await processPayment(reserved, user);
  await sendNotifications(payment);
  trackAnalytics(payment);
  return payment;
}
```

### Pipeline Pattern

```typescript
// Chain transformations clearly
async function userRegistrationFlow(formData: FormData): Promise<Result<User, Error>> {
  return pipe(
    formData,
    validateFormData,
    sanitizeInput,
    checkForDuplicates,
    hashPassword,
    createUserRecord,
    sendVerificationEmail,
    createSession
  );
}
```

### Command Pattern

```typescript
// Encapsulate each step as a command
class CheckoutProcessor {
  private steps: CheckoutStep[] = [
    new ValidateCartStep(),
    new CalculatePricingStep(),
    new ReserveInventoryStep(),
    new ProcessPaymentStep(),
    new SendNotificationsStep(),
  ];

  async process(cart: Cart, user: User): Promise<CheckoutResult> {
    let context = { cart, user };
    for (const step of this.steps) {
      const result = await step.execute(context);
      if (!result.ok) return result;
      context = result.value;
    }
    return Ok(context);
  }
}
```

---

## High Cyclomatic Complexity Solutions

### Data-Driven Approach

```typescript
// Replace decision tree with lookup
const categoryRules: Record<string, (item: Item) => string> = {
  'A': categorizeTypeA,
  'B': categorizeTypeB,
  'C': categorizeTypeC,
};

function categorize(item: Item): string {
  const handler = categoryRules[item.type];
  return handler ? handler(item) : 'unknown';
}

function categorizeTypeA(item: Item): string {
  const size = item.size > 10 ? 'large' : 'small';
  const color = item.color || 'other';
  return `A-${size}-${color}`;
}
```

### Strategy Pattern

```typescript
// Encapsulate variants in classes
interface EventHandler {
  canHandle(event: Event): boolean;
  handle(event: Event): Promise<void>;
}

class UserCreatedHandler implements EventHandler {
  canHandle(event: Event) { return event.type === 'USER_CREATED'; }
  async handle(event: Event) { /* focused logic */ }
}

class EventProcessor {
  constructor(private handlers: EventHandler[]) {}

  async process(event: Event) {
    const handler = this.handlers.find(h => h.canHandle(event));
    if (handler) await handler.handle(event);
  }
}
```

### Polymorphism

```typescript
// Use type system to eliminate conditionals
abstract class User {
  abstract getPermissions(): Permission[];
  abstract canAccessResource(resource: Resource): boolean;
}

class AdminUser extends User {
  getPermissions() { return ALL_PERMISSIONS; }
  canAccessResource() { return true; }
}

class RegularUser extends User {
  getPermissions() { return BASIC_PERMISSIONS; }
  canAccessResource(resource: Resource) {
    return resource.isPublic || this.owns(resource);
  }
}
```

---

## Magic Value Solutions

### Named Constants

```typescript
// Extract literals to named constants
const OrderStatus = {
  PENDING: 1,
  PROCESSING: 2,
  COMPLETED: 3,
} as const;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 5;

if (status === OrderStatus.COMPLETED) {
  setTimeout(callback, ONE_DAY_MS);
  retry(MAX_RETRIES);
}
```

### Configuration Objects

```typescript
// Centralize business rules
const ShippingRates = {
  HEAVY_ITEM_THRESHOLD: 50,      // kg
  LONG_DISTANCE_THRESHOLD: 500,  // km
  rates: {
    heavy: 29.99,
    longDistance: 19.99,
    bulky: 24.99,
    standard: 9.99,
  }
} as const;

function calculateShipping(weight: number, distance: number): number {
  if (weight > ShippingRates.HEAVY_ITEM_THRESHOLD) return ShippingRates.rates.heavy;
  if (distance > ShippingRates.LONG_DISTANCE_THRESHOLD) return ShippingRates.rates.longDistance;
  return ShippingRates.rates.standard;
}
```

---

## Complex Expression Solutions

### Break Into Named Steps

```typescript
// Replace chained operations with named steps
const activePremiumUsers = data.filter(isActivePremium);
const withScores = activePremiumUsers.map(calculateScore);
const topScore = findHighestScore(withScores);

function isActivePremium(user: User) {
  return user.active && user.type === 'premium';
}

function calculateScore(user: User) {
  const multiplier = user.bonus ? 1.5 : 1;
  return { ...user, score: (user.points * multiplier) / user.level };
}

function findHighestScore(users: ScoredUser[]) {
  return users.sort((a, b) => b.score - a.score)[0]?.score ?? 0;
}
```

### Replace Ternary Chains

```typescript
// Use mapping or switch for multiple conditions
function getUserStatus(user: User): string {
  if (user.isAdmin) return 'admin';
  if (user.isModerator) return 'moderator';
  if (user.isVerified) return 'verified';
  if (user.isPending) return 'pending';
  return 'guest';
}

// Or use a lookup
const statusPriority = [
  { check: (u: User) => u.isAdmin, status: 'admin' },
  { check: (u: User) => u.isModerator, status: 'moderator' },
  { check: (u: User) => u.isVerified, status: 'verified' },
  { check: (u: User) => u.isPending, status: 'pending' },
];

function getUserStatus(user: User): string {
  return statusPriority.find(p => p.check(user))?.status ?? 'guest';
}
```

---

## Naming Solutions

### Descriptive Names

```typescript
// Replace cryptic with descriptive
const now = new Date();
const oneDayAgo = now.getTime() - ONE_DAY_MS;
const recentItems = items.filter(item => item.timestamp > oneDayAgo);
const totalPrice = recentItems.reduce((sum, item) => sum + item.price, 0);
```

### Intent-Revealing Names

```typescript
// Name functions by what they do
function findOverdueInvoices(invoices: Invoice[]): Invoice[] {
  const thirtyDaysAgo = subDays(new Date(), 30);
  return invoices.filter(inv => inv.dueDate < thirtyDaysAgo && !inv.paid);
}

// Not: function process(data) or function filter(items)
```

---

## Code Duplication Solutions

### Generic Validation Framework

```typescript
// Extract common pattern
type ValidationRule<T> = (value: T) => string | null;

function validate<T>(value: T, rules: ValidationRule<T>[]): ValidationResult {
  for (const rule of rules) {
    const error = rule(value);
    if (error) return { valid: false, error };
  }
  return { valid: true, error: null };
}

const required = (v: string) => v ? null : 'Required';
const minLength = (n: number) => (v: string) => v.length >= n ? null : 'Too short';
const isEmail = (v: string) => v.includes('@') ? null : 'Invalid format';

const validateEmail = (email: string) => validate(email, [required, isEmail]);
const validateUsername = (name: string) => validate(name, [required, minLength(3)]);
```

### Generic Resource Handler

```typescript
// Abstract the common pattern
function createResourceHandler<T>(
  tableName: string,
  findById: (id: string) => Promise<T | null>
) {
  return async (req: Request, res: Response) => {
    try {
      const entity = await findById(req.params.id);
      if (!entity) return res.status(404).json({ error: 'Not found' });
      res.json(entity);
    } catch (error) {
      res.status(500).json({ error: 'Internal error' });
    }
  };
}

app.get('/users/:id', createResourceHandler('users', db.users.findById));
app.get('/orders/:id', createResourceHandler('orders', db.orders.findById));
```

---

## Parameter List Solutions

### Object Parameter

```typescript
// Group related parameters
interface CreateUserParams {
  name: string;
  email: string;
  password: string;
  role: string;
  department: string;
  manager?: string;
  startDate: Date;
  salary: number;
  benefits?: string[];
}

function createUser(params: CreateUserParams) {
  // ...
}
```

### Options Object for Booleans

```typescript
// Replace boolean flags with named options
interface FormatOptions {
  includeHeader?: boolean;
  includeFooter?: boolean;
  useColor?: boolean;
  landscape?: boolean;
  doubleSided?: boolean;
}

function formatDocument(doc: Document, options: FormatOptions = {}) {
  // ...
}

// Call site is clear:
formatDocument(doc, { useColor: true, doubleSided: true });
```

---

## Boolean Complexity Solutions

### Extract Named Predicates

```typescript
// Replace complex boolean with readable function
const canModerate = (user: User): boolean => {
  if (!user.active || user.deleted) return false;
  if (!['admin', 'moderator'].includes(user.role)) return false;
  if (!user.verified) return false;
  if (user.suspended && user.suspendedUntil >= Date.now()) return false;
  return true;
};

if (canModerate(user)) {
  // ...
}
```

### Positive Conditions

```typescript
// Eliminate double negatives
// Before: if (!user.isNotActive && !items.isEmpty())
// After:
if (user.isActive && items.length > 0) {
  // ...
}

// Apply De Morgan's law and simplify
// Before: if (!(a && !b) || !(!c || d))
// After:
if (!a || b || (c && !d)) {
  // ...
}
```

---

## Shotgun Surgery Solutions

### Encapsulate Variation

```typescript
// Adding new type = one new class
interface UserTypeHandler {
  validate(data: UserData): ValidationResult;
  serialize(user: User): SerializedUser;
  getPermissions(): Permission[];
}

class AdminUserHandler implements UserTypeHandler { /* ... */ }
class RegularUserHandler implements UserTypeHandler { /* ... */ }
class GuestUserHandler implements UserTypeHandler { /* ... */ }

// Registry for handlers
const handlers = new Map<UserType, UserTypeHandler>();
handlers.set('admin', new AdminUserHandler());
handlers.set('regular', new RegularUserHandler());
handlers.set('guest', new GuestUserHandler());

// Adding new type: just add one new class and register it
```
