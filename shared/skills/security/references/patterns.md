# Security — Correct Patterns

Extended correct patterns for security implementation with literature citations.

## Injection Prevention

### SQL Injection Prevention [1][6]
```typescript
// SECURE: Parameterized queries — never interpolate user data [6]
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
const result = await db.query('SELECT * FROM products WHERE name LIKE $1', [`%${search}%`]);
```

### NoSQL Injection Prevention [1][6]
```typescript
// SECURE: Coerce to string — reject operator objects
const username = String(req.body.username);
const user = await db.users.findOne({ username });

// SECURE: Escape regex special characters
const escaped = userInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
db.users.find({ name: { $regex: escaped } });
```

### Command Injection Prevention [6][9]
```typescript
// SECURE: Use execFile with arguments array — OS escapes args [9]
execFile('ls', [userInput]);
spawn('convert', [filename, 'output.png']);

// SECURE: Validate input format before use
const hostnamePattern = /^[a-zA-Z0-9.-]+$/;
if (!hostnamePattern.test(hostname)) throw new Error('Invalid hostname');
spawn('ping', ['-c', '4', hostname]);
```

### Path Traversal Prevention [1][6]
```typescript
// SECURE: Normalize and validate path stays within upload dir
const requestedPath = path.normalize(path.join('./uploads', path.basename(req.params.filename)));
const absoluteUploads = path.resolve('./uploads');
const absoluteRequested = path.resolve(requestedPath);

if (!absoluteRequested.startsWith(absoluteUploads + path.sep)) {
  throw new Error('Path traversal attempt blocked');
}
fs.readFile(absoluteRequested);
```

### LDAP Injection Prevention [6][9]
```typescript
// SECURE: Escape LDAP special characters
function escapeLDAP(str: string): string {
  return str.replace(/[\\*()]/g, char => `\\${char.charCodeAt(0).toString(16)}`);
}
const filter = `(uid=${escapeLDAP(username)})`;
ldap.search(baseDN, filter);
```

### Template Injection Prevention [1][20]
```typescript
// SECURE: Never build templates from user input — pass data as context only
const template = 'Hello <%= name %>!';
ejs.render(template, { name: req.body.name });
```

---

## Authentication Patterns

### Password Validation [2][7]
```typescript
import { z } from 'zod';

// NIST 800-63 minimum: 15-char passphrase or 12-char with complexity [7]
const PasswordSchema = z.string()
  .min(12, 'Password must be at least 12 characters')
  .max(128)
  .regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/);

async function validatePassword(password: string): Promise<Result<void, Error>> {
  const schemaResult = PasswordSchema.safeParse(password);
  if (!schemaResult.success) {
    return { ok: false, error: new Error(schemaResult.error.message) };
  }
  // Check against breach databases (HaveIBeenPwned) [7]
  const breachCount = await pwnedPassword(password);
  if (breachCount > 0) return { ok: false, error: new Error('Password found in breach database') };
  return { ok: true, value: undefined };
}
```

### Secure Session Management [4][7]
```typescript
// SECURE: httpOnly + Secure + SameSite cookie [4][16]
res.cookie('session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',  // CSRF prevention [16]
  maxAge: 3600000      // 1 hour
});

// Rotate session ID on privilege change to prevent session fixation [4][7]
async function login(userId: string, res: Response): Promise<void> {
  const newSessionId = crypto.randomBytes(32).toString('hex');
  await sessionStore.destroy(req.sessionID);
  await sessionStore.create(newSessionId, { userId, createdAt: Date.now(), lastAccess: Date.now() });
  res.cookie('session', newSessionId, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 3600000 });
}
```

### Secure JWT Handling [17]
```typescript
// SECURE: Explicit algorithm, expiry, issuer — RFC 8725 requirements [17]
jwt.sign(payload, process.env.JWT_SECRET, {
  algorithm: 'HS256',  // pin algorithm — prevents "none" and RS→HS confusion [17]
  expiresIn: '15m',
  issuer: 'myapp'
});

jwt.verify(token, secret, {
  algorithms: ['HS256'],  // allowlist — block algorithm substitution [17]
  issuer: 'myapp'
});

// Refresh token rotation — store JTI for revocation [17]
async function createTokenPair(userId: string): Promise<TokenPair> {
  const accessToken = jwt.sign({ userId, type: 'access' }, process.env.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' });
  const refreshToken = jwt.sign(
    { userId, type: 'refresh', jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
  // Store refresh token hash for revocation
  await tokenStore.save({ jti: jwt.decode(refreshToken).jti, userId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
  return { accessToken, refreshToken };
}
```

### Authorization Patterns [2][4]
```typescript
// RBAC: Role-Based Access Control [4]
type Permission = 'read' | 'write' | 'delete' | 'admin';
const ROLES: Record<string, Permission[]> = {
  viewer: ['read'],
  editor: ['read', 'write'],
  admin: ['read', 'write', 'delete', 'admin']
};

function requirePermission(...required: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userPerms = ROLES[req.user.role] ?? [];
    if (!required.every(p => userPerms.includes(p))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ABAC: Attribute-Based Access Control for ownership checks [2]
const policies = [
  { resource: 'post', action: 'delete',
    check: (user: User, post: Post) => user.role === 'admin' || post.authorId === user.id }
];
```

---

## Cryptography Patterns

### Secret Management [4][8]
```typescript
// SECURE: Validate secrets schema at startup — fail fast [8]
const SecretsSchema = z.object({
  DB_PASSWORD: z.string().min(20),
  JWT_SECRET: z.string().min(64),
  ENCRYPTION_KEY: z.string().length(64)
});

function loadSecrets(): Result<Secrets, Error> {
  const result = SecretsSchema.safeParse(process.env);
  if (!result.success) return { ok: false, error: new Error('Invalid secrets configuration') };
  return { ok: true, value: result.data };
}
```

### Password Hashing [24]
```typescript
// SECURE: Argon2id — PHC winner, memory-hard, side-channel resistant [24]
import argon2 from 'argon2';

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,  // 64 MB
    timeCost: 3,
    parallelism: 4
  });
}

// SECURE: bcrypt cost ≥12 — widely supported alternative [24]
import bcrypt from 'bcrypt';
async function hashPasswordBcrypt(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
```

### Authenticated Encryption [25]
```typescript
// SECURE: AES-256-GCM — authenticated encryption prevents tampering [25]
function encrypt(plaintext: string, key: Buffer): EncryptedData {
  const iv = crypto.randomBytes(12);  // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  return { ciphertext, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}
```

### Timing-Safe Comparison [25]
```typescript
// SECURE: Constant-time comparison — prevents timing oracle attacks [25]
import { timingSafeEqual } from 'crypto';

function verifyToken(provided: string, stored: string): boolean {
  if (provided.length !== stored.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(stored));
}
```

### Secure Random Generation [25]
```typescript
const token = crypto.randomBytes(32).toString('hex');  // session tokens
const id = crypto.randomUUID();                        // IDs
const code = crypto.randomInt(100000, 1000000);        // OTP codes
```

---

## Headers & CSP [10][15]

```typescript
// Content-Security-Policy: nonce-based CSP preferred over unsafe-inline [15]
const nonce = crypto.randomBytes(16).toString('base64');
res.setHeader('Content-Security-Policy',
  `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'`);

// HSTS: preload after testing [10]
res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('X-Frame-Options', 'DENY');
res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
```

## Subresource Integrity (SRI) [18]
```html
<!-- SECURE: Verify CDN assets by hash — prevents CDN compromise [18] -->
<script src="https://cdn.example.com/lib.js"
  integrity="sha384-ABC123..." crossorigin="anonymous"></script>
```

## Supply Chain [12][13]
```bash
# Pin exact versions
npm install --save-exact lodash@4.17.21

# Generate provenance with Sigstore in CI [13]
cosign sign --key cosign.key artifact.tar.gz

# SLSA Level 2+: hermetic build with provenance attestation [12]
```
