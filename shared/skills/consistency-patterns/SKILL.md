---
name: consistency-patterns
description: Consistency analysis for Reviewer agent. Loaded when focus=consistency. Detects pattern violations, truncation, feature regressions.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Consistency Patterns

Domain expertise for code consistency and unnecessary simplification detection. Use alongside `review-methodology` for complete consistency reviews.

## Iron Law

> **MATCH EXISTING PATTERNS OR JUSTIFY DEVIATION**
>
> New code should look like existing code. If the codebase uses camelCase, use camelCase.
> If errors return Result types, return Result types. Consistency trumps personal preference.
> Deviation requires explicit justification and team agreement. One codebase, one style.

---

## Consistency Categories

### 1. Unnecessary Simplification

Content truncation, stripped configuration, removed error context.

```typescript
// VIOLATION: Oversimplified error messages
const errorMessages = {
  INVALID_EMAIL: 'Invalid email',  // Was: detailed format guidance
  USER_NOT_FOUND: 'Not found',     // Was: helpful next steps
};

// CORRECT: Preserve helpful context
const errorMessages = {
  INVALID_EMAIL: 'Please enter a valid email address in the format user@domain.com',
  USER_NOT_FOUND: 'We could not find an account with that email. Please check or create a new account.',
};
```

### 2. Pattern Violations

Naming conventions, error handling styles, import/export organization.

```typescript
// EXISTING PATTERN: Result types
function existingFunction(): Result<User, Error> {
  if (!valid) return Err(new ValidationError('...'));
  return Ok(user);
}

// VIOLATION: Throws instead of Result
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

### 3. Feature Regression

Removed CLI options, changed return types, removed event emissions.

```typescript
// VIOLATION: Removed event emissions break listeners
class OrderService {
  async createOrder(data: OrderData) {
    const order = await this.repository.create(data);
    return order;  // Events removed - listeners won't fire!
  }
}

// CORRECT: Preserve all event emissions
class OrderService {
  async createOrder(data: OrderData) {
    const order = await this.repository.create(data);
    this.events.emit('order.created', order);
    this.events.emit('inventory.reserve', order.items);
    return order;
  }
}
```

### 4. Style Inconsistency

Brace style, quote style, trailing commas, naming conventions.

```typescript
// EXISTING: camelCase for functions
function getUserById(id: string) { }
function createOrder(data: OrderData) { }

// VIOLATION: Different naming style
function Process_Payment(amount: number) { }  // snake_case

// CORRECT: Match existing
function processPayment(amount: number) { }
```

---

## Extended References

For extended examples and detection commands, see:

- `references/violations.md` - Extended violation examples by category
- `references/patterns.md` - Extended correct pattern examples
- `references/detection.md` - Bash commands for detecting issues

---

## Severity Guidelines

| Severity | Description | Examples |
|----------|-------------|----------|
| **CRITICAL** | Breaking changes or significant content loss | API return types changed, CLI options removed, events removed |
| **HIGH** | Inconsistency requiring attention | Error handling pattern mismatch, naming violations, export pattern change |
| **MEDIUM** | Style inconsistency | Import organization, brace/quote style, formatting differences |
| **LOW** | Minor observations | Personal preference territory, linter should catch |

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
