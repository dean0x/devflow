# Documentation Violation Examples

Extended examples of documentation anti-patterns. See parent `SKILL.md` for brief examples and severity guidelines.

---

## Code Documentation Violations

### Missing Docstrings/JSDoc

```typescript
// VIOLATION: Complex function without documentation
export function calculateProratedAmount(
  plan: Plan,
  startDate: Date,
  endDate: Date,
  previousPlan?: Plan
): number {
  // 50 lines of complex billing logic...
}
```

**Why it's a problem**: Complex billing logic with edge cases (negative amounts for downgrades, credit calculations) is impossible to use correctly without documentation.

### Outdated Comments

```typescript
// VIOLATION: Comment doesn't match code
// Returns user's full name
function getDisplayName(user: User): string {
  return user.username;  // Actually returns username, not full name!
}

// VIOLATION: TODO that's been done
// TODO: Add validation
function processInput(input: string) {
  if (!isValid(input)) throw new Error('Invalid');  // Validation exists!
  // ...
}
```

**Why it's a problem**: Misleading comments cause bugs when developers trust them over reading the code.

### Comments Explaining "What" Instead of "Why"

```typescript
// VIOLATION: Describes what code does (obvious from code)
// Loop through users
for (const user of users) {
  // Check if user is active
  if (user.active) {
    // Add user to list
    activeUsers.push(user);
  }
}
```

**Why it's a problem**: These comments add noise without value. The code already says what it does.

### Complex Code Without Explanation

```typescript
// VIOLATION: Magic algorithm without explanation
function schedule(tasks: Task[]): Schedule {
  return tasks
    .sort((a, b) => (b.priority * b.urgency) / b.duration - (a.priority * a.urgency) / a.duration)
    .reduce((schedule, task) => {
      const slot = findSlot(schedule, task, task.deadline - task.duration * 1.5);
      return slot ? addToSchedule(schedule, task, slot) : schedule;
    }, emptySchedule());
}
```

**Why it's a problem**: The WSJF algorithm and 1.5x buffer are non-obvious. Future maintainers will be confused or afraid to modify.

---

## API Documentation Violations

### Missing Parameter Descriptions

```typescript
// VIOLATION: Parameters unexplained
/**
 * Creates a new subscription.
 */
async function createSubscription(
  userId: string,
  planId: string,
  options?: SubscriptionOptions
): Promise<Subscription>;
```

**Why it's a problem**: Callers don't know valid values for `planId`, what `options` are available, or constraints on parameters.

### Missing Return Value Documentation

```typescript
// VIOLATION: Return shape unknown
/**
 * Fetches analytics data.
 */
async function getAnalytics(range: DateRange): Promise<Analytics>;
```

**Why it's a problem**: Consumers must read implementation to understand the shape of `Analytics`.

### Missing Error Documentation

```typescript
// VIOLATION: Errors not documented
async function transferFunds(from: string, to: string, amount: number): Promise<void>;
```

**Why it's a problem**: Callers don't know what errors to catch or handle. They'll either catch everything or miss important cases.

---

## Alignment Violations

### Code-Comment Drift

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
```

**Why it's a problem**: Developers relying on the comment will expect different behavior than actual.

### Stale README

```markdown
<!-- VIOLATION: README doesn't reflect reality -->

## Installation
npm install mypackage

## Usage
const { oldFunction } = require('mypackage');
oldFunction(); // This function was removed!
```

**Why it's a problem**: New users follow outdated instructions and immediately hit errors.

### Missing Changelog Entries

```markdown
<!-- VIOLATION: Breaking change not documented -->

## [2.0.0] - 2024-01-15
- Updated dependencies
```

**Why it's a problem**: Users upgrading have no warning about breaking changes and no migration path.
