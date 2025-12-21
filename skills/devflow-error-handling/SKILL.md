---
name: devflow-error-handling
description: Automatically enforce Result type pattern and consistent error handling throughout the codebase. Use when writing functions that can fail, handling errors, or reviewing error handling consistency.
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Error Handling Skill

## Purpose

Enforce consistent, type-safe error handling using Result pattern:
1. **Result types everywhere** - No throwing exceptions in business logic
2. **Explicit error handling** - Force callers to handle errors
3. **Type-safe errors** - Leverage type system for error cases
4. **Consistent patterns** - Same approach throughout codebase

## When This Skill Activates

Automatically triggers when:
- Functions are being written that can fail
- Try/catch blocks are being added
- Error handling code is being modified
- New error types are being defined
- Functions are refactored to add error cases

## Core Pattern: Result Types

**CRITICAL**: Business logic NEVER throws exceptions.

### Result Type Definition

```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Helper constructors
const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

### Pattern Examples

```typescript
// ❌ VIOLATION: Throwing exceptions in business logic
function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

function processOrder(orderId: string): Order {
  const order = findOrder(orderId);
  if (!order) {
    throw new Error('Order not found');
  }
  if (order.status !== 'pending') {
    throw new Error('Order not pending');
  }
  return order;
}

// ✅ CORRECT: Return Result types
function divide(a: number, b: number): Result<number, string> {
  if (b === 0) {
    return Err('Division by zero');
  }
  return Ok(a / b);
}

type OrderError =
  | { type: 'NotFound'; orderId: string }
  | { type: 'InvalidStatus'; expected: string; actual: string };

function processOrder(orderId: string): Result<Order, OrderError> {
  const order = findOrder(orderId);
  if (!order) {
    return Err({ type: 'NotFound', orderId });
  }
  if (order.status !== 'pending') {
    return Err({
      type: 'InvalidStatus',
      expected: 'pending',
      actual: order.status
    });
  }
  return Ok(order);
}
```

## Exception Boundaries

Exceptions are ONLY allowed at system boundaries:

### Boundary Layer (Allowed)

```typescript
// ✅ API boundary - convert exceptions to HTTP responses
app.post('/api/orders/:id', async (req, res) => {
  try {
    const result = await processOrder(req.params.id);

    if (!result.ok) {
      // Handle Result error
      const statusCode = result.error.type === 'NotFound' ? 404 : 400;
      return res.status(statusCode).json({
        error: result.error
      });
    }

    return res.json(result.value);
  } catch (error) {
    // Unexpected errors only (infrastructure failures)
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ Database boundary - convert DB exceptions to Result
async function saveOrder(order: Order): Promise<Result<void, DbError>> {
  try {
    await db.orders.insert(order);
    return Ok(undefined);
  } catch (error) {
    // Convert infrastructure exception to Result
    if (error.code === 'UNIQUE_VIOLATION') {
      return Err({ type: 'DuplicateOrder', orderId: order.id });
    }
    return Err({ type: 'DatabaseError', message: error.message });
  }
}

// ✅ External API boundary - convert network errors to Result
async function fetchPaymentStatus(orderId: string): Promise<Result<PaymentStatus, ApiError>> {
  try {
    const response = await fetch(`https://payment-api.com/orders/${orderId}`);
    const data = await response.json();

    // Validate response
    const validation = PaymentStatusSchema.safeParse(data);
    if (!validation.success) {
      return Err({ type: 'InvalidResponse', details: validation.error });
    }

    return Ok(validation.data);
  } catch (error) {
    // Network/infrastructure errors
    return Err({ type: 'NetworkError', message: error.message });
  }
}
```

### Business Logic (No Exceptions)

```typescript
// ✅ Pure business logic - only Result types
function calculateDiscount(
  order: Order,
  discountCode: string
): Result<number, DiscountError> {
  const discount = findDiscount(discountCode);

  if (!discount) {
    return Err({ type: 'InvalidCode', code: discountCode });
  }

  if (isExpired(discount)) {
    return Err({ type: 'ExpiredCode', code: discountCode });
  }

  if (order.total < discount.minimumPurchase) {
    return Err({
      type: 'MinimumNotMet',
      required: discount.minimumPurchase,
      actual: order.total
    });
  }

  return Ok(order.total * discount.percentage);
}

// ✅ Composing Result-returning functions
function applyDiscountToOrder(
  order: Order,
  discountCode: string
): Result<Order, DiscountError | OrderError> {
  const discountResult = calculateDiscount(order, discountCode);

  if (!discountResult.ok) {
    return Err(discountResult.error);
  }

  const newTotal = order.total - discountResult.value;

  if (newTotal < 0) {
    return Err({ type: 'InvalidTotal', total: newTotal });
  }

  return Ok({ ...order, total: newTotal, discount: discountResult.value });
}
```

## Error Type Design

### Discriminated Unions for Errors

```typescript
// ✅ CORRECT: Discriminated union with specific error types
type UserError =
  | { type: 'NotFound'; userId: string }
  | { type: 'ValidationError'; field: string; message: string }
  | { type: 'DuplicateEmail'; email: string }
  | { type: 'PermissionDenied'; action: string; userId: string };

function getUser(userId: string): Result<User, UserError> {
  // Implementation that returns specific error types
}

// Exhaustive error handling
const result = getUser('123');
if (!result.ok) {
  switch (result.error.type) {
    case 'NotFound':
      console.log(`User ${result.error.userId} not found`);
      break;
    case 'ValidationError':
      console.log(`Invalid ${result.error.field}: ${result.error.message}`);
      break;
    case 'DuplicateEmail':
      console.log(`Email ${result.error.email} already exists`);
      break;
    case 'PermissionDenied':
      console.log(`Cannot ${result.error.action} for user ${result.error.userId}`);
      break;
  }
}
```

### Error Hierarchy

```typescript
// Base error types
type DbError =
  | { type: 'ConnectionFailed'; details: string }
  | { type: 'QueryFailed'; query: string; details: string }
  | { type: 'DuplicateKey'; table: string; key: string }
  | { type: 'NotFound'; table: string; id: string };

type ValidationError =
  | { type: 'RequiredField'; field: string }
  | { type: 'InvalidFormat'; field: string; format: string }
  | { type: 'OutOfRange'; field: string; min: number; max: number };

// Domain-specific errors compose base types
type OrderError =
  | { type: 'InvalidStatus'; expected: string; actual: string }
  | { type: 'InsufficientStock'; productId: string; available: number; requested: number }
  | ValidationError
  | DbError;
```

## Error Handling Patterns

### Pattern 1: Early Return

```typescript
function processPayment(order: Order, payment: Payment): Result<Receipt, PaymentError> {
  // Validate order
  const orderValidation = validateOrder(order);
  if (!orderValidation.ok) {
    return Err({ type: 'InvalidOrder', details: orderValidation.error });
  }

  // Validate payment
  const paymentValidation = validatePayment(payment);
  if (!paymentValidation.ok) {
    return Err({ type: 'InvalidPayment', details: paymentValidation.error });
  }

  // Check balance
  const balanceCheck = checkBalance(payment);
  if (!balanceCheck.ok) {
    return Err(balanceCheck.error);
  }

  // All validations passed, process
  const receipt = createReceipt(order, payment);
  return Ok(receipt);
}
```

### Pattern 2: Result Chaining (Monadic)

```typescript
// Helper for chaining Result-returning functions
function chain<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (!result.ok) {
    return result;
  }
  return fn(result.value);
}

// Usage
const result = chain(
  validateOrder(order),
  (validOrder) => chain(
    validatePayment(payment),
    (validPayment) => processPayment(validOrder, validPayment)
  )
);
```

### Pattern 3: Collecting Multiple Errors

```typescript
type ValidationResult<T> = Result<T, ValidationError[]>;

function validateUser(data: unknown): ValidationResult<User> {
  const errors: ValidationError[] = [];

  if (!isValidEmail(data.email)) {
    errors.push({ type: 'InvalidFormat', field: 'email', format: 'email' });
  }

  if (!isValidAge(data.age)) {
    errors.push({ type: 'OutOfRange', field: 'age', min: 0, max: 150 });
  }

  if (!isValidName(data.name)) {
    errors.push({ type: 'RequiredField', field: 'name' });
  }

  if (errors.length > 0) {
    return Err(errors);
  }

  return Ok({ email: data.email, age: data.age, name: data.name });
}
```

## Error Handling Report Format

```markdown
⚠️ ERROR HANDLING INCONSISTENCIES DETECTED

## 🔴 CRITICAL - Throwing in Business Logic
**File**: src/services/order.ts:45
**Issue**: Business logic throws exceptions instead of returning Result

**Current Code**:
```typescript
function processOrder(orderId: string): Order {
  const order = findOrder(orderId);
  if (!order) {
    throw new Error('Order not found');
  }
  return order;
}
```

**Required Fix**:
```typescript
type OrderError = { type: 'NotFound'; orderId: string };

function processOrder(orderId: string): Result<Order, OrderError> {
  const order = findOrder(orderId);
  if (!order) {
    return Err({ type: 'NotFound', orderId });
  }
  return Ok(order);
}
```

**Impact**: Forces explicit error handling, prevents uncaught exceptions

## 🔴 CRITICAL - Inconsistent Error Handling
**File**: src/services/user.ts
**Issue**: Some functions return Result, others throw exceptions

**Inconsistency**:
```typescript
// Function 1: Returns Result
function getUser(id: string): Result<User, UserError> { ... }

// Function 2: Throws exception (inconsistent!)
function createUser(data: UserData): User {
  if (!valid(data)) {
    throw new Error('Invalid data');
  }
  return user;
}
```

**Required Fix**:
```typescript
// ALL functions in module must use Result
function createUser(data: unknown): Result<User, UserError> {
  const validation = UserSchema.safeParse(data);
  if (!validation.success) {
    return Err({ type: 'ValidationError', details: validation.error });
  }
  return Ok(createUserFromValid(validation.data));
}
```

**Impact**: Consistent error handling throughout module

## 🟡 HIGH - Missing Error Types
**File**: src/services/payment.ts:67
**Issue**: Using generic Error instead of specific error types

**Current**:
```typescript
function processPayment(payment: Payment): Result<Receipt, Error> {
  if (payment.amount <= 0) {
    return Err(new Error('Invalid amount'));
  }
  // ...
}
```

**Required Fix**:
```typescript
type PaymentError =
  | { type: 'InvalidAmount'; amount: number }
  | { type: 'InsufficientFunds'; required: number; available: number }
  | { type: 'PaymentGatewayError'; details: string };

function processPayment(payment: Payment): Result<Receipt, PaymentError> {
  if (payment.amount <= 0) {
    return Err({ type: 'InvalidAmount', amount: payment.amount });
  }
  // ...
}
```

**Impact**: Type-safe, actionable error handling

## 🟡 HIGH - Try/Catch in Business Logic
**File**: src/utils/calculation.ts:34
**Issue**: Try/catch used where Result type should be used

**Current**:
```typescript
function calculateTotal(items: Item[]): number {
  try {
    return items.reduce((sum, item) => {
      if (item.price < 0) {
        throw new Error('Negative price');
      }
      return sum + item.price;
    }, 0);
  } catch (error) {
    return 0; // Swallowing error!
  }
}
```

**Required Fix**:
```typescript
type CalculationError = { type: 'NegativePrice'; itemId: string; price: number };

function calculateTotal(items: Item[]): Result<number, CalculationError> {
  let sum = 0;

  for (const item of items) {
    if (item.price < 0) {
      return Err({ type: 'NegativePrice', itemId: item.id, price: item.price });
    }
    sum += item.price;
  }

  return Ok(sum);
}
```

**Impact**: Explicit error handling, no silent failures

## 📊 Summary
- **Critical**: 12 functions throwing instead of Result
- **Critical**: 3 modules with inconsistent error handling
- **High**: 8 functions using generic Error
- **High**: 5 try/catch blocks in business logic
- **Files affected**: 15

## 🛑 CONSISTENCY CHECK FAILED

Error handling is inconsistent across codebase:
- Some functions use Result pattern
- Others throw exceptions
- Generic Error types used instead of specific types
- Silent error swallowing in several places

## ✅ Required Actions

**Phase 1: Critical (Stop throwing)**
1. Convert all business logic to Result types
2. Remove exception throwing from services
3. Define error type hierarchies

**Phase 2: Consistency**
4. Ensure entire modules use same pattern
5. Replace generic Error with specific types
6. Add discriminated union error types

**Phase 3: Boundaries**
7. Keep try/catch only at system boundaries
8. Convert exceptions to Result at boundaries
9. Document boundary vs business logic split

## 📚 Implementation Checklist

- [ ] Define Result<T, E> type
- [ ] Define error type hierarchies
- [ ] Convert throwing functions to Result
- [ ] Update callers to handle Result
- [ ] Move try/catch to boundaries only
- [ ] Add tests for error cases
- [ ] Document error handling pattern

## 🎯 Module Migration Example

Before (Inconsistent):
```typescript
// Some throw, some return Result
function getUser(id: string): Result<User, Error> { ... }
function createUser(data: any): User { throw ... }
function updateUser(id: string, data: any): User { throw ... }
```

After (Consistent):
```typescript
// All use Result with specific errors
type UserError =
  | { type: 'NotFound'; userId: string }
  | { type: 'ValidationError'; details: unknown }
  | { type: 'DuplicateEmail'; email: string };

function getUser(id: string): Result<User, UserError> { ... }
function createUser(data: unknown): Result<User, UserError> { ... }
function updateUser(id: string, data: unknown): Result<User, UserError> { ... }
```
```

## Consistency Rules

**Module-level consistency:**
- If ONE function in a module uses Result, ALL must use Result
- If ONE function uses specific error types, ALL must use specific types
- NO mixing of Result and exception throwing in same module

**Project-level consistency:**
- Business logic NEVER throws
- Boundaries ALWAYS catch and convert to Result
- Error types ALWAYS use discriminated unions
- Functions ALWAYS document possible errors in return type

## Integration Points

This skill works with:

**pattern-check**: Part of core pattern enforcement
**test-design**: Result types simplify test design
**code-smell**: Catches silent error swallowing
**input-validation**: Validation returns Result types

## Success Criteria

Error handling passes when:
- ✅ No exceptions thrown in business logic
- ✅ All functions use Result types consistently
- ✅ Specific error types (discriminated unions)
- ✅ Try/catch only at boundaries
- ✅ Boundary functions convert exceptions to Result
- ✅ Module consistency (all or nothing)
- ✅ Error cases tested
- ✅ Type system enforces error handling

## Example Scenario

```
User: "Add function to charge customer"
→ error-handling activates
→ Analyzes: Function can fail (insufficient funds, invalid card, etc.)
→ Checks: Does module use Result pattern?
→ Enforces: Define PaymentError type
→ Enforces: Return Result<Receipt, PaymentError>
→ Verifies: No exceptions thrown
→ Confirms: Callers handle errors
→ Approves: Consistent with module patterns
```

This ensures every function that can fail has explicit, type-safe error handling.
