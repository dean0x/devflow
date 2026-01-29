---
name: devflow-implementation-patterns
description: Automatically activate when implementing CRUD operations, API endpoints, event handlers, configuration systems, or logging. Triggers on feature implementation tasks involving database operations, REST/GraphQL APIs, pub/sub patterns, or service configuration.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Implementation Patterns

Reference for common implementation patterns. Use these patterns to write consistent, maintainable code.

## Iron Law

> **FOLLOW EXISTING PATTERNS**
>
> Match the codebase style, don't invent new conventions. If the project uses Result types,
> use Result types. If it uses exceptions, use exceptions. Consistency trumps personal
> preference. The best pattern is the one already in use.

## When This Skill Activates

- Implementing CRUD operations
- Creating API endpoints
- Writing event handlers
- Setting up configuration
- Adding logging
- Database operations

---

## Pattern Categories

### CRUD Operations

Create, Read, Update, Delete with Result types and proper error handling.

**Core pattern**: Validate -> Transform -> Persist -> Return

```typescript
async function createUser(input: CreateUserInput): Promise<Result<User, CreateError>> {
  const validated = validateCreateUser(input);
  if (!validated.ok) return Err({ type: 'validation', details: validated.error });

  const user: User = { id: generateId(), ...validated.value, createdAt: new Date() };
  const saved = await userRepository.save(user);
  if (!saved.ok) return Err({ type: 'persistence', details: saved.error });

  return Ok(saved.value);
}
```

### API Endpoints

REST endpoint structure with auth, validation, and error mapping.

**Core pattern**: Parse request -> Validate auth -> Execute -> Format response

```typescript
export async function handleGetUser(req: Request): Promise<Response> {
  const id = parsePathParam(req, 'id');
  if (!id.ok) return errorResponse(400, 'Invalid user ID');

  const auth = await authenticate(req);
  if (!auth.ok) return errorResponse(401, 'Unauthorized');

  const result = await getUser(id.value);
  if (!result.ok) return handleError(result.error);

  return jsonResponse(200, result.value);
}
```

### Event Handlers

Async event processing with idempotency and error recovery.

**Core pattern**: Validate event -> Process -> Handle errors -> Acknowledge

```typescript
async function handleUserCreated(event: UserCreatedEvent): Promise<void> {
  const validated = validateEvent(event);
  if (!validated.ok) { logger.warn('Invalid event'); return; }

  await sendWelcomeEmail(event.userId);
  await createDefaultSettings(event.userId);
  logger.info('Event processed successfully');
}
```

### Configuration

Environment config with schema validation and feature flags.

**Core pattern**: Define schema -> Load from env -> Validate -> Export frozen

```typescript
const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const config = Object.freeze(ConfigSchema.parse(process.env));
```

### Logging

Structured logging with context propagation and operation tracking.

**Core pattern**: Context -> Level -> Message -> Data

```typescript
const logger = createLogger({ requestId: req.id, userId: user.id });
logger.info('Processing order', { orderId: order.id, items: order.items.length });
```

---

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| God functions | 500-line functions doing everything | Compose small, focused functions |
| Implicit dependencies | Using global state (`db.query(...)`) | Inject dependencies explicitly |
| Swallowing errors | Empty catch blocks | Handle or propagate with Result types |
| Magic values | Unexplained numbers/strings | Extract to named constants |

---

## Build Optimization

Production builds must exclude test files, debug artifacts, and sourcemaps.

```json
// tsconfig.prod.json
{
  "exclude": ["**/*.test.ts", "**/*.spec.ts", "**/tests/**"]
}
```

---

## Implementation Checklist

Before implementing, verify:

- [ ] Using Result types for operations that can fail
- [ ] Validating input at system boundaries
- [ ] Logging with context (requestId, userId, operation)
- [ ] Handling all error cases explicitly
- [ ] Making operations idempotent where possible
- [ ] Using transactions for multi-step operations
- [ ] No hardcoded values (use config)
- [ ] Following existing codebase patterns

---

## Extended References

For full implementation examples:
- `references/violations.md` - Extended violation examples (CRUD, API, Events, Config, Logging)
- `references/patterns.md` - Extended correct patterns (CRUD, API, Events, Config, Logging)
