# Security Violation Examples

Extended violation patterns for security reviews. Reference from main SKILL.md.

## Injection Vulnerabilities

### SQL Injection
```typescript
// VULNERABLE: String interpolation in query
const user = await db.query(`SELECT * FROM users WHERE id = '${userId}'`);
const result = await db.query(`SELECT * FROM products WHERE name LIKE '%${search}%'`);
```

### NoSQL Injection
```typescript
// VULNERABLE: Direct object from request
const user = await db.users.findOne({ username: req.body.username });
// Attacker sends: { username: { $gt: "" } }

// VULNERABLE: $where operator accepts arbitrary JS
db.users.find({ $where: `this.name === '${userInput}'` });

// VULNERABLE: regex injection
db.users.find({ name: { $regex: userInput } });
// Attacker sends: ".*" (matches everything)
```

### Command Injection
```typescript
// VULNERABLE: User input in shell command
exec(`ls ${userInput}`);
exec(`convert ${filename} output.png`);
exec(`ping -c 4 ${hostname}`);

// Dangerous characters: ; | & $ ` ( ) < > \ ' "
// Example attack: userInput = "file.txt; rm -rf /"
```

### Path Traversal
```typescript
// VULNERABLE: Direct path concatenation
const file = req.params.filename;
fs.readFile(`./uploads/${file}`);  // Attacker: ../../../etc/passwd

// VULNERABLE: Encoded traversal
// Attacker sends: %2e%2e%2f%2e%2e%2fetc/passwd (URL encoded ../..)
const decoded = decodeURIComponent(req.params.filename);
fs.readFile(`./uploads/${decoded}`);

// VULNERABLE: Double encoding
// Attacker sends: %252e%252e%252f (double-encoded ../)
```

### LDAP Injection
```typescript
// VULNERABLE: Unescaped LDAP filter
const filter = `(uid=${username})`;
ldap.search(baseDN, filter);
// Attacker: username = "admin)(&(password=*)"
```

### Template Injection (SSTI)
```typescript
// VULNERABLE: User input in template
const template = `Hello ${req.body.name}!`;
ejs.render(template);
// Attacker: name = "<%= process.env.SECRET %>"
```

### Header Injection
```typescript
// VULNERABLE: CRLF injection
res.setHeader('Location', `/user/${userInput}`);
// Attacker: userInput = "test\r\nSet-Cookie: admin=true"
```

---

## Authentication Vulnerabilities

### Weak Password Policies
```typescript
// VULNERABLE: Weak password requirements
if (password.length >= 6) { /* accept */ }
```

### Session Management Issues
```typescript
// VULNERABLE: Session ID in URL
app.get('/dashboard?session=abc123');

// VULNERABLE: Predictable session IDs
const sessionId = `user_${userId}`;

// VULNERABLE: No session timeout or rotation
```

### JWT Misuse
```typescript
// VULNERABLE: Weak secret
jwt.sign(payload, 'secret123');

// VULNERABLE: No expiration
jwt.sign(payload, secret);

// VULNERABLE: Algorithm confusion (accepts 'none')
jwt.verify(token, secret);  // Without algorithm specification
```

### Missing Authorization
```typescript
// VULNERABLE: No auth checks
app.delete('/api/users/:id', async (req, res) => {
  await deleteUser(req.params.id);  // No auth check!
});
```

---

## Cryptography Vulnerabilities

### Hardcoded Secrets
```typescript
// VULNERABLE: Secrets in code
const API_KEY = 'sk-abc123xyz789';
const dbPassword = 'admin123';
const jwtSecret = 'mysecret';

// VULNERABLE: Secrets in config files
const config = {
  database: {
    password: 'prod_password_123'
  },
  api: {
    key: 'sk-live-abcdef123456'
  }
};
```

### Weak Cryptography
```typescript
// VULNERABLE: Broken hash algorithms
crypto.createHash('md5').update(password);  // MD5 is broken
crypto.createHash('sha1').update(password);  // SHA1 weak for passwords

// VULNERABLE: Using password directly as key
const key = password;
crypto.createCipheriv('aes-256-gcm', key, iv);
```

### Insecure Random
```typescript
// VULNERABLE: Predictable random
const token = Math.random().toString(36);  // Predictable!
const id = Date.now().toString();
const code = Math.floor(Math.random() * 1000000);
```

### Weak Encryption
```typescript
// VULNERABLE: ECB mode (patterns visible)
crypto.createCipheriv('aes-256-ecb', key, null);

// VULNERABLE: No authentication (CBC without HMAC)
crypto.createCipheriv('aes-256-cbc', key, iv);
```

### Timing Attacks
```typescript
// VULNERABLE: Early exit reveals length info
function verifyToken(provided: string, stored: string): boolean {
  return provided === stored; // Early exit reveals info
}
```

---

## Detection Grep Commands

### Injection Detection
```bash
# SQL Injection
grep -rn "query.*\${" --include="*.ts" --include="*.js"
grep -rn "query.*+ " --include="*.ts" --include="*.js"
grep -rn "execute.*\`" --include="*.ts" --include="*.js"

# NoSQL Injection
grep -rn "findOne.*req\.\|find.*req\." --include="*.ts" --include="*.js"
grep -rn "\$where" --include="*.ts" --include="*.js"

# Command Injection
grep -rn "exec\s*\(" --include="*.ts" --include="*.js"
grep -rn "spawn.*\`\|execSync.*\`" --include="*.ts" --include="*.js"

# Path Traversal
grep -rn "readFile.*req\.\|readFileSync.*req\." --include="*.ts" --include="*.js"
grep -rn "path\.join.*req\." --include="*.ts" --include="*.js"
```

### Auth Detection
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

### Crypto Detection
```bash
# Hardcoded secrets
grep -rn "password.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "api.key.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "secret.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "sk-\|pk-\|api_" --include="*.ts" --include="*.js"

# Weak crypto
grep -rn "createHash.*md5\|sha1" --include="*.ts" --include="*.js"
grep -rn "DES\|RC4\|Blowfish" --include="*.ts" --include="*.js"
grep -rn "aes-.*-ecb\|aes-.*-cbc" --include="*.ts" --include="*.js"

# Insecure random
grep -rn "Math.random" --include="*.ts" --include="*.js"
grep -rn "Date.now.*id\|Date.now.*token" --include="*.ts" --include="*.js"

# String comparison for secrets
grep -rn "token.*===\|secret.*===\|key.*===" --include="*.ts" --include="*.js"
```
