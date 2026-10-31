---
name: go
description: This skill should be used when the user works with Go files (.go), asks about "error handling", "interfaces", "goroutines", or discusses Go idioms and concurrency.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.go"
  exclude:
    - "vendor/**"
---

# Go Patterns

Full bibliography: `references/sources.md`.

## Iron Law

> **ERRORS ARE VALUES** [5][7]
>
> Never ignore errors. `if err != nil` is correctness, not boilerplate. Every error
> return must be checked, wrapped with context, or explicitly documented as intentionally
> ignored with `_ = fn()`. "Errors are values. Values can be programmed." — Rob Pike [5]

## Error Handling

- Wrap with context, `return fmt.Errorf("finding user %s: %w", id, err)`, not a bare `return err`: the caller loses context.
- Declare sentinel errors (`var ErrNotFound = errors.New("not found")`) and match them with `errors.Is`.
- Never discard an error with `val, _ := fn()`: check it, wrap it, or ignore it on purpose with `_ = fn()`.
- No `panic` or `log.Fatal` in library code.

## Interface Design

- Accept interfaces: `NewService(repo Repository)`, not `NewService(repo *PostgresRepo)`.
- Define an interface at the consumer when it is used, not at the producer before use.
- Keep interfaces small (1-3 methods) and compose them (`ReadWriter` embeds `Reader` and `Writer`).

## Concurrency

- Do not communicate by sharing memory; share memory by communicating.
- Pass `context.Context` as the first parameter.
- Give every goroutine a clear lifecycle and cancellation, for example `errgroup.WithContext`. A bare `go fn()` leaks.
- Specify channel direction in signatures: `chan<- int`, `<-chan int`.

## Package Design and Zero Values

- Organize packages by domain (`user/`, `order/`), not by type (`models/`, `controllers/`). Keep internals unexported.
- Make zero values ready to use (`sync.Mutex`, `bytes.Buffer`; a zero `Timeout` means no timeout).
- No naked `return` in functions with named returns.
- No complex `init()` with side effects.

## Extended References

- `references/sources.md` — Full bibliography
- `references/violations.md` — Violations with citations
- `references/patterns.md` — Extended patterns with citations
- `references/detection.md` — Grep patterns for automated detection
- `references/concurrency.md` — CSP-grounded concurrency patterns
