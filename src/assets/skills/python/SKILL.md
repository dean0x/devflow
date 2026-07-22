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

## Iron Law

> **EXPLICIT IS BETTER THAN IMPLICIT** [3]
>
> Type-hint every function signature. Name every exception. Use dataclasses over raw
> dicts. Python's flexibility is a strength only when boundaries are explicit.

## When This Skill Activates

Working with Python codebases, designing typed APIs, modeling data with dataclasses
or Pydantic, implementing async code, structuring Python packages.

---

## Type Safety

### Type Hint Everything [4][17][18]

```python
# BAD: def process(data, config): ...
def process(data: list[dict[str, Any]], config: AppConfig) -> ProcessResult: ...
```

Dropbox's 4M-line mypy migration eliminated entire bug classes [18]. Use
`from __future__ import annotations` for forward references [22].

### Protocols for Structural Typing [5][1]

```python
from typing import Protocol

class Repository(Protocol):
    def find_by_id(self, id: str) -> User | None: ...
    def save(self, entity: User) -> User: ...
```

PEP 544 formalizes duck typing as "static duck typing" — no `implements`
required [5]. Any class with matching methods satisfies the Protocol [1].

### Strict Optional Handling [4][23]

PEP 604 `X | Y` syntax replaces verbose `Optional[X]` [23]:

```python
def get_name(user: User | None) -> str:
    return "Anonymous" if user is None else user.name
```

---

## Error Handling [2][8][9]

```python
class AppError(Exception): ...

class NotFoundError(AppError):
    def __init__(self, entity: str, id: str) -> None:
        super().__init__(f"{entity} {id} not found")
        self.entity, self.id = entity, id

@contextmanager
def database_transaction(conn: Connection):
    try:
        yield conn; conn.commit()
    except Exception:
        conn.rollback(); raise
```

Google Style Guide prohibits bare `except:` — catches `SystemExit` [8].
Cosmic Python wraps the unit-of-work in a context manager [9].

---

## Data Modeling [6][12][14]

```python
# Internal value objects — frozen enforces immutability [6][14]
@dataclass(frozen=True)
class User:
    name: str
    email: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

# API boundary models — Pydantic validates on instantiation [12]
class CreateUserRequest(BaseModel):
    name: str
    email: EmailStr
    age: int = Field(ge=0, le=150)
```

PEP 557 gives `__init__`, `__repr__`, `__eq__` for free [6]. Use `@dataclass` for
domain objects and Pydantic for API models — not interchangeably [9][12].

---

## Pythonic Patterns [2][3]

```python
names = [u.name for u in users if u.active]  # comprehension over loop [2]
for i, item in enumerate(items): ...          # enumerate, not range(len) [2]
try:                                          # EAFP over LBYL [3]
    value = mapping[key]
except KeyError:
    value = default
```

---

## Anti-Patterns [2][8][14][4]

| Pattern | Violation | Fix |
|---------|-----------|-----|
| Bare except | `except:` | `except (ValueError, KeyError):` [8] |
| Mutable default | `def fn(items=[])` | `def fn(items: list \| None = None)` [2] |
| No type hints | `def process(data)` | Annotate params + return [4] |
| Forward ref string | `x: "MyClass"` | `from __future__ import annotations` [22] |
| God class | 50-method class | Compose smaller focused classes [9] |

---

## Extended References

- `references/sources.md` — Full bibliography (25 sources)
- `references/patterns.md` — Extended patterns: DI, decorators, fixtures [2][9][10][13]
- `references/violations.md` — Violation examples with citations
- `references/detection.md` — Grep patterns for Python issues
- `references/async.md` — Async patterns: gather, TaskGroup, generators [1][16]

---

## Checklist

- [ ] All functions annotated (params + return) [4]
- [ ] Custom exception types, no bare `except:` [8]
- [ ] Dataclasses or Pydantic for structured data [6][12]
- [ ] No mutable default arguments [2]
- [ ] Context managers for resource cleanup [10]
- [ ] `from __future__ import annotations` for forward refs [22]
- [ ] Protocols over ABC for structural typing [5]
- [ ] Tests use pytest fixtures, no repeated setup [13]
