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
> "is-a" relationship is genuinely invariant. — Effective Java, Item 18 [1, Item 18]

## When This Skill Activates

- Working with Java codebases (records, sealed classes, Optional, streams)
- Implementing concurrent code or API design
- Structuring Java packages and dependencies

---

## Type System (Modern Java)

**Records for data** [4][9] — Immutable carriers with auto-generated `equals`/`hashCode`/
`toString`. Compact constructors validate before fields are sealed.

```java
// BAD: Mutable POJO. GOOD: Immutable record [1, Item 17][4]
public record User(String name, String email, Instant createdAt) {
    public User {
        Objects.requireNonNull(name); Objects.requireNonNull(email);
    }
}
```

**Sealed classes** [5][9] — Close the subtype set, enabling exhaustive pattern matching. [6]

```java
public sealed interface Result<T> permits Success, Failure {
    record Success<T>(T value) implements Result<T> {}
    record Failure<T>(String error) implements Result<T> {}
}
// Exhaustive — no default needed [6]
switch (result) {
    case Success<User> s -> handleSuccess(s.value());
    case Failure<User> f -> handleError(f.error());
}
```

**Optional for absent values** [1, Item 22][25] — Never return `null`. Use functional
chaining (`map`/`orElse`), not `isPresent()`/`get()`.

```java
public Optional<User> findById(String id) { return Optional.ofNullable(userMap.get(id)); }
optional.map(User::name).orElse("Anonymous");
```

---

## Error Handling

All `AutoCloseable` resources MUST use try-with-resources. [1] Custom unchecked exceptions
carry structured fields for precise handling. [3]

```java
try (var conn = dataSource.getConnection(); var stmt = conn.prepareStatement(sql)) {
    stmt.setString(1, id); return mapResult(stmt.executeQuery());
}
```

---

## Immutability [1, Item 17]

Prefer `List.of`/`Map.of`. Make defensive copies in constructors via `List.copyOf`. [1, Item 17][2]

```java
public final class Team {
    private final List<String> members;
    public Team(List<String> members) { this.members = List.copyOf(members); }
    public List<String> members() { return members; }
}
```

---

## Composition Over Inheritance [1, Item 18]

Constructor-inject collaborators. Never extend a class solely to reuse methods. [1, Item 18][14]

```java
// BAD: class UserService extends BaseService extends AbstractDAO
// GOOD: inject repository and eventBus as constructor parameters [1, Item 18]
public class UserService {
    public UserService(UserRepository repository, EventPublisher events) { ... }
}
```

---

## Anti-Patterns

| Pattern | Bad | Good | Source |
|---------|-----|------|--------|
| Returning null | `return null` | `return Optional.empty()` | [1, Item 22] |
| Checked exception abuse | `throws Exception` | Specific or unchecked | [1] |
| Raw types | `List list` | `List<User> list` | [1, Item 26][3] |
| Deep inheritance | 4+ level hierarchy | Interfaces + composition | [1, Item 18][14] |
| Mutable data objects | `setName()/getName()` | Records or immutable classes | [1, Item 17][4] |
| Shared mutable state | `HashMap` across threads | `ConcurrentHashMap` or immutable | [2][12] |

---

## Extended References

- `references/sources.md` — Full bibliography (28 sources)
- `references/violations.md` — Common Java violations with citations
- `references/patterns.md` — Extended Java patterns with citations
- `references/detection.md` — Detection patterns for Java issues
- `references/modern-java.md` — Modern Java features (17-21+) with JEP citations

---

## Checklist

- [ ] Records for pure data types [4]
- [ ] Sealed interfaces for type hierarchies [5]
- [ ] Optional instead of null returns [1, Item 22]
- [ ] Composition over inheritance [1, Item 18]
- [ ] Try-with-resources for all AutoCloseable [3]
- [ ] Immutable collections (List.of, Map.of) [1, Item 17]
- [ ] No raw generic types [1, Item 26]
- [ ] Custom exceptions with context [1]
- [ ] Streams for collection transforms [10][26]
- [ ] Constructor injection for dependencies [1, Item 18]
