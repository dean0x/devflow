---
paths: ["**/*.py"]
---
# Python

**Type-hint every function signature — no untyped public APIs.**

- Dataclasses over raw dicts for structured data
- Protocols for structural typing — avoid deep inheritance
- Explicit `__all__` exports in every module
- Context managers for resource lifecycle
- Cap retries, pagination, and iteration — every loop needs max_iterations or itertools.islice
