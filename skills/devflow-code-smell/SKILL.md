---
name: devflow-code-smell
description: Automatically detect anti-patterns, fake solutions, and workarounds when implementing functionality. Use when adding new features, reviewing code changes, or when suspicious patterns appear. Enforces honest, production-ready solutions.
allowed-tools: Read, Grep, Glob
---

# Code Smell Skill

## Iron Law

> **NO FAKE SOLUTIONS**
>
> Never hardcode data to simulate working functionality. If it doesn't work, it MUST
> either: (1) fail honestly with an error, or (2) be clearly labeled as MOCK/TEMPORARY.
> Pretending to work is deception. Deception compounds into production failures.

## Purpose

Detect and prevent anti-patterns that indicate fake solutions or workarounds:
1. **Hardcoded data** - Simulating functionality instead of implementing
2. **Missing labels** - Workarounds without clear documentation
3. **Fake solutions** - Code that pretends to work but doesn't
4. **Magic values** - Unexplained constants and configuration

## When This Skill Activates

Automatically triggers when:
- New functionality is being implemented
- Code changes are being made
- Mock data or test fixtures appear outside tests
- Comments suggesting temporary solutions
- Configuration or constants are added

## Critical Anti-Patterns

### 1. Hardcoded Data Detection (FAKE SOLUTIONS)

**CRITICAL**: Never hardcode responses to simulate working functionality.

```typescript
// ❌ VIOLATION: Fake solution pretending to work
async function getUserProfile(userId: string): Promise<UserProfile> {
  // HACK: Hardcoded response until API is ready
  return {
    id: userId,
    name: "John Doe",
    email: "john@example.com",
    avatar: "https://example.com/default.jpg"
  };
}

// ❌ VIOLATION: Mock data masquerading as real functionality
async function fetchRecommendations(userId: string): Promise<Product[]> {
  // TODO: Connect to recommendation engine
  return [
    { id: "1", name: "Product 1", price: 99.99 },
    { id: "2", name: "Product 2", price: 149.99 }
  ];
}

// ✅ CORRECT: Honest implementation or explicit mock
async function getUserProfile(userId: string): Promise<Result<UserProfile, Error>> {
  try {
    const response = await api.get(`/users/${userId}`);
    return { ok: true, value: response.data };
  } catch (error) {
    return { ok: false, error };
  }
}

// ✅ CORRECT: Clearly labeled mock for testing
// MOCK: For development only, not production-ready
async function getUserProfileMock(userId: string): Promise<UserProfile> {
  return {
    id: userId,
    name: "Test User",
    email: "test@example.com"
  };
}
```

**Detection patterns:**
- Hardcoded return objects in business functions
- Static arrays/objects returned from "fetch" functions
- Functions with only return statements (no actual logic)
- Comments like "TODO: implement" with fake data below
- Default values that look like real data

### 2. Missing Label Detection (UNDOCUMENTED WORKAROUNDS)

**CRITICAL**: All workarounds, hacks, and temporary solutions MUST be labeled.

```typescript
// ❌ VIOLATION: Workaround without label
function processPayment(amount: number): boolean {
  // Skip validation for now
  return true;
}

// ❌ VIOLATION: Temporary fix without documentation
async function syncData() {
  await sleep(1000); // Wait for previous operation
  await performSync();
}

// ❌ VIOLATION: Hack without explanation
function getUserPermissions(userId: string): string[] {
  if (userId === "admin") return ["*"]; // Give admin all permissions
  return ["read"];
}

// ✅ CORRECT: Clearly labeled workaround
function processPayment(amount: number): boolean {
  // TEMPORARY: Validation disabled until payment gateway integration complete
  // TODO: Add amount validation, currency checks, fraud detection
  // Target: Sprint 23 (2025-11-15)
  // Ticket: PAY-456
  return true;
}

// ✅ CORRECT: Documented hack with rationale
async function syncData() {
  // HACK: Sleep required due to race condition in legacy sync system
  // Root cause: Event system doesn't guarantee order
  // Proper fix: Implement event sequencing (3-week effort)
  // Acceptable: Race condition occurs <0.1% of operations
  await sleep(1000);
  await performSync();
}

// ✅ CORRECT: Explicit exception with justification
function getUserPermissions(userId: string): string[] {
  // ARCHITECTURE EXCEPTION: Hardcoded admin check
  // Justification: Permission system must work if database is down
  // Security review: Approved 2025-09-01 (ticket SEC-789)
  if (userId === "admin") return ["*"];
  return ["read"];
}
```

**Required labels:**
- `HACK:` - Workaround for specific problem
- `MOCK:` - Fake data for testing/development
- `TODO:` - Work that needs to be done
- `TEMPORARY:` - Short-term solution with deadline
- `NOT-PRODUCTION:` - Code that should never ship
- `ARCHITECTURE EXCEPTION:` - Violates pattern with justification

**Detection patterns:**
- Comments without required labels
- Suspicious code without documentation
- Empty catch blocks without explanation
- Early returns without rationale
- Magic numbers without explanation

### 3. Fake Functionality Detection (DECEPTIVE CODE)

**CRITICAL**: Code must actually work or be clearly marked as non-functional.

```typescript
// ❌ VIOLATION: Pretending to validate but doing nothing
function validateEmail(email: string): boolean {
  // Just accept anything for now
  return true;
}

// ❌ VIOLATION: Fake error handling
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  try {
    // TODO: Implement SMTP
    console.log(`Email sent to ${to}`);
  } catch (error) {
    // Ignore errors
  }
}

// ❌ VIOLATION: Simulated async operation
async function fetchData(url: string): Promise<any> {
  await new Promise(resolve => setTimeout(resolve, 100)); // Fake loading time
  return { success: true, data: [] }; // Fake response
}

// ✅ CORRECT: Honest unimplemented function
function validateEmail(email: string): Result<boolean, Error> {
  return {
    ok: false,
    error: new Error('NOT-IMPLEMENTED: Email validation pending regex pattern approval')
  };
}

// ✅ CORRECT: Real implementation or clear mock
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

**Detection patterns:**
- Functions that return `true` with no logic
- Empty try/catch blocks
- Console.log masquerading as functionality
- setTimeout used to simulate async operations
- Functions with only TODO comments inside

### 4. Magic Value Detection (UNEXPLAINED CONSTANTS)

**CRITICAL**: All magic values must be explained with constants or comments.

```typescript
// ❌ VIOLATION: Magic numbers
function calculateDiscount(price: number, userLevel: number): number {
  if (userLevel >= 5) {
    return price * 0.15;
  } else if (userLevel >= 3) {
    return price * 0.10;
  }
  return 0;
}

// ❌ VIOLATION: Magic strings
function getUserRole(userId: string): string {
  const user = getUser(userId);
  if (user.permissions.includes("admin_access")) {
    return "admin";
  }
  return "user";
}

// ❌ VIOLATION: Magic configuration
setTimeout(() => {
  retryOperation();
}, 5000);

// ✅ CORRECT: Named constants with documentation
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

// ✅ CORRECT: Explicit role constants
enum UserRole {
  ADMIN = "admin",
  USER = "user"
}

const PERMISSION_ROLE_MAP = {
  "admin_access": UserRole.ADMIN,
  "user_access": UserRole.USER
} as const;

// ✅ CORRECT: Configuration with rationale
const RETRY_CONFIG = {
  // Retry after 5 seconds to allow rate limit reset
  // Based on API documentation: 10 requests per minute
  DELAY_MS: 5000,
  MAX_ATTEMPTS: 3
} as const;
```

**Detection patterns:**
- Numeric literals in business logic (except 0, 1, -1)
- String literals compared in conditionals
- Unexplained timeouts or delays
- Array indices without explanation
- Percentage or ratio calculations without constants

## Code Smell Report Format

```markdown
🚨 CODE SMELLS DETECTED

## 🔴 CRITICAL - Fake Solution
**File**: src/services/user.ts:45
**Issue**: Hardcoded user data pretending to fetch from API
**Evidence**:
```typescript
async function getUserProfile(userId: string) {
  return { id: userId, name: "John Doe", email: "john@example.com" };
}
```
**Problem**: This code pretends to work but returns fake data
**Impact**: Will fail in production, misleads other developers
**Action**: Either implement real API call or label as MOCK

## 🔴 CRITICAL - Unlabeled Workaround
**File**: src/utils/sync.ts:23
**Issue**: Sleep statement without explanation
**Evidence**:
```typescript
await sleep(1000);
await performSync();
```
**Problem**: Workaround without documentation of why it's needed
**Required**: Add HACK: label explaining race condition
**Action**: Document the workaround or fix the root cause

## 🔴 CRITICAL - Deceptive Validation
**File**: src/validation/email.ts:12
**Issue**: Validation function that doesn't validate
**Evidence**:
```typescript
function validateEmail(email: string): boolean {
  return true; // Accept anything for now
}
```
**Problem**: Function name promises validation but does nothing
**Impact**: Security risk, data quality issues
**Action**: Implement validation or return NotImplementedError

## 🟡 HIGH - Magic Values
**File**: src/billing/discount.ts:34
**Issue**: Unexplained discount percentages
**Evidence**:
```typescript
if (userLevel >= 5) return price * 0.15;
```
**Problem**: Magic numbers without explanation
**Action**: Extract to named constants with documentation

## 📊 Summary
- **Critical**: 8 fake solutions detected
- **Critical**: 5 unlabeled workarounds
- **High**: 12 magic values
- **Files affected**: 9

## 🛑 HONESTY CHECK FAILED

This code violates the "NO FAKE SOLUTIONS" principle:
- Functions pretend to work but return hardcoded data
- Workarounds exist without clear documentation
- Magic values indicate rushed implementation

## ✅ Required Actions

1. **Label all workarounds** - Add HACK:/TEMPORARY:/MOCK: labels
2. **Remove fake solutions** - Implement real functionality or mark as NOT-PRODUCTION
3. **Document magic values** - Extract to named constants
4. **Be transparent** - If something doesn't work, say so clearly

## 🎯 Example Fix

Before:
```typescript
async function getRecommendations(userId: string) {
  return [{ id: "1", name: "Product 1" }];
}
```

After (honest):
```typescript
// MOCK: Recommendations service not yet implemented
// TODO: Integrate with ML recommendation engine (ticket: REC-123)
// Target: Sprint 25
// NOT-PRODUCTION: This will fail in production
async function getRecommendationsMock(userId: string): Promise<Product[]> {
  return [
    { id: "1", name: "Mock Product 1", price: 99.99 }
  ];
}

// Proper implementation
async function getRecommendations(userId: string): Promise<Result<Product[], Error>> {
  return {
    ok: false,
    error: new Error('NOT-IMPLEMENTED: Awaiting ML service deployment')
  };
}
```
```

## Integration with Quality Gates

This skill prevents:
- Merging fake functionality to main branch
- Deploying unlabeled workarounds to production
- Shipping code that pretends to work
- Accumulating technical debt without documentation

## Red Flags - Immediate Stop

Stop immediately if you detect:
- Multiple fake solutions in same PR
- Production code with MOCK: labels
- Security-critical functions returning true without logic
- Database operations with hardcoded responses
- API clients returning static data

## Success Criteria

Code passes smell check when:
- ✅ No hardcoded return data in business logic
- ✅ All workarounds have required labels
- ✅ All fake/mock code clearly marked
- ✅ Magic values extracted to named constants
- ✅ Comments include rationale and timeline
- ✅ Functions do what their names promise

## Philosophy Enforcement

This skill enforces the core principle:

**"NO FAKE SOLUTIONS - Never hardcode responses or data to simulate working functionality"**

Code must either:
1. Work correctly (real implementation)
2. Fail honestly (return error explaining what's missing)
3. Be clearly labeled (MOCK:, TEMPORARY:, NOT-PRODUCTION:)

No middle ground. No deception.
