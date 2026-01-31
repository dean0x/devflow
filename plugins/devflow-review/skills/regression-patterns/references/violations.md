# Regression Violations Reference

Extended examples of regression patterns to detect during code review.

---

## Lost Functionality Violations

### Removed Exports

```typescript
// BEFORE: module exports
export function createUser(data: UserData): User { }
export function deleteUser(id: string): void { }
export function updateUser(id: string, data: Partial<UserData>): User { }
export const USER_ROLES = ['admin', 'user', 'guest'] as const;

// AFTER: exports removed (REGRESSION!)
export function createUser(data: UserData): User { }
// deleteUser - REMOVED
// updateUser - REMOVED
// USER_ROLES - REMOVED
```

### Removed CLI Options

```typescript
// BEFORE
program
  .option('-v, --verbose', 'Verbose output')
  .option('-q, --quiet', 'Quiet mode')
  .option('-f, --force', 'Force operation')
  .option('--dry-run', 'Preview changes');

// AFTER: options removed (REGRESSION!)
program
  .option('-v, --verbose', 'Verbose output');
// --quiet, --force, --dry-run REMOVED

// Users with scripts using these flags will break!
```

### Removed API Endpoints

```typescript
// BEFORE
app.get('/api/users', listUsers);
app.get('/api/users/:id', getUser);
app.post('/api/users', createUser);
app.delete('/api/users/:id', deleteUser);  // REMOVED!

// AFTER
app.get('/api/users', listUsers);
app.get('/api/users/:id', getUser);
app.post('/api/users', createUser);
// DELETE endpoint removed - clients will get 404!
```

### Removed Event Handlers

```typescript
// BEFORE
eventBus.on('user.created', sendWelcomeEmail);
eventBus.on('user.created', syncToAnalytics);
eventBus.on('order.completed', updateInventory);

// AFTER
eventBus.on('user.created', sendWelcomeEmail);
// syncToAnalytics handler REMOVED - analytics will be incomplete!
// updateInventory handler REMOVED - inventory won't update!
```

---

## Broken Behavior Violations

### Changed Return Types

```typescript
// BEFORE
async function getUser(id: string): Promise<User> {
  return user;
}

// AFTER: Return type changed (BREAKING!)
async function getUser(id: string): Promise<User | null> {
  return user ?? null;
}

// All callers assuming non-null will break:
const user = await getUser(id);
console.log(user.name);  // Potential null dereference!
```

### Changed Side Effects

```typescript
// BEFORE: Function logs and emits event
function processOrder(order: Order): ProcessedOrder {
  logger.info('Processing order', { orderId: order.id });
  const result = doProcessing(order);
  events.emit('order.processed', result);
  return result;
}

// AFTER: Side effects removed (REGRESSION!)
function processOrder(order: Order): ProcessedOrder {
  const result = doProcessing(order);
  return result;
  // No logging - harder to debug production issues!
  // No event - downstream systems won't be notified!
}
```

### Changed Default Values

```typescript
// BEFORE
interface Options {
  timeout?: number;  // default: 5000
  retries?: number;  // default: 3
}

function fetch(url: string, options: Options = { timeout: 5000, retries: 3 }) { }

// AFTER: Defaults changed (REGRESSION!)
function fetch(url: string, options: Options = { timeout: 1000, retries: 1 }) { }
// Existing code relying on 5s timeout may start failing!
```

### Changed Error Handling

```typescript
// BEFORE: Throws specific error
async function authenticate(credentials: Credentials): Promise<User> {
  if (!valid) throw new AuthenticationError('Invalid credentials');
  return user;
}

// AFTER: Returns null instead (BREAKING!)
async function authenticate(credentials: Credentials): Promise<User | null> {
  if (!valid) return null;  // Callers catching AuthenticationError will miss this!
  return user;
}
```

---

## Intent Mismatch Violations

### Commit Says X, Code Does Y

```typescript
// Commit message: "Add retry logic to API calls"

// ACTUAL CODE: No retry logic!
async function fetchData(): Promise<Data> {
  const response = await api.get('/data');
  return response.data;
}

// Expected: Retry on failure
// Reality: No retry implemented
```

### Partial Implementation

```typescript
// Commit message: "Implement user preferences"

// ACTUAL CODE: Only partial implementation
interface UserPreferences {
  theme: 'light' | 'dark';
  language: string;
  notifications: NotificationSettings;  // Not implemented!
  privacy: PrivacySettings;             // Not implemented!
}

function updatePreferences(prefs: Partial<UserPreferences>) {
  if (prefs.theme) user.theme = prefs.theme;
  if (prefs.language) user.language = prefs.language;
  // notifications and privacy not handled!
}
```

---

## Incomplete Migration Violations

### Partial Call Site Updates

```typescript
// OLD API
function oldFunction(a: string, b: number): Result { }

// NEW API
function newFunction(params: { a: string; b: number }): Result { }

// PARTIALLY MIGRATED:
// file1.ts - Updated
const result = newFunction({ a: 'test', b: 42 });

// file2.ts - NOT updated (REGRESSION!)
const result = oldFunction('test', 42);  // Still using old API!

// file3.ts - NOT updated (REGRESSION!)
const result = oldFunction('other', 100);  // Still using old API!
```

### Consumer Model Mismatch

```typescript
// CHANGED: User model
interface User {
  id: string;
  email: string;
  // name: string;  // REMOVED
  displayName: string;  // ADDED (replacement)
}

// CONSUMER NOT UPDATED (REGRESSION!)
function formatUserGreeting(user: User): string {
  return `Hello, ${user.name}!`;  // TypeScript error: 'name' doesn't exist
}
```
