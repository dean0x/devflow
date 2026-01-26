---
name: devflow-input-validation
description: Automatically enforce input validation at system boundaries when handling user input, API endpoints, or external data. Use when creating API routes, processing form data, or integrating with external services. Enforces parse-don't-validate pattern.
user-invocable: false
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Input Validation Skill

## Iron Law

> **ALL EXTERNAL DATA IS HOSTILE**
>
> Validate at boundaries, trust inside. Every piece of data from outside the system
> (user input, API responses, environment variables) is potentially malicious until
> validated with a schema. No exceptions. No "I trust this source." Validate everything.

## Purpose

Enforce security-critical validation at all system boundaries:
1. **Parse-don't-validate** - Use schema validation, not manual checks
2. **Boundary enforcement** - Validate at entry points only
3. **Type safety** - Leverage type system after validation
4. **Security first** - Prevent injection, overflow, and malformed data

## When This Skill Activates

Automatically triggers when:
- Creating API endpoints or routes
- Processing user-submitted data (forms, uploads, etc.)
- Integrating with external APIs
- Accepting configuration or environment variables
- Handling database queries with user input
- Processing command-line arguments

## Core Principle: Parse, Don't Validate

**CRITICAL**: Use schema validation libraries, not manual checks.

```typescript
// ❌ VIOLATION: Manual validation scatters checks
function createUser(data: any): User {
  if (!data.email || typeof data.email !== 'string') {
    throw new Error('Invalid email');
  }
  if (!data.age || typeof data.age !== 'number' || data.age < 0) {
    throw new Error('Invalid age');
  }
  if (!data.name || data.name.length > 100) {
    throw new Error('Invalid name');
  }
  // ... more manual checks

  return { email: data.email, age: data.age, name: data.name };
}

// ✅ CORRECT: Schema validation at boundary
import { z } from 'zod';

const UserSchema = z.object({
  email: z.string().email().max(255),
  age: z.number().int().min(0).max(150),
  name: z.string().min(1).max(100)
});

type User = z.infer<typeof UserSchema>;

function createUser(data: unknown): Result<User, ValidationError> {
  const validation = UserSchema.safeParse(data);

  if (!validation.success) {
    return {
      ok: false,
      error: new ValidationError('Invalid user data', validation.error)
    };
  }

  // After this point, data is guaranteed valid User type
  return { ok: true, value: validation.data };
}
```

## Boundary Detection

### API Endpoints (Critical Boundary)

```typescript
// ❌ VIOLATION: No validation at API boundary
app.post('/api/users', async (req, res) => {
  const user = await createUser(req.body); // Trusting external data!
  res.json(user);
});

// ✅ CORRECT: Validation at boundary
const CreateUserRequestSchema = z.object({
  body: UserSchema
});

app.post('/api/users', async (req, res) => {
  const validation = CreateUserRequestSchema.safeParse(req);

  if (!validation.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validation.error.issues
    });
  }

  // Now req.body is safely typed as User
  const result = await createUser(validation.data.body);

  if (!result.ok) {
    return res.status(500).json({ error: result.error.message });
  }

  res.json(result.value);
});
```

### External API Integration (Boundary)

```typescript
// ❌ VIOLATION: Trusting external API response
async function fetchUserData(userId: string): Promise<UserData> {
  const response = await fetch(`https://api.example.com/users/${userId}`);
  const data = await response.json();
  return data; // No validation!
}

// ✅ CORRECT: Validate external data
const ExternalUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  // Define exact structure we expect
});

async function fetchUserData(userId: string): Promise<Result<UserData, Error>> {
  try {
    const response = await fetch(`https://api.example.com/users/${userId}`);
    const rawData = await response.json();

    const validation = ExternalUserSchema.safeParse(rawData);

    if (!validation.success) {
      return {
        ok: false,
        error: new Error('External API returned invalid data')
      };
    }

    return { ok: true, value: validation.data };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
```

### Environment Variables (Boundary)

```typescript
// ❌ VIOLATION: Trusting environment variables
const config = {
  port: process.env.PORT,           // Could be undefined or invalid
  dbUrl: process.env.DATABASE_URL,  // No validation
  apiKey: process.env.API_KEY       // Could be empty or malformed
};

// ✅ CORRECT: Validate configuration
const ConfigSchema = z.object({
  port: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(65535)),
  dbUrl: z.string().url().startsWith('postgresql://'),
  apiKey: z.string().min(32).max(128)
});

function loadConfig(): Result<Config, Error> {
  const validation = ConfigSchema.safeParse({
    port: process.env.PORT,
    dbUrl: process.env.DATABASE_URL,
    apiKey: process.env.API_KEY
  });

  if (!validation.success) {
    return {
      ok: false,
      error: new Error(`Invalid configuration: ${validation.error.message}`)
    };
  }

  return { ok: true, value: validation.data };
}

// Application initialization
const configResult = loadConfig();
if (!configResult.ok) {
  console.error('Failed to load configuration:', configResult.error);
  process.exit(1);
}

const config = configResult.value; // Type-safe, validated config
```

### Database Queries (SQL Injection Prevention)

```typescript
// ❌ VIOLATION: Direct string interpolation (SQL injection risk)
async function getUserByEmail(email: string): Promise<User> {
  const query = `SELECT * FROM users WHERE email = '${email}'`;
  return db.query(query);
}

// ❌ VIOLATION: No input validation before query
async function searchUsers(searchTerm: string): Promise<User[]> {
  return db.query('SELECT * FROM users WHERE name LIKE $1', [`%${searchTerm}%`]);
}

// ✅ CORRECT: Validate input + parameterized query
const EmailSchema = z.string().email().max(255);
const SearchTermSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9\s-]+$/);

async function getUserByEmail(email: unknown): Promise<Result<User, Error>> {
  const validation = EmailSchema.safeParse(email);

  if (!validation.success) {
    return { ok: false, error: new Error('Invalid email format') };
  }

  try {
    // Parameterized query prevents SQL injection
    const user = await db.query('SELECT * FROM users WHERE email = $1', [validation.data]);
    return { ok: true, value: user };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

async function searchUsers(searchTerm: unknown): Promise<Result<User[], Error>> {
  const validation = SearchTermSchema.safeParse(searchTerm);

  if (!validation.success) {
    return { ok: false, error: new Error('Invalid search term') };
  }

  try {
    const users = await db.query(
      'SELECT * FROM users WHERE name ILIKE $1',
      [`%${validation.data}%`]
    );
    return { ok: true, value: users };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
```

## Validation Libraries

Recommended schema validation libraries by language:

**TypeScript/JavaScript**:
- Zod (recommended)
- Yup
- joi
- io-ts

**Python**:
- Pydantic (recommended)
- marshmallow
- dataclasses with validation

**Go**:
- go-playground/validator
- ozzo-validation

**Rust**:
- serde with validation
- validator crate

## Validation Report Format

When validation issues detected:

```markdown
🚨 INPUT VALIDATION ISSUES DETECTED

## 🔴 CRITICAL - Missing Boundary Validation
**File**: src/api/routes/users.ts:45
**Issue**: API endpoint accepts unvalidated user input
**Security Risk**: HIGH - Injection attacks, data corruption possible

**Current Code**:
```typescript
app.post('/api/users', async (req, res) => {
  const user = await createUser(req.body); // NO VALIDATION
  res.json(user);
});
```

**Required Fix**:
```typescript
const UserRequestSchema = z.object({
  body: z.object({
    email: z.string().email().max(255),
    name: z.string().min(1).max(100),
    age: z.number().int().min(0).max(150)
  })
});

app.post('/api/users', async (req, res) => {
  const validation = UserRequestSchema.safeParse(req);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error });
  }

  const result = await createUser(validation.data.body);
  // ... handle result
});
```

**Impact**: Prevents malicious input, ensures data integrity

## 🔴 CRITICAL - Manual Validation Instead of Schema
**File**: src/services/validation.ts:23
**Issue**: Manual type checking instead of schema validation
**Problem**: Scattered validation logic, incomplete checks

**Current Code**:
```typescript
if (!data.email || typeof data.email !== 'string') {
  throw new Error('Invalid email');
}
if (!data.age || typeof data.age !== 'number') {
  throw new Error('Invalid age');
}
// ... 15 more manual checks
```

**Required Fix**:
```typescript
const UserSchema = z.object({
  email: z.string().email().max(255),
  age: z.number().int().min(0).max(150),
  name: z.string().min(1).max(100),
  // All validation rules in one place
});

const validation = UserSchema.safeParse(data);
if (!validation.success) {
  return { ok: false, error: validation.error };
}
```

**Impact**: Centralized validation, type safety, better error messages

## 🔴 CRITICAL - SQL Injection Risk
**File**: src/database/queries.ts:67
**Issue**: String interpolation in SQL query
**Security Risk**: CRITICAL - SQL injection possible

**Current Code**:
```typescript
const query = `SELECT * FROM users WHERE email = '${email}'`;
```

**Required Fix**:
```typescript
// 1. Validate input
const validation = EmailSchema.safeParse(email);
if (!validation.success) {
  return { ok: false, error: new Error('Invalid email') };
}

// 2. Use parameterized query
const query = 'SELECT * FROM users WHERE email = $1';
const result = await db.query(query, [validation.data]);
```

**Impact**: Prevents SQL injection attacks (critical security issue)

## 🟡 HIGH - External API Response Not Validated
**File**: src/integrations/payment.ts:89
**Issue**: Trusting external API response without validation
**Risk**: Application crash if API changes structure

**Current Code**:
```typescript
const data = await response.json();
return data.amount; // No validation
```

**Required Fix**:
```typescript
const PaymentResponseSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  status: z.enum(['success', 'failed', 'pending'])
});

const validation = PaymentResponseSchema.safeParse(await response.json());
if (!validation.success) {
  return { ok: false, error: new Error('Invalid payment response') };
}

return { ok: true, value: validation.data.amount };
```

## 📊 Summary
- **Critical**: 8 validation issues (6 missing, 2 SQL injection risks)
- **High**: 4 external data issues
- **Security Risk**: CRITICAL (SQL injection possible)
- **Files affected**: 7

## 🛑 SECURITY GATE FAILED

These validation gaps create serious security vulnerabilities:
1. SQL injection possible in 2 locations
2. Unvalidated user input in 6 API endpoints
3. External data trusted without validation

**DO NOT deploy until these are fixed.**

## ✅ Required Actions

1. **Immediate** (Security Critical):
   - Fix SQL injection risks (2 locations)
   - Add validation to all API endpoints

2. **High Priority**:
   - Validate all external API responses
   - Validate environment variables on startup

3. **Standard**:
   - Replace manual validation with schemas
   - Add validation tests

## 📚 Implementation Guide

**Step 1**: Install validation library
```bash
npm install zod  # or appropriate library
```

**Step 2**: Define schemas for all boundaries
```typescript
// src/validation/schemas.ts
export const schemas = {
  createUser: UserSchema,
  updateUser: UpdateUserSchema,
  searchQuery: SearchQuerySchema,
  // ... all input shapes
};
```

**Step 3**: Apply at boundaries
```typescript
// Validate at entry point
const validation = schema.safeParse(input);
// Check result and proceed
```

**Step 4**: Add tests
```typescript
// Verify validation catches invalid input
```
```

## Validation Checklist

Before declaring endpoint/integration complete:

- ✅ All user input validated with schema
- ✅ External API responses validated
- ✅ Environment variables validated on startup
- ✅ Database queries use parameterized statements
- ✅ File uploads validated (type, size, content)
- ✅ URL parameters validated
- ✅ Query strings validated
- ✅ Request headers validated (if used for logic)

## Integration Points

This skill works with:

**devflow-core-patterns**: Ensures validation uses Result types
**devflow-code-smell**: Catches fake/incomplete validation
**devflow-test-design**: Validates boundary tests exist

## Security Principles

1. **Trust Nothing**: All external data is potentially malicious
2. **Validate Once**: At the boundary, then trust typed data
3. **Fail Secure**: Invalid input = reject, not accept with warning
4. **Clear Errors**: Help legitimate users fix issues
5. **No Bypass**: No "skip validation" flags or backdoors

## Success Criteria

Input validation passes when:
- ✅ All boundaries identified and validated
- ✅ Schema validation used (not manual checks)
- ✅ No SQL injection risks
- ✅ External data validated before use
- ✅ Configuration validated on startup
- ✅ Validation errors return Result types
- ✅ Tests cover invalid input scenarios

## Example Scenario

```
User: "Add API endpoint to create orders"
→ input-validation activates
→ Analyzes: New API endpoint = boundary
→ Checks: Is request body validated?
→ Reports: Missing validation
→ Blocks: Until schema validation added
→ Verifies: Validation implemented correctly
→ Confirms: SQL queries parameterized
→ Approves: Safe to proceed
```

This prevents shipping security vulnerabilities.
