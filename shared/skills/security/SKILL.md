---
name: security
description: This skill should be used when reviewing code for injection flaws, auth bypasses, or hardcoded secrets.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Security Patterns

Domain expertise for security vulnerability detection. Use alongside `devflow:review-methodology` for complete security reviews.

## Iron Law

> **ASSUME ALL INPUT IS MALICIOUS**
>
> Every user input, URL parameter, header, and cookie is an attack vector. Use parameterized
> queries always. Escape output always. Validate schemas always. "This field is internal"
> is not a defense. Defense in depth, not wishful thinking. [1][6]

## Vulnerability Categories

### 1. Input Validation & Injection [1][6]

**SQL Injection** — parameterize, never interpolate:
```typescript
// VULNERABLE: const query = `SELECT * FROM users WHERE email = '${email}'`;
await db.execute("SELECT * FROM users WHERE email = ?", [email]);
```

**XSS** — text content, never innerHTML:
```typescript
element.textContent = userInput;  // not: element.innerHTML = userInput
```

> `references/patterns.md` — NoSQL, command injection, path traversal, LDAP injection.

### 2. Authentication & Authorization [1][2][7]

```typescript
// VULNERABLE: no auth middleware
app.delete('/api/users/:id', async (req, res) => { await deleteUser(req.params.id); });

// SECURE: layered auth
app.delete('/api/users/:id', requireAuth, requireRole('admin'), handler);
```

NIST 800-63 minimum: 15-char passphrase or 12-char complex, phishing-resistant MFA [7].
JWT: pin algorithm explicitly, set `expiresIn`, store refresh tokens server-side [17].

### 3. Cryptography & Secrets [5][24][25]

```typescript
const API_KEY = process.env.API_KEY;           // not: hardcoded literal
const token = crypto.randomBytes(32).toString('hex');  // not: Math.random()
```

Password hashing: Argon2id (preferred) or bcrypt cost ≥12 [24]. Encrypt with AES-256-GCM
(authenticated). Compare secrets with `crypto.timingSafeEqual`, never `===` [25].

### 4. Configuration & Headers [10][15][16]

```typescript
app.use(helmet());
res.setHeader('Content-Security-Policy', "default-src 'self'");  // [15]
res.setHeader('Strict-Transport-Security', 'max-age=31536000');  // [10]
app.use(cors({ origin: ['https://myapp.com'], credentials: true }));
```

SameSite=Strict cookies prevent CSRF [16]. SRI hashes prevent CDN tampering [18].

### 5. Business Logic & API Security [1][3][11]

Race conditions: wrap check-then-act in database transactions with row locks.
Mass assignment: explicitly allowlist fields — never `User.create(req.body)` [11].
OWASP API Top 10 [11]: Broken Object Auth (API1), Excessive Data Exposure (API3), SSRF (API7).

### 6. Supply Chain [12][13]

Pin dependencies to exact versions. Require SRI for CDN assets [18]. Use
Sigstore/SLSA provenance in CI/CD to verify artifact integrity [12][13].

---

## Extended References

| Reference | Content |
|-----------|---------|
| `references/sources.md` | Full bibliography (25 sources) |
| `references/patterns.md` | Correct patterns with citations |
| `references/violations.md` | Violation examples with citations |
| `references/detection.md` | Grep patterns for automated scanning |

## Severity Guidelines

| Level | Criteria | Examples |
|-------|----------|----------|
| **CRITICAL** | Immediate exploitation | SQL injection in auth, RCE, hardcoded admin creds |
| **HIGH** | Significant risk | XSS [1], broken access control, weak crypto, CSRF [16] |
| **MEDIUM** | Moderate with conditions | Missing headers [10], permissive CORS, missing rate limits [11] |
| **LOW** | Minor improvement | Outdated deps (no CVE), suboptimal CSP [15] |

## OWASP Top 10 Reference [1]

| ID | Category | Examples |
|----|----------|----------|
| A01 | Broken Access Control | Missing auth, IDOR, privilege escalation |
| A02 | Cryptographic Failures | Weak hashing [24], hardcoded secrets |
| A03 | Injection | SQL, NoSQL, command, XSS [6] |
| A04 | Insecure Design | Missing rate limits, mass assignment [11] |
| A05 | Security Misconfiguration | Debug enabled, missing headers [10][15] |
| A06 | Vulnerable Components | Outdated deps, supply chain risks [12] |
| A07 | Auth Failures | Weak passwords [7], session issues, JWT misuse [17] |
| A08 | Data Integrity Failures | Untrusted deserialization, no SRI [18] |
| A09 | Logging Failures | Missing security event logs [8] |
| A10 | SSRF | Unvalidated URLs in server requests [11] |
