# Regression-Safe Patterns Reference

Correct patterns for avoiding regressions during code changes.

---

## Safe Export Changes

### Deprecation Before Removal

```typescript
// Step 1: Deprecate (release v1.1)
/**
 * @deprecated Use `createUserV2` instead. Will be removed in v2.0.
 */
export function createUser(data: UserData): User {
  console.warn('createUser is deprecated. Use createUserV2.');
  return createUserV2({ ...data, version: 1 });
}

// New function
export function createUserV2(data: UserDataV2): User { }

// Step 2: Remove in next major version (v2.0)
// export function createUser - REMOVED with changelog entry
export function createUserV2(data: UserDataV2): User { }
```

### Additive Changes Only

```typescript
// SAFE: Adding new exports
export function existingFunction() { }  // Unchanged
export function newFunction() { }       // Added - safe
export const NEW_CONSTANT = 'value';    // Added - safe

// SAFE: Adding optional parameters
function fetch(url: string, options?: FetchOptions): Promise<Response> { }
// Adding options parameter with default - safe for existing callers
```

---

## Safe Return Type Changes

### Widening with Type Guards

```typescript
// BEFORE
function getUser(id: string): User { }

// AFTER: Widen return type safely
function getUser(id: string): User | null { }

// MIGRATION: Provide type guard for existing callers
function isUserFound(user: User | null): user is User {
  return user !== null;
}

// Usage for existing code:
const user = getUser(id);
if (isUserFound(user)) {
  console.log(user.name);  // Safe - type narrowed
}
```

### Result Type Migration

```typescript
// BEFORE: Throws
function parseConfig(json: string): Config {
  if (!valid) throw new ConfigError('Invalid');
  return config;
}

// AFTER: Returns Result
function parseConfig(json: string): Result<Config, ConfigError> {
  if (!valid) return { ok: false, error: new ConfigError('Invalid') };
  return { ok: true, value: config };
}

// MIGRATION: Provide wrapper for existing callers
function parseConfigOrThrow(json: string): Config {
  const result = parseConfig(json);
  if (!result.ok) throw result.error;
  return result.value;
}
```

---

## Safe Default Value Changes

### Explicit Override

```typescript
// BEFORE
function fetch(url: string, timeout = 5000): Promise<Response> { }

// AFTER: New default with explicit legacy option
const LEGACY_TIMEOUT = 5000;
const NEW_TIMEOUT = 1000;

function fetch(
  url: string,
  timeout = NEW_TIMEOUT,
  options?: { useLegacyTimeout?: boolean }
): Promise<Response> {
  const actualTimeout = options?.useLegacyTimeout ? LEGACY_TIMEOUT : timeout;
  // ...
}

// Existing code can opt-in to legacy behavior
fetch(url, undefined, { useLegacyTimeout: true });
```

---

## Safe API Changes

### Versioned Endpoints

```typescript
// Keep old endpoint, add new version
app.get('/api/v1/users/:id', getUserV1);  // Unchanged
app.get('/api/v2/users/:id', getUserV2);  // New version

// Document deprecation timeline
// v1 sunset: 2025-06-01
```

### Backward Compatible Response

```typescript
// BEFORE response
{ id: '123', name: 'John' }

// AFTER: Add fields, don't remove
{ id: '123', name: 'John', displayName: 'John Doe', avatar: 'url' }
// name still present for backward compatibility
```

---

## Complete Migration Pattern

### Track Migration Progress

```typescript
// migration-tracker.ts
const MIGRATION_STATUS = {
  'src/api/users.ts': 'complete',
  'src/api/orders.ts': 'complete',
  'src/services/auth.ts': 'pending',    // NOT YET MIGRATED
  'src/utils/format.ts': 'pending',     // NOT YET MIGRATED
} as const;

// Verify before merge
function assertMigrationComplete(): void {
  const pending = Object.entries(MIGRATION_STATUS)
    .filter(([_, status]) => status === 'pending');

  if (pending.length > 0) {
    throw new Error(`Migration incomplete: ${pending.map(([f]) => f).join(', ')}`);
  }
}
```

### Automated Consumer Updates

```typescript
// codemod for migration
// jscodeshift transform
export default function transformer(file, api) {
  const j = api.jscodeshift;

  return j(file.source)
    .find(j.CallExpression, { callee: { name: 'oldFunction' } })
    .replaceWith(path => {
      const [a, b] = path.node.arguments;
      return j.callExpression(
        j.identifier('newFunction'),
        [j.objectExpression([
          j.property('init', j.identifier('a'), a),
          j.property('init', j.identifier('b'), b),
        ])]
      );
    })
    .toSource();
}
```

---

## Event Handler Safety

### Preserve Side Effects

```typescript
// When refactoring, preserve all side effects
function processOrder(order: Order): ProcessedOrder {
  // PRESERVED: Logging for debugging
  logger.info('Processing order', { orderId: order.id });

  const result = doProcessing(order);

  // PRESERVED: Event for downstream systems
  events.emit('order.processed', result);

  return result;
}
```

### Document Intentional Removal

```typescript
// If side effect removal is intentional, document it
function processOrder(order: Order): ProcessedOrder {
  // INTENTIONAL: Removed analytics event (tracked in ANALYTICS-123)
  // Reason: Moving to dedicated analytics service
  // Migration: Analytics service polls order database directly

  const result = doProcessing(order);
  return result;
}
```
