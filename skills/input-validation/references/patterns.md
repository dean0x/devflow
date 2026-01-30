# Input Validation Correct Patterns

Extended examples of proper validation patterns.

## Schema Validation at Boundary

```typescript
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

---

## API Endpoint Validation

```typescript
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

---

## External API Response Validation

```typescript
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

---

## Environment Variable Validation

```typescript
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

---

## Database Query with Validation

```typescript
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

---

## File Upload Validation

```typescript
const FileUploadSchema = z.object({
  name: z.string().max(255).regex(/^[a-zA-Z0-9._-]+$/),
  size: z.number().max(10 * 1024 * 1024), // 10MB max
  mimetype: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
});

async function handleUpload(file: unknown): Promise<Result<string, Error>> {
  const validation = FileUploadSchema.safeParse(file);

  if (!validation.success) {
    return { ok: false, error: new Error('Invalid file') };
  }

  const { name, size, mimetype } = validation.data;

  // Additional content validation
  const buffer = await readFileBuffer(file);
  const detectedType = await fileType.fromBuffer(buffer);

  if (detectedType?.mime !== mimetype) {
    return { ok: false, error: new Error('File type mismatch') };
  }

  // Safe filename generation
  const safeFilename = `${uuid()}_${name}`;
  const safePath = path.join(UPLOAD_DIR, safeFilename);

  await fs.writeFile(safePath, buffer);
  return { ok: true, value: safeFilename };
}
```

---

## URL Parameter Validation

```typescript
const UserIdSchema = z.string().uuid();

app.get('/users/:id', async (req, res) => {
  const validation = UserIdSchema.safeParse(req.params.id);

  if (!validation.success) {
    return res.status(400).json({ error: 'Invalid user ID format' });
  }

  const result = await getUserById(validation.data);

  if (!result.ok) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(result.value);
});
```

---

## Query String Validation

```typescript
const SearchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['name', 'date', 'relevance']).default('relevance'),
});

app.get('/search', async (req, res) => {
  const validation = SearchQuerySchema.safeParse(req.query);

  if (!validation.success) {
    return res.status(400).json({
      error: 'Invalid query parameters',
      details: validation.error.issues
    });
  }

  const { q, page, limit, sort } = validation.data;
  const results = await searchService.search(q, { page, limit, sort });

  res.json(results);
});
```

---

## Webhook Signature Verification

```typescript
const WebhookPayloadSchema = z.object({
  event: z.enum(['payment.completed', 'payment.failed', 'subscription.created']),
  data: z.object({
    id: z.string(),
    amount: z.number().optional(),
    status: z.string(),
  }),
  timestamp: z.number(),
});

app.post('/webhook', async (req, res) => {
  // 1. Verify signature first
  const signature = req.headers['x-webhook-signature'];
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 2. Then validate payload structure
  const validation = WebhookPayloadSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // 3. Process verified and validated event
  await processWebhookEvent(validation.data);
  res.sendStatus(200);
});
```

---

## GraphQL Input Validation

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
      const validation = UserFilterSchema.safeParse(filter);

      if (!validation.success) {
        throw new GraphQLError('Invalid filter', {
          extensions: { code: 'BAD_USER_INPUT' }
        });
      }

      return userService.findUsers(validation.data);
    },
  },
};
```

---

## Form Data Sanitization

```typescript
import DOMPurify from 'isomorphic-dompurify';

const ProfileUpdateSchema = z.object({
  bio: z.string().max(500).transform(s => DOMPurify.sanitize(s)),
  website: z.string().url().optional(),
  displayName: z.string().min(1).max(50),
});

app.post('/profile', async (req, res) => {
  const validation = ProfileUpdateSchema.safeParse(req.body);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error });
  }

  // bio is already sanitized by the schema transform
  await db.users.update(req.userId, validation.data);

  res.json({ success: true });
});
```
