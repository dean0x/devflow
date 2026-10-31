---
name: python
description: This skill should be used when the user works with Python files (.py), asks about "type hints", "protocols", "dataclasses", "async/await", or discusses Pythonic patterns.
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

## Type Safety

- Annotate every parameter and the return: `def process(data: list[dict[str, Any]], config: AppConfig) -> ProcessResult`, not `def process(data, config)`.
- Use `from __future__ import annotations` for forward references, not string annotations (`x: "MyClass"`).
- Use `Protocol` for structural typing, over ABC: any class with matching methods satisfies it, with no `implements`.
- Write optionals as `User | None` (PEP 604), not `Optional[User]`, and handle `None` explicitly.

## Error Handling

- Define custom exception types: a base `AppError(Exception)` and subclasses (`NotFoundError`) that carry structured fields (`entity`, `id`).
- Catch named exceptions, `except (ValueError, KeyError):`. Never a bare `except:`: it catches `SystemExit`.
- Use context managers for resource cleanup and the unit of work: commit on success, roll back and re-raise on error.

## Data Modeling

- Use `@dataclass(frozen=True)` for internal value objects, with `field(default_factory=...)` for computed defaults.
- Use Pydantic models at API boundaries: they validate on instantiation (`EmailStr`, `Field(ge=0, le=150)`).
- Use `@dataclass` for domain objects and Pydantic for API models — not interchangeably, and not raw dicts.

## Pythonic Patterns

- Comprehensions over loops: `[u.name for u in users if u.active]`.
- `enumerate(items)`, not `range(len(items))`.
- EAFP over LBYL: `try: value = mapping[key]` with `except KeyError`.
- No mutable default arguments: `def fn(items: list | None = None)`, not `def fn(items=[])`.
- Compose smaller focused classes, not a 50-method god class.
- Tests use pytest fixtures, no repeated setup.

## Extended References

- `references/sources.md` — Full bibliography
- `references/patterns.md` — Extended patterns: DI, decorators, fixtures
- `references/violations.md` — Violation examples with citations
- `references/detection.md` — Grep patterns for Python issues
- `references/async.md` — Async patterns: gather, TaskGroup, generators
