# Project Conventions

## Branch Naming
`{type}/{description}` — hyphen-separated. Issue-linked work uses
`{type}/{number}-{slug}`, where `{slug}` is the issue title lowercased with
non-alphanumeric characters collapsed to hyphens.

Types (inferred from issue labels when available): `feat`, `fix`, `docs`,
`chore`, `refactor` — default `feat` when no label matches.

Examples: `feat/add-login`, `feat/123-add-login-flow`, `fix/456-resolve-crash-bug`

## PR Titles
`{type}({scope}): {description}` (conventional commits; scope is common but
optional) — under 72 characters, imperative mood.

Example: `feat(auth): add login flow`

## Version PR Titles
`chore(release): v{version}`

Example: `chore(release): v1.2.3`

## Version Names
`v{semver}`

Example: `v1.2.3`

## Branching Model
Trunk-based: `main` is the sole integration branch (no `master`/`develop`/
`integration`/`trunk` in use). Feature branches merge back via squash merge.
