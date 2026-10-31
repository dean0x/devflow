---
name: java
description: This skill should be used when the user works with Java files (.java), asks about "records", "sealed classes", "streams", or discusses modern Java patterns.
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

## Iron Law

> **Favor composition over inheritance**
>
> Delegation and interfaces over class hierarchies. Inheritance creates tight coupling,
> breaks encapsulation, and makes refactoring dangerous. Use interfaces for polymorphism,
> records for data, and sealed classes for restricted hierarchies. Extend only when the
> "is-a" relationship is genuinely invariant. — Effective Java, Item 18

## Type System (Modern Java)

- Use records for pure data, not mutable POJOs with `setName()/getName()`. Validate in the compact constructor (`Objects.requireNonNull`).
- Use sealed interfaces for type hierarchies. They close the subtype set, so a switch over them is exhaustive with no `default`:

```java
public sealed interface Result<T> permits Success, Failure {
    record Success<T>(T value) implements Result<T> {}
    record Failure<T>(String error) implements Result<T> {}
}
switch (result) {
    case Success<User> s -> handleSuccess(s.value());
    case Failure<User> f -> handleError(f.error());
}
```

- Never return `null`: return `Optional`, and chain with `map`/`orElse`, not `isPresent()`/`get()`.
- No raw generic types: `List<User>`, not `List`.

## Error Handling

- Use try-with-resources for every `AutoCloseable` resource.
- Throw specific or unchecked custom exceptions that carry structured fields for context, not `throws Exception`.

## Immutability and Composition

- Prefer `List.of`/`Map.of`. Make defensive copies in constructors with `List.copyOf`.
- Do not share mutable state across threads (`HashMap`): use `ConcurrentHashMap` or immutable data.
- Constructor-inject collaborators. Never extend a class only to reuse methods; replace deep hierarchies (4+ levels) with interfaces and composition.
- Use streams for collection transforms.

## Extended References

- `references/sources.md` — Full bibliography
- `references/violations.md` — Common Java violations with citations
- `references/patterns.md` — Extended Java patterns with citations
- `references/detection.md` — Detection patterns for Java issues
- `references/modern-java.md` — Modern Java features (17-21+) with JEP citations
