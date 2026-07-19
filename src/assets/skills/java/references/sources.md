# Java — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | "Effective Java" 3rd Ed. | Joshua Bloch | 2018 | Purchase | Items 1–90: APIs, generics, lambdas, concurrency, serialization — core Java best practices |
| 2 | "Java Concurrency in Practice" | Goetz, Peierls, Bloch, Bowbeer, Holmes, Lea | 2006 | Purchase | Thread safety, concurrent collections, executors, atomic variables, memory model |
| 3 | Java Language Specification (JLS 21) | Oracle | 2024 | [Free](https://docs.oracle.com/javase/specs/) | Definitive language semantics: types, expressions, execution, memory model |
| 4 | JEP 395: Records | OpenJDK | 2021 | [Free](https://openjdk.org/jeps/395) | Immutable data carriers, compact constructors, auto-generated accessors/equals/hashCode/toString |
| 5 | JEP 409: Sealed Classes | OpenJDK | 2021 | [Free](https://openjdk.org/jeps/409) | Algebraic data types, restricted class hierarchies, exhaustive pattern matching |
| 6 | JEP 441: Pattern Matching for switch | OpenJDK | 2023 | [Free](https://openjdk.org/jeps/441) | Exhaustive switch on sealed types, guarded patterns, null handling in switch |
| 7 | JEP 444: Virtual Threads | OpenJDK | 2023 | [Free](https://openjdk.org/jeps/444) | Lightweight concurrency, structured concurrency, loom project goals |
| 8 | Google Java Style Guide | Google | 2024 | [Free](https://google.github.io/styleguide/javaguide.html) | Formatting, naming conventions, programming practices |
| 9 | "Data Oriented Programming in Java" | Brian Goetz | 2022 | [Free](https://inside.java/2022/03/09/data-oriented-programming-in-java/) | Records + sealed classes + pattern matching as a programming model |
| 10 | "Modern Java in Action" 2nd Ed. | Urma, Fusco, Mycroft | 2018 | Purchase | Streams, lambdas, Optional, CompletableFuture, reactive programming |
| 11 | JSR 380: Bean Validation 2.0 | JCP | 2017 | [Free](https://beanvalidation.org/2.0/spec/) | Annotation-based validation, constraint composition, programmatic validation |
| 12 | "The JSR-133 Cookbook for Compiler Writers" | Doug Lea | 2004 | [Free](https://gee.cs.oswego.edu/dl/jmm/cookbook.html) | Java Memory Model: happens-before, volatile, synchronization mechanics |
| 13 | Baeldung Java Guides | Baeldung | 2024 | [Free](https://www.baeldung.com) | Practical tutorials: Spring, streams, testing, concurrency |
| 14 | "Design Patterns: Elements of Reusable OO Software" | Gamma, Helm, Johnson, Vlissides (GoF) | 1994 | Purchase | Strategy, Observer, Factory, Decorator, Composite — classic patterns |
| 15 | JEP 430: String Templates (Preview) | OpenJDK | 2023 | [Free](https://openjdk.org/jeps/430) | Type-safe string interpolation, template processors |

## Effective Java Item Index

| # | Item | Bloch | Topic |
|---|------|-------|-------|
| 16 | Item 18 | [1] | "Favor composition over inheritance" — Iron Law citation |
| 17 | Item 17 | [1] | "Minimize mutability" — immutable class design |
| 18 | Item 1 | [1] | "Consider static factory methods over constructors" |
| 19 | Item 15 | [1] | "Minimize mutability" companion — limit accessibility |
| 20 | Item 64 | [1] | "Refer to objects by their interfaces" |
| 21 | Item 43 | [1] | "Prefer method references to lambdas" |
| 22 | Item 55 | [1] | "Return optionals judiciously" |
| 23 | Item 78 | [1] | "Synchronize access to shared mutable data" |
| 24 | Item 80 | [1] | "Prefer executors, tasks, and streams to threads" |

## API References

| # | Source | Org | Access | Topics |
|---|--------|-----|--------|--------|
| 25 | Optional Javadoc | Oracle | [Free](https://docs.oracle.com/en/java/docs/api/java.base/java/util/Optional.html) | Optional usage patterns, API contract, when not to use |
| 26 | Stream API Javadoc | Oracle | [Free](https://docs.oracle.com/en/java/docs/api/java.base/java/util/stream/Stream.html) | Functional pipeline, collectors, parallel streams |
| 27 | CompletableFuture Javadoc | Oracle | [Free](https://docs.oracle.com/en/java/docs/api/java.base/java/util/concurrent/CompletableFuture.html) | Async composition, exception handling, combining futures |
| 28 | StructuredTaskScope Javadoc | Oracle | [Free](https://docs.oracle.com/en/java/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html) | Structured concurrency: fan-out/fan-in, failure policies |
