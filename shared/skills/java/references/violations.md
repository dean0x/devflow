# Common Java Violations

Extended violation patterns for Java reviews. Reference from main SKILL.md.

---

## Null Returns

### Returning null Instead of Optional

```java
// VIOLATION: Null return forces callers to null-check
public User findById(String id) {
    return userMap.get(id); // Returns null if absent
}

// Callers must remember to check:
User user = findById(id);
user.getName(); // NullPointerException if not found
```

### Nullable Collections

```java
// VIOLATION: Returning null instead of empty collection
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

## Raw Types

### Unparameterized Generics

```java
// VIOLATION: Raw List - no type safety
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
// VIOLATION: Raw Comparable
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

## Checked Exception Abuse

### Broad Throws Declarations

```java
// VIOLATION: throws Exception - hides what can actually go wrong
public User createUser(String name) throws Exception {
    // Callers must catch Exception, can't handle specific failures
}

// VIOLATION: Wrapping everything in checked exceptions
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
// VIOLATION: Empty catch block
try {
    connection.close();
} catch (SQLException e) {
    // silently ignored - resource leak hidden
}

// VIOLATION: Catching and logging only
try {
    processPayment(order);
} catch (PaymentException e) {
    logger.error("Payment failed", e);
    // Continues as if nothing happened - order in inconsistent state
}
```

---

## Mutable Data Objects

### JavaBean-Style Mutability

```java
// VIOLATION: Mutable DTO with setters
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
// VIOLATION: Getter returns mutable internal list
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

## Deep Inheritance

### Fragile Base Class

```java
// VIOLATION: Deep hierarchy creates tight coupling
public abstract class AbstractEntity { ... }
public abstract class AbstractAuditableEntity extends AbstractEntity { ... }
public abstract class AbstractVersionedEntity extends AbstractAuditableEntity { ... }
public class User extends AbstractVersionedEntity { ... }

// Changing any base class ripples through all descendants
// Testing requires understanding 4 levels of behavior
```

### Inheritance for Code Reuse

```java
// VIOLATION: Extending just to reuse utility methods
public class OrderService extends BaseService {
    // Only extends BaseService to get logAndAudit() method
    public void processOrder(Order order) {
        logAndAudit("processing", order.getId()); // Inherited utility
    }
}
// Should be: inject a LogAuditService instead
```

---

## Concurrency Violations

### Shared Mutable State Without Synchronization

```java
// VIOLATION: HashMap accessed from multiple threads
private Map<String, Session> sessions = new HashMap<>();

public void addSession(String id, Session s) {
    sessions.put(id, s); // Not thread-safe
}
```

### Double-Checked Locking Done Wrong

```java
// VIOLATION: Missing volatile on lazily-initialized field
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
```
