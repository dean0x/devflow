---
name: devflow-complexity-patterns
description: Code complexity and maintainability analysis. Load when reviewing code for cyclomatic complexity, readability issues, or maintainability concerns. Used by Reviewer agent with complexity focus.
allowed-tools: Read, Grep, Glob
---

# Complexity Patterns

Domain expertise for code complexity and maintainability analysis. Use alongside `devflow-review-methodology` for complete complexity reviews.

## Iron Law

> **IF YOU CAN'T UNDERSTAND IT IN 5 MINUTES, IT'S TOO COMPLEX**
>
> Every function should be explainable to a colleague in under 5 minutes. If you need a
> diagram to understand control flow, refactor. If you need comments to explain what
> (not why), the code is too clever. Simplicity is a feature, complexity is a bug.

## Complexity Categories

### 1. Cyclomatic Complexity

**Deep Nesting**
```typescript
// PROBLEM: 5+ levels of nesting
function processOrder(order: Order) {
  if (order) {
    if (order.items) {
      for (const item of order.items) {
        if (item.quantity > 0) {
          if (item.product) {
            if (item.product.inStock) {
              // Finally the actual logic...
            }
          }
        }
      }
    }
  }
}

// SOLUTION: Early returns and extraction
function processOrder(order: Order) {
  if (!order?.items) return;

  for (const item of order.items) {
    processItem(item);
  }
}

function processItem(item: OrderItem) {
  if (item.quantity <= 0) return;
  if (!item.product?.inStock) return;

  // Actual logic at top level
}
```

**Long Functions (>50 lines)**
```typescript
// PROBLEM: Function does too many things
function handleCheckout(cart: Cart, user: User) {
  // 150 lines of validation, pricing, inventory,
  // payment, notifications, analytics...
}

// SOLUTION: Extract logical units
async function handleCheckout(cart: Cart, user: User) {
  const validated = validateCart(cart);
  const priced = calculatePricing(validated);
  const reserved = await reserveInventory(priced);
  const payment = await processPayment(reserved, user);
  await sendNotifications(payment);
  trackAnalytics(payment);
  return payment;
}
```

**High Cyclomatic Complexity (>10)**
```typescript
// PROBLEM: Too many decision paths
function categorize(item: Item): string {
  if (item.type === 'A') {
    if (item.size > 10) {
      if (item.color === 'red') return 'A-large-red';
      else if (item.color === 'blue') return 'A-large-blue';
      else return 'A-large-other';
    } else {
      if (item.color === 'red') return 'A-small-red';
      // ... many more branches
    }
  } else if (item.type === 'B') {
    // ... another tree of conditions
  }
}

// SOLUTION: Data-driven or strategy pattern
const categoryRules: Record<string, (item: Item) => string> = {
  'A': categorizeTypeA,
  'B': categorizeTypeB,
};

function categorize(item: Item): string {
  const handler = categoryRules[item.type];
  return handler ? handler(item) : 'unknown';
}
```

### 2. Readability Issues

**Magic Numbers/Strings**
```typescript
// PROBLEM: Unexplained literals
if (status === 3) {
  setTimeout(callback, 86400000);
  retry(5);
}

// SOLUTION: Named constants
const OrderStatus = {
  PENDING: 1,
  PROCESSING: 2,
  COMPLETED: 3,
} as const;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 5;

if (status === OrderStatus.COMPLETED) {
  setTimeout(callback, ONE_DAY_MS);
  retry(MAX_RETRIES);
}
```

**Complex Expressions**
```typescript
// PROBLEM: Hard to parse mentally
const result = data.filter(x => x.active && x.type === 'premium')
  .map(x => ({ ...x, score: x.points * (x.bonus ? 1.5 : 1) / x.level }))
  .sort((a, b) => b.score - a.score)[0]?.score || 0;

// SOLUTION: Break into named steps
const activePremiusers = data.filter(isActivePremium);
const withScores = activePremiumUsers.map(calculateScore);
const topScore = findHighestScore(withScores);

function isActivePremium(user: User) {
  return user.active && user.type === 'premium';
}

function calculateScore(user: User) {
  const multiplier = user.bonus ? 1.5 : 1;
  return { ...user, score: (user.points * multiplier) / user.level };
}

function findHighestScore(users: ScoredUser[]) {
  return users.sort((a, b) => b.score - a.score)[0]?.score ?? 0;
}
```

**Unclear Variable Names**
```typescript
// PROBLEM: Cryptic names
const d = new Date();
const t = d.getTime();
const r = items.filter(i => i.t > t - 86400000);
const x = r.reduce((a, b) => a + b.p, 0);

// SOLUTION: Descriptive names
const now = new Date();
const oneDayAgo = now.getTime() - ONE_DAY_MS;
const recentItems = items.filter(item => item.timestamp > oneDayAgo);
const totalPrice = recentItems.reduce((sum, item) => sum + item.price, 0);
```

### 3. Maintainability Issues

**Code Duplication**
```typescript
// PROBLEM: Same logic repeated
function validateEmail(email: string) {
  if (!email) return { valid: false, error: 'Required' };
  if (!email.includes('@')) return { valid: false, error: 'Invalid format' };
  return { valid: true, error: null };
}

function validateUsername(username: string) {
  if (!username) return { valid: false, error: 'Required' };
  if (username.length < 3) return { valid: false, error: 'Too short' };
  return { valid: true, error: null };
}

// Similar validation in 10 more places...

// SOLUTION: Generic validation framework
type ValidationRule<T> = (value: T) => string | null;

function validate<T>(value: T, rules: ValidationRule<T>[]): ValidationResult {
  for (const rule of rules) {
    const error = rule(value);
    if (error) return { valid: false, error };
  }
  return { valid: true, error: null };
}

const required = (v: string) => v ? null : 'Required';
const minLength = (n: number) => (v: string) => v.length >= n ? null : 'Too short';
const isEmail = (v: string) => v.includes('@') ? null : 'Invalid format';

const validateEmail = (email: string) => validate(email, [required, isEmail]);
const validateUsername = (name: string) => validate(name, [required, minLength(3)]);
```

**Long Parameter Lists**
```typescript
// PROBLEM: Too many parameters
function createUser(
  name: string,
  email: string,
  password: string,
  role: string,
  department: string,
  manager: string,
  startDate: Date,
  salary: number,
  benefits: string[]
) {
  // ...
}

// SOLUTION: Use object parameter
interface CreateUserParams {
  name: string;
  email: string;
  password: string;
  role: string;
  department: string;
  manager?: string;
  startDate: Date;
  salary: number;
  benefits?: string[];
}

function createUser(params: CreateUserParams) {
  // ...
}
```

**Shotgun Surgery Indicators**
```typescript
// PROBLEM: Change requires modifying many files
// To add a new user type, you must modify:
// - UserType enum
// - UserFactory
// - UserValidator
// - UserSerializer
// - UserRepository
// - UserController
// - user.routes.ts
// - 5 more files...

// SOLUTION: Encapsulate variation
interface UserTypeHandler {
  validate(data: UserData): ValidationResult;
  serialize(user: User): SerializedUser;
  getPermissions(): Permission[];
}

class AdminUserHandler implements UserTypeHandler { /* ... */ }
class RegularUserHandler implements UserTypeHandler { /* ... */ }

// Adding new type = one new class
```

### 4. Boolean Complexity

**Complex Boolean Expressions**
```typescript
// PROBLEM: Hard to understand
if (user.active && !user.deleted && (user.role === 'admin' || user.role === 'moderator') && user.verified && (!user.suspended || user.suspendedUntil < Date.now())) {
  // ...
}

// SOLUTION: Extract to named predicates
const canModerate = (user: User): boolean => {
  if (!user.active || user.deleted) return false;
  if (!['admin', 'moderator'].includes(user.role)) return false;
  if (!user.verified) return false;
  if (user.suspended && user.suspendedUntil >= Date.now()) return false;
  return true;
};

if (canModerate(user)) {
  // ...
}
```

**Negation Overuse**
```typescript
// PROBLEM: Double/triple negatives
if (!user.isNotActive && !items.isEmpty()) {
  // ...
}

if (!(a && !b) || !(!c || d)) {
  // ...
}

// SOLUTION: Positive conditions
if (user.isActive && items.length > 0) {
  // ...
}

// Apply De Morgan's law and simplify
if (!a || b || (c && !d)) {
  // ...
}
```

---

## Severity Guidelines

**CRITICAL** - Code is unmaintainable:
- Functions > 200 lines
- Cyclomatic complexity > 20
- Nesting depth > 6 levels
- Duplicated logic in 5+ places

**HIGH** - Significant maintainability risk:
- Functions 50-200 lines
- Cyclomatic complexity 10-20
- Nesting depth 4-6 levels
- Complex boolean expressions (5+ conditions)
- Parameter lists > 5 parameters

**MEDIUM** - Moderate complexity concern:
- Functions 30-50 lines
- Cyclomatic complexity 5-10
- Magic numbers/strings
- Minor code duplication

**LOW** - Minor improvement opportunity:
- Could be more readable
- Naming could be clearer
- Comments would help

---

## Detection Patterns

Search for these patterns in code:

```bash
# Long functions (rough estimate)
grep -rn "function\|=>" --include="*.ts" | head -100

# Deep nesting (multiple indentation levels)
grep -rn "^        if\|^        for\|^        while" --include="*.ts"

# Magic numbers
grep -rn "[^a-zA-Z][0-9]{3,}[^a-zA-Z]" --include="*.ts" | grep -v "const\|enum\|type"

# Long parameter lists
grep -rn "function.*,.*,.*,.*,.*," --include="*.ts"

# Complex boolean expressions
grep -rn "&&.*&&.*&&\|||.*||.*||" --include="*.ts"

# Duplicated code (look for similar patterns)
grep -rn "if (!.*) return\|throw" --include="*.ts" | sort | uniq -c | sort -rn
```

---

## Complexity Metrics Reference

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Function length | < 30 lines | 30-50 lines | > 50 lines |
| Cyclomatic complexity | < 5 | 5-10 | > 10 |
| Nesting depth | < 3 | 3-4 | > 4 |
| Parameters | < 3 | 3-5 | > 5 |
| File length | < 300 lines | 300-500 lines | > 500 lines |

