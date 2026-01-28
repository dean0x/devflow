# API Endpoint Patterns

Detailed patterns for REST API endpoints, error handling, and request validation.

## REST Endpoint Structure

```typescript
// Pattern: Parse request -> Validate auth -> Execute -> Format response
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

## Error Response Mapping

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

## Request Validation

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

## POST Endpoint Example

```typescript
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

## PUT/PATCH Endpoint Example

```typescript
export async function handleUpdateUser(req: Request): Promise<Response> {
  // 1. Parse path parameter
  const id = parsePathParam(req, 'id');
  if (!id.ok) {
    return errorResponse(400, 'Invalid user ID');
  }

  // 2. Parse and validate request body
  const input = parseUpdateUserRequest(req);
  if (!input.ok) {
    return errorResponse(400, 'Invalid request', input.error.errors);
  }

  // 3. Auth checks
  const auth = await authenticate(req);
  if (!auth.ok) {
    return errorResponse(401, 'Unauthorized');
  }

  if (!authorize(auth.value, 'users:update', id.value)) {
    return errorResponse(403, 'Forbidden');
  }

  // 4. Execute update
  const result = await updateUser(id.value, input.value);
  if (!result.ok) {
    return handleError(result.error);
  }

  return jsonResponse(200, result.value);
}
```

## DELETE Endpoint Example

```typescript
export async function handleDeleteUser(req: Request): Promise<Response> {
  const id = parsePathParam(req, 'id');
  if (!id.ok) {
    return errorResponse(400, 'Invalid user ID');
  }

  const auth = await authenticate(req);
  if (!auth.ok) {
    return errorResponse(401, 'Unauthorized');
  }

  if (!authorize(auth.value, 'users:delete', id.value)) {
    return errorResponse(403, 'Forbidden');
  }

  const result = await deleteUser(id.value);
  if (!result.ok) {
    return handleError(result.error);
  }

  return emptyResponse(204);
}
```

## Response Helpers

```typescript
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
