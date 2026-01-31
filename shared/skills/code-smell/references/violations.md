# Code Smell Violations Reference

Extended examples for each anti-pattern category. For core detection patterns, see [SKILL.md](../SKILL.md).

---

## 1. Hardcoded Data (FAKE SOLUTIONS) - Extended Examples

### Violation: Mock data masquerading as real functionality

```typescript
async function fetchRecommendations(userId: string): Promise<Product[]> {
  // TODO: Connect to recommendation engine
  return [
    { id: "1", name: "Product 1", price: 99.99 },
    { id: "2", name: "Product 2", price: 149.99 }
  ];
}
```

**Problem**: Returns static data instead of fetching from actual recommendation service.

### Correct: Honest implementation with Result type

```typescript
async function getUserProfile(userId: string): Promise<Result<UserProfile, Error>> {
  try {
    const response = await api.get(`/users/${userId}`);
    return { ok: true, value: response.data };
  } catch (error) {
    return { ok: false, error };
  }
}
```

### Correct: Clearly labeled mock for testing

```typescript
// MOCK: For development only, not production-ready
async function getUserProfileMock(userId: string): Promise<UserProfile> {
  return {
    id: userId,
    name: "Test User",
    email: "test@example.com"
  };
}
```

---

## 2. Missing Labels (UNDOCUMENTED WORKAROUNDS) - Extended Examples

### Violation: Temporary fix without documentation

```typescript
async function syncData() {
  await sleep(1000); // Wait for previous operation
  await performSync();
}
```

### Violation: Hack without explanation

```typescript
function getUserPermissions(userId: string): string[] {
  if (userId === "admin") return ["*"]; // Give admin all permissions
  return ["read"];
}
```

### Correct: Clearly labeled workaround

```typescript
function processPayment(amount: number): boolean {
  // TEMPORARY: Validation disabled until payment gateway integration complete
  // TODO: Add amount validation, currency checks, fraud detection
  // Target: Sprint 23 (2025-11-15)
  // Ticket: PAY-456
  return true;
}
```

### Correct: Documented hack with rationale

```typescript
async function syncData() {
  // HACK: Sleep required due to race condition in legacy sync system
  // Root cause: Event system doesn't guarantee order
  // Proper fix: Implement event sequencing (3-week effort)
  // Acceptable: Race condition occurs <0.1% of operations
  await sleep(1000);
  await performSync();
}
```

### Correct: Explicit exception with justification

```typescript
function getUserPermissions(userId: string): string[] {
  // ARCHITECTURE EXCEPTION: Hardcoded admin check
  // Justification: Permission system must work if database is down
  // Security review: Approved 2025-09-01 (ticket SEC-789)
  if (userId === "admin") return ["*"];
  return ["read"];
}
```

---

## 3. Fake Functionality (DECEPTIVE CODE) - Extended Examples

### Violation: Fake error handling

```typescript
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  try {
    // TODO: Implement SMTP
    console.log(`Email sent to ${to}`);
  } catch (error) {
    // Ignore errors
  }
}
```

### Violation: Simulated async operation

```typescript
async function fetchData(url: string): Promise<any> {
  await new Promise(resolve => setTimeout(resolve, 100)); // Fake loading time
  return { success: true, data: [] }; // Fake response
}
```

### Correct: Honest unimplemented function

```typescript
function validateEmail(email: string): Result<boolean, Error> {
  return {
    ok: false,
    error: new Error('NOT-IMPLEMENTED: Email validation pending regex pattern approval')
  };
}
```

### Correct: Real implementation or clear mock

```typescript
// MOCK: Email service for development (replace before production)
async function sendEmailMock(to: string, subject: string, body: string): Promise<Result<void, Error>> {
  console.log(`[MOCK EMAIL] To: ${to}, Subject: ${subject}`);
  return { ok: true, value: undefined };
}

// Real implementation
async function sendEmailReal(to: string, subject: string, body: string): Promise<Result<void, Error>> {
  try {
    await smtpClient.send({ to, subject, body });
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
```

---

## 4. Magic Values (UNEXPLAINED CONSTANTS) - Extended Examples

### Violation: Magic strings

```typescript
function getUserRole(userId: string): string {
  const user = getUser(userId);
  if (user.permissions.includes("admin_access")) {
    return "admin";
  }
  return "user";
}
```

### Violation: Magic configuration

```typescript
setTimeout(() => {
  retryOperation();
}, 5000);
```

### Correct: Named constants with documentation

```typescript
const USER_LEVEL_THRESHOLD = {
  PREMIUM: 5,      // Premium tier: $50/month subscribers
  STANDARD: 3,     // Standard tier: $20/month subscribers
  FREE: 0          // Free tier
} as const;

const DISCOUNT_RATE = {
  PREMIUM: 0.15,   // 15% discount for premium users
  STANDARD: 0.10,  // 10% discount for standard users
  NONE: 0
} as const;

function calculateDiscount(price: number, userLevel: number): number {
  if (userLevel >= USER_LEVEL_THRESHOLD.PREMIUM) {
    return price * DISCOUNT_RATE.PREMIUM;
  } else if (userLevel >= USER_LEVEL_THRESHOLD.STANDARD) {
    return price * DISCOUNT_RATE.STANDARD;
  }
  return DISCOUNT_RATE.NONE;
}
```

### Correct: Explicit role constants

```typescript
enum UserRole {
  ADMIN = "admin",
  USER = "user"
}

const PERMISSION_ROLE_MAP = {
  "admin_access": UserRole.ADMIN,
  "user_access": UserRole.USER
} as const;
```

### Correct: Configuration with rationale

```typescript
const RETRY_CONFIG = {
  // Retry after 5 seconds to allow rate limit reset
  // Based on API documentation: 10 requests per minute
  DELAY_MS: 5000,
  MAX_ATTEMPTS: 3
} as const;
```
