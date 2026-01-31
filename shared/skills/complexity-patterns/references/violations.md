# Complexity Violation Examples

Extended examples of complexity issues to detect during code review.

---

## Deep Nesting Violations

### Multi-level Conditional Nesting

```typescript
// VIOLATION: 5+ levels of nesting
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
```

### Nested Try-Catch Blocks

```typescript
// VIOLATION: Exception handling adds nesting
async function fetchAndProcess(url: string) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      try {
        const data = await response.json();
        if (data.items) {
          for (const item of data.items) {
            try {
              await processItem(item);
            } catch (itemError) {
              // Nested error handling
            }
          }
        }
      } catch (parseError) {
        // More nesting
      }
    }
  } catch (fetchError) {
    // Top-level catch
  }
}
```

---

## Long Function Violations

### Monolithic Handler

```typescript
// VIOLATION: Function does too many things (150+ lines typical)
function handleCheckout(cart: Cart, user: User) {
  // Lines 1-30: Validate cart
  // Lines 31-50: Check inventory
  // Lines 51-80: Calculate pricing
  // Lines 81-100: Apply discounts
  // Lines 101-120: Process payment
  // Lines 121-140: Update inventory
  // Lines 141-150: Send notifications
}
```

### God Function Pattern

```typescript
// VIOLATION: Single function handles entire feature
async function userRegistrationFlow(formData: FormData) {
  // Validation
  // Sanitization
  // Duplicate check
  // Password hashing
  // Database insert
  // Email verification
  // Welcome email
  // Analytics tracking
  // Session creation
  // Redirect logic
  // ... 200+ lines
}
```

---

## High Cyclomatic Complexity Violations

### Decision Tree Anti-Pattern

```typescript
// VIOLATION: Too many decision paths (cyclomatic complexity > 10)
function categorize(item: Item): string {
  if (item.type === 'A') {
    if (item.size > 10) {
      if (item.color === 'red') return 'A-large-red';
      else if (item.color === 'blue') return 'A-large-blue';
      else return 'A-large-other';
    } else {
      if (item.color === 'red') return 'A-small-red';
      else if (item.color === 'blue') return 'A-small-blue';
      else return 'A-small-other';
    }
  } else if (item.type === 'B') {
    if (item.size > 10) {
      if (item.color === 'red') return 'B-large-red';
      // ... another tree of conditions
    }
  }
  // Pattern continues for types C, D, E...
}
```

### Switch Statement Explosion

```typescript
// VIOLATION: Giant switch with embedded logic
function handleEvent(event: Event) {
  switch (event.type) {
    case 'USER_CREATED':
      // 20 lines of logic
      break;
    case 'USER_UPDATED':
      // 25 lines of logic
      break;
    case 'USER_DELETED':
      // 15 lines of logic
      break;
    // 20 more cases, each with substantial logic
  }
}
```

---

## Magic Number/String Violations

### Unexplained Literals

```typescript
// VIOLATION: Numbers without context
if (status === 3) {
  setTimeout(callback, 86400000);
  retry(5);
}

// VIOLATION: String literals scattered in code
if (user.role === 'admin' || user.role === 'superuser') {
  if (document.status === 'pending_review') {
    // ...
  }
}
```

### Hardcoded Configuration

```typescript
// VIOLATION: Magic values in business logic
function calculateShipping(weight: number, distance: number) {
  if (weight > 50) return 29.99;
  if (distance > 500) return 19.99;
  if (weight * distance > 10000) return 24.99;
  return 9.99;
}
```

---

## Complex Expression Violations

### Chained Operations

```typescript
// VIOLATION: Hard to parse mentally
const result = data.filter(x => x.active && x.type === 'premium')
  .map(x => ({ ...x, score: x.points * (x.bonus ? 1.5 : 1) / x.level }))
  .sort((a, b) => b.score - a.score)[0]?.score || 0;
```

### Dense Ternary Chains

```typescript
// VIOLATION: Nested ternaries
const status = isAdmin ? 'admin' : isModerator ? 'moderator' : isVerified ? 'verified' : isPending ? 'pending' : 'guest';

const price = quantity > 100 ? basePrice * 0.8 : quantity > 50 ? basePrice * 0.9 : quantity > 10 ? basePrice * 0.95 : basePrice;
```

---

## Unclear Naming Violations

### Cryptic Variable Names

```typescript
// VIOLATION: Single-letter or abbreviated names
const d = new Date();
const t = d.getTime();
const r = items.filter(i => i.t > t - 86400000);
const x = r.reduce((a, b) => a + b.p, 0);
```

### Misleading Names

```typescript
// VIOLATION: Names don't match behavior
function getData() {
  // Actually deletes data before returning
}

const userList = fetchUser(); // Returns single user, not list
```

---

## Code Duplication Violations

### Repeated Validation Logic

```typescript
// VIOLATION: Same logic repeated
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

// Similar pattern in 10+ more places
```

### Copy-Paste API Handlers

```typescript
// VIOLATION: Nearly identical handlers
app.get('/users/:id', async (req, res) => {
  try {
    const user = await db.users.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/orders/:id', async (req, res) => {
  try {
    const order = await db.orders.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});
// Repeated for every resource...
```

---

## Long Parameter List Violations

### Function Signature Overload

```typescript
// VIOLATION: Too many parameters
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
```

### Boolean Parameter Explosion

```typescript
// VIOLATION: Multiple booleans (unclear at call site)
function formatDocument(
  doc: Document,
  includeHeader: boolean,
  includeFooter: boolean,
  useColor: boolean,
  landscape: boolean,
  doubleSided: boolean
) {
  // ...
}

// Call site is cryptic:
formatDocument(doc, true, false, true, false, true);
```

---

## Boolean Complexity Violations

### Complex Boolean Expressions

```typescript
// VIOLATION: Hard to understand
if (user.active && !user.deleted && (user.role === 'admin' || user.role === 'moderator') && user.verified && (!user.suspended || user.suspendedUntil < Date.now())) {
  // ...
}
```

### Negation Overuse

```typescript
// VIOLATION: Double/triple negatives
if (!user.isNotActive && !items.isEmpty()) {
  // ...
}

if (!(a && !b) || !(!c || d)) {
  // ...
}
```

---

## Shotgun Surgery Indicators

### Change Requires Many Files

```typescript
// VIOLATION: To add a new user type, you must modify:
// - UserType enum
// - UserFactory
// - UserValidator
// - UserSerializer
// - UserRepository
// - UserController
// - user.routes.ts
// - 5 more files...

// Each file has a switch or if-else chain checking user type
```
