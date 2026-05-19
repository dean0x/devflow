# TypeScript Best Practices and Coding Guidelines

## Table of Contents
1. [Code Quality & Maintainability](#1-code-quality--maintainability)
2. [Functional Programming](#2-functional-programming-in-typescript)
3. [Architecture Patterns](#3-architecture-patterns)
4. [Advanced TypeScript Features](#4-advanced-typescript-features)
5. [Testing & Quality Assurance](#5-testing--quality-assurance)
6. [Performance Considerations](#6-performance-considerations)

## 1. Code Quality & Maintainability

### Type Safety Best Practices

#### Enable Strict Mode Configuration
```typescript
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitReturns": true,
    "noImplicitThis": true,
    "noUncheckedIndexedAccess": true
  }
}
```

#### Avoid `any` - Use Better Alternatives
```typescript
// ❌ Bad
function processData(data: any): any {
  return data.someProperty;
}

// ✅ Good - Use unknown for safer handling
function processData(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'someProperty' in data) {
    return String((data as { someProperty: unknown }).someProperty);
  }
  throw new Error('Invalid data structure');
}

// ✅ Good - Use generics for reusable type-safe functions
function processTypedData<T extends { someProperty: string }>(data: T): string {
  return data.someProperty;
}
```

### Naming Conventions

```typescript
// Types and interfaces - PascalCase
interface UserProfile {
  readonly id: UserId;
  readonly email: EmailAddress;
  readonly createdAt: DateTime;
}

// Constants - SCREAMING_SNAKE_CASE
const MAX_RETRY_ATTEMPTS = 3;
const API_ENDPOINTS = {
  USERS: '/api/users',
  ORDERS: '/api/orders'
} as const;

// Functions and variables - camelCase
const calculateUserScore = (profile: UserProfile): Score => {
  // Implementation
};

// Enums - PascalCase with descriptive prefix
enum UserAccountStatus {
  Active = 'ACTIVE',
  Suspended = 'SUSPENDED',
  Deleted = 'DELETED'
}
```

### Error Handling Patterns

#### Result Pattern for Explicit Error Handling
```typescript
type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

class UserService {
  async createUser(userData: CreateUserRequest): Promise<Result<User, ValidationError | DatabaseError>> {
    const validationResult = this.validateUserData(userData);
    if (!validationResult.success) {
      return { success: false, error: validationResult.error };
    }

    try {
      const user = await this.userRepository.create(validationResult.value);
      return { success: true, value: user };
    } catch (error) {
      return { success: false, error: new DatabaseError('Failed to create user', error) };
    }
  }
}

// Usage with explicit error handling
const result = await userService.createUser(userData);
if (result.success) {
  console.log('User created:', result.value.id);
} else {
  console.error('Failed to create user:', result.error.message);
}
```

### Code Documentation Standards

```typescript
/**
 * Calculates the compound interest for an investment.
 *
 * @param principal - The initial amount invested
 * @param rate - The annual interest rate (as a decimal)
 * @param time - The number of years
 * @param compoundingFrequency - How many times per year interest is compounded
 * @returns The final amount after compound interest
 * @throws {ValidationError} When any parameter is negative or invalid
 *
 * @example
 * ```typescript
 * const finalAmount = calculateCompoundInterest(1000, 0.05, 10, 4);
 * console.log(finalAmount); // 1643.62
 * ```
 */
function calculateCompoundInterest(
  principal: number,
  rate: number,
  time: number,
  compoundingFrequency: number
): number {
  // Implementation
}
```

## 2. Functional Programming in TypeScript

### Immutability Patterns

#### Deep Readonly Types
```typescript
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

interface User {
  id: string;
  profile: {
    name: string;
    preferences: {
      theme: 'light' | 'dark';
      notifications: boolean;
    };
  };
}

type ImmutableUser = DeepReadonly<User>;

// Immutable update patterns
const updateUserTheme = (user: ImmutableUser, theme: 'light' | 'dark'): ImmutableUser => ({
  ...user,
  profile: {
    ...user.profile,
    preferences: {
      ...user.profile.preferences,
      theme
    }
  }
});
```

#### Immutable Array Operations
```typescript
const numbers: readonly number[] = [1, 2, 3, 4, 5];

const addNumber = (arr: readonly number[], num: number): readonly number[] =>
  [...arr, num];

const removeNumber = (arr: readonly number[], index: number): readonly number[] =>
  arr.filter((_, i) => i !== index);

const updateNumber = (arr: readonly number[], index: number, newValue: number): readonly number[] =>
  arr.map((value, i) => i === index ? newValue : value);
```

### Pure Functions and Side Effect Management

```typescript
// ✅ Pure function - same input, same output, no side effects
const calculateTotalPrice = (items: readonly Item[], taxRate: number): number =>
  items.reduce((total, item) => total + item.price, 0) * (1 + taxRate);

// Separating pure and impure code
const calculateOrderTotal = (
  items: readonly OrderItem[],
  discounts: readonly Discount[],
  taxRate: number
): OrderTotal => {
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discountAmount = discounts.reduce((sum, discount) => sum + discount.amount, 0);
  const taxAmount = (subtotal - discountAmount) * taxRate;

  return {
    subtotal,
    discountAmount,
    taxAmount,
    total: subtotal - discountAmount + taxAmount
  };
};

// Impure wrapper that handles I/O
const processOrder = async (orderId: OrderId): Promise<Result<OrderTotal, Error>> => {
  try {
    const order = await orderRepository.findById(orderId);
    const discounts = await discountService.getActiveDiscounts();
    const taxRate = await taxService.getTaxRate(order.shippingAddress);

    const orderTotal = calculateOrderTotal(order.items, discounts, taxRate);

    return { success: true, value: orderTotal };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};
```

### Function Composition and Pipelines

```typescript
const pipe = <T>(value: T, ...fns: Array<(arg: T) => T>): T =>
  fns.reduce((acc, fn) => fn(acc), value);

const processUserInput = (input: string): string =>
  pipe(
    input,
    (s) => s.trim(),
    (s) => s.toLowerCase(),
    (s) => s.replace(/[^a-z0-9]/g, ''),
    (s) => s.substring(0, 20)
  );
```

### Higher-Order Functions and Currying

```typescript
// Curried function for filtering
const filterBy = <T>(predicate: (item: T) => boolean) => (array: readonly T[]): readonly T[] =>
  array.filter(predicate);

const filterActiveUsers = filterBy<User>(user => user.status === 'active');
const filterExpensiveItems = filterBy<Item>(item => item.price > 100);

// Curried function for mapping
const mapWith = <T, U>(mapper: (item: T) => U) => (array: readonly T[]): readonly U[] =>
  array.map(mapper);

const extractUserNames = mapWith<User, string>(user => user.name);
const calculateItemTotals = mapWith<Item, number>(item => item.price * item.quantity);
```

### Functional Error Handling

```typescript
// Either type for railway-oriented programming
type Either<E, A> = Left<E> | Right<A>;
type Left<E> = { _tag: 'Left'; left: E };
type Right<A> = { _tag: 'Right'; right: A };

const left = <E>(e: E): Left<E> => ({ _tag: 'Left', left: e });
const right = <A>(a: A): Right<A> => ({ _tag: 'Right', right: a });

const map = <E, A, B>(fa: Either<E, A>, f: (a: A) => B): Either<E, B> =>
  fa._tag === 'Left' ? fa : right(f(fa.right));

const flatMap = <E, A, B>(fa: Either<E, A>, f: (a: A) => Either<E, B>): Either<E, B> =>
  fa._tag === 'Left' ? fa : f(fa.right);
```

## 3. Architecture Patterns

### Hexagonal/Clean Architecture

```typescript
// Domain layer - Core business logic
interface User {
  readonly id: UserId;
  readonly email: Email;
  readonly hashedPassword: HashedPassword;
  readonly createdAt: DateTime;
}

// Ports (interfaces) - Define contracts
interface UserRepository {
  findById(id: UserId): Promise<Result<User, NotFoundError>>;
  findByEmail(email: Email): Promise<Result<User, NotFoundError>>;
  save(user: User): Promise<Result<User, DatabaseError>>;
}

interface PasswordHasher {
  hash(password: string): Promise<HashedPassword>;
  verify(password: string, hash: HashedPassword): Promise<boolean>;
}

// Use Cases - Application layer
class RegisterUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly userIdGenerator: () => UserId
  ) {}

  async execute(request: RegisterUserRequest): Promise<Result<User, RegisterUserError>> {
    const existingUser = await this.userRepository.findByEmail(request.email);
    if (existingUser.success) {
      return { success: false, error: new UserAlreadyExistsError() };
    }

    const hashedPassword = await this.passwordHasher.hash(request.password);

    const user: User = {
      id: this.userIdGenerator(),
      email: request.email,
      hashedPassword,
      createdAt: new DateTime()
    };

    return this.userRepository.save(user);
  }
}

// Adapters - Infrastructure layer
class SqlUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findById(id: UserId): Promise<Result<User, NotFoundError>> {
    try {
      const row = await this.db.query('SELECT * FROM users WHERE id = ?', [id.value]);
      if (!row) {
        return { success: false, error: new NotFoundError('User not found') };
      }
      return { success: true, value: this.mapRowToUser(row) };
    } catch (error) {
      return { success: false, error: new DatabaseError('Query failed', error) };
    }
  }
}
```

### Dependency Injection Patterns

```typescript
interface EmailService {
  sendWelcomeEmail(user: User): Promise<void>;
}

interface AuditLogger {
  logUserAction(userId: UserId, action: string): Promise<void>;
}

class UserManagementService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService,
    private readonly auditLogger: AuditLogger
  ) {}

  async activateUser(userId: UserId): Promise<Result<void, Error>> {
    const userResult = await this.userRepository.findById(userId);
    if (!userResult.success) {
      return userResult;
    }

    const activatedUser = { ...userResult.value, status: 'active' as const };
    const saveResult = await this.userRepository.save(activatedUser);

    if (saveResult.success) {
      await this.emailService.sendWelcomeEmail(activatedUser);
      await this.auditLogger.logUserAction(userId, 'USER_ACTIVATED');
    }

    return saveResult.success
      ? { success: true, value: undefined }
      : saveResult;
  }
}
```

### SOLID Principles

#### Single Responsibility Principle
```typescript
// ✅ Good - Single responsibilities
class UserValidator {
  validate(user: User): Result<User, ValidationError> {
    // Only validation logic
  }
}

class UserRepository {
  save(user: User): Promise<Result<User, DatabaseError>> {
    // Only persistence logic
  }
}

class WelcomeEmailService {
  send(user: User): Promise<Result<void, EmailError>> {
    // Only email sending logic
  }
}
```

#### Dependency Inversion Principle
```typescript
// ✅ Good - Depend on abstractions, not concretions
interface PaymentProcessor {
  processPayment(amount: Money, method: PaymentMethod): Promise<Result<PaymentResult, PaymentError>>;
}

class OrderService {
  constructor(private readonly paymentProcessor: PaymentProcessor) {}

  async completeOrder(order: Order): Promise<Result<CompletedOrder, OrderError>> {
    const paymentResult = await this.paymentProcessor.processPayment(
      order.total,
      order.paymentMethod
    );

    if (!paymentResult.success) {
      return { success: false, error: new OrderError('Payment failed', paymentResult.error) };
    }

    // Complete order logic...
  }
}
```

## 4. Advanced TypeScript Features

### Discriminated Unions and Exhaustive Checking

```typescript
type OrderState =
  | { status: 'pending'; submittedAt: Date }
  | { status: 'processing'; assignedTo: string; startedAt: Date }
  | { status: 'shipped'; trackingNumber: string; shippedAt: Date }
  | { status: 'delivered'; deliveredAt: Date; signedBy: string }
  | { status: 'cancelled'; reason: string; cancelledAt: Date };

const getOrderStatusMessage = (orderState: OrderState): string => {
  switch (orderState.status) {
    case 'pending':
      return `Order submitted on ${orderState.submittedAt.toLocaleDateString()}`;
    case 'processing':
      return `Being processed by ${orderState.assignedTo}`;
    case 'shipped':
      return `Tracking: ${orderState.trackingNumber}`;
    case 'delivered':
      return `Delivered to ${orderState.signedBy}`;
    case 'cancelled':
      return `Cancelled: ${orderState.reason}`;
    default:
      const _exhaustive: never = orderState;
      throw new Error(`Unhandled order state: ${JSON.stringify(_exhaustive)}`);
  }
};
```

### Template Literal Types

```typescript
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type ApiVersion = 'v1' | 'v2';
type Resource = 'users' | 'orders' | 'products';

type ApiRoute<V extends ApiVersion, R extends Resource> = `/api/${V}/${R}`;
type ApiRouteWithId<V extends ApiVersion, R extends Resource> = `/api/${V}/${R}/${string}`;

type ApiEndpoints = {
  [V in ApiVersion]: {
    [R in Resource]: {
      list: ApiRoute<V, R>;
      create: ApiRoute<V, R>;
      get: ApiRouteWithId<V, R>;
      update: ApiRouteWithId<V, R>;
      delete: ApiRouteWithId<V, R>;
    };
  };
};
```

### Branded Types for Domain Modeling

```typescript
type Brand<T, B> = T & { __brand: B };

type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;
type Email = Brand<string, 'Email'>;
type PositiveNumber = Brand<number, 'PositiveNumber'>;

const UserId = (id: string): UserId => {
  if (!id || id.length === 0) {
    throw new Error('Invalid UserId');
  }
  return id as UserId;
};

const Email = (email: string): Email => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid email format');
  }
  return email as Email;
};

// Prevents mixing up different types of IDs
const getUserOrders = (userId: UserId): Promise<OrderId[]> => {
  // Implementation
};

const userId = UserId('user-123');
const orderId = OrderId('order-456');

getUserOrders(userId); // ✅ Correct
// getUserOrders(orderId); // ❌ TypeScript error
```

### Conditional Types

```typescript
// Extract promise values
type Awaited<T> = T extends Promise<infer U> ? U : T;

// Deep partial type
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Conditional type for API responses
type ApiResponse<T> = T extends { success: true }
  ? { data: T; status: 'success' }
  : { error: string; status: 'error' };
```

## 5. Testing & Quality Assurance

### Test-Driven Development

```typescript
describe('UserService', () => {
  describe('registerUser', () => {
    it('should create a new user with valid data', async () => {
      // Arrange
      const userData: CreateUserRequest = {
        email: 'test@example.com',
        password: 'securePassword123',
        firstName: 'John',
        lastName: 'Doe'
      };

      const mockUserRepository = {
        findByEmail: jest.fn().mockResolvedValue({ success: false, error: new NotFoundError() }),
        save: jest.fn().mockResolvedValue({ success: true, value: expect.any(Object) })
      };

      const userService = new UserService(mockUserRepository);

      // Act
      const result = await userService.registerUser(userData);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.email).toBe(userData.email);
        expect(result.value.id).toBeDefined();
      }
    });
  });
});
```

### Property-Based Testing

```typescript
import fc from 'fast-check';

describe('StringUtils', () => {
  describe('reverse', () => {
    it('should satisfy: reverse(reverse(s)) === s', () => {
      fc.assert(
        fc.property(fc.string(), (s) => {
          expect(reverse(reverse(s))).toBe(s);
        })
      );
    });
  });
});

// Domain-specific generators
const userGenerator = fc.record({
  id: fc.string({ minLength: 1, maxLength: 50 }),
  email: fc.emailAddress(),
  age: fc.integer({ min: 18, max: 120 }),
  preferences: fc.record({
    theme: fc.oneof(fc.constant('light'), fc.constant('dark')),
    notifications: fc.boolean()
  })
});
```

### Test Organization

```typescript
describe('UserService', () => {
  let userService: UserService;
  let mockUserRepository: jest.Mocked<UserRepository>;
  let mockEmailService: jest.Mocked<EmailService>;

  beforeEach(() => {
    mockUserRepository = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      save: jest.fn(),
      delete: jest.fn()
    };

    mockEmailService = {
      sendWelcomeEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn()
    };

    userService = new UserService(mockUserRepository, mockEmailService);
  });

  describe('registerUser', () => {
    describe('when user data is valid', () => {
      it('should create user and send welcome email', async () => {
        // Test implementation
      });
    });

    describe('when user already exists', () => {
      it('should return UserAlreadyExistsError', async () => {
        // Test implementation
      });
    });
  });
});
```

### Test Data Factories

```typescript
class UserTestFactory {
  static create(overrides: Partial<User> = {}): User {
    return {
      id: 'test-user-id',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      createdAt: new Date('2023-01-01'),
      status: 'active',
      ...overrides
    };
  }

  static createMany(count: number, overrides: Partial<User> = {}): User[] {
    return Array.from({ length: count }, (_, index) =>
      this.create({
        id: `test-user-${index}`,
        email: `test${index}@example.com`,
        ...overrides
      })
    );
  }
}
```

## 6. Performance Considerations

### Tree Shaking and Bundle Optimization

```typescript
// package.json
{
  "sideEffects": false,
  "type": "module"
}

// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "declaration": true,
    "declarationMap": true
  }
}

// ✅ Good - Named exports for better tree shaking
export const validateEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const validatePassword = (password: string): boolean => {
  return password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
};

// ❌ Bad - Default export with object (harder to tree shake)
export default {
  validateEmail,
  validatePassword
};
```

### Lazy Loading Patterns

```typescript
class FeatureLoader {
  private static loadedFeatures = new Map<string, Promise<any>>();

  static async loadAnalytics(): Promise<AnalyticsModule> {
    if (!this.loadedFeatures.has('analytics')) {
      this.loadedFeatures.set('analytics',
        import('./features/analytics').then(module => module.AnalyticsModule)
      );
    }
    return this.loadedFeatures.get('analytics')!;
  }
}

class ServiceRegistry {
  private services = new Map<string, Promise<any>>();

  async getService<T>(serviceName: string, loader: () => Promise<T>): Promise<T> {
    if (!this.services.has(serviceName)) {
      this.services.set(serviceName, loader());
    }
    return this.services.get(serviceName) as Promise<T>;
  }
}
```

### Memory Management

```typescript
// ✅ Good - Proper cleanup patterns
class EventManager {
  private listeners = new Map<string, Set<Function>>();
  private abortController = new AbortController();

  addEventListener(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  dispose(): void {
    this.listeners.clear();
    this.abortController.abort();
  }
}

// ✅ Good - WeakMap for object references
class ObjectMetadata {
  private static metadata = new WeakMap<object, MetadataInfo>();

  static setMetadata(obj: object, info: MetadataInfo): void {
    this.metadata.set(obj, info);
  }

  static getMetadata(obj: object): MetadataInfo | undefined {
    return this.metadata.get(obj);
  }
}
```

### Async Patterns

```typescript
// ✅ Good - Parallel execution when possible
const loadUserDashboard = async (userId: string): Promise<DashboardData> => {
  const [user, orders, preferences, notifications] = await Promise.all([
    userService.getUser(userId),
    orderService.getUserOrders(userId),
    preferenceService.getUserPreferences(userId),
    notificationService.getUnreadNotifications(userId)
  ]);

  return {
    user: user.value,
    recentOrders: orders.value.slice(0, 5),
    preferences: preferences.value,
    unreadNotifications: notifications.value.length
  };
};

// ✅ Good - Error handling with proper cleanup
const uploadFileWithProgress = async (
  file: File,
  onProgress: (progress: number) => void
): Promise<Result<UploadResult, UploadError>> => {
  const abortController = new AbortController();
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
      signal: abortController.signal
    });

    if (!response.ok) {
      return { success: false, error: new UploadError('Upload failed', response.status) };
    }

    const result = await response.json();
    return { success: true, value: result };
  } catch (error) {
    if (error instanceof AbortError) {
      return { success: false, error: new UploadError('Upload cancelled') };
    }
    return { success: false, error: new UploadError('Network error', error) };
  } finally {
    abortController.abort();
  }
};
```

## Key Principles Summary

1. **Type Safety First**: Use strict TypeScript configuration and avoid `any`
2. **Functional Core, Imperative Shell**: Keep business logic pure and isolate side effects
3. **Explicit Error Handling**: Use Result types instead of throwing exceptions
4. **Immutability by Default**: Use readonly types and immutable update patterns
5. **Dependency Injection**: Inject dependencies for testability and flexibility
6. **Test Everything**: Follow TDD with property-based testing for edge cases
7. **Performance Conscious**: Optimize bundles and manage memory properly
8. **Domain Modeling**: Use branded types and discriminated unions for type-safe domain models

## References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Functional Programming in TypeScript](https://gcanti.github.io/fp-ts/)
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Domain-Driven Design](https://martinfowler.com/bliki/DomainDrivenDesign.html)