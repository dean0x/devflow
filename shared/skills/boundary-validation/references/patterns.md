# Boundary Validation — Correct Patterns

Extended examples of proper validation patterns with literature citations.

## Schema Validation at Boundary [1][5]

Parse at the boundary, then trust the typed result downstream. The schema is the
single source of truth for what valid data looks like.

```typescript
import { z } from 'zod';

// Schema IS the type definition — no drift possible [5]
const UserSchema = z.object({
  email: z.string().email().max(255),
  age: z.number().int().min(0).max(150),
  name: z.string().min(1).max(100),
});

type User = z.infer<typeof UserSchema>;

// Parse, don't validate: unknown → User | error [1]
function createUser(data: unknown): Result<User, ValidationError> {
  const parsed = UserSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: new ValidationError('Invalid user data', parsed.error) };
  }
  return { ok: true, value: parsed.data };
}
```

---

## API Endpoint — Zero Trust Boundary [3][4]

HTTP request data is always hostile. Parse the entire request shape, not just body.

```typescript
const CreateUserRequestSchema = z.object({
  body: UserSchema,
});

app.post('/api/users', async (req, res) => {
  const parsed = CreateUserRequestSchema.safeParse(req);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.issues, // structured errors for client [5]
    });
  }
  const result = await createUser(parsed.data.body);
  if (!result.ok) return res.status(500).json({ error: result.error.message });
  res.json(result.value);
});
```

---

## External API Response [2][3]

External APIs can change without notice. Parse responses to detect contract violations
before they propagate through your system.

```typescript
const ExternalUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
});

async function fetchUserData(userId: string): Promise<Result<UserData, Error>> {
  try {
    const response = await fetch(`https://api.example.com/users/${userId}`);
    const parsed = ExternalUserSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { ok: false, error: new Error('External API returned invalid data') };
    }
    return { ok: true, value: parsed.data };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
```

---

## Environment Variables — Fail Fast [8]

Validate configuration on startup. A misconfigured environment should crash
immediately, not fail subtly at 3am. [8]

```typescript
const ConfigSchema = z.object({
  port: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(65535)),
  dbUrl: z.string().url().startsWith('postgresql://'),
  apiKey: z.string().min(32).max(128),
});

function loadConfig(): Result<Config, Error> {
  const parsed = ConfigSchema.safeParse({
    port: process.env.PORT,
    dbUrl: process.env.DATABASE_URL,
    apiKey: process.env.API_KEY,
  });
  if (!parsed.success) {
    return { ok: false, error: new Error(`Invalid config: ${parsed.error.message}`) };
  }
  return { ok: true, value: parsed.data };
}

// Startup: fail-fast pattern [8]
const configResult = loadConfig();
if (!configResult.ok) {
  console.error('Failed to load configuration:', configResult.error);
  process.exit(1);
}
const config = configResult.value; // typed, validated, safe
```

---

## Database Query with Input Parsing [7][15]

Parse input before query. Always use parameterized queries — never interpolate. [15]

```typescript
const EmailSchema = z.string().email().max(255);
const SearchTermSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9\s-]+$/);

async function getUserByEmail(email: unknown): Promise<Result<User, Error>> {
  const parsed = EmailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: new Error('Invalid email format') };
  try {
    const user = await db.query('SELECT * FROM users WHERE email = $1', [parsed.data]);
    return { ok: true, value: user };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
```

---

## File Upload — Defense in Depth [4]

Validate metadata, verify content type matches declared type, enforce size limits.

```typescript
const FileUploadSchema = z.object({
  name: z.string().max(255).regex(/^[a-zA-Z0-9._-]+$/),
  size: z.number().max(10 * 1024 * 1024), // 10MB max
  mimetype: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
});

async function handleUpload(file: unknown): Promise<Result<string, Error>> {
  const parsed = FileUploadSchema.safeParse(file);
  if (!parsed.success) return { ok: false, error: new Error('Invalid file') };

  // Content sniffing: verify actual content matches declared type [4]
  const buffer = await readFileBuffer(file);
  const detectedType = await fileType.fromBuffer(buffer);
  if (detectedType?.mime !== parsed.data.mimetype) {
    return { ok: false, error: new Error('File type mismatch') };
  }

  const safeFilename = `${uuid()}_${parsed.data.name}`;
  const safePath = path.join(UPLOAD_DIR, safeFilename);
  await fs.writeFile(safePath, buffer);
  return { ok: true, value: safeFilename };
}
```

---

## URL Parameters and Query Strings [3][4]

```typescript
const UserIdSchema = z.string().uuid();

app.get('/users/:id', async (req, res) => {
  const parsed = UserIdSchema.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid user ID' });
  const result = await getUserById(parsed.data);
  if (!result.ok) return res.status(404).json({ error: 'User not found' });
  res.json(result.value);
});

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['name', 'date', 'relevance']).default('relevance'),
});

app.get('/search', async (req, res) => {
  const parsed = SearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query', details: parsed.error.issues });
  }
  const { q, page, limit, sort } = parsed.data;
  res.json(await searchService.search(q, { page, limit, sort }));
});
```

---

## Webhook — Verify Then Parse [4][9]

Always verify signature before parsing payload. Signature verification prevents
spoofed events; schema parsing prevents malformed data.

```typescript
const WebhookPayloadSchema = z.object({
  event: z.enum(['payment.completed', 'payment.failed', 'subscription.created']),
  data: z.object({ id: z.string(), amount: z.number().optional(), status: z.string() }),
  timestamp: z.number(),
});

app.post('/webhook', async (req, res) => {
  // Step 1: Verify signature [9]
  const signature = req.headers['x-webhook-signature'];
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body)).digest('hex');
  if (!timingSafeEqual(Buffer.from(signature ?? ''), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Step 2: Parse payload [5]
  const parsed = WebhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  await processWebhookEvent(parsed.data);
  res.sendStatus(200);
});
```

---

## Form Data Sanitization [3][4]

Parse structure, then sanitize content. Output encoding prevents XSS.

```typescript
import DOMPurify from 'isomorphic-dompurify';

const ProfileUpdateSchema = z.object({
  bio: z.string().max(500).transform(s => DOMPurify.sanitize(s)),
  website: z.string().url().optional(),
  displayName: z.string().min(1).max(50),
});

app.post('/profile', async (req, res) => {
  const parsed = ProfileUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  await db.users.update(req.userId, parsed.data); // bio already sanitized
  res.json({ success: true });
});
```

---

## GraphQL Input [3]

```typescript
const UserFilterSchema = z.object({
  name: z.string().max(100).optional(),
  email: z.string().email().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const resolvers = {
  Query: {
    users: async (_, { filter }) => {
      const parsed = UserFilterSchema.safeParse(filter);
      if (!parsed.success) {
        throw new GraphQLError('Invalid filter', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      return userService.findUsers(parsed.data);
    },
  },
};
```
