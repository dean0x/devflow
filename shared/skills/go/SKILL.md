---
name: go
description: This skill should be used when the user works with Go files (.go), asks about "error handling", "interfaces", "goroutines", "channels", "packages", or discusses Go idioms and concurrency. Provides patterns for error handling, interface design, concurrency, and package organization.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.go"
  exclude:
    - "vendor/**"
---

# Go Patterns

Reference for Go-specific patterns, idioms, and best practices. Full bibliography: `references/sources.md`.

## Iron Law

> **ERRORS ARE VALUES** [5][7]
>
> Never ignore errors. `if err != nil` is correctness, not boilerplate. Every error
> return must be checked, wrapped with context, or explicitly documented as intentionally
> ignored with `_ = fn()`. "Errors are values. Values can be programmed." — Rob Pike [5]

## When This Skill Activates

Working with Go codebases — error handling, interfaces, goroutines, channels, packages.

---

## Error Handling [5][6]

```go
// BAD: return err  — caller loses context
// GOOD: return fmt.Errorf("reading config %s: %w", path, err)

var ErrNotFound = errors.New("not found")

func FindUser(id string) (*User, error) {
    u, err := db.Get(id)
    if err != nil {
        return nil, fmt.Errorf("finding user %s: %w", id, err)
    }
    if u == nil { return nil, ErrNotFound }
    return u, nil
}
// Caller: if errors.Is(err, ErrNotFound) { ... }
```

---

## Interface Design [7][14]

```go
// "The bigger the interface, the weaker the abstraction" — Rob Pike [7]
// BAD: func NewService(repo *PostgresRepo) *Service
// GOOD: func NewService(repo Repository) *Service — accept interfaces [14]

// Small interfaces compose cleanly [1]
type Reader interface { Read(p []byte) (n int, err error) }
type Writer interface { Write(p []byte) (n int, err error) }
type ReadWriter interface { Reader; Writer }
```

---

## Concurrency [9][10][13]

CSP (Hoare [9]): "Do not communicate by sharing memory; share memory by communicating." [10]

```go
// Context cancellation with errgroup [16][22]
func Process(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, item := range items {
        g.Go(func() error { return processItem(ctx, item) })
    }
    return g.Wait()
}

// Channel direction prevents misuse at compile time [1][8]
func producer(ch chan<- int) { ch <- 42 }
func consumer(ch <-chan int) { v := <-ch; _ = v }
```

---

## Package Design [15][17]

```go
// BAD: models/, controllers/, services/
// GOOD: user/, order/, payment/  — organize by domain [15]

func (s *Service) validate(u *User) error { ... }   // unexported — internal only
func (s *Service) CreateUser(ctx context.Context, req CreateUserReq) (*User, error) { ... }
```

---

## Zero Values [1]

```go
var mu sync.Mutex; var buf bytes.Buffer  // Ready to use — no init needed

type Config struct {
    Timeout time.Duration // zero = no timeout
    Retries int           // zero = no retries
}
```

---

## Anti-Patterns

| Pattern | Violation | Source |
|---------|-----------|--------|
| Ignoring error | `val, _ := fn()` | [5][2] |
| Naked return | `return` in named returns | [2][4] |
| init() abuse | Complex `init()` with side effects | [1][12] |
| Interface pollution | Interface defined before use | [14][7] |
| Goroutine leak | `go fn()` without lifecycle | [13][16] |
| Panic in library | `panic(err)` in non-main code | [1][4] |

---

## Extended References

- `references/sources.md` — Full bibliography (25 sources)
- `references/violations.md` — Violations with citations [5][6][7][12][13]
- `references/patterns.md` — Extended patterns with citations [1][3][11][18][19]
- `references/detection.md` — Grep patterns for automated detection
- `references/concurrency.md` — CSP-grounded concurrency patterns [9][10][13][22]

---

## Checklist

- [ ] All errors checked or explicitly ignored with `_ =` [5]
- [ ] Errors wrapped with `fmt.Errorf("context: %w", err)` [6]
- [ ] Interfaces defined at consumer, not producer [14]
- [ ] Interfaces kept small (1-3 methods) [7]
- [ ] Context as first parameter [16]
- [ ] Goroutines have clear lifecycle/cancellation [13]
- [ ] Channel direction specified in signatures [8]
- [ ] Packages organized by domain, not by type [15]
- [ ] No `init()` with side effects [1]
- [ ] No `panic` or `log.Fatal` in library code [4]
