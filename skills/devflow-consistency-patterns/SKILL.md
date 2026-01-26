---
name: devflow-consistency-patterns
description: Code consistency, pattern adherence, and unnecessary simplification detection. Load when reviewing code for style violations, content truncation, or feature regressions. Used by Reviewer agent with consistency focus.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Consistency Patterns

Domain expertise for code consistency and unnecessary simplification detection. Use alongside `devflow-review-methodology` for complete consistency reviews.

## Iron Law

> **MATCH EXISTING PATTERNS OR JUSTIFY DEVIATION**
>
> New code should look like existing code. If the codebase uses camelCase, use camelCase.
> If errors return Result types, return Result types. Consistency trumps personal preference.
> Deviation requires explicit justification and team agreement. One codebase, one style.

## Consistency Categories

### 1. Unnecessary Simplification

**Content Truncation**
```typescript
// BEFORE (comprehensive)
const errorMessages = {
  INVALID_EMAIL: 'Please enter a valid email address in the format user@domain.com',
  PASSWORD_WEAK: 'Password must contain at least 8 characters, one uppercase, one lowercase, one number, and one special character',
  USER_NOT_FOUND: 'We could not find an account with that email. Please check the email or create a new account.',
};

// AFTER (over-simplified - PROBLEM)
const errorMessages = {
  INVALID_EMAIL: 'Invalid email',
  PASSWORD_WEAK: 'Password too weak',
  USER_NOT_FOUND: 'Not found',
};

// RED FLAG: User-facing messages should be helpful, not minimal
```

**Removed Error Context**
```typescript
// BEFORE (informative)
throw new Error(`Failed to process order ${orderId}: ${reason}. Customer: ${customerId}. Items: ${itemCount}`);

// AFTER (stripped - PROBLEM)
throw new Error('Order failed');

// RED FLAG: Debug info removed, harder to troubleshoot
```

**Stripped Configuration Options**
```typescript
// BEFORE (flexible)
interface ServerConfig {
  port: number;
  host: string;
  timeout: number;
  maxConnections: number;
  ssl: SSLConfig;
  logging: LogConfig;
  cors: CorsConfig;
}

// AFTER (rigid - PROBLEM)
interface ServerConfig {
  port: number;
}

// RED FLAG: Configuration flexibility removed
```

### 2. Pattern Violations

**Naming Convention Inconsistency**
```typescript
// EXISTING PATTERN: camelCase for functions
function getUserById(id: string) { }
function createOrder(data: OrderData) { }

// VIOLATION: Different style
function Process_Payment(amount: number) { }  // snake_case
function VALIDATE_INPUT(input: string) { }    // SCREAMING_CASE

// CORRECT: Match existing
function processPayment(amount: number) { }
function validateInput(input: string) { }
```

**Error Handling Style Mismatch**
```typescript
// EXISTING PATTERN: Result types
function existingFunction(): Result<User, Error> {
  if (!valid) return Err(new ValidationError('...'));
  return Ok(user);
}

// VIOLATION: Throws instead
function newFunction(): User {
  if (!valid) throw new Error('...');  // Different pattern!
  return user;
}

// CORRECT: Match existing
function newFunction(): Result<User, Error> {
  if (!valid) return Err(new ValidationError('...'));
  return Ok(user);
}
```

**Import Organization Inconsistency**
```typescript
// EXISTING PATTERN: External, internal, relative
import express from 'express';           // External
import { Logger } from '@internal/logger'; // Internal
import { User } from './models';          // Relative

// VIOLATION: Mixed order
import { User } from './models';
import express from 'express';
import { Logger } from '@internal/logger';

// CORRECT: Match existing organization
```

**Export Pattern Mismatch**
```typescript
// EXISTING PATTERN: Named exports
export function createUser() { }
export function deleteUser() { }
export const UserSchema = z.object({ });

// VIOLATION: Default export
export default class UserService {  // Different pattern!
  create() { }
  delete() { }
}

// CORRECT: Match existing
export class UserService { }
export const userService = new UserService();
```

### 3. Feature Regression

**Removed CLI Options**
```typescript
// BEFORE
program
  .option('-v, --verbose', 'Enable verbose output')
  .option('-d, --debug', 'Enable debug mode')
  .option('-c, --config <path>', 'Config file path')
  .option('--dry-run', 'Preview without executing');

// AFTER (PROBLEM)
program
  .option('-c, --config <path>', 'Config file path');

// RED FLAG: Users relying on removed options will break
```

**Changed Return Types**
```typescript
// BEFORE
async function fetchUsers(): Promise<User[]> {
  return users;
}

// AFTER (PROBLEM)
async function fetchUsers(): Promise<{ data: User[] }> {
  return { data: users };  // Breaking change!
}

// All callers expecting User[] will break
```

**Removed Event Emissions**
```typescript
// BEFORE
class OrderService {
  async createOrder(data: OrderData) {
    const order = await this.repository.create(data);
    this.events.emit('order.created', order);  // Other services listen
    this.events.emit('inventory.reserve', order.items);
    return order;
  }
}

// AFTER (PROBLEM)
class OrderService {
  async createOrder(data: OrderData) {
    const order = await this.repository.create(data);
    return order;  // Events removed - listeners won't fire!
  }
}
```

### 4. Style Inconsistency

**Brace Style**
```typescript
// EXISTING PATTERN: Same-line braces
function existing() {
  if (condition) {
    // ...
  }
}

// VIOLATION: Next-line braces
function newFunction()
{
  if (condition)
  {
    // ...
  }
}
```

**Quote Style**
```typescript
// EXISTING PATTERN: Single quotes
const name = 'John';
const message = 'Hello';

// VIOLATION: Double quotes
const name = "Jane";  // Inconsistent

// CORRECT: Match existing
const name = 'Jane';
```

**Trailing Commas**
```typescript
// EXISTING PATTERN: Trailing commas
const config = {
  name: 'app',
  version: '1.0',
};

// VIOLATION: No trailing comma
const newConfig = {
  name: 'app',
  version: '1.0'  // Missing trailing comma
};
```

---

## Red Flags Detection

**Diff Statistics to Watch:**
```bash
# Files with many more deletions than additions
git diff main...HEAD --stat | awk '{
  if (match($0, /\+([0-9]+).*-([0-9]+)/, arr)) {
    added = arr[1]; deleted = arr[2];
    if (deleted > added * 2 && deleted > 10) {
      print "WARNING:", $0
    }
  }
}'
```

**Content Length Changes:**
```bash
# Compare line counts for key files
for file in $(git diff --name-only main...HEAD); do
  if [ -f "$file" ]; then
    before=$(git show main:"$file" 2>/dev/null | wc -l)
    after=$(wc -l < "$file")
    if [ "$before" -gt "$after" ]; then
      reduction=$((before - after))
      percent=$((reduction * 100 / before))
      if [ "$percent" -gt 20 ]; then
        echo "WARNING: $file reduced by $percent% ($before -> $after lines)"
      fi
    fi
  fi
done
```

---

## Severity Guidelines

**CRITICAL** - Breaking changes or significant content loss:
- Public API return types changed
- CLI options/flags removed
- Error messages stripped to uselessness
- Event emissions removed
- Configuration options removed without deprecation

**HIGH** - Inconsistency requiring attention:
- Error handling pattern mismatch
- Naming convention violations
- Export pattern inconsistency
- Documentation removed from public APIs

**MEDIUM** - Style inconsistency:
- Import organization different
- Brace/quote style mismatch
- Comment style variations
- Minor formatting differences

**LOW** - Minor observations:
- Could be more consistent
- Personal preference territory
- Linter should catch this

---

## Detection Patterns

Search for these patterns in code:

```bash
# Find shortened error messages
git diff main...HEAD -- "*.ts" | grep "^-.*Error\|^-.*throw" | head -20

# Find removed exports
git diff main...HEAD -- "*.ts" | grep "^-export" | head -20

# Find removed options
git diff main...HEAD -- "*.ts" | grep "^-.*option\|^-.*flag" | head -20

# Compare naming styles
grep -rn "function [A-Z_]" --include="*.ts"  # Unusual naming
grep -rn "const [a-z].*= function" --include="*.ts"  # Mixed function styles

# Find inconsistent quotes
grep -rn '"[^"]*"' --include="*.ts" | head -10
grep -rn "'[^']*'" --include="*.ts" | head -10
```

---

## Consistency Checklist

Before approving changes, verify:

- [ ] Naming matches existing patterns (camelCase, PascalCase, etc.)
- [ ] Error handling matches existing approach (throw vs Result)
- [ ] Import organization matches existing files
- [ ] Export style matches existing modules
- [ ] No user-facing content was unnecessarily shortened
- [ ] No configuration options were silently removed
- [ ] No CLI flags/options were removed without deprecation
- [ ] All removed functionality has explicit justification

