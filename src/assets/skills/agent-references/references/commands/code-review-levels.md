# Code review: focus sets by gate level

## Sets

Each cell narrows one class's full set. `keep:` leaves only the named focuses; `drop:` removes them. A cell never adds a focus.

| Class | standard | lean |
|-------|----------|------|
| `code` | drop: typescript, dependencies (dependencies stays when a listed manifest changed) | keep: security, testing, reliability, compliance |
| `docs-only` | keep: documentation, consistency, security | keep: documentation, consistency, security |
| `tests-only` | keep: testing, reliability, consistency, security | keep: testing, reliability, security |
| `lockfile-only` | keep: dependencies, security | keep: dependencies, security |

## Rules

- **Manifests:** `package.json`, `go.mod`, `go.work`, `Cargo.toml`, `pyproject.toml`, `requirements*.txt`, `CMakeLists.txt`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle*`, `setup.py`, `setup.cfg`, `Pipfile`, `*.csproj`, `Directory.*.props`, `Package.swift`, `Podfile`, `pubspec.yaml`, `build.sbt`, `mix.exs`, `deno.json`. A path matches by file name. A lockfile alone is not a manifest change.
- **Mixed diff:** apply each class's row to that class's own set, then take the union of the results, with no further cap.
- **Security:** every cell keeps `security`.
- **Compliance:** only the command's own trigger adds `compliance`, on the `code` class.
