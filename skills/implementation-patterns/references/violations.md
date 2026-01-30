# Implementation Violation Examples

Extended violation patterns for implementation reviews. Reference from main SKILL.md.

---

## CRUD Violations

### Missing Validation

**No Input Validation Before Persist**
```typescript
// VIOLATION: Saving unvalidated data
async function createUser(input: any): Promise<User> {
  const user = { id: generateId(), ...input };  // No validation!
  return await userRepository.save(user);
}
```

**Trusting External Data**
```typescript
// VIOLATION: Using input directly without parsing
async function updateUser(id: string, body: any): Promise<User> {
  return await db.users.update(id, body);  // Body could have extra fields
}
```

### Inconsistent Error Handling

**Mixed Error Styles**
```typescript
// VIOLATION: Throws in some cases, returns null in others
async function getUser(id: string): Promise<User | null> {
  if (!id) throw new Error('Invalid ID');  // Throws
  const user = await db.users.findById(id);
  return user || null;  // Returns null for not found
}
```

**Silent Failures**
```typescript
// VIOLATION: Error swallowed with empty catch
async function deleteUser(id: string): Promise<void> {
  try {
    await userRepository.delete(id);
  } catch (error) {
    // Silently ignore deletion failures
  }
}
```

### N+1 Query Patterns

**Loop Query**
```typescript
// VIOLATION: N queries in loop
async function listUsersWithOrders(userIds: string[]): Promise<UserWithOrders[]> {
  return Promise.all(
    userIds.map(async (id) => {
      const user = await db.users.findById(id);
      const orders = await db.orders.findByUserId(id);  // N queries!
      return { ...user, orders };
    })
  );
}
```

**Missing Join/Include**
```typescript
// VIOLATION: Separate query for related data
async function getOrderDetails(orderId: string): Promise<OrderDetails> {
  const order = await db.orders.findById(orderId);
  const items = await db.orderItems.findByOrderId(orderId);  // Second query
  const customer = await db.customers.findById(order.customerId);  // Third query
  return { order, items, customer };
}
```

### Missing Existence Check

**Update Without Checking Exists**
```typescript
// VIOLATION: No existence check before update
async function updateUser(id: string, data: UpdateData): Promise<User> {
  return await db.users.update(id, data);  // Fails silently or throws generic error
}
```

**Delete Without Constraints Check**
```typescript
// VIOLATION: No cascade/constraint check
async function deleteCategory(id: string): Promise<void> {
  await db.categories.delete(id);  // Orphans products referencing this category
}
```

---

## API Violations

### Missing Auth Checks

**No Authentication**
```typescript
// VIOLATION: Endpoint without auth
app.delete('/api/users/:id', async (req, res) => {
  await deleteUser(req.params.id);  // Anyone can delete users!
  res.status(204).send();
});
```

**No Authorization**
```typescript
// VIOLATION: Auth but no authorization check
app.put('/api/users/:id', authenticate, async (req, res) => {
  const result = await updateUser(req.params.id, req.body);  // Can update any user
  res.json(result);
});
```

### Inconsistent Response Format

**Mixed Response Shapes**
```typescript
// VIOLATION: Different error formats across endpoints
app.get('/api/users/:id', async (req, res) => {
  const user = await getUser(req.params.id);
  if (!user) res.status(404).send('Not found');  // String
});

app.get('/api/orders/:id', async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) res.status(404).json({ error: 'Order not found' });  // Object
});
```

**Leaking Internal Errors**
```typescript
// VIOLATION: Exposing stack traces
app.post('/api/users', async (req, res) => {
  try {
    const user = await createUser(req.body);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.stack });  // Security risk!
  }
});
```

### Poor Error Messages

**Generic Messages**
```typescript
// VIOLATION: Unhelpful error response
function handleError(error: Error, res: Response) {
  res.status(400).json({ error: 'Something went wrong' });  // No actionable info
}
```

**Missing Field Context**
```typescript
// VIOLATION: No field-level validation errors
app.post('/api/users', async (req, res) => {
  if (!req.body.email || !req.body.name) {
    res.status(400).json({ error: 'Invalid request' });  // Which field?
  }
});
```

### Missing Request Validation

**No Path Parameter Validation**
```typescript
// VIOLATION: Using params without validation
app.get('/api/users/:id', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  // id could be malformed or SQL injection
});
```

**No Body Validation**
```typescript
// VIOLATION: No schema validation
app.post('/api/orders', async (req, res) => {
  const order = await createOrder(req.body);  // Could be anything
  res.json(order);
});
```

---

## Event Handler Violations

### Lost Events

**Fire and Forget Without ACK**
```typescript
// VIOLATION: Processing not confirmed
async function handleMessage(message: Message): Promise<void> {
  processMessage(message);  // Not awaited!
  // Message may not be processed but considered handled
}
```

**No Retry Mechanism**
```typescript
// VIOLATION: Single attempt, then lost
async function handleOrderCreated(event: OrderEvent): Promise<void> {
  try {
    await notifyWarehouse(event);
  } catch (error) {
    console.error('Failed to notify', error);
    // Event lost, no retry
  }
}
```

### Race Conditions

**Concurrent Updates Without Locking**
```typescript
// VIOLATION: Read-modify-write without protection
async function handleInventoryUpdate(event: InventoryEvent): Promise<void> {
  const current = await db.inventory.get(event.productId);
  const newQuantity = current.quantity - event.quantity;
  await db.inventory.update(event.productId, { quantity: newQuantity });
  // Two concurrent events can read same quantity, lose an update
}
```

**Non-Idempotent Processing**
```typescript
// VIOLATION: No idempotency check
async function handlePaymentReceived(event: PaymentEvent): Promise<void> {
  await creditUserAccount(event.userId, event.amount);
  await sendReceipt(event.userId);
  // Redelivery credits user twice!
}
```

### Missing Error Handling

**Unhandled Promise Rejection**
```typescript
// VIOLATION: No error handling in handler
eventBus.on('user.created', async (event) => {
  await sendWelcomeEmail(event.user);  // Unhandled rejection if email fails
  await createAuditLog(event);
});
```

**Partial Processing**
```typescript
// VIOLATION: Stops on first error
async function handleBatchEvent(events: Event[]): Promise<void> {
  for (const event of events) {
    await processEvent(event);  // One failure stops all remaining
  }
}
```

### Missing Event Context

**No Correlation ID**
```typescript
// VIOLATION: Can't trace event through system
async function publishEvent(type: string, payload: object): Promise<void> {
  await eventBus.publish({
    type,
    payload,
    timestamp: new Date(),
    // No correlationId, requestId, or traceId
  });
}
```

---

## Configuration Violations

### Hardcoded Values

**Magic Numbers/Strings**
```typescript
// VIOLATION: Hardcoded configuration
async function fetchWithRetry(url: string) {
  const maxRetries = 3;  // Magic number
  const timeout = 5000;  // Magic number
  const apiKey = 'sk-abc123...';  // Hardcoded secret!
  // ...
}
```

**Environment-Specific Branching**
```typescript
// VIOLATION: Scattered environment checks
function getApiUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    return 'https://api.example.com';
  } else if (process.env.NODE_ENV === 'staging') {
    return 'https://staging-api.example.com';
  } else {
    return 'http://localhost:3000';
  }
}
```

### Missing Validation

**No Schema Validation**
```typescript
// VIOLATION: Trusting environment variables
const config = {
  port: process.env.PORT,  // Could be undefined or 'abc'
  dbUrl: process.env.DATABASE_URL,  // Could be malformed
  timeout: process.env.TIMEOUT,  // String, not number
};
```

**Silent Defaults**
```typescript
// VIOLATION: Defaulting without warning
const port = process.env.PORT || 3000;  // No indication of fallback
const dbUrl = process.env.DATABASE_URL || 'localhost:5432';  // Insecure default
```

### Insecure Defaults

**Debug Mode in Production**
```typescript
// VIOLATION: Debug enabled by default
const config = {
  debug: process.env.DEBUG !== 'false',  // Default true!
  verboseLogging: true,  // Always verbose
};
```

**Missing Required Secrets**
```typescript
// VIOLATION: Optional secret with fallback
const jwtSecret = process.env.JWT_SECRET || 'default-secret';  // Insecure!
```

### Mutable Configuration

**Writable Config Object**
```typescript
// VIOLATION: Config can be mutated at runtime
export const config = {
  port: 3000,
  debug: false,
};

// Elsewhere in code
config.debug = true;  // Mutation!
```

---

## Logging Violations

### Missing Context

**No Request Identifier**
```typescript
// VIOLATION: Can't correlate logs
app.get('/api/users/:id', async (req, res) => {
  console.log('Fetching user');  // Which request?
  const user = await getUser(req.params.id);
  console.log('User found');  // Can't trace to request
  res.json(user);
});
```

**No Operation Context**
```typescript
// VIOLATION: Logs without context
async function processOrder(order: Order): Promise<void> {
  console.log('Processing');  // What order? Who requested?
  await validateOrder(order);
  console.log('Validated');
  await saveOrder(order);
  console.log('Done');
}
```

### Sensitive Data Exposure

**Logging Credentials**
```typescript
// VIOLATION: Passwords in logs
async function login(credentials: Credentials): Promise<Result<User, Error>> {
  logger.info('Login attempt', { credentials });  // Logs password!
  // ...
}
```

**PII in Logs**
```typescript
// VIOLATION: Personal data exposed
async function createUser(user: UserInput): Promise<User> {
  logger.info('Creating user', {
    email: user.email,
    ssn: user.ssn,  // PII!
    creditCard: user.paymentInfo,  // PCI data!
  });
  // ...
}
```

### Inconsistent Levels

**Wrong Log Levels**
```typescript
// VIOLATION: Using wrong severity
function processPayment(payment: Payment): void {
  console.log('Payment failed!');  // Should be error
  console.error('Processing payment');  // Not an error
  console.warn('Payment successful');  // Not a warning
}
```

**Debug Logs in Production**
```typescript
// VIOLATION: Verbose logging without level check
function complexCalculation(data: Data): number {
  console.log('Input:', JSON.stringify(data));  // Always logs, even in production
  const result = calculate(data);
  console.log('Intermediate:', intermediate);  // Noise in production
  console.log('Output:', result);
  return result;
}
```

### Unstructured Logging

**String Interpolation**
```typescript
// VIOLATION: Not machine-parseable
console.log(`User ${userId} created order ${orderId} at ${timestamp}`);
// Can't query or aggregate these logs
```

**Console.log in Production**
```typescript
// VIOLATION: No structured output
console.log('Error:', error);  // Not JSON, no metadata
console.log('Request received');  // No timestamp, level, or context
```

### Missing Error Details

**Logging Without Stack**
```typescript
// VIOLATION: Lost debugging info
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed');  // No error details!
}
```

**Catching and Re-logging**
```typescript
// VIOLATION: Duplicate logs
async function outerFunction() {
  try {
    await innerFunction();
  } catch (error) {
    logger.error('Outer failed', { error });  // Double logged
    throw error;
  }
}

async function innerFunction() {
  try {
    await riskyThing();
  } catch (error) {
    logger.error('Inner failed', { error });  // First log
    throw error;
  }
}
```
