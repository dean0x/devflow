# Validation Issue Detection

Grep patterns and report templates for finding validation issues.

## Quick Detection Commands

### Find Unvalidated Request Body Usage

```bash
# Express/Node.js
grep -rn "req\.body" --include="*.ts" --include="*.js" | grep -v "safeParse\|validate\|schema"

# Look for direct property access without validation
grep -rn "req\.body\.\w" --include="*.ts" --include="*.js"
```

### Find Unvalidated Parameters

```bash
# Path parameters
grep -rn "req\.params\.\w" --include="*.ts" --include="*.js" | grep -v "safeParse\|validate"

# Query parameters
grep -rn "req\.query\.\w" --include="*.ts" --include="*.js" | grep -v "safeParse\|validate"
```

### Find SQL Injection Risks

```bash
# Template literals with SQL
grep -rn '`.*SELECT.*\${' --include="*.ts" --include="*.js"
grep -rn '`.*INSERT.*\${' --include="*.ts" --include="*.js"
grep -rn '`.*UPDATE.*\${' --include="*.ts" --include="*.js"
grep -rn '`.*DELETE.*\${' --include="*.ts" --include="*.js"

# String concatenation in queries
grep -rn "'\s*\+\s*.*\+\s*'" --include="*.ts" --include="*.js" | grep -i "select\|insert\|update\|delete"
```

### Find Unvalidated External Data

```bash
# JSON.parse without validation
grep -rn "JSON\.parse" --include="*.ts" --include="*.js" | grep -v "safeParse\|try"

# fetch responses used directly
grep -rn "\.json()" --include="*.ts" --include="*.js" | grep -v "safeParse\|schema\|validate"
```

### Find Unvalidated Environment Variables

```bash
# Direct process.env usage
grep -rn "process\.env\.\w" --include="*.ts" --include="*.js" | grep -v "safeParse\|validate\|ConfigSchema"
```

### Find Dangerous Functions

```bash
# eval and Function constructor
grep -rn "eval\s*(" --include="*.ts" --include="*.js"
grep -rn "new\s*Function\s*(" --include="*.ts" --include="*.js"

# JWT decode without verify
grep -rn "jwt\.decode" --include="*.ts" --include="*.js" | grep -v "jwt\.verify"
```

---

## Validation Report Format

When validation issues detected:

```markdown
# INPUT VALIDATION ISSUES DETECTED

## CRITICAL - Missing Boundary Validation
**File**: src/api/routes/users.ts:45
**Issue**: API endpoint accepts unvalidated user input
**Security Risk**: HIGH - Injection attacks, data corruption possible

**Current Code**:
```typescript
app.post('/api/users', async (req, res) => {
  const user = await createUser(req.body); // NO VALIDATION
  res.json(user);
});
```

**Required Fix**:
```typescript
const UserRequestSchema = z.object({
  body: z.object({
    email: z.string().email().max(255),
    name: z.string().min(1).max(100),
    age: z.number().int().min(0).max(150)
  })
});

app.post('/api/users', async (req, res) => {
  const validation = UserRequestSchema.safeParse(req);

  if (!validation.success) {
    return res.status(400).json({ error: validation.error });
  }

  const result = await createUser(validation.data.body);
  // ... handle result
});
```

**Impact**: Prevents malicious input, ensures data integrity

## CRITICAL - Manual Validation Instead of Schema
**File**: src/services/validation.ts:23
**Issue**: Manual type checking instead of schema validation
**Problem**: Scattered validation logic, incomplete checks

**Current Code**:
```typescript
if (!data.email || typeof data.email !== 'string') {
  throw new Error('Invalid email');
}
if (!data.age || typeof data.age !== 'number') {
  throw new Error('Invalid age');
}
// ... 15 more manual checks
```

**Required Fix**:
```typescript
const UserSchema = z.object({
  email: z.string().email().max(255),
  age: z.number().int().min(0).max(150),
  name: z.string().min(1).max(100),
  // All validation rules in one place
});

const validation = UserSchema.safeParse(data);
if (!validation.success) {
  return { ok: false, error: validation.error };
}
```

**Impact**: Centralized validation, type safety, better error messages

## CRITICAL - SQL Injection Risk
**File**: src/database/queries.ts:67
**Issue**: String interpolation in SQL query
**Security Risk**: CRITICAL - SQL injection possible

**Current Code**:
```typescript
const query = `SELECT * FROM users WHERE email = '${email}'`;
```

**Required Fix**:
```typescript
// 1. Validate input
const validation = EmailSchema.safeParse(email);
if (!validation.success) {
  return { ok: false, error: new Error('Invalid email') };
}

// 2. Use parameterized query
const query = 'SELECT * FROM users WHERE email = $1';
const result = await db.query(query, [validation.data]);
```

**Impact**: Prevents SQL injection attacks (critical security issue)

## HIGH - External API Response Not Validated
**File**: src/integrations/payment.ts:89
**Issue**: Trusting external API response without validation
**Risk**: Application crash if API changes structure

**Current Code**:
```typescript
const data = await response.json();
return data.amount; // No validation
```

**Required Fix**:
```typescript
const PaymentResponseSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  status: z.enum(['success', 'failed', 'pending'])
});

const validation = PaymentResponseSchema.safeParse(await response.json());
if (!validation.success) {
  return { ok: false, error: new Error('Invalid payment response') };
}

return { ok: true, value: validation.data.amount };
```

## Summary
- **Critical**: X validation issues (Y missing, Z SQL injection risks)
- **High**: X external data issues
- **Security Risk**: CRITICAL/HIGH/MEDIUM
- **Files affected**: X

## SECURITY GATE FAILED

These validation gaps create serious security vulnerabilities:
1. SQL injection possible in X locations
2. Unvalidated user input in Y API endpoints
3. External data trusted without validation

**DO NOT deploy until these are fixed.**

## Required Actions

1. **Immediate** (Security Critical):
   - Fix SQL injection risks
   - Add validation to all API endpoints

2. **High Priority**:
   - Validate all external API responses
   - Validate environment variables on startup

3. **Standard**:
   - Replace manual validation with schemas
   - Add validation tests

## Implementation Guide

**Step 1**: Install validation library
```bash
npm install zod  # or appropriate library
```

**Step 2**: Define schemas for all boundaries
```typescript
// src/validation/schemas.ts
export const schemas = {
  createUser: UserSchema,
  updateUser: UpdateUserSchema,
  searchQuery: SearchQuerySchema,
  // ... all input shapes
};
```

**Step 3**: Apply at boundaries
```typescript
// Validate at entry point
const validation = schema.safeParse(input);
// Check result and proceed
```

**Step 4**: Add tests
```typescript
// Verify validation catches invalid input
```
```

---

## Risk Classification

| Issue Type | Risk Level | Fix Priority |
|------------|------------|--------------|
| SQL injection | CRITICAL | Immediate |
| Command injection | CRITICAL | Immediate |
| Path traversal | CRITICAL | Immediate |
| Missing auth validation | CRITICAL | Immediate |
| Unvalidated API input | HIGH | Same day |
| Unvalidated external data | HIGH | Same day |
| Manual validation | MEDIUM | This sprint |
| Missing env validation | MEDIUM | This sprint |
| Incomplete schemas | LOW | Next sprint |

---

## Integration Points

This skill works with:

- **devflow-core-patterns**: Ensures validation uses Result types
- **devflow-code-smell**: Catches fake/incomplete validation
- **devflow-test-design**: Validates boundary tests exist
- **devflow-security-patterns**: Broader security review context
