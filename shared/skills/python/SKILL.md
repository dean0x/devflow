---
name: python
description: This skill should be used when the user works with Python files (.py), asks about "type hints", "protocols", "dataclasses", "async/await", "decorators", or discusses Pythonic patterns and data modeling. Provides patterns for type safety, error handling, data modeling, and async programming.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.py"
  exclude:
    - "venv/**"
    - ".venv/**"
    - "**/__pycache__/**"
---

# Python Patterns

Reference for Python-specific patterns, type safety, and idioms.

## Iron Law

> **EXPLICIT IS BETTER THAN IMPLICIT**
>
> Type-hint every function signature. Name every exception. Use dataclasses over raw dicts.
> Python's flexibility is a strength only when boundaries are explicit. Implicit behavior
> causes debugging nightmares and makes codebases hostile to newcomers.

## When This Skill Activates

- Working with Python codebases
- Designing typed APIs with type hints
- Modeling data with dataclasses or Pydantic
- Implementing async code
- Structuring Python packages

---

## Type Safety

### Type Hint Everything

```python
# BAD: def process(data, config): ...
# GOOD:
def process(data: list[dict[str, Any]], config: AppConfig) -> ProcessResult:
    ...
```

### Use Protocols for Structural Typing

```python
from typing import Protocol

class Repository(Protocol):
    def find_by_id(self, id: str) -> User | None: ...
    def save(self, entity: User) -> User: ...

# Any class with these methods satisfies Repository — no inheritance needed
```

### Strict Optional Handling

```python
# BAD: def get_name(user): return user.name
# GOOD:
def get_name(user: User | None) -> str:
    if user is None:
        return "Anonymous"
    return user.name
```

---

## Error Handling

### Custom Exception Hierarchies

```python
class AppError(Exception):
    """Base application error."""

class NotFoundError(AppError):
    def __init__(self, entity: str, id: str) -> None:
        super().__init__(f"{entity} {id} not found")
        self.entity = entity
        self.id = id

class ValidationError(AppError):
    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"Validation failed for {field}: {message}")
```

### Context Managers for Resources

```python
from contextlib import contextmanager

@contextmanager
def database_transaction(conn: Connection):
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
```

---

## Data Modeling

### Dataclasses Over Raw Dicts

```python
# BAD: user = {"name": "Alice", "email": "alice@example.com"}
# GOOD:
@dataclass(frozen=True)
class User:
    name: str
    email: str
    created_at: datetime = field(default_factory=datetime.utcnow)
```

### Pydantic for Validation at Boundaries

```python
from pydantic import BaseModel, EmailStr

class CreateUserRequest(BaseModel):
    name: str
    email: EmailStr
    age: int = Field(ge=0, le=150)
```

---

## Pythonic Patterns

```python
# Comprehensions over loops for transforms
names = [user.name for user in users if user.active]

# Enumerate over manual index tracking
for i, item in enumerate(items):
    process(i, item)

# EAFP: Easier to Ask Forgiveness than Permission
try:
    value = mapping[key]
except KeyError:
    value = default
```

---

## Anti-Patterns

| Pattern | Bad | Good |
|---------|-----|------|
| Bare except | `except:` | `except (ValueError, KeyError):` |
| Mutable default | `def fn(items=[])` | `def fn(items: list | None = None)` |
| No type hints | `def process(data)` | `def process(data: DataFrame) -> Result` |
| String typing | `x: "MyClass"` (without reason) | `from __future__ import annotations` |
| God class | `class App` with 50 methods | Compose smaller focused classes |

---

## Extended References

For additional patterns and examples:
- `references/violations.md` - Common Python violations
- `references/patterns.md` - Extended Python patterns
- `references/detection.md` - Detection patterns for Python issues
- `references/async.md` - Async Python patterns

---

## Checklist

- [ ] All functions have type hints (params + return)
- [ ] Custom exceptions with meaningful messages
- [ ] Dataclasses or Pydantic for structured data
- [ ] No bare `except:` clauses
- [ ] No mutable default arguments
- [ ] Context managers for resource management
- [ ] `from __future__ import annotations` for forward refs
- [ ] Protocols for structural typing (not ABC unless needed)
- [ ] Comprehensions for simple transforms
- [ ] Tests use pytest with fixtures
