---
name: java
description: This skill should be used when the user works with Java files (.java), asks about "records", "sealed classes", "Optional", "streams", "composition over inheritance", or discusses modern Java patterns and API design. Provides patterns for type system usage, error handling, immutability, and concurrency.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.java"
  exclude:
    - "**/build/**"
    - "**/target/**"
---

# Java Patterns

Reference for modern Java patterns, type system, and best practices.

## Iron Law

> **FAVOR COMPOSITION OVER INHERITANCE**
>
> Delegation and interfaces over class hierarchies. Inheritance creates tight coupling,
> breaks encapsulation, and makes refactoring dangerous. Use interfaces for polymorphism,
> records for data, and sealed classes for restricted hierarchies. Extend only when the
> "is-a" relationship is genuinely invariant.

## When This Skill Activates

- Working with Java codebases
- Designing APIs with modern Java features
- Using records, sealed classes, Optional
- Implementing concurrent code
- Structuring Java packages

---

## Type System (Modern Java)

### Records for Data

```java
// BAD: Mutable POJO with getters/setters
// GOOD: Immutable record
public record User(String name, String email, Instant createdAt) {
    public User {
        Objects.requireNonNull(name, "name must not be null");
        Objects.requireNonNull(email, "email must not be null");
    }
}
```

### Sealed Classes for Restricted Hierarchies

```java
public sealed interface Result<T> permits Success, Failure {
    record Success<T>(T value) implements Result<T> {}
    record Failure<T>(String error) implements Result<T> {}
}

// Exhaustive pattern matching (Java 21+)
switch (result) {
    case Success<User> s -> handleSuccess(s.value());
    case Failure<User> f -> handleError(f.error());
}
```

### Optional for Absent Values

```java
// BAD: return null;
// GOOD:
public Optional<User> findById(String id) {
    return Optional.ofNullable(userMap.get(id));
}

// BAD: if (optional.isPresent()) optional.get()
// GOOD:
optional.map(User::name).orElse("Anonymous");
```

---

## Error Handling

### Custom Exceptions with Context

```java
public class EntityNotFoundException extends RuntimeException {
    private final String entityType;
    private final String entityId;

    public EntityNotFoundException(String entityType, String entityId) {
        super("%s with id %s not found".formatted(entityType, entityId));
        this.entityType = entityType;
        this.entityId = entityId;
    }
}
```

### Try-with-Resources

```java
// Always use try-with-resources for AutoCloseable
try (var conn = dataSource.getConnection();
     var stmt = conn.prepareStatement(sql)) {
    stmt.setString(1, id);
    return mapResult(stmt.executeQuery());
}
```

---

## Immutability

```java
// Prefer unmodifiable collections
List<String> names = List.of("Alice", "Bob");
Map<String, Integer> scores = Map.of("Alice", 100, "Bob", 95);

// Defensive copies in constructors
public final class Team {
    private final List<String> members;
    public Team(List<String> members) {
        this.members = List.copyOf(members);
    }
    public List<String> members() { return members; }
}
```

---

## Composition Over Inheritance

```java
// BAD: class UserService extends BaseService extends AbstractDAO
// GOOD: compose via constructor injection
public class UserService {
    private final UserRepository repository;
    private final EventPublisher events;

    public UserService(UserRepository repository, EventPublisher events) {
        this.repository = repository;
        this.events = events;
    }
}
```

---

## Anti-Patterns

| Pattern | Bad | Good |
|---------|-----|------|
| Returning null | `return null` | `return Optional.empty()` |
| Checked exception abuse | `throws Exception` | Specific exceptions or unchecked |
| Raw types | `List list` | `List<User> list` |
| Deep inheritance | 4+ level hierarchy | Interfaces + composition |
| Mutable data objects | `setName()/getName()` | Records or immutable classes |

---

## Extended References

For additional patterns and examples:
- `references/violations.md` - Common Java violations
- `references/patterns.md` - Extended Java patterns
- `references/detection.md` - Detection patterns for Java issues
- `references/modern-java.md` - Modern Java features (17-21+)

---

## Checklist

- [ ] Records for pure data types
- [ ] Sealed interfaces for type hierarchies
- [ ] Optional instead of null returns
- [ ] Composition over inheritance
- [ ] Try-with-resources for all AutoCloseable
- [ ] Immutable collections (List.of, Map.of)
- [ ] No raw generic types
- [ ] Custom exceptions with context
- [ ] Streams for collection transforms
- [ ] Constructor injection for dependencies
