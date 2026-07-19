# Security — Violation Examples

Extended violation patterns for security reviews with literature citations.

## Injection Vulnerabilities [1][6]

### SQL Injection [1][6]
```typescript
// VULNERABLE: String interpolation in query — A03:Injection [1]
const user = await db.query(`SELECT * FROM users WHERE id = '${userId}'`);
const result = await db.query(`SELECT * FROM products WHERE name LIKE '%${search}%'`);
```
**CWE-89** (SQL Injection) is in the CWE Top 25 [5]. Any unsanitized string in a query
is exploitable. Parameterized queries are the only reliable fix [6].

### NoSQL Injection [1][6]
```typescript
// VULNERABLE: Direct object from request — operator injection possible
const user = await db.users.findOne({ username: req.body.username });
// Attacker sends: { username: { $gt: "" } } — matches all users

// VULNERABLE: $where operator accepts arbitrary JS execution
db.users.find({ $where: `this.name === '${userInput}'` });

// VULNERABLE: Unescaped regex — catastrophic backtracking or full-table match
db.users.find({ name: { $regex: userInput } });
// Attacker sends: ".*"
```

### Command Injection [1][6][9]
```typescript
// VULNERABLE: User input in shell command — A03:Injection [1]
exec(`ls ${userInput}`);
exec(`convert ${filename} output.png`);
exec(`ping -c 4 ${hostname}`);
// Dangerous chars: ; | & $ ` ( ) < > \ ' "
// Attack: userInput = "file.txt; rm -rf /"
```

### Path Traversal [1][6]
```typescript
// VULNERABLE: Direct path concatenation — CWE-22 [5]
fs.readFile(`./uploads/${req.params.filename}`);  // Attack: ../../../etc/passwd

// VULNERABLE: Encoded traversal not decoded before validation
const decoded = decodeURIComponent(req.params.filename);
fs.readFile(`./uploads/${decoded}`);  // %2e%2e%2f = ../
```

### LDAP Injection [6][9]
```typescript
// VULNERABLE: Unescaped LDAP filter — CWE-90 [5]
const filter = `(uid=${username})`;
ldap.search(baseDN, filter);
// Attack: username = "admin)(&(password=*)"
```

### Template Injection (SSTI) [1][20]
```typescript
// VULNERABLE: User input as template string
const template = `Hello ${req.body.name}!`;
ejs.render(template);
// Attack: name = "<%= process.env.SECRET %>" — exfiltrates env vars
```

### Header Injection (CRLF) [1][4]
```typescript
// VULNERABLE: CRLF injection in redirect header
res.setHeader('Location', `/user/${userInput}`);
// Attack: userInput = "test\r\nSet-Cookie: admin=true" — injects cookie
```

---

## Authentication Vulnerabilities [1][2][7]

### Weak Password Policies [7]
```typescript
// VULNERABLE: Below NIST 800-63 minimum [7]
if (password.length >= 6) { /* accept */ }
// NIST requires: ≥8 chars minimum (recommend 15-char passphrase or 12-char complex)
```

### Session Management Issues [4][7]
```typescript
// VULNERABLE: Session ID in URL — logged in access logs, Referer header
app.get('/dashboard?session=abc123');

// VULNERABLE: Predictable session IDs — CWE-330 [5]
const sessionId = `user_${userId}`;  // sequential, enumerable

// VULNERABLE: No session timeout — indefinite access after token theft [7]
// VULNERABLE: No session rotation on login — session fixation attack [4]
```

### JWT Misuse [17]
```typescript
// VULNERABLE: Weak secret — brute-forceable [17]
jwt.sign(payload, 'secret123');

// VULNERABLE: No expiration — stolen token never expires [17]
jwt.sign(payload, secret);  // no expiresIn

// VULNERABLE: No algorithm specification — algorithm confusion attack [17]
jwt.verify(token, secret);  // accepts 'none' algorithm or RS256→HS256 downgrade

// VULNERABLE: Storing JWT in localStorage — XSS can exfiltrate [4]
localStorage.setItem('token', jwt);
```

### Missing Authorization [1][2]
```typescript
// VULNERABLE: No auth check — any user can delete any user [1]
app.delete('/api/users/:id', async (req, res) => {
  await deleteUser(req.params.id);
});

// VULNERABLE: IDOR — no ownership check (API1: Broken Object Level Auth) [11]
app.get('/api/orders/:id', requireAuth, async (req, res) => {
  const order = await getOrder(req.params.id);  // any user can read any order
  res.json(order);
});
```

---

## Cryptography Vulnerabilities [5][24][25]

### Hardcoded Secrets [1][4]
```typescript
// VULNERABLE: Secrets in source code — A02:Cryptographic Failures [1]
const API_KEY = 'sk-abc123xyz789';
const dbPassword = 'admin123';
const jwtSecret = 'mysecret';

// VULNERABLE: Secrets in config objects committed to git [8]
const config = { database: { password: 'prod_password_123' } };
```

### Weak Cryptography [5][25]
```typescript
// VULNERABLE: MD5/SHA1 for passwords — broken, rainbow table viable [5][25]
crypto.createHash('md5').update(password);
crypto.createHash('sha1').update(password);

// VULNERABLE: Password as raw encryption key — no stretching [24]
crypto.createCipheriv('aes-256-gcm', password, iv);  // must use scrypt/Argon2 first

// VULNERABLE: ECB mode — identical plaintext blocks produce identical ciphertext [25]
crypto.createCipheriv('aes-256-ecb', key, null);

// VULNERABLE: CBC without authentication — padding oracle, bit-flipping attacks [25]
crypto.createCipheriv('aes-256-cbc', key, iv);  // use GCM for authenticated encryption
```

### Insecure Random [5][25]
```typescript
// VULNERABLE: Math.random for security — predictable, not cryptographic [25]
const token = Math.random().toString(36);
const id = Date.now().toString();           // timestamp-based — guessable
const code = Math.floor(Math.random() * 1000000);  // 2FA code — predictable
```

### Timing Attacks [25]
```typescript
// VULNERABLE: Early exit reveals length info through timing [25]
function verifyToken(provided: string, stored: string): boolean {
  return provided === stored;  // short-circuits on first mismatch — timing oracle
}
```

---

## Configuration Vulnerabilities [1][10][15]

### Missing Security Headers [10][15]
```typescript
// VULNERABLE: No CSP — XSS can load arbitrary scripts [15]
// VULNERABLE: No HSTS — downgrade to HTTP possible [10]
// VULNERABLE: No X-Frame-Options — clickjacking possible [10]
// DETECTION: Check with: curl -I https://yoursite.com | grep -i "content-security\|strict-transport\|x-frame"
```

### Permissive CORS [1][4]
```typescript
// VULNERABLE: Wildcard origin with credentials — CORS bypass [4]
app.use(cors({ origin: '*', credentials: true }));
// Credentials + wildcard is rejected by browsers but indicates configuration intent
```

### Error Information Exposure [4][8]
```typescript
// VULNERABLE: Stack trace to client — reveals internals [8]
res.status(500).json({ error: err.stack });

// VULNERABLE: Verbose DB errors — reveals schema structure
res.status(500).json({ error: err.message });  // e.g. "column 'admin' does not exist"
```

---

## Business Logic Vulnerabilities [1][3]

### Race Conditions (TOCTOU) [1][3]
```typescript
// VULNERABLE: Time-of-check to time-of-use — double-spend possible [3]
if (balance >= amount) {
  await withdraw(userId, amount);  // another request can execute between check and write
}
```

### Mass Assignment [1][11]
```typescript
// VULNERABLE: API6:Mass Assignment — user can set role, verified, etc. [11]
await User.create(req.body);
await User.update(userId, req.body);
// Attack: POST { "email": "x@y.com", "role": "admin", "verified": true }

// VULNERABLE: Spread operator passes all request fields
const user = { ...req.body, createdAt: new Date() };
```

### SSRF (Server-Side Request Forgery) [1][11]
```typescript
// VULNERABLE: Unvalidated URL — can reach internal services [11]
const response = await fetch(req.body.webhookUrl);
// Attack: webhookUrl = "http://169.254.169.254/latest/meta-data/" (AWS metadata)
// Attack: webhookUrl = "http://internal-db:5432/"
```

---

## Supply Chain Vulnerabilities [12][13][18]

```typescript
// VULNERABLE: Unpinned CDN script — CDN compromise delivers malicious code
// <script src="https://cdn.example.com/lib.js"></script>  // no integrity attribute [18]

// VULNERABLE: Floating dependency versions — supply chain attack surface [12]
// "dependencies": { "lodash": "^4.17.0" }  // range allows malicious patch releases
```
