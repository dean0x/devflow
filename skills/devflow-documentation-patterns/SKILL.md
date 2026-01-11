---
name: devflow-documentation-patterns
description: Documentation quality and code-documentation alignment. Load when reviewing code comments, API docs, READMEs, or checking for documentation drift. Used by Reviewer agent with documentation focus.
allowed-tools: Read, Grep, Glob
---

# Documentation Patterns

Domain expertise for documentation quality and alignment. Use alongside `devflow-review-methodology` for complete documentation reviews.

## Iron Law

> **DOCUMENTATION MUST MATCH REALITY**
>
> Outdated documentation is worse than no documentation. It actively misleads. Every code
> change that affects behavior requires a documentation check. Comments that explain "what"
> instead of "why" are noise. The best documentation is code that doesn't need documentation.

## Documentation Categories

### 1. Code Documentation Issues

**Missing Docstrings/JSDoc**
```typescript
// PROBLEM: Complex function without documentation
export function calculateProratedAmount(
  plan: Plan,
  startDate: Date,
  endDate: Date,
  previousPlan?: Plan
): number {
  // 50 lines of complex billing logic...
}

// SOLUTION: Document purpose, params, returns, edge cases
/**
 * Calculates prorated billing amount when switching plans mid-cycle.
 *
 * @param plan - The new plan to prorate to
 * @param startDate - When the new plan starts
 * @param endDate - End of current billing cycle
 * @param previousPlan - Optional previous plan for credit calculation
 * @returns Prorated amount in cents (can be negative for downgrades)
 *
 * @example
 * // Upgrading mid-month
 * calculateProratedAmount(premiumPlan, new Date('2024-01-15'), new Date('2024-01-31'))
 * // Returns: 1645 (cents)
 *
 * @throws {InvalidDateRangeError} If startDate is after endDate
 */
export function calculateProratedAmount(
  plan: Plan,
  startDate: Date,
  endDate: Date,
  previousPlan?: Plan
): number {
  // ...
}
```

**Outdated Comments**
```typescript
// PROBLEM: Comment doesn't match code
// Returns user's full name
function getDisplayName(user: User): string {
  return user.username;  // Actually returns username, not full name!
}

// PROBLEM: TODO that's been done
// TODO: Add validation
function processInput(input: string) {
  if (!isValid(input)) throw new Error('Invalid');  // Validation exists!
  // ...
}

// SOLUTION: Keep comments in sync or remove
function getDisplayName(user: User): string {
  return user.username;  // No misleading comment needed
}
```

**Comments Explaining "What" Instead of "Why"**
```typescript
// BAD: Describes what code does (obvious from code)
// Loop through users
for (const user of users) {
  // Check if user is active
  if (user.active) {
    // Add user to list
    activeUsers.push(user);
  }
}

// GOOD: Explains why
// Filter to active users only - inactive users should not receive
// promotional emails per GDPR consent requirements
const activeUsers = users.filter(u => u.active);
```

**Complex Code Without Explanation**
```typescript
// PROBLEM: Magic algorithm without explanation
function schedule(tasks: Task[]): Schedule {
  return tasks
    .sort((a, b) => (b.priority * b.urgency) / b.duration - (a.priority * a.urgency) / a.duration)
    .reduce((schedule, task) => {
      const slot = findSlot(schedule, task, task.deadline - task.duration * 1.5);
      return slot ? addToSchedule(schedule, task, slot) : schedule;
    }, emptySchedule());
}

// SOLUTION: Explain the algorithm
/**
 * Schedules tasks using weighted shortest job first (WSJF) algorithm.
 *
 * Priority score = (priority * urgency) / duration
 * Higher scores are scheduled first.
 *
 * Tasks are placed starting 1.5x their duration before deadline
 * to allow buffer for overruns.
 *
 * @see https://www.scaledagileframework.com/wsjf/
 */
function schedule(tasks: Task[]): Schedule {
  // ...
}
```

### 2. API Documentation Issues

**Missing Parameter Descriptions**
```typescript
// PROBLEM: Parameters unexplained
/**
 * Creates a new subscription.
 */
async function createSubscription(
  userId: string,
  planId: string,
  options?: SubscriptionOptions
): Promise<Subscription>;

// SOLUTION: Document all parameters
/**
 * Creates a new subscription for a user.
 *
 * @param userId - The unique identifier of the user
 * @param planId - The plan to subscribe to (from /plans endpoint)
 * @param options - Optional configuration
 * @param options.trialDays - Number of trial days (default: 0, max: 30)
 * @param options.couponCode - Discount coupon to apply
 * @param options.startDate - When to start (default: now)
 *
 * @returns The created subscription with payment details
 *
 * @throws {UserNotFoundError} If userId doesn't exist
 * @throws {PlanNotFoundError} If planId doesn't exist
 * @throws {InvalidCouponError} If coupon is expired or invalid
 */
async function createSubscription(
  userId: string,
  planId: string,
  options?: SubscriptionOptions
): Promise<Subscription>;
```

**Missing Return Value Documentation**
```typescript
// PROBLEM: Return shape unknown
/**
 * Fetches analytics data.
 */
async function getAnalytics(range: DateRange): Promise<Analytics>;

// SOLUTION: Document return structure
/**
 * Fetches aggregated analytics data for the date range.
 *
 * @param range - Start and end dates for the query
 * @returns Analytics data including:
 *   - totalVisitors: Unique visitor count
 *   - pageViews: Total page view count
 *   - bounceRate: Percentage (0-100) of single-page sessions
 *   - avgSessionDuration: Average session length in seconds
 *   - topPages: Array of {path, views} sorted by views desc
 */
async function getAnalytics(range: DateRange): Promise<Analytics>;
```

**Missing Error Documentation**
```typescript
// PROBLEM: Errors not documented
async function transferFunds(from: string, to: string, amount: number): Promise<void>;

// SOLUTION: Document possible errors
/**
 * Transfers funds between accounts.
 *
 * @throws {InsufficientFundsError} If source account balance < amount
 * @throws {AccountNotFoundError} If either account doesn't exist
 * @throws {AccountFrozenError} If either account is frozen
 * @throws {TransferLimitError} If amount exceeds daily transfer limit
 * @throws {SameAccountError} If from === to
 */
async function transferFunds(from: string, to: string, amount: number): Promise<void>;
```

### 3. Alignment Issues

**Code-Comment Drift**
```typescript
// BEFORE: Comment matches
// Retries up to 3 times with exponential backoff
async function fetchWithRetry(url: string) {
  for (let i = 0; i < 3; i++) { /* ... */ }
}

// AFTER: Code changed, comment didn't
// Retries up to 3 times with exponential backoff
async function fetchWithRetry(url: string) {
  for (let i = 0; i < 5; i++) { /* ... */ }  // Now 5 retries!
}

// SOLUTION: Update comment or extract constant
const MAX_RETRIES = 5;
// Retries up to MAX_RETRIES times with exponential backoff
async function fetchWithRetry(url: string) {
  for (let i = 0; i < MAX_RETRIES; i++) { /* ... */ }
}
```

**Stale README**
```markdown
<!-- PROBLEM: README doesn't reflect reality -->

## Installation
npm install mypackage

## Usage
const { oldFunction } = require('mypackage');
oldFunction(); // This function was removed!

<!-- SOLUTION: Keep README in sync -->

## Installation
npm install mypackage@^2.0.0

## Usage
import { newFunction } from 'mypackage';
await newFunction({ /* new options */ });

## Migration from v1
See [MIGRATION.md](./MIGRATION.md) for upgrade instructions.
```

**Missing Changelog Entries**
```markdown
<!-- PROBLEM: Breaking change not documented -->

## [2.0.0] - 2024-01-15
- Updated dependencies

<!-- SOLUTION: Document all changes -->

## [2.0.0] - 2024-01-15

### Breaking Changes
- `createUser()` now returns `Promise<Result<User>>` instead of `Promise<User>`
- Removed deprecated `oldFunction()` - use `newFunction()` instead
- Minimum Node.js version is now 18

### Added
- New `validateUser()` function for input validation

### Changed
- Improved error messages for authentication failures
```

---

## Severity Guidelines

**CRITICAL** - Actively misleading documentation:
- Comments that contradict code behavior
- API docs with wrong parameter types
- README with broken installation steps
- Changelog missing breaking changes

**HIGH** - Significant documentation gaps:
- Public APIs without documentation
- Complex algorithms unexplained
- Error conditions not documented
- Migration guides missing

**MEDIUM** - Moderate documentation issues:
- Some parameters undocumented
- Examples could be clearer
- Comments explain "what" not "why"

**LOW** - Minor improvements:
- Could add more examples
- Formatting inconsistencies
- Typos or grammar

---

## Detection Patterns

Search for these patterns in code:

```bash
# Functions without JSDoc
grep -rn "export function\|export async function" --include="*.ts" | \
  xargs -I {} sh -c 'grep -B1 "{}" | grep -v "/\*\*"'

# TODO comments (potential staleness)
grep -rn "TODO\|FIXME\|HACK\|XXX" --include="*.ts"

# Magic numbers (likely need comments)
grep -rn "[^a-zA-Z][0-9]{3,}[^a-zA-Z]" --include="*.ts" | grep -v "const\|enum"

# Outdated references (check for removed/renamed)
grep -rn "@see\|@link\|@deprecated" --include="*.ts"
```

---

## Documentation Checklist

Before approving changes:

- [ ] All public APIs have JSDoc/docstrings
- [ ] Parameters and return values documented
- [ ] Error conditions documented
- [ ] Complex algorithms explained
- [ ] Comments explain "why", not "what"
- [ ] README reflects current state
- [ ] CHANGELOG updated for notable changes
- [ ] No TODO comments for completed work
- [ ] Examples work with current API

