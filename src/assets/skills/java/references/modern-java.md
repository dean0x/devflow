# Modern Java Features (17-21+)

Deep-dive on modern Java language features with JEP and literature citations.
Reference from main SKILL.md.

---

## Records (Java 16+) [4]

Records are transparent carriers of immutable data. The compiler auto-generates
`equals`, `hashCode`, `toString`, and an accessor method per component. Compact
constructors validate fields before the record is constructed. — JEP 395 [4]

"Records model the situation where a class's primary purpose is to hold data."
— Brian Goetz, Data Oriented Programming in Java [9]

### Basic Record [4]

```java
// Immutable data carrier with auto-generated equals, hashCode, toString [4]
public record Point(double x, double y) {}

// Usage
var p = new Point(3.0, 4.0);
double x = p.x(); // Accessor method, not getX() [4]
```

### Compact Constructor (Validation) [4]

```java
// Validation before component fields are sealed [4]
public record Email(String value) {
    public Email {
        Objects.requireNonNull(value, "email must not be null");
        if (!value.contains("@")) {
            throw new IllegalArgumentException("Invalid email: " + value);
        }
        value = value.toLowerCase().strip(); // Normalize before assignment [4]
    }
}
```

### Record with Custom Methods [4][1, Item 17]

Records can have instance methods; they cannot have mutable state. Return new
records for "updates" — the immutability contract is preserved. [1, Item 17]

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

### Records as Local Classes [4][9]

Local records are useful for intermediate computation shapes inside a method —
they scope the type to where it is needed. [9]

```java
public List<String> processOrders(List<Order> orders) {
    // Local record for intermediate computation [4]
    record OrderTotal(String orderId, Money total) {}

    return orders.stream()
        .map(o -> new OrderTotal(o.id(), o.calculateTotal()))
        .filter(ot -> ot.total().isGreaterThan(Money.of(100)))
        .map(OrderTotal::orderId)
        .toList();
}
```

---

## Sealed Classes (Java 17+) [5]

Sealed types close the subtype hierarchy: only `permits`-listed subtypes may
implement/extend. This enables exhaustive pattern matching — the compiler verifies
all cases are handled without a `default` branch. — JEP 409 [5]

"Sealed classes expose the constraint that a domain model is closed." — Goetz [9]

### Sealed Interface [5]

```java
// Closed hierarchy — compiler knows all subtypes [5]
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

### Sealed Class with Abstract Methods [5]

```java
public sealed abstract class Payment permits CreditCard, BankTransfer, Crypto {
    abstract Money amount();
    abstract String reference();
}

public final class CreditCard extends Payment { /* ... */ }
public final class BankTransfer extends Payment { /* ... */ }
public final class Crypto extends Payment { /* ... */ }
```

---

## Pattern Matching (Java 21+) [6]

Pattern matching for `switch` combines type testing, binding, and guarded conditions
in one expression. Sealed types make the switch exhaustive — no `default` needed. — JEP 441 [6]

### Switch with Patterns [6]

```java
// Exhaustive — compiler verifies all Shape subtypes covered [5][6]
public String describe(Shape shape) {
    return switch (shape) {
        case Circle c    -> "Circle with radius %.2f".formatted(c.radius());
        case Rectangle r -> "Rectangle %s x %s".formatted(r.width(), r.height());
        case Triangle t  -> "Triangle with base %.2f".formatted(t.base());
    };
}
```

### Guarded Patterns [6]

```java
// when-guards refine pattern match conditions [6]
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

### Record Patterns (Destructuring) [6][4]

Record patterns decompose record components inline in the pattern. Nested destructuring
collapses what would otherwise be multi-step instanceof + field access. [6]

```java
// Nested destructuring — components bound directly in pattern [6][4]
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

## Text Blocks (Java 15+) [3]

Text blocks preserve indentation relative to the closing delimiter. Use `formatted()`
for interpolation — avoids escape sequences entirely.

```java
// Multi-line strings with proper indentation [3]
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

## Virtual Threads (Java 21+) [7]

Virtual threads are lightweight JVM-managed threads that do not pin a platform thread
during blocking I/O. Enables thread-per-request style with the efficiency of async. — JEP 444 [7]

"Virtual threads are not faster threads — they are cheaper threads. They allow you
to write blocking code that scales like async code." — JEP 444 [7]

### Basic Virtual Thread [7]

```java
// Lightweight thread — does not pin platform thread during I/O [7]
Thread.startVirtualThread(() -> {
    var result = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    process(result.body());
});
```

### Structured Concurrency (Preview) [7][28]

Structured concurrency treats a group of concurrent tasks as a single unit of work:
all succeed, or all are cancelled. Prevents thread leaks and orphaned tasks. [28]

```java
// All subtasks complete or cancel together [28]
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<User> userTask = scope.fork(() -> fetchUser(userId));
    Subtask<List<Order>> ordersTask = scope.fork(() -> fetchOrders(userId));

    scope.join().throwIfFailed();

    return new UserDashboard(userTask.get(), ordersTask.get());
}
```

### ExecutorService with Virtual Threads [7][1, Item 80]

Prefer executors over raw threads. `newVirtualThreadPerTaskExecutor` spawns one
virtual thread per submitted task. — Effective Java, Item 80 [1, Item 80]

```java
// Process thousands of concurrent I/O tasks [7][1, Item 80]
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

### Enhanced instanceof (Java 16+) [3]

Pattern variable binding eliminates explicit cast — the variable is scoped to the
branch where the type is guaranteed.

```java
// Pattern variable binding eliminates explicit cast [3]
if (obj instanceof String s && s.length() > 5) {
    System.out.println(s.toUpperCase());
}

// Works with negation [3]
if (!(obj instanceof String s)) {
    throw new IllegalArgumentException("Expected String");
}
// s is in scope here — type proven by earlier check
process(s);
```

### Helpful NullPointerExceptions (Java 14+) [3]

The JVM now identifies exactly which reference was null in the exception message.
Enabled by default since Java 17.

```java
// JVM now tells you exactly which reference was null:
// java.lang.NullPointerException: Cannot invoke "String.length()"
//   because the return value of "User.name()" is null
// Enable with: -XX:+ShowCodeDetailsInExceptionMessages (default since Java 17) [3]
```

### Stream Gatherers (Java 22+ Preview) [3]

Custom intermediate stream operations via the `Gatherers` API — enables sliding
windows, batch processing, and other stateful operations.

```java
// Custom intermediate stream operations [3]
var windowedAverages = temperatures.stream()
    .gather(Gatherers.windowSliding(5))
    .map(window -> window.stream().mapToDouble(d -> d).average().orElse(0))
    .toList();
```

---

## Data Oriented Programming Summary [9]

Brian Goetz's Data Oriented Programming model combines four features into a
unified paradigm for modeling immutable data: [9]

| Feature | Role | JEP |
|---------|------|-----|
| Records | Immutable data carrier | [4] |
| Sealed classes | Closed type hierarchies | [5] |
| Pattern matching | Exhaustive dispatch | [6] |
| Local records | Scoped intermediate types | [4] |

"Data orientation separates the 'what' (data as records) from the 'how'
(behavior in functions), leading to simpler, more testable code." — Goetz [9]
