# Extended Authentication Patterns

Detailed examples for authentication and authorization vulnerability detection. See main SKILL.md for core patterns.

## Password Policies

```typescript
// VULNERABLE
if (password.length >= 6) { /* accept */ }

// SECURE
const requirements = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecial: true,
  maxLength: 128,
  checkBreached: true  // Check against known breached passwords
};
```

**Implementing secure password validation:**
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

## Session Management

```typescript
// VULNERABLE: Session ID in URL
app.get('/dashboard?session=abc123');

// VULNERABLE: Predictable session IDs
const sessionId = `user_${userId}`;

// VULNERABLE: No session timeout

// SECURE: Session in httpOnly cookie
res.cookie('session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 3600000  // 1 hour
});

// Cryptographically random session ID
const sessionId = crypto.randomBytes(32).toString('hex');
```

**Session rotation and invalidation:**
```typescript
// Rotate session ID on privilege change
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

## JWT Best Practices

```typescript
// VULNERABLE: Weak secret
jwt.sign(payload, 'secret123');

// VULNERABLE: No expiration
jwt.sign(payload, secret);

// VULNERABLE: Algorithm confusion
jwt.verify(token, secret);  // Accepts 'none' algorithm

// SECURE
jwt.sign(payload, process.env.JWT_SECRET, {
  algorithm: 'HS256',
  expiresIn: '15m',
  issuer: 'myapp'
});

jwt.verify(token, secret, {
  algorithms: ['HS256'],  // Explicitly specify
  issuer: 'myapp'
});
```

**Refresh token pattern:**
```typescript
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

## Authorization Patterns

```typescript
// VULNERABLE: Missing auth checks
app.delete('/api/users/:id', async (req, res) => {
  await deleteUser(req.params.id);  // No auth check!
});

// SECURE: Layered auth middleware
app.delete('/api/users/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    await deleteUser(req.params.id);
  }
);
```

**Role-Based Access Control (RBAC):**
```typescript
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
```

**Attribute-Based Access Control (ABAC):**
```typescript
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

## Detection Grep Commands

```bash
# Missing auth middleware
grep -rn "app\.\(get\|post\|put\|delete\).*async" --include="*.ts" --include="*.js" | \
  grep -v "requireAuth\|isAuthenticated\|authorize"

# Weak JWT configuration
grep -rn "jwt\.sign\|jwt\.verify" --include="*.ts" --include="*.js" -A 5 | \
  grep -v "algorithm\|expiresIn"

# Session issues
grep -rn "session\|cookie" --include="*.ts" --include="*.js" | \
  grep -v "httpOnly\|secure\|sameSite"

# Password handling
grep -rn "password.*length" --include="*.ts" --include="*.js"
```
