# Correct Documentation Patterns

Extended examples of proper documentation. See parent `SKILL.md` for brief examples and severity guidelines.

---

## Code Documentation Patterns

### Proper JSDoc for Complex Functions

```typescript
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

**Key elements**: Purpose, all params, return type with units, example usage, error conditions.

### Comments That Explain "Why"

```typescript
// Filter to active users only - inactive users should not receive
// promotional emails per GDPR consent requirements
const activeUsers = users.filter(u => u.active);
```

**Key elements**: Business reason (GDPR), not mechanical description.

### Algorithm Documentation

```typescript
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

**Key elements**: Algorithm name, formula explanation, rationale for magic numbers, external reference.

---

## API Documentation Patterns

### Complete Parameter Documentation

```typescript
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

**Key elements**: All params including nested options, defaults, constraints, all error types.

### Return Value Documentation

```typescript
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

**Key elements**: Shape of return object, units (percentage, seconds), sorting order.

### Error Documentation

```typescript
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

**Key elements**: All possible error types with conditions that trigger them.

---

## Alignment Patterns

### Constants Instead of Magic Numbers

```typescript
const MAX_RETRIES = 5;

// Retries up to MAX_RETRIES times with exponential backoff
async function fetchWithRetry(url: string) {
  for (let i = 0; i < MAX_RETRIES; i++) { /* ... */ }
}
```

**Key elements**: Named constant keeps comment and code in sync automatically.

### Up-to-Date README

```markdown
## Installation
npm install mypackage@^2.0.0

## Usage
import { newFunction } from 'mypackage';
await newFunction({ /* new options */ });

## Migration from v1
See [MIGRATION.md](./MIGRATION.md) for upgrade instructions.
```

**Key elements**: Correct version, working examples, migration guidance.

### Proper Changelog

```markdown
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

**Key elements**: Breaking changes highlighted first, migration hints, categorized changes.
