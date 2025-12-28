---
name: devflow-implementation-patterns
description: Automatically activate when implementing CRUD operations, API endpoints, event handlers, configuration systems, or logging. Triggers on feature implementation tasks involving database operations, REST/GraphQL APIs, pub/sub patterns, or service configuration.
allowed-tools: Read, Grep, Glob
---

# Implementation Patterns

Reference for common implementation patterns. Use these patterns to write consistent, maintainable code.

## When This Skill Activates

- Implementing CRUD operations
- Creating API endpoints
- Writing event handlers
- Setting up configuration
- Adding logging
- Database operations

---

## CRUD Patterns

### Create Operation

```typescript
// Pattern: Validate → Transform → Persist → Return
async function createUser(input: CreateUserInput): Promise<Result<User, CreateError>> {
  // 1. Validate input
  const validated = validateCreateUser(input);
  if (!validated.ok) {
    return Err({ type: 'validation', details: validated.error });
  }

  // 2. Transform to domain entity
  const user: User = {
    id: generateId(),
    ...validated.value,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // 3. Persist
  const saved = await userRepository.save(user);
  if (!saved.ok) {
    return Err({ type: 'persistence', details: saved.error });
  }

  // 4. Return created entity
  return Ok(saved.value);
}
```

### Read Operation (Single)

```typescript
// Pattern: Fetch → NotFound check → Transform → Return
async function getUser(id: UserId): Promise<Result<UserDTO, GetError>> {
  // 1. Fetch from store
  const user = await userRepository.findById(id);

  // 2. Handle not found
  if (!user.ok) {
    return Err({ type: 'not_found', id });
  }

  // 3. Transform to DTO (hide internal fields)
  const dto = toUserDTO(user.value);

  // 4. Return
  return Ok(dto);
}
```

### Read Operation (List)

```typescript
// Pattern: Parse filters → Query → Transform → Paginate
async function listUsers(params: ListParams): Promise<Result<PaginatedResult<UserDTO>, ListError>> {
  // 1. Parse and validate filters
  const filters = parseFilters(params);
  const pagination = parsePagination(params);

  // 2. Query with filters
  const result = await userRepository.findMany({
    where: filters,
    skip: pagination.offset,
    take: pagination.limit,
    orderBy: pagination.orderBy,
  });

  // 3. Transform to DTOs
  const items = result.items.map(toUserDTO);

  // 4. Return paginated result
  return Ok({
    items,
    total: result.total,
    page: pagination.page,
    pageSize: pagination.limit,
    hasMore: result.total > pagination.offset + items.length,
  });
}
```

### Update Operation

```typescript
// Pattern: Fetch existing → Validate changes → Merge → Persist
async function updateUser(
  id: UserId,
  input: UpdateUserInput
): Promise<Result<User, UpdateError>> {
  // 1. Fetch existing
  const existing = await userRepository.findById(id);
  if (!existing.ok) {
    return Err({ type: 'not_found', id });
  }

  // 2. Validate changes
  const validated = validateUpdateUser(input, existing.value);
  if (!validated.ok) {
    return Err({ type: 'validation', details: validated.error });
  }

  // 3. Merge changes (immutable update)
  const updated: User = {
    ...existing.value,
    ...validated.value,
    updatedAt: new Date(),
  };

  // 4. Persist
  const saved = await userRepository.save(updated);
  if (!saved.ok) {
    return Err({ type: 'persistence', details: saved.error });
  }

  return Ok(saved.value);
}
```

### Delete Operation

```typescript
// Pattern: Check exists → Check constraints → Delete → Confirm
async function deleteUser(id: UserId): Promise<Result<void, DeleteError>> {
  // 1. Check exists
  const existing = await userRepository.findById(id);
  if (!existing.ok) {
    return Err({ type: 'not_found', id });
  }

  // 2. Check constraints (can this be deleted?)
  const canDelete = await checkDeleteConstraints(existing.value);
  if (!canDelete.ok) {
    return Err({ type: 'constraint_violation', details: canDelete.error });
  }

  // 3. Delete (soft delete preferred)
  const deleted = await userRepository.softDelete(id);
  if (!deleted.ok) {
    return Err({ type: 'persistence', details: deleted.error });
  }

  // 4. Confirm success
  return Ok(undefined);
}
```

---

## API Endpoint Patterns

### REST Endpoint Structure

```typescript
// Pattern: Parse request → Validate auth → Execute → Format response
export async function handleGetUser(req: Request): Promise<Response> {
  // 1. Parse request parameters
  const id = parsePathParam(req, 'id');
  if (!id.ok) {
    return errorResponse(400, 'Invalid user ID');
  }

  // 2. Validate authentication/authorization
  const auth = await authenticate(req);
  if (!auth.ok) {
    return errorResponse(401, 'Unauthorized');
  }

  const canAccess = authorize(auth.value, 'users:read', id.value);
  if (!canAccess) {
    return errorResponse(403, 'Forbidden');
  }

  // 3. Execute business logic
  const result = await getUser(id.value);
  if (!result.ok) {
    return handleError(result.error);
  }

  // 4. Format response
  return jsonResponse(200, result.value);
}
```

### Error Response Mapping

```typescript
// Map domain errors to HTTP responses
function handleError(error: DomainError): Response {
  switch (error.type) {
    case 'not_found':
      return errorResponse(404, 'Resource not found');
    case 'validation':
      return errorResponse(400, 'Validation failed', error.details);
    case 'conflict':
      return errorResponse(409, 'Resource conflict');
    case 'unauthorized':
      return errorResponse(401, 'Unauthorized');
    case 'forbidden':
      return errorResponse(403, 'Forbidden');
    default:
      // Log unexpected errors, return generic message
      logger.error('Unexpected error', { error });
      return errorResponse(500, 'Internal server error');
  }
}
```

### Request Validation

```typescript
// Use schema validation at API boundary
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['user', 'admin']).default('user'),
});

function parseCreateUserRequest(req: Request): Result<CreateUserInput, ValidationError> {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return Err({
      type: 'validation',
      errors: parsed.error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }
  return Ok(parsed.data);
}
```

---

## Event Handler Patterns

### Async Event Handler

```typescript
// Pattern: Validate event → Process → Handle errors → Acknowledge
async function handleUserCreated(event: UserCreatedEvent): Promise<void> {
  const logger = createLogger({ eventId: event.id, type: event.type });

  try {
    // 1. Validate event structure
    const validated = validateEvent(event);
    if (!validated.ok) {
      logger.warn('Invalid event structure', { error: validated.error });
      return; // Don't retry invalid events
    }

    // 2. Process event (idempotent operations)
    await sendWelcomeEmail(event.userId);
    await createDefaultSettings(event.userId);
    await notifyAdmins(event.userId);

    // 3. Success
    logger.info('Event processed successfully');
  } catch (error) {
    // 4. Handle errors
    logger.error('Event processing failed', { error });
    throw error; // Rethrow for retry
  }
}
```

### Idempotent Processing

```typescript
// Pattern: Check if already processed → Process → Mark complete
async function processOrderEvent(event: OrderEvent): Promise<void> {
  // 1. Check idempotency key
  const alreadyProcessed = await idempotencyStore.exists(event.id);
  if (alreadyProcessed) {
    logger.info('Event already processed, skipping', { eventId: event.id });
    return;
  }

  // 2. Process within transaction
  await db.transaction(async (tx) => {
    await processOrder(tx, event.order);
    await idempotencyStore.mark(tx, event.id);
  });

  // 3. Event processed
  logger.info('Order event processed', { orderId: event.order.id });
}
```

---

## Configuration Patterns

### Environment Configuration

```typescript
// Pattern: Define schema → Load from env → Validate → Export frozen
import { z } from 'zod';

const ConfigSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_SIZE: z.coerce.number().min(1).max(100).default(10),

  // External services
  API_KEY: z.string().min(1),
  API_TIMEOUT_MS: z.coerce.number().default(5000),

  // Feature flags
  ENABLE_NEW_FEATURE: z.coerce.boolean().default(false),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Configuration validation failed:');
    for (const error of result.error.errors) {
      console.error(`  ${error.path.join('.')}: ${error.message}`);
    }
    process.exit(1);
  }
  return Object.freeze(result.data);
}

export const config = loadConfig();
```

### Feature Flags

```typescript
// Pattern: Centralized flags with typed access
interface FeatureFlags {
  newCheckoutFlow: boolean;
  betaFeatures: boolean;
  debugMode: boolean;
}

const defaultFlags: FeatureFlags = {
  newCheckoutFlow: false,
  betaFeatures: false,
  debugMode: false,
};

function loadFeatureFlags(): FeatureFlags {
  return {
    newCheckoutFlow: config.ENABLE_NEW_CHECKOUT === true,
    betaFeatures: config.ENABLE_BETA === true,
    debugMode: config.NODE_ENV === 'development',
  };
}

export const features = loadFeatureFlags();

// Usage
if (features.newCheckoutFlow) {
  return newCheckoutProcess(cart);
} else {
  return legacyCheckoutProcess(cart);
}
```

---

## Logging Patterns

### Structured Logging

```typescript
// Pattern: Context → Level → Message → Data
interface LogContext {
  requestId?: string;
  userId?: string;
  operation?: string;
}

function createLogger(context: LogContext) {
  return {
    info: (message: string, data?: object) =>
      log('info', message, { ...context, ...data }),
    warn: (message: string, data?: object) =>
      log('warn', message, { ...context, ...data }),
    error: (message: string, data?: object) =>
      log('error', message, { ...context, ...data }),
    debug: (message: string, data?: object) =>
      log('debug', message, { ...context, ...data }),
  };
}

// Usage
const logger = createLogger({ requestId: req.id, userId: user.id });
logger.info('Processing order', { orderId: order.id, items: order.items.length });
```

### Operation Logging

```typescript
// Pattern: Log start → Execute → Log result
async function withLogging<T>(
  logger: Logger,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  logger.info(`${operation} started`);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    logger.info(`${operation} completed`, { durationMs: duration });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`${operation} failed`, { durationMs: duration, error });
    throw error;
  }
}

// Usage
const user = await withLogging(logger, 'CreateUser', () => createUser(input));
```

---

## Database Patterns

### Repository Pattern

```typescript
// Pattern: Abstract data access behind interface
interface UserRepository {
  findById(id: UserId): Promise<Result<User, NotFoundError>>;
  findByEmail(email: string): Promise<Result<User, NotFoundError>>;
  findMany(query: UserQuery): Promise<PaginatedResult<User>>;
  save(user: User): Promise<Result<User, PersistenceError>>;
  delete(id: UserId): Promise<Result<void, PersistenceError>>;
}

// Implementation
class PostgresUserRepository implements UserRepository {
  constructor(private db: Database) {}

  async findById(id: UserId): Promise<Result<User, NotFoundError>> {
    const row = await this.db.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    if (!row) {
      return Err({ type: 'not_found', entity: 'User', id });
    }
    return Ok(rowToUser(row));
  }

  // ... other methods
}
```

### Transaction Pattern

```typescript
// Pattern: Start transaction → Execute operations → Commit or rollback
async function transferFunds(
  from: AccountId,
  to: AccountId,
  amount: Money
): Promise<Result<Transfer, TransferError>> {
  return db.transaction(async (tx) => {
    // 1. Debit source account
    const debit = await tx.accounts.debit(from, amount);
    if (!debit.ok) {
      return Err({ type: 'insufficient_funds', account: from });
    }

    // 2. Credit destination account
    const credit = await tx.accounts.credit(to, amount);
    if (!credit.ok) {
      return Err({ type: 'credit_failed', account: to });
    }

    // 3. Record transfer
    const transfer = await tx.transfers.create({
      from,
      to,
      amount,
      timestamp: new Date(),
    });

    return Ok(transfer);
  });
  // Transaction auto-commits on success, auto-rollbacks on error
}
```

---

## Anti-Patterns to Avoid

### ❌ God Functions
```typescript
// BAD: One function does everything
async function processOrder(order) {
  // validate, save, notify, bill, ship... 500 lines
}

// GOOD: Composed small functions
async function processOrder(order) {
  const validated = await validateOrder(order);
  const saved = await saveOrder(validated);
  await notifyCustomer(saved);
  await initiateBilling(saved);
  await scheduleShipping(saved);
  return saved;
}
```

### ❌ Implicit Dependencies
```typescript
// BAD: Uses global state
function getUser() {
  return db.query(...); // Where does db come from?
}

// GOOD: Explicit dependencies
function getUser(db: Database) {
  return db.query(...);
}
```

### ❌ Swallowing Errors
```typescript
// BAD: Silent failure
try {
  await riskyOperation();
} catch (e) {
  // silently ignored
}

// GOOD: Handle or propagate
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed', { error: e });
  return Err({ type: 'operation_failed', cause: e });
}
```

---

## Build Optimization

**CRITICAL**: Production builds must exclude test files, debug artifacts, and sourcemaps.

### Build Configuration

```json
// package.json scripts
{
  "scripts": {
    "prebuild": "rm -rf dist",
    "build": "tsc --project tsconfig.prod.json",
    "build:dev": "tsc --project tsconfig.json --sourceMap",
    "build:watch": "tsc --watch"
  }
}
```

```json
// tsconfig.prod.json - Production config
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "sourceMap": false,
    "declaration": true,
    "removeComments": true
  },
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/tests/**",
    "**/__tests__/**",
    "**/test/**",
    "**/*.test.tsx",
    "**/*.spec.tsx"
  ]
}
```

### Files to Exclude from Production

```gitignore
# Test files
**/*.test.*
**/*.spec.*
**/__tests__/
**/tests/
**/test/

# Debug artifacts
**/*.map
**/debug/
**/coverage/

# Development only
**/*.d.ts.map
**/tsconfig.tsbuildinfo
```

### Verify Package Contents

```bash
# Before publishing, check what gets included
npm pack --dry-run

# Or for detailed listing
npm pack --dry-run 2>&1 | grep -E '^\d'
```

### Build Checklist

- [ ] Production build excludes test files
- [ ] Production build excludes sourcemaps
- [ ] Pre-build cleanup of old artifacts
- [ ] Separate dev build with full debug info
- [ ] Package.json `files` field or `.npmignore` configured
- [ ] Verified package contents before publishing

---

## Checklist

Before implementing, verify:

- [ ] Using Result types for operations that can fail
- [ ] Validating input at system boundaries
- [ ] Logging with context (requestId, userId, operation)
- [ ] Handling all error cases explicitly
- [ ] Making operations idempotent where possible
- [ ] Using transactions for multi-step operations
- [ ] No hardcoded values (use config)
- [ ] Following existing codebase patterns
