# Detection Patterns for Java Issues

Grep and regex patterns for automated detection of Java violations. Reference from main SKILL.md.

---

## Null Returns

```bash
# Methods returning null instead of Optional
rg 'return\s+null\s*;' --type java

# Nullable method parameters without validation
rg 'public\s+\w+\s+\w+\((?!.*@NonNull).*\)' --type java
```

---

## Raw Types

```bash
# Raw List, Map, Set, Collection usage
rg '\b(List|Map|Set|Collection|Iterator|Iterable)\b(?!\s*<)' --type java

# Raw Comparable implementation
rg 'implements\s+Comparable\b(?!\s*<)' --type java

# Unsafe casts from Object
rg '\(\s*(String|Integer|Long|Double)\s*\)\s*\w+\.get' --type java
```

---

## Deep Inheritance

```bash
# Classes extending non-Object/non-interface classes (potential deep hierarchy)
rg 'class\s+\w+\s+extends\s+(?!Object\b)\w+' --type java

# Abstract class chains (look for multiple levels)
rg 'abstract\s+class\s+\w+\s+extends\s+Abstract' --type java

# Count inheritance depth per file
rg 'extends\s+\w+' --type java --count
```

---

## Missing Try-with-Resources

```bash
# Manual close() calls (should use try-with-resources)
rg '\.close\(\)\s*;' --type java

# InputStream/OutputStream/Connection created outside try-with-resources
rg 'new\s+(FileInputStream|FileOutputStream|BufferedReader|BufferedWriter|Socket)\(' --type java

# getConnection() without try-with-resources context
rg '\.getConnection\(\)' --type java
```

---

## Checked Exception Abuse

```bash
# Broad throws declarations
rg 'throws\s+Exception\b' --type java

# Empty catch blocks
rg -U 'catch\s*\([^)]+\)\s*\{\s*\}' --type java --multiline

# Catch-and-ignore (catch with only a comment or log)
rg -U 'catch\s*\([^)]+\)\s*\{\s*(//|/\*|logger\.(debug|trace))' --type java --multiline
```

---

## Mutable Data Objects

```bash
# Setter methods (JavaBean anti-pattern for data objects)
rg 'public\s+void\s+set[A-Z]\w*\(' --type java

# Mutable collections returned from getters
rg 'return\s+(this\.)?(list|map|set|collection)\s*;' --type java -i

# Missing defensive copies in constructors
rg 'this\.\w+\s*=\s*\w+\s*;' --type java
```

---

## Concurrency Issues

```bash
# HashMap in concurrent context (should be ConcurrentHashMap)
rg 'new\s+HashMap\b' --type java

# Missing volatile on shared fields
rg 'private\s+(?!volatile\s)(?!final\s)\w+\s+\w+\s*=' --type java

# Synchronized on non-private lock object
rg 'synchronized\s*\(\s*this\s*\)' --type java
```

---

## Streams Anti-Patterns

```bash
# Stream.forEach with side effects (should use for-loop or collect)
rg '\.stream\(\).*\.forEach\(' --type java

# Nested streams (performance concern)
rg '\.stream\(\).*\.stream\(\)' --type java

# collect(Collectors.toList()) instead of .toList() (Java 16+)
rg 'collect\(Collectors\.toList\(\)\)' --type java
```
