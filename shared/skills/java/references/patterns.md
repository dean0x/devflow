# Extended Java Patterns

Correct patterns for Java development. Reference from main SKILL.md.

---

## Builder Pattern (Type-Safe)

```java
// Compile-time enforcement of required fields
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

## Strategy via Interfaces

```java
// Define strategy as functional interface
@FunctionalInterface
public interface PricingStrategy {
    Money calculatePrice(Order order);
}

// Implementations as lambdas or classes
PricingStrategy standard = order -> order.subtotal();
PricingStrategy discounted = order -> order.subtotal().multiply(0.9);
PricingStrategy tiered = order -> {
    if (order.itemCount() > 10) return order.subtotal().multiply(0.8);
    if (order.itemCount() > 5) return order.subtotal().multiply(0.9);
    return order.subtotal();
};

// Inject strategy
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

## Repository Pattern

```java
public interface UserRepository {
    Optional<User> findById(String id);
    List<User> findByEmail(String email);
    User save(User user);
    void deleteById(String id);
    boolean existsById(String id);
}

// Implementation with constructor injection
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

## Value Objects

```java
// Immutable value object with validation
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
        return new Money(amount.add(other.amount), currency);
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

## Event-Driven Pattern

```java
// Domain event as sealed interface
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

// Event handler with exhaustive matching
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

## Stream Pipelines

```java
// Declarative collection processing
public List<String> getActiveUserEmails(List<User> users) {
    return users.stream()
        .filter(User::isActive)
        .map(User::email)
        .filter(email -> email.contains("@"))
        .sorted()
        .toList(); // Unmodifiable list (Java 16+)
}

// Grouping and aggregation
public Map<Department, Long> countByDepartment(List<Employee> employees) {
    return employees.stream()
        .collect(Collectors.groupingBy(Employee::department, Collectors.counting()));
}

// Reducing to summary
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

## Dependency Injection (Manual)

```java
// Composition root wires everything together
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
