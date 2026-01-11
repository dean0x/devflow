---
name: devflow-regression-patterns
description: Functionality regression and intent validation analysis. Load when reviewing for lost functionality, broken behavior, or incomplete migrations. Used by Reviewer agent with regression focus.
allowed-tools: Read, Grep, Glob
---

# Regression Patterns

Domain expertise for detecting functionality regressions and validating implementation intent. Use alongside `devflow-review-methodology` for complete regression reviews.

## Iron Law

> **WHAT WORKED BEFORE MUST WORK AFTER**
>
> Every change carries regression risk. Removed exports break consumers. Changed signatures
> break callers. Modified behavior breaks expectations. The burden of proof is on the change:
> demonstrate no regression, or document the intentional breaking change.

## Regression Categories

### 1. Lost Functionality

**Removed Exports**
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

// Detection: Compare exports before/after
// git show main:src/users.ts | grep "^export"
// vs
// grep "^export" src/users.ts
```

**Removed CLI Options**
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

**Removed API Endpoints**
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

**Removed Event Handlers**
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

### 2. Broken Behavior

**Changed Return Types**
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

**Changed Side Effects**
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

**Changed Default Values**
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

**Changed Error Handling**
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

### 3. Intent vs Reality Mismatch

**Commit Says X, Code Does Y**
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

**Partial Implementation**
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

### 4. Incomplete Migrations

**Some Call Sites Updated, Others Not**
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

**Consumers Not Updated**
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

---

## Detection Techniques

**Compare Exports Before/After:**
```bash
# List exports in main branch
git show main:src/index.ts | grep -E "^export" > /tmp/exports_before.txt

# List exports in current branch
grep -E "^export" src/index.ts > /tmp/exports_after.txt

# Find removed exports
diff /tmp/exports_before.txt /tmp/exports_after.txt | grep "^<"
```

**Find Removed Function Calls:**
```bash
# Check if function is still called
git show main:src/*.ts | grep "oldFunction" | wc -l  # Before: 15
grep -r "oldFunction" src/*.ts | wc -l                # After: 3 (12 removed!)
```

**Verify All Consumers Updated:**
```bash
# Find all imports of changed module
grep -rn "from './changed-module'" --include="*.ts"

# Check each importer for usage of changed exports
```

---

## Severity Guidelines

**CRITICAL** - Breaking changes without migration:
- Public API exports removed
- Return types changed incompatibly
- Required parameters added
- Event emissions removed
- CLI options removed

**HIGH** - Significant behavior changes:
- Default values changed
- Error handling changed
- Side effects removed
- Incomplete migrations

**MEDIUM** - Moderate regression risk:
- Internal APIs changed
- Logging reduced
- Performance characteristics changed

**LOW** - Minor concerns:
- Documentation drift
- Internal refactoring

---

## Regression Checklist

Before approving changes:

- [ ] No exports removed without deprecation
- [ ] Return types backward compatible
- [ ] Default values unchanged (or documented)
- [ ] Side effects preserved (events, logging)
- [ ] All consumers of changed code updated
- [ ] Migration complete across codebase
- [ ] CLI options preserved or deprecated
- [ ] API endpoints preserved or versioned
- [ ] Commit message matches implementation
- [ ] Breaking changes documented in CHANGELOG

---

## Comparison Commands

```bash
# Compare file structure
diff <(git ls-tree -r --name-only main src/) <(git ls-tree -r --name-only HEAD src/)

# Compare exports
diff <(git show main:src/index.ts | grep "^export") <(cat src/index.ts | grep "^export")

# Find removed functions
git diff main...HEAD --stat | grep -E "^\s+-" | head -20

# Check for removed test files
git diff main...HEAD --name-status | grep "^D.*test"

# Find TODO/FIXME additions (incomplete work?)
git diff main...HEAD | grep "^\+.*TODO\|^\+.*FIXME"
```

