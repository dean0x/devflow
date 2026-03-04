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
    - "**/*_test.go"
---

# Go Patterns

Reference for Go-specific patterns, idioms, and best practices.

## Iron Law

> **ERRORS ARE VALUES**
>
> Never ignore errors. `if err != nil` is correctness, not boilerplate. Every error
> return must be checked, wrapped with context, or explicitly documented as intentionally
> ignored with `_ = fn()`. Silent error swallowing causes cascading failures.

## When This Skill Activates

- Working with Go codebases
- Designing interfaces and packages
- Implementing concurrent code
- Handling errors
- Structuring Go projects

---

## Error Handling

### Wrap Errors with Context

```go
// BAD: return err
// GOOD: return fmt.Errorf("reading config %s: %w", path, err)
```

### Sentinel Errors for Expected Conditions

```go
var ErrNotFound = errors.New("not found")

func FindUser(id string) (*User, error) {
    u, err := db.Get(id)
    if err != nil {
        return nil, fmt.Errorf("finding user %s: %w", id, err)
    }
    if u == nil {
        return nil, ErrNotFound
    }
    return u, nil
}
// Caller: if errors.Is(err, ErrNotFound) { ... }
```

---

## Interface Design

### Accept Interfaces, Return Structs

```go
// BAD: func NewService(repo *PostgresRepo) *Service
// GOOD: func NewService(repo Repository) *Service

type Repository interface {
    FindByID(ctx context.Context, id string) (*Entity, error)
    Save(ctx context.Context, entity *Entity) error
}
```

### Keep Interfaces Small

```go
// BAD: 10-method interface
// GOOD: single-method interfaces composed as needed
type Reader interface { Read(p []byte) (n int, err error) }
type Writer interface { Write(p []byte) (n int, err error) }
type ReadWriter interface { Reader; Writer }
```

---

## Concurrency

### Use Context for Cancellation

```go
func Process(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, item := range items {
        g.Go(func() error {
            return processItem(ctx, item)
        })
    }
    return g.Wait()
}
```

### Channel Direction

```go
// Declare direction in function signatures
func producer(ch chan<- int) { ch <- 42 }
func consumer(ch <-chan int) { v := <-ch; _ = v }
```

---

## Package Design

### Organize by Domain, Not by Type

```go
// BAD: models/, controllers/, services/
// GOOD: user/, order/, payment/
```

### Export Only What's Needed

```go
// Internal helpers stay unexported (lowercase)
func (s *Service) validate(u *User) error { ... }

// Public API is exported (uppercase)
func (s *Service) CreateUser(ctx context.Context, req CreateUserReq) (*User, error) { ... }
```

---

## Zero Values

```go
// Use zero values as valid defaults
var mu sync.Mutex     // Ready to use
var buf bytes.Buffer  // Ready to use
var wg sync.WaitGroup // Ready to use

// Design types with useful zero values
type Config struct {
    Timeout time.Duration // zero = no timeout
    Retries int           // zero = no retries
}
```

---

## Anti-Patterns

| Pattern | Bad | Good |
|---------|-----|------|
| Ignoring error | `val, _ := fn()` | `val, err := fn(); if err != nil { ... }` |
| Naked return | `return` in named returns | Explicit `return val, err` |
| init() abuse | Complex `init()` functions | Explicit initialization in `main()` or constructors |
| Interface pollution | Defining interfaces before use | Define interfaces at the consumer site |
| Goroutine leak | `go fn()` without lifecycle | Use context, errgroup, or done channels |

---

## Extended References

For additional patterns and examples:
- `references/violations.md` - Common Go violations
- `references/patterns.md` - Extended Go patterns
- `references/detection.md` - Detection patterns for Go issues
- `references/concurrency.md` - Advanced concurrency patterns

---

## Checklist

- [ ] All errors checked or explicitly ignored with `_ =`
- [ ] Errors wrapped with `fmt.Errorf("context: %w", err)`
- [ ] Interfaces defined at consumer, not producer
- [ ] Interfaces kept small (1-3 methods)
- [ ] Context passed as first parameter
- [ ] Goroutines have clear lifecycle/cancellation
- [ ] Channel direction specified in signatures
- [ ] Zero values are useful defaults
- [ ] Packages organized by domain
- [ ] No `init()` with side effects
