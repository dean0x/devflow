# Modern Java Features (17-21+)

Deep-dive on modern Java language features. Reference from main SKILL.md.

---

## Records (Java 16+)

### Basic Record

```java
// Immutable data carrier with auto-generated equals, hashCode, toString
public record Point(double x, double y) {}

// Usage
var p = new Point(3.0, 4.0);
double x = p.x(); // Accessor method, not getX()
```

### Compact Constructor (Validation)

```java
public record Email(String value) {
    public Email {
        Objects.requireNonNull(value, "email must not be null");
        if (!value.contains("@")) {
            throw new IllegalArgumentException("Invalid email: " + value);
        }
        value = value.toLowerCase().strip(); // Reassign before final assignment
    }
}
```

### Record with Custom Methods

```java
public record Range(int start, int end) {
    public Range {
        if (start > end) throw new IllegalArgumentException("start must be <= end");
    }

    public int length() { return end - start; }
    public boolean contains(int value) { return value >= start && value <= end; }
    public Range overlap(Range other) {
        int newStart = Math.max(start, other.start);
        int newEnd = Math.min(end, other.end);
        return newStart <= newEnd ? new Range(newStart, newEnd) : null;
    }
}
```

### Records as Local Classes

```java
public List<String> processOrders(List<Order> orders) {
    // Local record for intermediate computation
    record OrderTotal(String orderId, Money total) {}

    return orders.stream()
        .map(o -> new OrderTotal(o.id(), o.calculateTotal()))
        .filter(ot -> ot.total().isGreaterThan(Money.of(100)))
        .map(OrderTotal::orderId)
        .toList();
}
```

---

## Sealed Classes (Java 17+)

### Sealed Interface

```java
public sealed interface Shape permits Circle, Rectangle, Triangle {
    double area();
}

public record Circle(double radius) implements Shape {
    public double area() { return Math.PI * radius * radius; }
}

public record Rectangle(double width, double height) implements Shape {
    public double area() { return width * height; }
}

public record Triangle(double base, double height) implements Shape {
    public double area() { return 0.5 * base * height; }
}
```

### Sealed Class with Abstract Methods

```java
public sealed abstract class Payment permits CreditCard, BankTransfer, Crypto {
    abstract Money amount();
    abstract String reference();
}

public final class CreditCard extends Payment {
    private final String cardLast4;
    private final Money amount;
    // ...
}

public final class BankTransfer extends Payment { /* ... */ }
public final class Crypto extends Payment { /* ... */ }
```

---

## Pattern Matching (Java 21+)

### Switch with Patterns

```java
// Exhaustive pattern matching on sealed types
public String describe(Shape shape) {
    return switch (shape) {
        case Circle c    -> "Circle with radius %.2f".formatted(c.radius());
        case Rectangle r -> "Rectangle %s x %s".formatted(r.width(), r.height());
        case Triangle t  -> "Triangle with base %.2f".formatted(t.base());
    };
}
```

### Guarded Patterns

```java
public String classifyTemperature(Object obj) {
    return switch (obj) {
        case Integer i when i < 0    -> "Freezing";
        case Integer i when i < 15   -> "Cold";
        case Integer i when i < 25   -> "Comfortable";
        case Integer i               -> "Hot";
        case Double d when d < 0.0   -> "Freezing";
        case Double d                -> "Warm-ish (%.1f)".formatted(d);
        case String s                -> "Not a temperature: " + s;
        case null                    -> "No reading";
        default                      -> "Unknown type";
    };
}
```

### Record Patterns (Destructuring)

```java
// Nested destructuring
record Address(String city, String country) {}
record Person(String name, Address address) {}

public String greet(Object obj) {
    return switch (obj) {
        case Person(var name, Address(var city, _)) ->
            "Hello %s from %s".formatted(name, city);
        default -> "Hello stranger";
    };
}
```

---

## Text Blocks (Java 15+)

```java
// Multi-line strings with proper indentation
String json = """
        {
            "name": "%s",
            "email": "%s",
            "active": true
        }
        """.formatted(user.name(), user.email());

String sql = """
        SELECT u.id, u.name, u.email
        FROM users u
        JOIN orders o ON o.user_id = u.id
        WHERE u.active = true
          AND o.created_at > ?
        ORDER BY u.name
        """;
```

---

## Virtual Threads (Java 21+)

### Basic Virtual Thread

```java
// Lightweight thread - does not pin platform thread during I/O
Thread.startVirtualThread(() -> {
    var result = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    process(result.body());
});
```

### Structured Concurrency (Preview)

```java
// All subtasks complete or cancel together
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<User> userTask = scope.fork(() -> fetchUser(userId));
    Subtask<List<Order>> ordersTask = scope.fork(() -> fetchOrders(userId));

    scope.join().throwIfFailed();

    return new UserDashboard(userTask.get(), ordersTask.get());
}
```

### ExecutorService with Virtual Threads

```java
// Process thousands of concurrent I/O tasks
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Response>> futures = urls.stream()
        .map(url -> executor.submit(() -> httpClient.send(
            HttpRequest.newBuilder(URI.create(url)).build(),
            HttpResponse.BodyHandlers.ofString()
        )))
        .toList();

    List<Response> responses = futures.stream()
        .map(f -> {
            try { return f.get(); }
            catch (Exception e) { throw new RuntimeException(e); }
        })
        .toList();
}
```

---

## Other Modern Features

### Enhanced instanceof (Java 16+)

```java
// Pattern variable binding eliminates explicit cast
if (obj instanceof String s && s.length() > 5) {
    System.out.println(s.toUpperCase());
}

// Works with negation
if (!(obj instanceof String s)) {
    throw new IllegalArgumentException("Expected String");
}
// s is in scope here
process(s);
```

### Helpful NullPointerExceptions (Java 14+)

```java
// JVM now tells you exactly which reference was null:
// java.lang.NullPointerException: Cannot invoke "String.length()"
//   because the return value of "User.name()" is null
// Enable with: -XX:+ShowCodeDetailsInExceptionMessages (default since Java 17)
```

### Stream Gatherers (Java 22+ Preview)

```java
// Custom intermediate stream operations
var windowedAverages = temperatures.stream()
    .gather(Gatherers.windowSliding(5))
    .map(window -> window.stream().mapToDouble(d -> d).average().orElse(0))
    .toList();
```
