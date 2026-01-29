# Security Correct Patterns

Extended correct patterns for security implementation. Reference from main SKILL.md.

## Injection Prevention

### SQL Injection Prevention
```typescript
// SECURE: Parameterized queries
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
const result = await db.query('SELECT * FROM products WHERE name LIKE $1', [`%${search}%`]);
```

### NoSQL Injection Prevention
```typescript
// SECURE: Coerce to string
const username = String(req.body.username);
const user = await db.users.findOne({ username });

// SECURE: Escape regex special characters
const escaped = userInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
db.users.find({ name: { $regex: escaped } });
```

### Command Injection Prevention
```typescript
// SECURE: Use execFile with arguments array
execFile('ls', [userInput]);  // Arguments are escaped
spawn('convert', [filename, 'output.png']);

// SECURE: Validate input format
const hostnamePattern = /^[a-zA-Z0-9.-]+$/;
if (!hostnamePattern.test(hostname)) {
  throw new Error('Invalid hostname');
}
const args = ['-c', '4', hostname];
spawn('ping', args);
```

### Path Traversal Prevention
```typescript
// SECURE: Normalize and validate path
const file = path.basename(req.params.filename);  // Strip directory
const requestedPath = path.normalize(
  path.join('./uploads', path.basename(req.params.filename))
);
const absoluteUploads = path.resolve('./uploads');
const absoluteRequested = path.resolve(requestedPath);

if (!absoluteRequested.startsWith(absoluteUploads + path.sep)) {
  throw new Error('Path traversal attempt blocked');
}
fs.readFile(absoluteRequested);
```

### LDAP Injection Prevention
```typescript
// SECURE: Escape LDAP special characters
function escapeLDAP(str: string): string {
  return str.replace(/[\\*()]/g, char => `\\${char.charCodeAt(0).toString(16)}`);
}
const filter = `(uid=${escapeLDAP(username)})`;
ldap.search(baseDN, filter);
```

### Template Injection Prevention
```typescript
// SECURE: Never build templates from user input
const template = 'Hello <%= name %>!';
ejs.render(template, { name: req.body.name });
```

### Header Injection Prevention
```typescript
// SECURE: Validate or encode header values
const safeInput = encodeURIComponent(userInput);
res.setHeader('Location', `/user/${safeInput}`);
```

---

## Authentication Patterns

### Password Validation
```typescript
import { z } from 'zod';

const PasswordSchema = z.string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password cannot exceed 128 characters')
  .regex(/[A-Z]/, 'Password must contain uppercase letter')
  .regex(/[a-z]/, 'Password must contain lowercase letter')
  .regex(/[0-9]/, 'Password must contain number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain special character');

// Check against breach databases
import { pwnedPassword } from 'hibp';

async function validatePassword(password: string): Promise<Result<void, Error>> {
  const schemaResult = PasswordSchema.safeParse(password);
  if (!schemaResult.success) {
    return { ok: false, error: new Error(schemaResult.error.message) };
  }

  const breachCount = await pwnedPassword(password);
  if (breachCount > 0) {
    return { ok: false, error: new Error('Password found in breach database') };
  }

  return { ok: true, value: undefined };
}
```

### Secure Session Management
```typescript
// SECURE: httpOnly cookie with secure flags
res.cookie('session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 3600000  // 1 hour
});

// Cryptographically random session ID
const sessionId = crypto.randomBytes(32).toString('hex');

// Session rotation on privilege change
async function login(userId: string, res: Response): Promise<void> {
  const newSessionId = crypto.randomBytes(32).toString('hex');

  // Invalidate old session
  await sessionStore.destroy(req.sessionID);

  // Create new session with new ID
  await sessionStore.create(newSessionId, {
    userId,
    createdAt: Date.now(),
    lastAccess: Date.now()
  });

  res.cookie('session', newSessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 3600000
  });
}

// Session timeout with sliding window
async function validateSession(sessionId: string): Promise<Result<Session, Error>> {
  const session = await sessionStore.get(sessionId);

  if (!session) {
    return { ok: false, error: new Error('Session not found') };
  }

  const MAX_IDLE_TIME = 30 * 60 * 1000; // 30 minutes
  const MAX_SESSION_AGE = 24 * 60 * 60 * 1000; // 24 hours

  const now = Date.now();

  if (now - session.lastAccess > MAX_IDLE_TIME) {
    await sessionStore.destroy(sessionId);
    return { ok: false, error: new Error('Session expired (idle)') };
  }

  if (now - session.createdAt > MAX_SESSION_AGE) {
    await sessionStore.destroy(sessionId);
    return { ok: false, error: new Error('Session expired (max age)') };
  }

  // Update last access for sliding window
  await sessionStore.update(sessionId, { lastAccess: now });

  return { ok: true, value: session };
}
```

### Secure JWT Handling
```typescript
// SECURE: Proper JWT configuration
jwt.sign(payload, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  expiresIn: '15m',
  issuer: 'myapp'
});

jwt.verify(token, secret, {
  algorithms: ['HS256'],  // Explicitly specify
  issuer: 'myapp'
});

// Refresh token pattern
interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

async function createTokenPair(userId: string): Promise<TokenPair> {
  const accessToken = jwt.sign(
    { userId, type: 'access' },
    process.env.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { userId, type: 'refresh', jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );

  // Store refresh token hash for revocation
  await tokenStore.save({
    jti: jwt.decode(refreshToken).jti,
    userId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });

  return { accessToken, refreshToken };
}

async function refreshTokens(refreshToken: string): Promise<Result<TokenPair, Error>> {
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
      algorithms: ['HS256']
    });

    // Check if token is revoked
    const stored = await tokenStore.find(payload.jti);
    if (!stored) {
      return { ok: false, error: new Error('Token revoked') };
    }

    // Revoke old refresh token
    await tokenStore.delete(payload.jti);

    // Issue new token pair
    return { ok: true, value: await createTokenPair(payload.userId) };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
```

### Authorization Patterns
```typescript
// SECURE: Layered auth middleware
app.delete('/api/users/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    await deleteUser(req.params.id);
  }
);

// Role-Based Access Control (RBAC)
type Permission = 'read' | 'write' | 'delete' | 'admin';

interface Role {
  name: string;
  permissions: Permission[];
}

const ROLES: Record<string, Role> = {
  viewer: { name: 'viewer', permissions: ['read'] },
  editor: { name: 'editor', permissions: ['read', 'write'] },
  admin: { name: 'admin', permissions: ['read', 'write', 'delete', 'admin'] }
};

function requirePermission(...required: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = ROLES[req.user.role];

    if (!userRole) {
      return res.status(403).json({ error: 'Invalid role' });
    }

    const hasAll = required.every(p => userRole.permissions.includes(p));

    if (!hasAll) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

// Usage
app.delete('/api/posts/:id', requireAuth, requirePermission('delete'), handler);

// Attribute-Based Access Control (ABAC)
interface AccessPolicy {
  resource: string;
  action: string;
  conditions: (user: User, resource: Resource) => boolean;
}

const policies: AccessPolicy[] = [
  {
    resource: 'post',
    action: 'delete',
    conditions: (user, post) =>
      user.role === 'admin' || post.authorId === user.id
  },
  {
    resource: 'comment',
    action: 'edit',
    conditions: (user, comment) =>
      comment.authorId === user.id &&
      Date.now() - comment.createdAt < 15 * 60 * 1000 // 15 min window
  }
];

function checkAccess(user: User, resource: Resource, action: string): boolean {
  const policy = policies.find(
    p => p.resource === resource.type && p.action === action
  );

  if (!policy) {
    return false; // Deny by default
  }

  return policy.conditions(user, resource);
}
```

---

## Cryptography Patterns

### Secret Management
```typescript
// SECURE: Environment variables with validation
import { z } from 'zod';

const SecretsSchema = z.object({
  DB_PASSWORD: z.string().min(20),
  API_KEY: z.string().regex(/^sk-(live|test)-[a-zA-Z0-9]{32}$/),
  JWT_SECRET: z.string().min(64),
  ENCRYPTION_KEY: z.string().length(64) // 32 bytes hex-encoded
});

function loadSecrets(): Result<Secrets, Error> {
  const result = SecretsSchema.safeParse(process.env);
  if (!result.success) {
    return { ok: false, error: new Error('Invalid secrets configuration') };
  }
  return { ok: true, value: result.data };
}

// AWS Secrets Manager
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

async function getSecret(secretId: string): Promise<Result<string, Error>> {
  const client = new SecretsManager({ region: 'us-east-1' });

  try {
    const response = await client.getSecretValue({ SecretId: secretId });
    if (!response.SecretString) {
      return { ok: false, error: new Error('Secret not found') };
    }
    return { ok: true, value: response.SecretString };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
```

### Password Hashing
```typescript
// SECURE: Argon2id (recommended)
import argon2 from 'argon2';

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,  // 64 MB
    timeCost: 3,        // 3 iterations
    parallelism: 4      // 4 parallel threads
  });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// SECURE: bcrypt (widely supported)
import bcrypt from 'bcrypt';

async function hashPassword(password: string): Promise<string> {
  const COST_FACTOR = 12; // Minimum for production
  return bcrypt.hash(password, COST_FACTOR);
}
```

### Key Derivation
```typescript
// SECURE: Derive key using scrypt
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

// Usage
const salt = crypto.randomBytes(16);
const key = await deriveKey(password, salt);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
```

### Secure Random Generation
```typescript
// SECURE: Cryptographic random
const token = crypto.randomBytes(32).toString('hex');
const id = crypto.randomUUID();
const code = crypto.randomInt(100000, 1000000);

// Secure token generation
function generateToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

// Secure numeric code (e.g., 2FA)
function generateOTP(digits: number = 6): string {
  const max = Math.pow(10, digits);
  const min = Math.pow(10, digits - 1);
  return crypto.randomInt(min, max).toString();
}

// Secure API key generation
function generateApiKey(): string {
  const prefix = 'sk';
  const env = process.env.NODE_ENV === 'production' ? 'live' : 'test';
  const random = crypto.randomBytes(24).toString('base64url');
  return `${prefix}_${env}_${random}`;
}

// Secure password reset token
function generateResetToken(): { token: string; hash: string; expires: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  return { token, hash, expires };
}
```

### Authenticated Encryption
```typescript
// SECURE: AES-256-GCM (authenticated encryption)
interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function encrypt(plaintext: string, key: Buffer): EncryptedData {
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decrypt(data: EncryptedData, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(data.iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(data.authTag, 'hex'));

  let plaintext = decipher.update(data.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}
```

### Timing-Safe Comparison
```typescript
// SECURE: Constant-time comparison
import { timingSafeEqual } from 'crypto';

function verifyToken(provided: string, stored: string): boolean {
  if (provided.length !== stored.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(provided),
    Buffer.from(stored)
  );
}
```
