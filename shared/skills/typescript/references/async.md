# TypeScript — Async Patterns

Type-safe async patterns in TypeScript. See `sources.md` for full bibliography.

---

## Async Fundamentals [2][1, Item 25]

TypeScript's async model layers on JavaScript's Promise-based event loop. The key
addition is **typed Promise chains** — `Promise<T>` propagates type information through
`.then()` and `async/await` without losing it [2].

"Prefer async/await to raw Promise chains — they're easier to read and produce better
stack traces." — Effective TypeScript [1, Item 25]

---

## Async Function Types [6]

```typescript
type AsyncFn<T, R> = (arg: T) => Promise<R>;
type AsyncFn2<T1, T2, R> = (arg1: T1, arg2: T2) => Promise<R>;
type AsyncResult<T, E = Error> = Promise<Result<T, E>>;
type AsyncVoidFn<T> = (arg: T) => Promise<void>;
```

---

## Result-Based Async [1, Item 25][6]

Combine Result types with async for explicit, composable error handling.
Returning errors as values instead of throwing enables chaining without try/catch noise.

```typescript
async function fetchUser(id: string): AsyncResult<User> {
  try {
    const user = await db.users.findById(id);
    if (!user) return { ok: false, error: new Error('User not found') };
    return { ok: true, value: user };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// Generic tryCatch — wraps any async function in Result [6]
async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// Usage — no try/catch at call site
const result = await tryCatch(() => fetchUser(id));
if (!result.ok) {
  console.error('Failed:', result.error.message);
  return;
}
const user = result.value; // typed User
```

---

## Promise Utilities [6]

### Settle All — Individual Results per Item

```typescript
async function settleAll<T>(promises: Promise<T>[]): Promise<Array<Result<T, Error>>> {
  const results = await Promise.allSettled(promises);
  return results.map(r =>
    r.status === 'fulfilled'
      ? { ok: true as const, value: r.value }
      : { ok: false as const, error: r.reason }
  );
}

// Usage
const results = await settleAll(ids.map(fetchUser));
const successes = results.filter(r => r.ok).map(r => r.value);
const failures  = results.filter(r => !r.ok).map(r => r.error);
```

### Timeout Wrapper

```typescript
function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Timeout'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// Usage
const user = await withTimeout(fetchUser(id), 5000, 'User fetch timed out');
```

### Retry with Exponential Backoff [6]

```typescript
interface RetryOptions {
  attempts: number;
  delayMs: number;
  backoff?: 'linear' | 'exponential';
  onRetry?: (error: Error, attempt: number) => void;
}

async function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, delayMs, backoff = 'linear', onRetry } = options;
  let lastError!: Error;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      onRetry?.(lastError, i + 1);
      if (i < attempts - 1) {
        const delay = backoff === 'exponential' ? delayMs * Math.pow(2, i) : delayMs;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
```

---

## Controlled Concurrency [6]

### Bounded Parallel Map

```typescript
// pMap — like Promise.all but with concurrency limit [6]
async function pMap<T, R>(
  items: T[], fn: (item: T, index: number) => Promise<R>, concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const idx = i;
    const promise = fn(items[idx], idx).then(result => { results[idx] = result; });
    executing.push(promise);
    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(p => p === promise), 1);
    }
  }

  await Promise.all(executing);
  return results;
}

// Usage — process 100 items, 5 at a time
const results = await pMap(items, fetchItem, 5);
```

### Batch Processing

```typescript
async function batch<T, R>(
  items: T[], batchSize: number, fn: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batchResults = await fn(items.slice(i, i + batchSize));
    results.push(...batchResults);
  }
  return results;
}
```

---

## Cancellation via AbortController [2][8]

```typescript
interface Cancellable<T> { promise: Promise<T>; cancel: () => void }

function cancellable<T>(fn: (signal: AbortSignal) => Promise<T>): Cancellable<T> {
  const controller = new AbortController();
  return { promise: fn(controller.signal), cancel: () => controller.abort() };
}

// Usage
const { promise, cancel } = cancellable(async (signal) => {
  const response = await fetch(url, { signal });
  return response.json() as Promise<User>;
});

setTimeout(cancel, 5000); // cancel if too slow

try {
  const user = await promise;
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    console.log('Request cancelled');
  }
}
```

---

## Debounce and Throttle [6]

```typescript
// Debounce — delays execution until after calls stop [6]
function debounce<T extends (...args: any[]) => any>(
  fn: T, delayMs: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

// Throttle — limits execution to once per interval [6]
function throttle<T extends (...args: any[]) => any>(
  fn: T, limitMs: number
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastRun >= limitMs) {
      lastRun = now;
      fn(...args);
    }
  };
}
```

---

## Lazy Async Initialization [6]

```typescript
// Execute once, cache forever — safe for concurrent callers [6]
class LazyAsync<T> {
  private promise: Promise<T> | null = null;

  constructor(private readonly factory: () => Promise<T>) {}

  get(): Promise<T> {
    if (!this.promise) {
      this.promise = this.factory(); // concurrent calls share this Promise
    }
    return this.promise;
  }

  reset(): void { this.promise = null; }
}

// Usage
const config = new LazyAsync(async () => {
  const response = await fetch('/config');
  return response.json() as Promise<AppConfig>;
});

const cfg = await config.get(); // first call fetches
const cfg2 = await config.get(); // returns same promise
```

---

## Async Iteration [2]

```typescript
// Async generator — for streaming or paginated data [2]
async function* paginate<T>(
  fetcher: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>
): AsyncGenerator<T> {
  let cursor: string | undefined;
  do {
    const page = await fetcher(cursor);
    for (const item of page.items) yield item;
    cursor = page.nextCursor;
  } while (cursor);
}

// Usage — process items as they arrive
for await (const user of paginate(fetchUserPage)) {
  await processUser(user);
}
```

---

## Async Anti-Patterns [1, Item 25][6]

```typescript
// VIOLATION: Fire-and-forget — error silently lost [1, Item 25]
async function save() {
  saveToDatabase(data); // no await
  console.log('Saved!'); // lie
}

// VIOLATION: forEach with async — doesn't await iterations [6]
ids.forEach(async (id) => { await process(id); });
// continues immediately, all errors swallowed

// VIOLATION: Promise constructor with async executor [6]
function fetch(): Promise<Data> {
  return new Promise(async (resolve, reject) => {
    // async executor: thrown errors don't reject the outer promise
    const data = await doFetch();
    resolve(data);
  });
}

// VIOLATION: Unnecessary Promise wrapping [6]
function getValue(): Promise<number> {
  return new Promise(resolve => resolve(42)); // just: return Promise.resolve(42)
}

// VIOLATION: Unhandled rejection in Promise.all [6]
async function loadAll(ids: string[]) {
  return Promise.all(ids.map(id => fetch(`/api/${id}`)));
  // one failure rejects entire batch — use settleAll for partial results
}

// VIOLATION: Callback inside async — inner return discarded [6]
async function getData() {
  fs.readFile('data.json', (err, data) => {
    return JSON.parse(data); // return does nothing; no await possible
  });
  // function returns Promise<undefined>
}
```
