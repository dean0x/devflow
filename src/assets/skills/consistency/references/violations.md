# Consistency Violations Reference

Extended examples of consistency violations to detect.

---

## Unnecessary Simplification

### Content Truncation

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

### Removed Error Context

```typescript
// BEFORE (informative)
throw new Error(`Failed to process order ${orderId}: ${reason}. Customer: ${customerId}. Items: ${itemCount}`);

// AFTER (stripped - PROBLEM)
throw new Error('Order failed');

// RED FLAG: Debug info removed, harder to troubleshoot
```

### Stripped Configuration Options

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

---

## Pattern Violations

### Import Organization Inconsistency

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

### Export Pattern Mismatch

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

---

## Feature Regression

### Removed CLI Options

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

### Changed Return Types

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

### Removed Event Emissions

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

---

## Style Inconsistency

### Brace Style

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

### Quote Style

```typescript
// EXISTING PATTERN: Single quotes
const name = 'John';
const message = 'Hello';

// VIOLATION: Double quotes
const name = "Jane";  // Inconsistent

// CORRECT: Match existing
const name = 'Jane';
```

### Trailing Commas

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
