# Implementation Correct Patterns

Extended correct patterns for implementation. Reference from main SKILL.md.

---

## CRUD Patterns

### Create Operation

```typescript
// CORRECT: Validate -> Transform -> Persist -> Return
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
// CORRECT: Fetch -> NotFound check -> Transform -> Return
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
// CORRECT: Parse filters -> Query -> Transform -> Paginate
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
// CORRECT: Fetch existing -> Validate changes -> Merge -> Persist
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
// CORRECT: Check exists -> Check constraints -> Delete -> Confirm
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

### Repository Pattern

```typescript
// CORRECT: Abstract data access behind interface
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
// CORRECT: Start transaction -> Execute operations -> Commit or rollback
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

## API Endpoint Patterns

### REST Endpoint Structure

```typescript
// CORRECT: Parse request -> Validate auth -> Execute -> Format response
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
// CORRECT: Map domain errors to HTTP responses
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
// CORRECT: Use schema validation at API boundary
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

### POST Endpoint Example

```typescript
// CORRECT: Full POST endpoint with validation and auth
export async function handleCreateUser(req: Request): Promise<Response> {
  // 1. Parse and validate request body
  const input = parseCreateUserRequest(req);
  if (!input.ok) {
    return errorResponse(400, 'Invalid request', input.error.errors);
  }

  // 2. Authenticate caller
  const auth = await authenticate(req);
  if (!auth.ok) {
    return errorResponse(401, 'Unauthorized');
  }

  // 3. Check authorization
  if (!authorize(auth.value, 'users:create')) {
    return errorResponse(403, 'Forbidden');
  }

  // 4. Execute business logic
  const result = await createUser(input.value);
  if (!result.ok) {
    return handleError(result.error);
  }

  // 5. Return created resource
  return jsonResponse(201, result.value, {
    Location: `/api/users/${result.value.id}`,
  });
}
```

### Response Helpers

```typescript
// CORRECT: Consistent response formatting
function jsonResponse<T>(status: number, data: T, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function errorResponse(status: number, message: string, details?: unknown): Response {
  return jsonResponse(status, {
    error: message,
    details,
    timestamp: new Date().toISOString(),
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}
```

---

## Event Handler Patterns

### Async Event Handler

```typescript
// CORRECT: Validate event -> Process -> Handle errors -> Acknowledge
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
// CORRECT: Check if already processed -> Process -> Mark complete
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

### Event with Retry Logic

```typescript
// CORRECT: Exponential backoff retry
interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

async function handleEventWithRetry<T>(
  event: T,
  handler: (event: T) => Promise<void>,
  config: RetryConfig
): Promise<void> {
  let attempt = 0;
  let delay = config.initialDelayMs;

  while (attempt < config.maxAttempts) {
    try {
      await handler(event);
      return; // Success
    } catch (error) {
      attempt++;

      if (attempt >= config.maxAttempts) {
        logger.error('Event processing failed after max retries', {
          eventId: (event as any).id,
          attempts: attempt,
          error,
        });
        throw error;
      }

      logger.warn('Event processing failed, retrying', {
        eventId: (event as any).id,
        attempt,
        nextDelayMs: delay,
      });

      await sleep(delay);
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    }
  }
}
```

### Dead Letter Queue Pattern

```typescript
// CORRECT: Move failed events to DLQ for manual review
interface DeadLetterEvent<T> {
  originalEvent: T;
  error: string;
  failedAt: Date;
  attempts: number;
}

async function handleWithDeadLetter<T>(
  event: T,
  handler: (event: T) => Promise<void>,
  maxAttempts: number = 3
): Promise<void> {
  try {
    await handleEventWithRetry(event, handler, {
      maxAttempts,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    });
  } catch (error) {
    // Send to dead letter queue
    await deadLetterQueue.push({
      originalEvent: event,
      error: error.message,
      failedAt: new Date(),
      attempts: maxAttempts,
    });

    logger.error('Event moved to dead letter queue', {
      eventId: (event as any).id,
    });
  }
}
```

### Event Batching

```typescript
// CORRECT: Process events in batches for efficiency
async function processBatch<T>(
  events: T[],
  processor: (event: T) => Promise<void>,
  batchSize: number = 10
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(event => processor(event))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        success++;
      } else {
        failed++;
        logger.error('Batch item failed', { error: result.reason });
      }
    }
  }

  return { success, failed };
}
```

### Pub/Sub Handler Registration

```typescript
// CORRECT: Typed event bus with error handling
type EventHandler<T> = (event: T) => Promise<void>;

class EventBus {
  private handlers = new Map<string, EventHandler<unknown>[]>();

  subscribe<T>(eventType: string, handler: EventHandler<T>): void {
    const existing = this.handlers.get(eventType) || [];
    this.handlers.set(eventType, [...existing, handler as EventHandler<unknown>]);
  }

  async publish<T>(eventType: string, event: T): Promise<void> {
    const handlers = this.handlers.get(eventType) || [];

    await Promise.all(
      handlers.map(handler =>
        handler(event).catch(error => {
          logger.error('Event handler failed', { eventType, error });
        })
      )
    );
  }
}

// Usage
const eventBus = new EventBus();
eventBus.subscribe('user.created', handleUserCreated);
eventBus.subscribe('user.created', sendWelcomeEmail);
```

---

## Configuration Patterns

### Environment Configuration

```typescript
// CORRECT: Define schema -> Load from env -> Validate -> Export frozen
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
// CORRECT: Centralized flags with typed access
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

### Runtime Feature Flags

```typescript
// CORRECT: Dynamic flags that can change at runtime
interface FeatureFlagService {
  isEnabled(flag: string, context?: FlagContext): Promise<boolean>;
  getVariant(flag: string, context?: FlagContext): Promise<string | null>;
}

interface FlagContext {
  userId?: string;
  region?: string;
  percentile?: number;
}

class FeatureFlagClient implements FeatureFlagService {
  constructor(private source: FlagSource) {}

  async isEnabled(flag: string, context?: FlagContext): Promise<boolean> {
    const flagConfig = await this.source.getFlag(flag);
    if (!flagConfig) return false;

    // Percentage rollout
    if (flagConfig.percentageEnabled !== undefined && context?.percentile) {
      return context.percentile <= flagConfig.percentageEnabled;
    }

    // User targeting
    if (flagConfig.enabledForUsers && context?.userId) {
      return flagConfig.enabledForUsers.includes(context.userId);
    }

    return flagConfig.enabled;
  }
}
```

### Secrets Management

```typescript
// CORRECT: Load secrets separately from config
interface Secrets {
  databasePassword: string;
  apiKey: string;
  jwtSecret: string;
}

async function loadSecrets(): Promise<Secrets> {
  // In production, fetch from secret manager
  if (config.NODE_ENV === 'production') {
    return {
      databasePassword: await secretManager.get('db-password'),
      apiKey: await secretManager.get('api-key'),
      jwtSecret: await secretManager.get('jwt-secret'),
    };
  }

  // In development, use environment variables
  const SecretsSchema = z.object({
    DATABASE_PASSWORD: z.string().min(1),
    API_KEY: z.string().min(1),
    JWT_SECRET: z.string().min(32),
  });

  const result = SecretsSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error('Missing required secrets');
  }

  return {
    databasePassword: result.data.DATABASE_PASSWORD,
    apiKey: result.data.API_KEY,
    jwtSecret: result.data.JWT_SECRET,
  };
}
```

### Configuration Validation on Startup

```typescript
// CORRECT: Fail fast with clear error messages
async function validateConfiguration(): Promise<void> {
  const errors: string[] = [];

  // Check required services are reachable
  try {
    await db.ping();
  } catch (error) {
    errors.push(`Database connection failed: ${error.message}`);
  }

  try {
    await redis.ping();
  } catch (error) {
    errors.push(`Redis connection failed: ${error.message}`);
  }

  // Validate configuration values
  if (config.PORT < 1 || config.PORT > 65535) {
    errors.push(`Invalid PORT: ${config.PORT}`);
  }

  if (config.NODE_ENV === 'production' && config.logLevel === 'debug') {
    errors.push('Debug logging should not be enabled in production');
  }

  if (errors.length > 0) {
    console.error('Configuration validation failed:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}

// Call on startup
await validateConfiguration();
```

---

## Logging Patterns

### Structured Logging

```typescript
// CORRECT: Context -> Level -> Message -> Data
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
// CORRECT: Log start -> Execute -> Log result
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

### JSON Log Format

```typescript
// CORRECT: Production-ready JSON logging
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  service: string;
  environment: string;
  requestId?: string;
  userId?: string;
  durationMs?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  [key: string]: unknown;
}

function log(level: LogEntry['level'], message: string, data: object = {}): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: config.serviceName,
    environment: config.NODE_ENV,
    ...data,
  };

  // In production, output JSON
  if (config.NODE_ENV === 'production') {
    console.log(JSON.stringify(entry));
  } else {
    // In development, pretty print
    const color = { debug: '\x1b[34m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' }[level];
    console.log(`${color}[${level.toUpperCase()}]\x1b[0m ${message}`, data);
  }
}
```

### Request Logging Middleware

```typescript
// CORRECT: Log all HTTP requests with timing
function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id'] || generateId();
  const startTime = Date.now();

  // Attach request ID for tracing
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    log(res.statusCode >= 400 ? 'error' : 'info', 'HTTP Request', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  });

  next();
}
```

### Error Logging

```typescript
// CORRECT: Log errors with full context
function logError(error: Error, context: object = {}): void {
  log('error', error.message, {
    ...context,
    error: {
      name: error.name,
      message: error.message,
      stack: config.NODE_ENV !== 'production' ? error.stack : undefined,
    },
  });
}

// CORRECT: Wrap async handlers with error logging
function withErrorLogging<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context: object = {}
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      logError(error as Error, context);
      throw error;
    }
  }) as T;
}
```

### Audit Logging

```typescript
// CORRECT: Immutable audit trail for sensitive operations
interface AuditEntry {
  timestamp: Date;
  actor: string;
  action: string;
  resource: string;
  resourceId: string;
  changes?: {
    before: unknown;
    after: unknown;
  };
  result: 'success' | 'failure';
  metadata?: object;
}

async function audit(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
  const fullEntry: AuditEntry = {
    ...entry,
    timestamp: new Date(),
  };

  // Write to immutable audit log (not regular logs)
  await auditStore.append(fullEntry);

  // Also log for operational visibility
  log('info', 'Audit event', {
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    actor: entry.actor,
    result: entry.result,
  });
}

// Usage
await audit({
  actor: userId,
  action: 'user.update',
  resource: 'user',
  resourceId: targetUserId,
  changes: { before: oldUser, after: newUser },
  result: 'success',
});
```

### Performance Logging

```typescript
// CORRECT: Log slow operations
const SLOW_THRESHOLD_MS = 1000;

async function withPerformanceLogging<T>(
  logger: Logger,
  operation: string,
  fn: () => Promise<T>,
  threshold: number = SLOW_THRESHOLD_MS
): Promise<T> {
  const start = performance.now();

  try {
    const result = await fn();
    const duration = performance.now() - start;

    if (duration > threshold) {
      logger.warn(`Slow operation: ${operation}`, {
        durationMs: Math.round(duration),
        threshold,
      });
    } else {
      logger.debug(`${operation} completed`, { durationMs: Math.round(duration) });
    }

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    logger.error(`${operation} failed`, {
      durationMs: Math.round(duration),
      error: (error as Error).message,
    });
    throw error;
  }
}
```

### Correlation IDs

```typescript
// CORRECT: Trace requests across services
import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId: string;
  traceId: string;
  spanId: string;
  userId?: string;
}

const contextStorage = new AsyncLocalStorage<RequestContext>();

function getContext(): RequestContext | undefined {
  return contextStorage.getStore();
}

function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return contextStorage.run(context, fn);
}

// Logger automatically includes context
function createContextAwareLogger() {
  return {
    info: (message: string, data?: object) => {
      const context = getContext();
      log('info', message, { ...context, ...data });
    },
    // ... other levels
  };
}
```
