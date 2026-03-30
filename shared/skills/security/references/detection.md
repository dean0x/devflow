# Security Detection Patterns

Comprehensive grep commands and patterns for security vulnerability detection.

## Injection Detection

### SQL Injection

```bash
# String interpolation in queries
grep -rn "query.*\${" --include="*.ts" --include="*.js"
grep -rn "query.*+ " --include="*.ts" --include="*.js"
grep -rn "execute.*\`" --include="*.ts" --include="*.js"

# Raw SQL with variables
grep -rn "SELECT.*\${" --include="*.ts" --include="*.js"
grep -rn "INSERT.*\${" --include="*.ts" --include="*.js"
grep -rn "UPDATE.*\${" --include="*.ts" --include="*.js"
grep -rn "DELETE.*\${" --include="*.ts" --include="*.js"

# ORM raw queries
grep -rn "\.raw\s*\(" --include="*.ts" --include="*.js"
grep -rn "\.query\s*\(" --include="*.ts" --include="*.js"
```

### NoSQL Injection

```bash
# MongoDB queries with user input
grep -rn "findOne.*req\.\|find.*req\." --include="*.ts" --include="*.js"
grep -rn "\$where" --include="*.ts" --include="*.js"
grep -rn "\$regex.*req\." --include="*.ts" --include="*.js"
```

### Command Injection

```bash
# Shell execution
grep -rn "exec\s*\(" --include="*.ts" --include="*.js"
grep -rn "execSync" --include="*.ts" --include="*.js"
grep -rn "spawn.*\`" --include="*.ts" --include="*.js"
grep -rn "child_process" --include="*.ts" --include="*.js"

# Eval and similar
grep -rn "eval\s*\(" --include="*.ts" --include="*.js"
grep -rn "Function\s*\(" --include="*.ts" --include="*.js"
grep -rn "new Function" --include="*.ts" --include="*.js"
```

### XSS Detection

```bash
# Dangerous DOM manipulation
grep -rn "innerHTML" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx"
grep -rn "document.write" --include="*.ts" --include="*.js"
grep -rn "dangerouslySetInnerHTML" --include="*.tsx" --include="*.jsx"

# React unescaped rendering
grep -rn "__html" --include="*.tsx" --include="*.jsx"
```

### Path Traversal

```bash
# File operations with user input
grep -rn "readFile.*req\.\|readFileSync.*req\." --include="*.ts" --include="*.js"
grep -rn "writeFile.*req\.\|writeFileSync.*req\." --include="*.ts" --include="*.js"
grep -rn "path\.join.*req\." --include="*.ts" --include="*.js"
grep -rn "fs\.\|readdir\|unlink" --include="*.ts" --include="*.js"
```

## Authentication Detection

### Missing Auth Middleware

```bash
# Endpoints without auth checks
grep -rn "app\.\(get\|post\|put\|delete\|patch\).*async" --include="*.ts" --include="*.js" | \
  grep -v "requireAuth\|isAuthenticated\|authorize\|protect"

# Express route handlers
grep -rn "router\.\(get\|post\|put\|delete\).*\(" --include="*.ts" --include="*.js" | \
  grep -v "auth\|protect\|verify"
```

### JWT Issues

```bash
# JWT without algorithm specification
grep -rn "jwt\.sign\|jwt\.verify" --include="*.ts" --include="*.js" -A 5 | \
  grep -v "algorithm"

# JWT without expiration
grep -rn "jwt\.sign" --include="*.ts" --include="*.js" -A 5 | \
  grep -v "expiresIn\|exp"

# Weak JWT secrets
grep -rn "jwt\.sign.*['\"][a-zA-Z0-9]\{1,20\}['\"]" --include="*.ts" --include="*.js"
```

### Session Issues

```bash
# Session configuration
grep -rn "session\|cookie" --include="*.ts" --include="*.js" | \
  grep -v "httpOnly\|secure\|sameSite"

# Session in URL
grep -rn "session.*=.*req\.query\|session.*=.*req\.params" --include="*.ts" --include="*.js"
```

### Password Handling

```bash
# Weak password requirements
grep -rn "password.*length" --include="*.ts" --include="*.js" | \
  grep -v "minLength.*12\|min.*12"

# Plain text password storage
grep -rn "password.*=.*req\." --include="*.ts" --include="*.js" | \
  grep -v "hash\|bcrypt\|argon"
```

## Cryptography Detection

### Hardcoded Secrets

```bash
# Common secret patterns
grep -rn "password.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "api.key.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "secret.*=.*['\"]" --include="*.ts" --include="*.js"
grep -rn "token.*=.*['\"]" --include="*.ts" --include="*.js"

# API key patterns
grep -rn "sk-\|pk-\|api_" --include="*.ts" --include="*.js" --include="*.json"
grep -rn "AKIA[0-9A-Z]\{16\}" --include="*.ts" --include="*.js" # AWS keys

# Private keys
grep -rn "BEGIN.*PRIVATE KEY" --include="*.ts" --include="*.js" --include="*.pem"
```

### Weak Algorithms

```bash
# Weak hash functions
grep -rn "createHash.*md5\|sha1" --include="*.ts" --include="*.js"

# Weak encryption
grep -rn "DES\|RC4\|Blowfish" --include="*.ts" --include="*.js"
grep -rn "aes-.*-ecb" --include="*.ts" --include="*.js"

# Non-authenticated encryption
grep -rn "aes-.*-cbc" --include="*.ts" --include="*.js" | \
  grep -v "hmac\|auth"
```

### Insecure Random

```bash
# Math.random for security
grep -rn "Math.random" --include="*.ts" --include="*.js"

# Date-based IDs
grep -rn "Date.now.*id\|Date.now.*token" --include="*.ts" --include="*.js"

# UUID v1 (time-based)
grep -rn "uuid\.v1\|uuidv1" --include="*.ts" --include="*.js"
```

## Configuration Detection

### CORS Issues

```bash
# Permissive CORS
grep -rn "cors.*origin.*\*\|Access-Control.*\*" --include="*.ts" --include="*.js"
grep -rn "cors.*credentials.*true" --include="*.ts" --include="*.js"
```

### Missing Headers

```bash
# Check for security headers
grep -rn "Content-Security-Policy\|X-Frame-Options\|X-Content-Type-Options" \
  --include="*.ts" --include="*.js" -l
# If no results, headers may be missing

# Check for helmet usage
grep -rn "helmet" --include="*.ts" --include="*.js"
```

### Error Exposure

```bash
# Stack trace exposure
grep -rn "err\.stack\|error\.stack" --include="*.ts" --include="*.js" | \
  grep -v "console\|log\|debug"

# Verbose errors to client
grep -rn "res\.json.*error\|res\.send.*error" --include="*.ts" --include="*.js"
```

## Business Logic Detection

### Race Conditions

```bash
# Check-then-act patterns
grep -rn "if.*balance\|if.*quantity\|if.*available" --include="*.ts" --include="*.js" -A 3 | \
  grep -v "transaction\|lock"

# Missing transaction blocks
grep -rn "await.*update\|await.*delete" --include="*.ts" --include="*.js" | \
  grep -v "transaction\|atomic"
```

### Mass Assignment

```bash
# Direct body assignment
grep -rn "\.create.*req\.body\|\.update.*req\.body" --include="*.ts" --include="*.js"
grep -rn "Object\.assign.*req\.body\|{.*\.\.\.req\.body" --include="*.ts" --include="*.js"
```

## Quick Security Audit Script

```bash
#!/bin/bash
# security-audit.sh - Run all detection patterns

echo "=== Security Audit ==="

echo -e "\n## Injection Risks"
echo "SQL Injection:"
grep -rn "query.*\${" --include="*.ts" --include="*.js" 2>/dev/null | head -5

echo -e "\nXSS:"
grep -rn "innerHTML\|dangerouslySetInnerHTML" --include="*.ts" --include="*.js" --include="*.tsx" 2>/dev/null | head -5

echo -e "\n## Hardcoded Secrets"
grep -rn "password.*=.*['\"]" --include="*.ts" --include="*.js" 2>/dev/null | head -5
grep -rn "api.key.*=.*['\"]" --include="*.ts" --include="*.js" 2>/dev/null | head -5

echo -e "\n## Weak Crypto"
grep -rn "createHash.*md5\|sha1" --include="*.ts" --include="*.js" 2>/dev/null | head -5
grep -rn "Math.random" --include="*.ts" --include="*.js" 2>/dev/null | head -5

echo -e "\n## Missing Auth"
grep -rn "app\.\(get\|post\|put\|delete\).*async" --include="*.ts" --include="*.js" 2>/dev/null | \
  grep -v "requireAuth\|isAuthenticated" | head -5

echo -e "\n=== End Audit ==="
```

## Integration with CI/CD

```yaml
# .github/workflows/security.yml
name: Security Scan
on: [push, pull_request]

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check for hardcoded secrets
        run: |
          if grep -rn "password.*=.*['\"]" --include="*.ts" --include="*.js" src/; then
            echo "::error::Potential hardcoded secrets found"
            exit 1
          fi

      - name: Check for weak crypto
        run: |
          if grep -rn "createHash.*md5\|sha1" --include="*.ts" --include="*.js" src/; then
            echo "::warning::Weak hash algorithms detected"
          fi

      - name: Check for Math.random
        run: |
          if grep -rn "Math.random" --include="*.ts" --include="*.js" src/; then
            echo "::warning::Math.random used - verify not for security"
          fi
```
