# Logging Patterns

Detailed patterns for structured logging, operation tracking, and observability.

## Structured Logging

```typescript
// Pattern: Context -> Level -> Message -> Data
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

## Operation Logging

```typescript
// Pattern: Log start -> Execute -> Log result
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

## JSON Log Format

```typescript
// Production-ready JSON logging
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

## Request Logging Middleware

```typescript
// Pattern: Log all HTTP requests with timing
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

## Error Logging

```typescript
// Pattern: Log errors with full context
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

// Pattern: Wrap async handlers with error logging
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

## Audit Logging

```typescript
// Pattern: Immutable audit trail for sensitive operations
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

## Performance Logging

```typescript
// Pattern: Log slow operations
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

## Log Sampling

```typescript
// Pattern: Sample high-volume logs to reduce noise
class SampledLogger {
  private counters = new Map<string, number>();

  constructor(
    private logger: Logger,
    private sampleRate: number = 0.1
  ) {}

  sampled(key: string, level: 'info' | 'warn', message: string, data?: object): void {
    const count = (this.counters.get(key) || 0) + 1;
    this.counters.set(key, count);

    if (Math.random() < this.sampleRate) {
      this.logger[level](message, { ...data, sampleCount: count });
    }
  }
}

// Usage for high-volume events
const sampledLogger = new SampledLogger(logger, 0.01); // 1% sample rate
sampledLogger.sampled('cache-miss', 'info', 'Cache miss', { key: cacheKey });
```

## Correlation IDs

```typescript
// Pattern: Trace requests across services
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
