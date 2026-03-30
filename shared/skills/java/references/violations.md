# Common Java Violations

Extended violation patterns for Java reviews with literature citations. Reference from main SKILL.md.

---

## Null Returns [1, Item 22]

Returning `null` forces callers to null-check — easy to forget, causes NPE at
unpredictable call sites. Use `Optional` to encode absence in the type. [1, Item 22][25]

### Returning null Instead of Optional

```java
// VIOLATION: Null return forces callers to null-check [1, Item 22]
public User findById(String id) {
    return userMap.get(id); // Returns null if absent
}

// Callers must remember to check:
User user = findById(id);
user.getName(); // NullPointerException if not found
```

### Nullable Collections

```java
// VIOLATION: Returning null instead of empty collection [1, Item 54]
public List<Order> getOrders(String userId) {
    List<Order> orders = orderMap.get(userId);
    return orders; // null if user has no orders
}

// Callers iterate without checking:
for (Order o : getOrders(userId)) { // NullPointerException
    process(o);
}
```

---

## Raw Types [1, Item 26][3]

Raw types bypass the generic type system entirely. Use of raw `List`, `Map`, or
`Comparable` generates unchecked warnings and enables runtime `ClassCastException`. [1, Item 26]

### Unparameterized Generics

```java
// VIOLATION: Raw List — no type safety [1, Item 26]
List users = new ArrayList();
users.add("not a user"); // No compile error
users.add(42);           // No compile error
User first = (User) users.get(0); // ClassCastException at runtime

// VIOLATION: Raw Map
Map cache = new HashMap();
cache.put(123, "value");
String val = (String) cache.get(123); // Unsafe cast
```

### Raw Type in Method Signatures

```java
// VIOLATION: Raw Comparable [1, Item 26]
public class Price implements Comparable {
    public int compareTo(Object other) {
        return Double.compare(this.amount, ((Price) other).amount); // Unsafe cast
    }
}

// VIOLATION: Raw Iterator
Iterator it = collection.iterator();
while (it.hasNext()) {
    String s = (String) it.next(); // Unsafe cast
}
```

---

## Checked Exception Abuse [1]

Broad `throws Exception` declarations hide what can actually go wrong. Callers can't
catch specific failures and must either re-throw or swallow. Swallowing silently is
the worst outcome. [1]

### Broad Throws Declarations

```java
// VIOLATION: throws Exception — hides what can actually go wrong [1]
public User createUser(String name) throws Exception {
    // Callers must catch Exception, can't handle specific failures
}

// VIOLATION: Wrapping everything in checked exceptions [1]
public void process(String data) throws ProcessingException {
    try {
        Integer.parseInt(data);
    } catch (NumberFormatException e) {
        throw new ProcessingException("Failed", e); // Unnecessary wrapping
    }
}
```

### Swallowed Exceptions

```java
// VIOLATION: Empty catch block — resource leak hidden [1]
try {
    connection.close();
} catch (SQLException e) {
    // silently ignored
}

// VIOLATION: Catching and logging only [1]
try {
    processPayment(order);
} catch (PaymentException e) {
    logger.error("Payment failed", e);
    // Continues as if nothing happened — order in inconsistent state
}
```

---

## Mutable Data Objects [1, Item 17][4]

JavaBean-style mutation breaks encapsulation: any caller, anywhere, at any time,
can change state. Records enforce immutability structurally. [1, Item 17][4][9]

### JavaBean-Style Mutability

```java
// VIOLATION: Mutable DTO with setters [1, Item 17]
public class UserDTO {
    private String name;
    private String email;

    public void setName(String name) { this.name = name; }
    public void setEmail(String email) { this.email = email; }
    public String getName() { return name; }
    public String getEmail() { return email; }
}

// Anyone can modify at any time:
dto.setName("changed"); // No control over when/where mutation happens
```

### Exposing Internal Mutable State

```java
// VIOLATION: Getter returns mutable internal list [1, Item 50]
public class Team {
    private List<String> members = new ArrayList<>();

    public List<String> getMembers() {
        return members; // Caller can modify internal state
    }
}

// External code breaks encapsulation:
team.getMembers().clear(); // Empties the team's internal list
```

---

## Deep Inheritance [1, Item 18][14]

Inheritance for code reuse creates a fragile base class problem: changes to any
ancestor break all descendants without warning. Prefer composition. [1, Item 18]

### Fragile Base Class

```java
// VIOLATION: Deep hierarchy creates tight coupling [1, Item 18]
public abstract class AbstractEntity { ... }
public abstract class AbstractAuditableEntity extends AbstractEntity { ... }
public abstract class AbstractVersionedEntity extends AbstractAuditableEntity { ... }
public class User extends AbstractVersionedEntity { ... }

// Changing any base class ripples through all descendants
// Testing requires understanding 4 levels of behavior
```

### Inheritance for Code Reuse

```java
// VIOLATION: Extending just to reuse utility methods [1, Item 18]
public class OrderService extends BaseService {
    // Only extends BaseService to get logAndAudit() method
    public void processOrder(Order order) {
        logAndAudit("processing", order.getId()); // Inherited utility
    }
}
// Should be: inject a LogAuditService instead [1, Item 18]
```

---

## Concurrency Violations [2][12]

Shared mutable state accessed from multiple threads without synchronization causes
data races. The Java Memory Model does not guarantee visibility without
`volatile` or `synchronized`. — Java Concurrency in Practice [2]

### Shared Mutable State Without Synchronization

```java
// VIOLATION: HashMap accessed from multiple threads [2, Ch. 2]
private Map<String, Session> sessions = new HashMap<>();

public void addSession(String id, Session s) {
    sessions.put(id, s); // Not thread-safe — use ConcurrentHashMap [2, Ch. 5]
}
```

### Double-Checked Locking Done Wrong [2, Ch. 16][12]

Missing `volatile` allows the JVM to publish a partially-constructed object due to
instruction reordering. — JSR-133 Cookbook [12]

```java
// VIOLATION: Missing volatile on lazily-initialized field [2, Ch. 16][12]
private ExpensiveObject instance;

public ExpensiveObject getInstance() {
    if (instance == null) {
        synchronized (this) {
            if (instance == null) {
                instance = new ExpensiveObject(); // Partially constructed object visible
            }
        }
    }
    return instance;
}

// CORRECT: volatile ensures happens-before [12]
private volatile ExpensiveObject instance;
```

---

## Stream Anti-Patterns [10][26]

Streams with side effects in `forEach` and nested streams are hard to reason about.
Prefer explicit for-loops for side effects and collect for transformation. [10]

```java
// VIOLATION: forEach with side effects — prefer for-loop [1, Item 46]
users.stream().forEach(u -> externalService.notify(u));

// VIOLATION: collect(Collectors.toList()) is verbose since Java 16 [26]
List<String> names = users.stream().map(User::name).collect(Collectors.toList());

// CORRECT: .toList() returns unmodifiable list [26]
List<String> names = users.stream().map(User::name).toList();
```
