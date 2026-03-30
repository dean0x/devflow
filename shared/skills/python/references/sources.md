# Python Skill — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | "Fluent Python" 2nd Ed | Luciano Ramalho | 2022 | Purchase | Data model, protocols, iterators, async, descriptors |
| 2 | "Effective Python" 2nd Ed | Brett Slatkin | 2020 | Purchase | 90 items for Pythonic code, type hints, concurrency |
| 3 | PEP 20: The Zen of Python | Tim Peters | 2004 | [Free](https://peps.python.org/pep-0020/) | Core philosophy — explicit, simple, readable |
| 4 | PEP 484: Type Hints | van Rossum, Lehtosalo, Langa | 2014 | [Free](https://peps.python.org/pep-0484/) | Type annotation foundation, Optional, Union, generics |
| 5 | PEP 544: Protocols — Structural subtyping | Levkivskyi, Lehtosalo, van Rossum | 2017 | [Free](https://peps.python.org/pep-0544/) | Structural subtyping, duck typing formalized |
| 6 | PEP 557: Data Classes | Eric V. Smith | 2017 | [Free](https://peps.python.org/pep-0557/) | Dataclass decorator, frozen, field, default_factory |
| 7 | PEP 695: Type Parameter Syntax | Python 3.12 | 2023 | [Free](https://peps.python.org/pep-0695/) | Generic syntax `type[T]`, new `type` statement |
| 8 | Google Python Style Guide | Google | 2024 | [Free](https://google.github.io/styleguide/pyguide.html) | Naming, formatting, imports, docstrings |
| 9 | "Architecture Patterns with Python" (Cosmic Python) | Percival & Gregory | 2020 | [Free](https://www.cosmicpython.com) | DDD, repository pattern, CQRS, dependency injection |
| 10 | "Python Cookbook" 3rd Ed | Beazley & Jones | 2013 | Purchase | Advanced recipes, metaprogramming, decorators |
| 11 | mypy Documentation | mypy-lang.org | 2024 | [Free](https://mypy.readthedocs.io) | Static type checking, strict mode, ignore patterns |
| 12 | Pydantic Documentation | Samuel Colvin | 2024 | [Free](https://docs.pydantic.dev) | Data validation, model_validate, field validators |
| 13 | pytest Documentation | pytest.org | 2024 | [Free](https://docs.pytest.org) | Testing framework, fixtures, parametrize, plugins |
| 14 | "Robust Python" | Patrick Viafore | 2021 | Purchase | Type-driven design, user-defined types, protocols |
| 15 | PEP 3107: Function Annotations | Collin Winter | 2006 | [Free](https://peps.python.org/pep-3107/) | Annotation syntax origin, `__annotations__` |
| 16 | asyncio Documentation | Python.org | 2024 | [Free](https://docs.python.org/3/library/asyncio.html) | Event loop, tasks, gather, TaskGroup, timeout |
| 17 | "Python Type Checking" | Geir Arne Hjelle | 2023 | [Free](https://realpython.com/python-type-checking/) | Type hints tutorial, mypy walkthrough |

## Case Studies & Design

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 18 | Dropbox typing case study | Jukka Lehtosalo | 2018 | [Free](https://dropbox.tech/application/our-journey-to-type-checking-4-million-lines-of-python) | Large-scale typing migration, mypy at Dropbox |
| 19 | "Making wrong code look wrong" | Joel Spolsky | 2005 | [Free](https://www.joelonsoftware.com/2005/05/11/making-wrong-code-look-wrong/) | Type naming, Hungarian notation to type hints |
| 20 | structlog Documentation | Hynek Schlawack | 2024 | [Free](https://www.structlog.org) | Structured logging, context binding, processors |

## PEP Progression

| # | Source | Year | Access | Topics |
|---|--------|------|--------|--------|
| 21 | PEP 526: Variable Annotations | 2016 | [Free](https://peps.python.org/pep-0526/) | Class-level and variable annotation syntax |
| 22 | PEP 563: Postponed Evaluation of Annotations | 2017 | [Free](https://peps.python.org/pep-0563/) | `from __future__ import annotations` — forward refs |
| 23 | PEP 604: Union Types with `\|` | 2020 | [Free](https://peps.python.org/pep-0604/) | `X \| Y` syntax replacing `Union[X, Y]` |
| 24 | PEP 634: Structural Pattern Matching | 2020 | [Free](https://peps.python.org/pep-0634/) | `match`/`case` statement, structural patterns |
| 25 | PEP 673: Self Type | 2021 | [Free](https://peps.python.org/pep-0673/) | `Self` type for methods returning same class |
