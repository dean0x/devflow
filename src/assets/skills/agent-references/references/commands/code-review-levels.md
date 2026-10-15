# Code review: focus sets by gate level

## Sets

Each cell narrows one class's full-level set. `keep:` leaves only the named focuses the set holds; `drop:` removes the named focuses. A cell never adds a focus.

| Class | standard | lean |
|-------|----------|------|
| `code` | drop: typescript, dependencies (dependencies stays when a listed manifest changed) | keep: security, testing, reliability, compliance |
| `docs-only` | keep: documentation, consistency, security | keep: documentation, consistency, security |
| `tests-only` | keep: testing, reliability, consistency, security | keep: testing, reliability, security |
| `lockfile-only` | keep: dependencies, security | keep: dependencies, security |

## Rules

- **Manifests:** `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `requirements*.txt`, `CMakeLists.txt`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `setup.py`, `setup.cfg`, `Pipfile`. A changed path matches when its file name is one of these. A lockfile alone is not a manifest change.
- **Mixed diff:** apply each class's row to that class's own set, then take the union of the results, with no further cap.
- **Security:** every cell keeps `security`.
- **Compliance:** a set holds `compliance` only when the command's own trigger added it, on the `code` class. This file never adds it.
