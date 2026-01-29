# Correct Consistency Patterns Reference

Extended examples of correct patterns to follow.

---

## Naming Conventions

### Function Naming

```typescript
// EXISTING PATTERN: camelCase for functions
function getUserById(id: string) { }
function createOrder(data: OrderData) { }
function validateInput(input: string) { }
function processPayment(amount: number) { }

// All new functions MUST match this style
```

### Class Naming

```typescript
// EXISTING PATTERN: PascalCase for classes
class UserService { }
class OrderRepository { }
class PaymentGateway { }
class ValidationError extends Error { }
```

### Constant Naming

```typescript
// EXISTING PATTERN: SCREAMING_SNAKE_CASE for true constants
const MAX_RETRY_ATTEMPTS = 3;
const API_BASE_URL = 'https://api.example.com';
const DEFAULT_TIMEOUT_MS = 5000;

// camelCase for configuration objects
const serverConfig = { port: 3000 };
```

---

## Error Handling

### Result Type Pattern

```typescript
// EXISTING PATTERN: Result types
function existingFunction(): Result<User, Error> {
  if (!valid) return Err(new ValidationError('Detailed message'));
  return Ok(user);
}

// CORRECT: Match existing
function newFunction(): Result<Order, Error> {
  if (!valid) return Err(new ValidationError('Detailed message'));
  return Ok(order);
}
```

### Error Messages

```typescript
// CORRECT: Informative error messages
throw new Error(`Failed to process order ${orderId}: ${reason}. Customer: ${customerId}. Items: ${itemCount}`);

// Include:
// - What failed
// - Why it failed (if known)
// - Context for debugging
// - Action the user can take (for user-facing)
```

---

## Import Organization

```typescript
// CORRECT ORDER:
// 1. Node built-ins
import fs from 'fs';
import path from 'path';

// 2. External packages
import express from 'express';
import { z } from 'zod';

// 3. Internal packages (@company/*)
import { Logger } from '@internal/logger';
import { Config } from '@internal/config';

// 4. Relative imports (parent directories first)
import { BaseService } from '../../base';
import { User } from '../models';
import { validate } from './utils';
```

---

## Export Patterns

### Named Exports (Preferred)

```typescript
// Functions
export function createUser(data: UserInput): Result<User, Error> { }
export function deleteUser(id: string): Result<void, Error> { }

// Classes
export class UserService { }
export class UserRepository { }

// Types
export type UserId = string;
export interface UserConfig { }

// Constants
export const DEFAULT_PAGE_SIZE = 20;
```

### Barrel Exports

```typescript
// src/services/index.ts
export { UserService } from './user-service';
export { OrderService } from './order-service';
export type { ServiceConfig } from './types';
```

---

## Configuration Preservation

```typescript
// CORRECT: Maintain configuration flexibility
interface ServerConfig {
  // Required
  port: number;
  host: string;

  // Optional with defaults
  timeout?: number;
  maxConnections?: number;

  // Nested configs
  ssl?: SSLConfig;
  logging?: LogConfig;
  cors?: CorsConfig;
}

// Deprecation notice when removing options
/**
 * @deprecated Use `logging.level` instead. Will be removed in v3.0
 */
debugMode?: boolean;
```

---

## Event Emission Preservation

```typescript
// CORRECT: Maintain all event emissions
class OrderService {
  async createOrder(data: OrderData) {
    const order = await this.repository.create(data);

    // All existing events preserved
    this.events.emit('order.created', order);
    this.events.emit('inventory.reserve', order.items);
    this.events.emit('notification.send', {
      type: 'order_confirmation',
      userId: order.userId,
    });

    return order;
  }
}

// If removing events, deprecate first:
// DEPRECATED: 'order.legacy' event will be removed in v3.0
```

---

## CLI Option Preservation

```typescript
// CORRECT: Maintain all CLI options
program
  .option('-v, --verbose', 'Enable verbose output')
  .option('-d, --debug', 'Enable debug mode')
  .option('-c, --config <path>', 'Config file path')
  .option('--dry-run', 'Preview without executing')
  // New options add to existing, don't replace
  .option('--json', 'Output in JSON format');

// If removing, add deprecation warning:
.option('--old-flag', '[DEPRECATED] Use --new-flag instead')
```
