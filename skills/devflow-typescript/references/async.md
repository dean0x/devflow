# Async TypeScript Patterns

Extended async patterns and utilities for TypeScript.

## Async Function Types

```typescript
// Async function type
type AsyncFn<T, R> = (arg: T) => Promise<R>;

// Async with multiple args
type AsyncFn2<T1, T2, R> = (arg1: T1, arg2: T2) => Promise<R>;

// Async with result
type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// Async void function
type AsyncVoidFn<T> = (arg: T) => Promise<void>;
```

---

## Result-Based Async

```typescript
// Basic async result pattern
async function fetchUser(id: string): AsyncResult<User> {
  try {
    const user = await db.users.findById(id);
    if (!user) {
      return { ok: false, error: new Error('User not found') };
    }
    return { ok: true, value: user };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// Wrapping async operations
async function tryCatch<T>(
  fn: () => Promise<T>
): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// Usage
const result = await tryCatch(() => fetchUserFromApi(id));
if (!result.ok) {
  console.error('Failed:', result.error.message);
}
```

---

## Promise Utilities

### settleAll

```typescript
// Wait for all, but handle errors individually
async function settleAll<T>(
  promises: Promise<T>[]
): Promise<Array<Result<T, Error>>> {
  const results = await Promise.allSettled(promises);
  return results.map((result) =>
    result.status === 'fulfilled'
      ? { ok: true as const, value: result.value }
      : { ok: false as const, error: result.reason }
  );
}

// Usage
const [user, orders, preferences] = await settleAll([
  fetchUser(id),
  fetchOrders(id),
  fetchPreferences(id)
]);

if (user.ok) {
  console.log(user.value.name);
}
```

### withTimeout

```typescript
// Timeout wrapper
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs)
    ),
  ]);
}

// Usage
const data = await withTimeout(
  fetchRemoteData(),
  5000,
  'Remote API did not respond in time'
);
```

### retry

```typescript
interface RetryOptions {
  attempts: number;
  delayMs: number;
  backoff?: 'linear' | 'exponential';
  onRetry?: (error: Error, attempt: number) => void;
}

async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { attempts, delayMs, backoff = 'linear', onRetry } = options;

  let lastError: Error;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      onRetry?.(lastError, i + 1);

      if (i < attempts - 1) {
        const delay = backoff === 'exponential'
          ? delayMs * Math.pow(2, i)
          : delayMs;
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

// Usage
const data = await retry(
  () => fetchRemoteData(),
  {
    attempts: 3,
    delayMs: 1000,
    backoff: 'exponential',
    onRetry: (err, attempt) => console.log(`Retry ${attempt}: ${err.message}`)
  }
);
```

### sleep

```typescript
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Concurrent Execution

### pMap (Concurrency Control)

```typescript
async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const promise = fn(items[i], i).then(result => {
      results[i] = result;
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove completed promises
      executing.splice(
        executing.findIndex(p => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

// Usage - process 100 items, max 5 at a time
const results = await pMap(
  items,
  async (item) => processItem(item),
  5
);
```

### batch

```typescript
async function batch<T, R>(
  items: T[],
  batchSize: number,
  fn: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await fn(batch);
    results.push(...batchResults);
  }

  return results;
}

// Usage
const users = await batch(
  userIds,
  50,
  async (ids) => fetchUsers(ids)
);
```

---

## Async Queue

```typescript
class AsyncQueue<T> {
  private queue: T[] = [];
  private processing = false;
  private processor: (item: T) => Promise<void>;

  constructor(processor: (item: T) => Promise<void>) {
    this.processor = processor;
  }

  push(item: T): void {
    this.queue.push(item);
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const item = this.queue.shift()!;

    try {
      await this.processor(item);
    } catch (error) {
      console.error('Queue processing error:', error);
    }

    this.processing = false;
    this.processNext();
  }

  get length(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }
}

// Usage
const emailQueue = new AsyncQueue<Email>(async (email) => {
  await sendEmail(email);
});

emailQueue.push({ to: 'user@example.com', subject: 'Hello' });
```

---

## Debounce / Throttle

### debounce

```typescript
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

// Async version that returns promise
function debounceAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingResolve: ((value: any) => void) | null = null;

  return (...args: Parameters<T>) => {
    return new Promise((resolve) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      pendingResolve = resolve;
      timeoutId = setTimeout(async () => {
        const result = await fn(...args);
        pendingResolve?.(result);
      }, delayMs);
    });
  };
}
```

### throttle

```typescript
function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limitMs: number
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();

    if (now - lastRun >= limitMs) {
      lastRun = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastRun = Date.now();
        timeoutId = null;
        fn(...args);
      }, limitMs - (now - lastRun));
    }
  };
}
```

---

## Cancellation

```typescript
interface Cancellable<T> {
  promise: Promise<T>;
  cancel: () => void;
}

function cancellable<T>(
  fn: (signal: AbortSignal) => Promise<T>
): Cancellable<T> {
  const controller = new AbortController();

  const promise = fn(controller.signal);

  return {
    promise,
    cancel: () => controller.abort()
  };
}

// Usage
const { promise, cancel } = cancellable(async (signal) => {
  const response = await fetch(url, { signal });
  return response.json();
});

// Cancel if takes too long
setTimeout(cancel, 5000);

try {
  const data = await promise;
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Request cancelled');
  }
}
```

---

## Async Initialization

```typescript
class AsyncInitializable {
  private initPromise: Promise<void> | null = null;
  private initialized = false;

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }

    await this.initPromise;
    this.initialized = true;
  }

  protected async initialize(): Promise<void> {
    // Override in subclass
  }
}

// Usage
class DatabaseConnection extends AsyncInitializable {
  private connection: Connection | null = null;

  protected async initialize(): Promise<void> {
    this.connection = await createConnection(config);
  }

  async query(sql: string): Promise<any[]> {
    await this.ensureInitialized();
    return this.connection!.query(sql);
  }
}
```

---

## Lazy Async

```typescript
class LazyAsync<T> {
  private promise: Promise<T> | null = null;
  private value: T | null = null;
  private resolved = false;

  constructor(private factory: () => Promise<T>) {}

  async get(): Promise<T> {
    if (this.resolved) return this.value!;

    if (!this.promise) {
      this.promise = this.factory().then(v => {
        this.value = v;
        this.resolved = true;
        return v;
      });
    }

    return this.promise;
  }

  isResolved(): boolean {
    return this.resolved;
  }

  reset(): void {
    this.promise = null;
    this.value = null;
    this.resolved = false;
  }
}

// Usage
const config = new LazyAsync(async () => {
  const response = await fetch('/config');
  return response.json();
});

// First call fetches
const cfg1 = await config.get();

// Subsequent calls return cached
const cfg2 = await config.get();
```
