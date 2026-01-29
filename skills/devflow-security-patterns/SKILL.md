---
name: devflow-security-patterns
description: Security vulnerability analysis for Reviewer agent. Loaded when focus=security. Detects injection, auth, crypto issues.
user-invocable: false
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

---

## Vulnerability Categories

### 1. Input Validation & Injection

**SQL Injection**
```typescript
// VULNERABLE
const query = `SELECT * FROM users WHERE email = '${email}'`;

// SECURE
await db.execute("SELECT * FROM users WHERE email = ?", [email]);
```

**XSS (Cross-Site Scripting)**
```typescript
// VULNERABLE
element.innerHTML = userInput;

// SECURE
element.textContent = userInput;
```

> See `references/injection.md` for NoSQL, command injection, path traversal patterns.

### 2. Authentication & Authorization

**Missing Auth Checks**
```typescript
// VULNERABLE
app.delete('/api/users/:id', async (req, res) => {
  await deleteUser(req.params.id);  // No auth!
});

// SECURE
app.delete('/api/users/:id', requireAuth, requireRole('admin'), handler);
```

> See `references/auth.md` for password policies, session management, JWT patterns.

### 3. Cryptography & Secrets

**Hardcoded Secrets**
```typescript
// VULNERABLE
const API_KEY = 'sk-abc123xyz789';

// SECURE
const API_KEY = process.env.API_KEY;
```

**Insecure Random**
```typescript
// VULNERABLE
const token = Math.random().toString(36);

// SECURE
const token = crypto.randomBytes(32).toString('hex');
```

> See `references/crypto.md` for weak crypto detection, encryption patterns.

### 4. Configuration & Headers

```typescript
// REQUIRED: Use helmet or set manually
app.use(helmet());
res.setHeader('Content-Security-Policy', "default-src 'self'");
res.setHeader('X-Frame-Options', 'DENY');
res.setHeader('Strict-Transport-Security', 'max-age=31536000');

// CORS: Never use origin: '*'
app.use(cors({ origin: ['https://myapp.com'], credentials: true }));
```

### 5. Business Logic

**Race Conditions**
```typescript
// VULNERABLE
if (balance >= amount) await withdraw(userId, amount);

// SECURE: Use transactions with row locks
await db.transaction(async (tx) => {
  const balance = await tx.getBalance(userId, { forUpdate: true });
  if (balance >= amount) await tx.withdraw(userId, amount);
});
```

**Mass Assignment**
```typescript
// VULNERABLE
await User.create(req.body);  // All fields accepted!

// SECURE: Explicitly list allowed fields
await User.create({ email: req.body.email, name: req.body.name });
```

---

## Extended References

| Reference | Content |
|-----------|---------|
| `references/injection.md` | NoSQL, command, path traversal, LDAP, template injection |
| `references/auth.md` | Password policy, session management, JWT, RBAC/ABAC |
| `references/crypto.md` | Secret management, weak crypto, encryption, timing attacks |
| `references/detection.md` | All grep patterns for automated scanning |

---

## Severity Guidelines

| Level | Criteria | Examples |
|-------|----------|----------|
| **CRITICAL** | Immediate exploitation | SQL injection in auth, RCE, hardcoded admin creds |
| **HIGH** | Significant risk | XSS, broken access control, weak crypto, CSRF |
| **MEDIUM** | Moderate with conditions | Missing headers, permissive CORS, missing rate limits |
| **LOW** | Minor improvement | Outdated deps (no CVE), suboptimal CSP |

---

## OWASP Reference

| ID | Category | Examples |
|----|----------|----------|
| A01 | Broken Access Control | Missing auth, IDOR, privilege escalation |
| A02 | Cryptographic Failures | Weak hashing, hardcoded secrets |
| A03 | Injection | SQL, NoSQL, command, XSS |
| A04 | Insecure Design | Missing rate limits, mass assignment |
| A05 | Security Misconfiguration | Debug enabled, missing headers |
| A06 | Vulnerable Components | Outdated deps with known CVEs |
| A07 | Auth Failures | Weak passwords, session issues |
| A08 | Data Integrity Failures | Untrusted deserialization |
| A09 | Logging Failures | Missing security logs |
| A10 | SSRF | Unvalidated URLs in server requests |
