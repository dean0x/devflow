# Extended Java Patterns

Correct patterns for Java development with literature citations. Reference from main SKILL.md.

---

## Builder Pattern (Type-Safe) [1, Item 2]

Use when constructors would have many optional parameters. Records with a nested `Builder`
class provide compile-time validation of required fields. — Effective Java, Item 2 [1]

```java
// Compile-time enforcement of required fields [1, Item 2]
public record EmailMessage(String to, String subject, String body, List<String> cc) {

    public static Builder builder() { return new Builder(); }

    public static class Builder {
        private String to;
        private String subject;
        private String body;
        private List<String> cc = List.of();

        public Builder to(String to) { this.to = Objects.requireNonNull(to); return this; }
        public Builder subject(String subject) { this.subject = Objects.requireNonNull(subject); return this; }
        public Builder body(String body) { this.body = Objects.requireNonNull(body); return this; }
        public Builder cc(List<String> cc) { this.cc = List.copyOf(cc); return this; }

        public EmailMessage build() {
            Objects.requireNonNull(to, "to is required");
            Objects.requireNonNull(subject, "subject is required");
            Objects.requireNonNull(body, "body is required");
            return new EmailMessage(to, subject, body, cc);
        }
    }
}

// Usage
var email = EmailMessage.builder()
    .to("user@example.com")
    .subject("Welcome")
    .body("Hello!")
    .build();
```

---

## Strategy via Interfaces [14]

Define behavior as a functional interface. Implementations can be lambdas or classes.
Compose strategies as constructor arguments — no subclassing. — GoF Strategy [14]

```java
// Define strategy as functional interface [14]
@FunctionalInterface
public interface PricingStrategy {
    Money calculatePrice(Order order);
}

// Implementations as lambdas [10]
PricingStrategy standard = order -> order.subtotal();
PricingStrategy discounted = order -> order.subtotal().multiply(0.9);
PricingStrategy tiered = order -> {
    if (order.itemCount() > 10) return order.subtotal().multiply(0.8);
    if (order.itemCount() > 5) return order.subtotal().multiply(0.9);
    return order.subtotal();
};

// Inject strategy — composition over inheritance [1, Item 18]
public class OrderService {
    private final PricingStrategy pricing;

    public OrderService(PricingStrategy pricing) {
        this.pricing = pricing;
    }

    public Money calculateTotal(Order order) {
        return pricing.calculatePrice(order);
    }
}
```

---

## Repository Pattern [1, Item 64]

Refer to objects by their interfaces — Item 64. [1, Item 64] Implementations are
swappable (JPA, JDBC, in-memory for tests) without changing callers.

```java
// Interface — callers depend on abstraction, not implementation [1, Item 64]
public interface UserRepository {
    Optional<User> findById(String id);
    List<User> findByEmail(String email);
    User save(User user);
    void deleteById(String id);
    boolean existsById(String id);
}

// Implementation with constructor injection [1, Item 18]
public class JpaUserRepository implements UserRepository {
    private final EntityManager em;

    public JpaUserRepository(EntityManager em) {
        this.em = em;
    }

    @Override
    public Optional<User> findById(String id) {
        return Optional.ofNullable(em.find(User.class, id));
    }

    @Override
    public User save(User user) {
        return em.merge(user);
    }
}
```

---

## Value Objects [1, Item 17][4]

Immutable value objects with validation in compact constructors. Records are the idiomatic
Java 16+ choice — `equals`/`hashCode` are value-based automatically. [4][1, Item 17]

```java
// Value object as record with compact constructor validation [4][1, Item 17]
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "amount must not be null");
        Objects.requireNonNull(currency, "currency must not be null");
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("Scale exceeds currency precision");
        }
    }

    public Money add(Money other) {
        requireSameCurrency(other);
        return new Money(amount.add(other.amount), currency);  // new object [1, Item 17]
    }

    public Money multiply(double factor) {
        return new Money(
            amount.multiply(BigDecimal.valueOf(factor))
                  .setScale(currency.getDefaultFractionDigits(), RoundingMode.HALF_UP),
            currency
        );
    }

    private void requireSameCurrency(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException(
                "Cannot combine %s and %s".formatted(currency, other.currency)
            );
        }
    }
}
```

---

## Event-Driven Pattern with Sealed Interfaces [5][6][9]

Domain events as sealed interfaces with record subtypes enable exhaustive switch handling.
No `instanceof` chains, no default fallback, compiler enforces completeness. [5][6]

```java
// Domain event hierarchy — sealed + records [5][9]
public sealed interface OrderEvent permits OrderCreated, OrderShipped, OrderCancelled {
    String orderId();
    Instant occurredAt();
}

public record OrderCreated(String orderId, Instant occurredAt, List<LineItem> items)
    implements OrderEvent {}

public record OrderShipped(String orderId, Instant occurredAt, String trackingNumber)
    implements OrderEvent {}

public record OrderCancelled(String orderId, Instant occurredAt, String reason)
    implements OrderEvent {}

// Exhaustive pattern matching — no default needed [6]
public class OrderEventHandler {
    public void handle(OrderEvent event) {
        switch (event) {
            case OrderCreated e -> notifyWarehouse(e.items());
            case OrderShipped e -> sendTrackingEmail(e.trackingNumber());
            case OrderCancelled e -> processRefund(e.orderId(), e.reason());
        }
    }
}
```

---

## Stream Pipelines [10][26]

Declarative, composable collection processing. Prefer `.toList()` (Java 16+) over
`collect(Collectors.toList())`. Use `Collectors.groupingBy` for aggregations. [10][1, Item 46]

```java
// Declarative collection processing [10]
public List<String> getActiveUserEmails(List<User> users) {
    return users.stream()
        .filter(User::isActive)
        .map(User::email)
        .filter(email -> email.contains("@"))
        .sorted()
        .toList(); // Unmodifiable list (Java 16+) [26]
}

// Grouping and aggregation [10]
public Map<Department, Long> countByDepartment(List<Employee> employees) {
    return employees.stream()
        .collect(Collectors.groupingBy(Employee::department, Collectors.counting()));
}

// Reducing to summary [10]
public record OrderSummary(int count, Money total) {}

public OrderSummary summarize(List<Order> orders) {
    return orders.stream()
        .reduce(
            new OrderSummary(0, Money.ZERO),
            (summary, order) -> new OrderSummary(
                summary.count() + 1,
                summary.total().add(order.total())
            ),
            (a, b) -> new OrderSummary(a.count() + b.count(), a.total().add(b.total()))
        );
}
```

---

## Concurrency: Thread-Safe Patterns [2][7]

Use `ConcurrentHashMap` for shared state, virtual threads for I/O concurrency,
`StructuredTaskScope` for fan-out/fan-in. — Java Concurrency in Practice [2]

```java
// Thread-safe shared state [2, Ch. 5]
private final Map<String, Session> sessions = new ConcurrentHashMap<>();

public void addSession(String id, Session s) {
    sessions.put(id, s); // Thread-safe
}

// Virtual threads for I/O concurrency — JEP 444 [7]
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Response>> futures = urls.stream()
        .map(url -> executor.submit(() -> fetch(url)))
        .toList();
    return futures.stream().map(f -> uncheck(f::get)).toList();
}

// Structured concurrency: all subtasks complete or cancel together [28]
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<User> userTask       = scope.fork(() -> fetchUser(userId));
    Subtask<List<Order>> orders  = scope.fork(() -> fetchOrders(userId));
    scope.join().throwIfFailed();
    return new UserDashboard(userTask.get(), orders.get());
}
```

---

## Dependency Injection (Manual Composition Root) [1, Item 18]

Wire all dependencies at the entry point. Inner components receive collaborators
through constructors — no `new` calls buried in business logic. [1, Item 18]

```java
// Composition root wires everything together [1, Item 18]
public class Application {
    public static void main(String[] args) {
        var config = Config.load();
        var dataSource = createDataSource(config);
        var userRepo = new JpaUserRepository(dataSource);
        var eventBus = new InMemoryEventBus();
        var userService = new UserService(userRepo, eventBus);
        var userController = new UserController(userService);

        startServer(config.port(), userController);
    }
}
```

---

## Bean Validation (JSR 380) [11]

Annotation-based validation at API boundaries. Pair with `@Valid` on controller method
parameters for automatic enforcement. [11]

```java
public record CreateUserRequest(
    @NotBlank @Size(max = 100) String name,
    @Email @Size(max = 255) String email,
    @Min(0) @Max(150) int age
) {}

// Spring MVC: @Valid triggers constraint evaluation [11]
@PostMapping("/users")
public ResponseEntity<UserDTO> create(@Valid @RequestBody CreateUserRequest req) {
    // req is guaranteed valid here — ConstraintViolationException thrown if not
    return ResponseEntity.ok(userService.create(req));
}
```
