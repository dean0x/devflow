---
name: devflow-security-patterns
description: Security vulnerability patterns and detection strategies. Load when reviewing code for security issues, implementing authentication/authorization, handling user input, or working with sensitive data. Used by SecurityReview agent.
allowed-tools: Read, Grep, Glob
---

# Security Patterns

Domain expertise for security vulnerability detection. Use alongside `devflow-review-methodology` for complete security reviews.

## Iron Law

> **ASSUME ALL INPUT IS MALICIOUS**
>
> Every user input, URL parameter, header, and cookie is an attack vector. Use parameterized
> queries always. Escape output always. Validate schemas always. "This field is internal"
> is not a defense. Defense in depth, not wishful thinking.

## Vulnerability Categories

### 1. Input Validation & Injection

**SQL Injection**
```typescript
// VULNERABLE
const query = `SELECT * FROM users WHERE email = '${email}'`;
const query = "SELECT * FROM users WHERE id = " + id;

// SECURE
const query = "SELECT * FROM users WHERE email = ?";
await db.execute(query, [email]);

// Or using parameterized queries
await db.users.findOne({ where: { email } });
```

**NoSQL Injection**
```typescript
// VULNERABLE
const user = await db.users.findOne({ username: req.body.username });
// Attacker sends: { username: { $gt: "" } }

// SECURE
const username = String(req.body.username);  // Coerce to string
const user = await db.users.findOne({ username });
```

**Command Injection**
```typescript
// VULNERABLE
exec(`ls ${userInput}`);
exec(`convert ${filename} output.png`);

// SECURE
execFile('ls', [userInput]);  // Arguments are escaped
spawn('convert', [filename, 'output.png']);
```

**XSS (Cross-Site Scripting)**
```typescript
// VULNERABLE
element.innerHTML = userInput;
document.write(userInput);
`<div>${userInput}</div>`  // In React dangerouslySetInnerHTML

// SECURE
element.textContent = userInput;
// React auto-escapes by default
<div>{userInput}</div>
// Explicit sanitization
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userInput);
```

**Path Traversal**
```typescript
// VULNERABLE
const file = req.params.filename;
fs.readFile(`./uploads/${file}`);  // Attacker: ../../../etc/passwd

// SECURE
const file = path.basename(req.params.filename);  // Strip directory
const safePath = path.join('./uploads', file);
if (!safePath.startsWith('./uploads/')) {
  throw new Error('Invalid path');
}
fs.readFile(safePath);
```

### 2. Authentication & Authorization

**Weak Password Policies**
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

**Session Management**
```typescript
// VULNERABLE
// Session ID in URL
app.get('/dashboard?session=abc123');
// Predictable session IDs
const sessionId = `user_${userId}`;
// No session timeout

// SECURE
// Session in httpOnly cookie
res.cookie('session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 3600000  // 1 hour
});
// Cryptographically random session ID
const sessionId = crypto.randomBytes(32).toString('hex');
// Session timeout and rotation
```

**JWT Issues**
```typescript
// VULNERABLE
// Weak secret
jwt.sign(payload, 'secret123');
// No expiration
jwt.sign(payload, secret);
// Algorithm confusion
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

**Missing Auth Checks**
```typescript
// VULNERABLE
app.delete('/api/users/:id', async (req, res) => {
  await deleteUser(req.params.id);  // No auth check!
});

// SECURE
app.delete('/api/users/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res) => {
    await deleteUser(req.params.id);
  }
);
```

### 3. Cryptography & Secrets

**Hardcoded Secrets**
```typescript
// VULNERABLE
const API_KEY = 'sk-abc123xyz789';
const dbPassword = 'admin123';
const jwtSecret = 'mysecret';

// SECURE
const API_KEY = process.env.API_KEY;
const dbPassword = process.env.DB_PASSWORD;
// Use secret management: AWS Secrets Manager, Vault, etc.
```

**Weak Cryptography**
```typescript
// VULNERABLE
crypto.createHash('md5').update(password);  // MD5 is broken
crypto.createHash('sha1').update(password);  // SHA1 weak for passwords

// SECURE
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(password, 12);  // Cost factor 12+

import argon2 from 'argon2';
const hash = await argon2.hash(password);  // Preferred
```

**Insecure Random**
```typescript
// VULNERABLE
const token = Math.random().toString(36);  // Predictable!
const id = Date.now().toString();

// SECURE
const token = crypto.randomBytes(32).toString('hex');
const id = crypto.randomUUID();
```

### 4. Configuration & Headers

**Missing Security Headers**
```typescript
// REQUIRED HEADERS
app.use(helmet());  // Or manually:
res.setHeader('Content-Security-Policy', "default-src 'self'");
res.setHeader('X-Frame-Options', 'DENY');
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
res.setHeader('X-XSS-Protection', '1; mode=block');
```

**CORS Misconfiguration**
```typescript
// VULNERABLE
app.use(cors({ origin: '*' }));  // Allows any origin
app.use(cors({ origin: true }));  // Reflects Origin header
app.use(cors({ credentials: true, origin: '*' }));  // Dangerous combo

// SECURE
app.use(cors({
  origin: ['https://myapp.com', 'https://admin.myapp.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

**Debug/Error Exposure**
```typescript
// VULNERABLE
app.use((err, req, res, next) => {
  res.status(500).json({
    error: err.message,
    stack: err.stack  // Exposes internals!
  });
});

// SECURE
app.use((err, req, res, next) => {
  console.error(err);  // Log internally
  res.status(500).json({
    error: 'Internal server error',
    requestId: req.id  // For support lookup
  });
});
```

### 5. Business Logic

**Race Conditions**
```typescript
// VULNERABLE
const balance = await getBalance(userId);
if (balance >= amount) {
  await withdraw(userId, amount);  // Race condition!
}

// SECURE
await db.transaction(async (tx) => {
  const balance = await tx.getBalance(userId, { forUpdate: true });
  if (balance >= amount) {
    await tx.withdraw(userId, amount);
  }
});
```

**Mass Assignment**
```typescript
// VULNERABLE
const user = await User.create(req.body);  // All fields accepted!

// SECURE
const user = await User.create({
  email: req.body.email,
  name: req.body.name
  // Explicitly list allowed fields
});
```

---

## Severity Guidelines

**CRITICAL** - Immediate exploitation possible:
- SQL/NoSQL injection in auth queries
- Remote code execution
- Hardcoded admin credentials
- Authentication bypass
- Unauthenticated admin endpoints

**HIGH** - Significant security risk:
- XSS vulnerabilities
- Broken access control
- Weak cryptography for sensitive data
- Session fixation
- CSRF without protection

**MEDIUM** - Moderate risk with conditions:
- Missing security headers
- Verbose error messages
- CORS too permissive
- Missing rate limiting
- Weak password policy

**LOW** - Minor security improvement:
- Outdated dependencies (no known CVE)
- Missing security logging
- Suboptimal CSP
- Information disclosure (non-sensitive)

---

## Detection Patterns

Search for these patterns in code:

```bash
# SQL Injection
grep -rn "query.*\${" --include="*.ts" --include="*.js"
grep -rn "query.*+ " --include="*.ts" --include="*.js"

# Hardcoded secrets
grep -rn "password.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "api.key.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "secret.*=.*['\"]" --include="*.ts" --include="*.js"

# Weak crypto
grep -rn "createHash.*md5\|sha1" --include="*.ts" --include="*.js"
grep -rn "Math.random" --include="*.ts" --include="*.js"

# Missing auth middleware
grep -rn "app\.\(get\|post\|put\|delete\).*async" --include="*.ts" --include="*.js" | grep -v "requireAuth\|isAuthenticated"

# Dangerous DOM
grep -rn "innerHTML\|document.write\|dangerouslySetInnerHTML" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx"
```

---

## OWASP Reference

Map findings to OWASP Top 10 2021:

| ID | Category | Examples |
|----|----------|----------|
| A01 | Broken Access Control | Missing auth, IDOR, privilege escalation |
| A02 | Cryptographic Failures | Weak hashing, hardcoded secrets, no encryption |
| A03 | Injection | SQL, NoSQL, command, XSS |
| A04 | Insecure Design | Missing rate limits, mass assignment |
| A05 | Security Misconfiguration | Debug enabled, default creds, missing headers |
| A06 | Vulnerable Components | Outdated deps with known CVEs |
| A07 | Auth Failures | Weak passwords, session issues, JWT flaws |
| A08 | Data Integrity Failures | Untrusted deserialization, missing signatures |
| A09 | Logging Failures | Missing security logs, log injection |
| A10 | SSRF | Unvalidated URLs in server requests |

---

## Integration

This skill provides domain expertise for:
- **SecurityReview agent**: Use with `devflow-review-methodology`
- **Coder agent**: Reference when implementing auth, input handling
- **Code-smell skill**: Complements anti-pattern detection

Load this skill when security analysis is needed.
