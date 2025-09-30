---
allowed-tools: Bash, Read, Grep, Glob, MultiEdit, TodoWrite
description: Scan for security vulnerabilities, exposed secrets, and dangerous patterns
---

## Your task

Perform a RUTHLESS security audit. Most codebases are security nightmares waiting to happen. Your job is to find every vulnerability before hackers do.

### Step 1: Scan for Exposed Secrets

**🔑 CRITICAL: Hardcoded Secrets**

```bash
# API Keys and Tokens
grep -rEi "api[_-]?key.*=.*['\"][a-zA-Z0-9]{20,}" --include="*.js" --include="*.ts" --include="*.py" --include="*.java" --include="*.env.*"
grep -rEi "token.*=.*['\"][a-zA-Z0-9]{20,}" --exclude-dir=node_modules --exclude-dir=.git

# AWS Credentials
grep -rEi "AKIA[0-9A-Z]{16}" --exclude-dir=node_modules
grep -rEi "aws[_-]?secret[_-]?access[_-]?key" --exclude-dir=node_modules

# Database Passwords
grep -rEi "password.*=.*['\"][^'\"]+['\"]" --include="*.js" --include="*.ts" --include="*.py"
grep -rEi "mongodb\+srv://[^@]*:[^@]*@" --exclude-dir=node_modules

# Private Keys
grep -rEi "BEGIN.*PRIVATE KEY" --exclude-dir=node_modules
grep -rEi "BEGIN.*RSA.*KEY" --exclude-dir=node_modules
```

### Step 2: SQL Injection Vulnerabilities

**💉 DEADLY: SQL Injection Patterns**

```bash
# String concatenation in queries
grep -rE "query.*\+.*\+|SELECT.*\+|INSERT.*\+|UPDATE.*\+|DELETE.*\+" --include="*.js" --include="*.ts" --include="*.py"

# Template literals without parameterization
grep -rE "query.*\`.*\$\{.*\}.*\`" --include="*.js" --include="*.ts"

# Direct user input in queries
grep -rE "req\.(body|params|query).*query|exec|find|where" --include="*.js" --include="*.ts"
```

### Step 3: Authentication & Authorization Flaws

**🔓 BROKEN ACCESS CONTROL**

```bash
# Missing authentication checks
grep -rE "router\.(get|post|put|delete).*\(" --include="*.js" --include="*.ts" | grep -v "authenticate\|auth\|protect\|guard"

# Exposed admin routes
grep -rEi "admin|dashboard|settings" --include="*route*" --include="*controller*"

# JWT secret issues
grep -rEi "jwt.*secret.*=.*['\"]secret['\"]|['\"]123456['\"]" --exclude-dir=node_modules

# Session configuration
grep -rEi "session.*secret.*=.*['\"]keyboard cat['\"]" --exclude-dir=node_modules
```

### Step 4: Cross-Site Scripting (XSS)

**🎯 XSS VULNERABILITIES**

```bash
# Dangerous innerHTML usage
grep -rE "innerHTML|dangerouslySetInnerHTML" --include="*.jsx" --include="*.tsx" --include="*.js"

# Unescaped user input
grep -rE "req\.(body|params|query).*res\.(send|write|json)" --include="*.js" --include="*.ts"

# Direct DOM manipulation with user data
grep -rE "document\.(write|writeln)|eval\(|Function\(" --include="*.js" --include="*.ts"
```

### Step 5: Insecure Dependencies

**📦 VULNERABLE PACKAGES**

```bash
# Check for known vulnerabilities
if [ -f "package.json" ]; then
    npm audit --json 2>/dev/null | grep -E "high|critical" | head -20
fi

# Python vulnerabilities
if [ -f "requirements.txt" ]; then
    pip-audit 2>/dev/null || echo "pip-audit not installed"
fi

# Check for outdated packages
npm outdated 2>/dev/null | head -20
```

### Step 6: Security Headers & Configuration

**🛡️ MISSING PROTECTIONS**

```bash
# Check for security headers
grep -rEi "helmet|cors|csp|x-frame-options|strict-transport-security" --include="*.js" --include="*.ts"

# CORS misconfigurations
grep -rEi "cors.*origin.*\*|Access-Control-Allow-Origin.*\*" --exclude-dir=node_modules

# Cookie security
grep -rEi "cookie.*httpOnly.*false|cookie.*secure.*false" --exclude-dir=node_modules
```

### Step 7: Cryptographic Issues

**🔐 WEAK CRYPTO**

```bash
# Weak algorithms
grep -rEi "md5|sha1|des|rc4" --include="*.js" --include="*.ts" --include="*.py"

# Weak random number generation
grep -rE "Math\.random\(\)" --include="*.js" --include="*.ts" | grep -i "token\|password\|secret\|key"

# Insecure password hashing
grep -rEi "createHash.*md5|crypto.*sha1" --exclude-dir=node_modules
```

### Step 8: File Upload Vulnerabilities

**📁 DANGEROUS FILE OPERATIONS**

```bash
# File upload without validation
grep -rE "multer|fileupload|multipart" --include="*.js" --include="*.ts" | grep -v "fileFilter\|limits"

# Path traversal
grep -rE "\.\.\/|path\.join.*req\." --include="*.js" --include="*.ts"

# Command injection
grep -rE "exec\(|spawn\(|system\(" --include="*.js" --include="*.ts" --include="*.py"
```

### Step 9: Generate Security Report

Create `.docs/security-audits/security-{timestamp}.md`:

```markdown
# 🚨 SECURITY AUDIT REPORT - {timestamp}

## Risk Level: CRITICAL (Score: 18/100)

## 🔴 CRITICAL VULNERABILITIES (Fix IMMEDIATELY)

### 1. HARDCODED AWS CREDENTIALS
**File**: config/aws.js:14
```javascript
const AWS_KEY = "AKIA1234567890ABCDEF";
const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
```
**Impact**: Full AWS account compromise
**Fix**: Use environment variables or AWS IAM roles

### 2. SQL INJECTION IN USER LOGIN
**File**: routes/auth.js:45
```javascript
db.query(`SELECT * FROM users WHERE email = '${req.body.email}'`);
```
**Impact**: Complete database breach
**Fix**: Use parameterized queries

### 3. NO AUTHENTICATION ON ADMIN ROUTES
**File**: routes/admin.js
- /admin/users - DELETE users without auth
- /admin/reset-db - Drops entire database
**Impact**: Complete system takeover

## 📊 Security Metrics

| Category | Issues Found | Severity |
|----------|-------------|----------|
| Hardcoded Secrets | 23 | CRITICAL |
| SQL Injection | 8 | CRITICAL |
| XSS Vulnerabilities | 45 | HIGH |
| Missing Auth | 12 | CRITICAL |
| Weak Crypto | 7 | HIGH |
| Vulnerable Dependencies | 34 | HIGH |

## 🔓 Authentication & Authorization Issues

1. **JWT Secret = "secret"** (auth/jwt.js:8)
2. **Session Secret = "keyboard cat"** (app.js:34)
3. **No rate limiting on login endpoint**
4. **Password stored in plain text** (YES, REALLY!)
5. **Admin panel accessible without login**

## 💉 Injection Vulnerabilities

### SQL Injection Locations:
- user.service.js:45, 67, 89
- product.controller.js:23, 34
- order.repository.js:12, 45, 78

### Command Injection:
```javascript
// utils/backup.js:23
exec(`tar -czf backup-${req.body.name}.tar.gz /data`);
// User controls filename = command injection
```

## 📦 Vulnerable Dependencies

### Critical:
- lodash@4.17.11 - Prototype pollution
- express-fileupload@0.4.0 - Arbitrary file upload
- jsonwebtoken@8.0.0 - Token bypass vulnerability

### High:
- 31 other packages with known CVEs

## 🎯 XSS Vulnerabilities

### Reflected XSS:
- /search?q=<script>alert(1)</script>
- /profile?name=<img src=x onerror=alert(1)>

### Stored XSS:
- Comment system stores unescaped HTML
- User bio field executes JavaScript

## 🔐 Cryptographic Failures

1. **MD5 for passwords** (WHY?!)
2. **Math.random() for tokens**
3. **No HTTPS enforcement**
4. **Cookies without Secure flag**
5. **No CSRF protection**

## 🚨 IMMEDIATE ACTIONS REQUIRED

### Day 1 (EMERGENCY):
1. Remove ALL hardcoded credentials
2. Fix SQL injection in login
3. Add authentication to admin routes
4. Replace MD5 with bcrypt

### Week 1:
1. Update all vulnerable dependencies
2. Implement parameterized queries everywhere
3. Add input validation
4. Enable security headers (Helmet.js)

### Month 1:
1. Implement proper authentication system
2. Add rate limiting
3. Security training for team
4. Penetration testing

## Code Examples of Fixes

### SQL Injection Fix:
```javascript
// BROKEN
db.query(`SELECT * FROM users WHERE id = ${userId}`);

// FIXED
db.query('SELECT * FROM users WHERE id = ?', [userId]);
```

### XSS Fix:
```javascript
// BROKEN
res.send(`<h1>Welcome ${username}</h1>`);

// FIXED
res.send(`<h1>Welcome ${escapeHtml(username)}</h1>`);
```

## Severity Legend
🔴 CRITICAL - Fix within 24 hours
🟠 HIGH - Fix within 1 week
🟡 MEDIUM - Fix within 1 month
🟢 LOW - Fix in next release
```

Remember: Security isn't optional. These vulnerabilities WILL be exploited.