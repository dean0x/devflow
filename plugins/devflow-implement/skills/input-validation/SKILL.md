---
name: input-validation
description: Input validation at boundaries. Use when user asks to "validate input", "parse request", "handle form data", or creates API endpoints.
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

## When This Skill Activates

- Creating API endpoints or routes
- Processing user-submitted data
- Integrating with external APIs
- Accepting environment variables
- Handling database queries with user input

## Core Principle: Parse, Don't Validate

Use schema validation libraries, not manual checks.

```typescript
// VIOLATION: Manual validation
function createUser(data: any): User {
  if (!data.email || typeof data.email !== 'string') throw new Error('Invalid');
  // ... scattered checks
}

// CORRECT: Schema validation at boundary
const UserSchema = z.object({
  email: z.string().email().max(255),
  age: z.number().int().min(0).max(150),
  name: z.string().min(1).max(100)
});

function createUser(data: unknown): Result<User, ValidationError> {
  const validation = UserSchema.safeParse(data);
  if (!validation.success) {
    return { ok: false, error: new ValidationError('Invalid', validation.error) };
  }
  return { ok: true, value: validation.data };
}
```

## Boundary Examples

### API Endpoint

```typescript
app.post('/api/users', async (req, res) => {
  const validation = UserSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: validation.error.issues });
  }
  const result = await createUser(validation.data);
  // ... handle result
});
```

### External API Response

```typescript
async function fetchUserData(userId: string): Promise<Result<UserData, Error>> {
  const response = await fetch(`https://api.example.com/users/${userId}`);
  const validation = ExternalUserSchema.safeParse(await response.json());
  if (!validation.success) {
    return { ok: false, error: new Error('External API returned invalid data') };
  }
  return { ok: true, value: validation.data };
}
```

### Environment Variables

```typescript
const ConfigSchema = z.object({
  port: z.string().regex(/^\d+$/).transform(Number),
  dbUrl: z.string().url().startsWith('postgresql://'),
  apiKey: z.string().min(32)
});

const configResult = ConfigSchema.safeParse(process.env);
if (!configResult.success) {
  console.error('Invalid configuration:', configResult.error);
  process.exit(1);
}
```

### Database Queries (SQL Injection Prevention)

```typescript
const EmailSchema = z.string().email().max(255);

async function getUserByEmail(email: unknown): Promise<Result<User, Error>> {
  const validation = EmailSchema.safeParse(email);
  if (!validation.success) {
    return { ok: false, error: new Error('Invalid email format') };
  }
  // Parameterized query prevents SQL injection
  const user = await db.query('SELECT * FROM users WHERE email = $1', [validation.data]);
  return { ok: true, value: user };
}
```

## Validation Libraries

| Language | Recommended |
|----------|-------------|
| TypeScript/JavaScript | Zod, Yup, joi |
| Python | Pydantic, marshmallow |
| Go | go-playground/validator |
| Rust | serde + validator |

## Security Principles

1. **Trust Nothing**: All external data is potentially malicious
2. **Validate Once**: At the boundary, then trust typed data
3. **Fail Secure**: Invalid input = reject, not accept with warning
4. **No Bypass**: No "skip validation" flags or backdoors

---

## Extended References

For extended examples and detection patterns, see:
- `references/violations.md` - Extended violation examples
- `references/patterns.md` - Extended correct patterns
- `references/detection.md` - Grep patterns and report templates

---

## Success Criteria

- [ ] All boundaries identified and validated
- [ ] Schema validation used (not manual checks)
- [ ] No SQL injection risks
- [ ] External data validated before use
- [ ] Configuration validated on startup
- [ ] Validation errors return Result types
- [ ] Tests cover invalid input scenarios
