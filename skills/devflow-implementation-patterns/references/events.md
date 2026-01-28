# Event Handler Patterns

Detailed patterns for async event handling, idempotency, and error recovery.

## Async Event Handler

```typescript
// Pattern: Validate event -> Process -> Handle errors -> Acknowledge
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

## Idempotent Processing

```typescript
// Pattern: Check if already processed -> Process -> Mark complete
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

## Event with Retry Logic

```typescript
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

## Dead Letter Queue Pattern

```typescript
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

## Event Batching

```typescript
// Process events in batches for efficiency
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

## Event Sourcing Pattern

```typescript
interface DomainEvent {
  id: string;
  aggregateId: string;
  type: string;
  payload: unknown;
  timestamp: Date;
  version: number;
}

class EventStore {
  async append(event: DomainEvent): Promise<void> {
    await db.events.insert({
      ...event,
      timestamp: new Date(),
    });
  }

  async getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]> {
    return db.events
      .where({ aggregateId })
      .filter(e => !fromVersion || e.version > fromVersion)
      .orderBy('version')
      .all();
  }
}

// Rebuild aggregate state from events
function rebuildAggregate<T>(
  events: DomainEvent[],
  reducer: (state: T, event: DomainEvent) => T,
  initialState: T
): T {
  return events.reduce(reducer, initialState);
}
```

## Pub/Sub Handler Registration

```typescript
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
eventBus.subscribe('order.placed', handleOrderPlaced);

await eventBus.publish('user.created', { userId: '123', email: 'test@example.com' });
```
