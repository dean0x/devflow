# Go Correct Patterns

Extended correct patterns for Go development. Reference from main SKILL.md.

## Table-Driven Tests

```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive numbers", 2, 3, 5},
        {"negative numbers", -1, -2, -3},
        {"zero", 0, 0, 0},
        {"mixed signs", -1, 3, 2},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := Add(tt.a, tt.b)
            if result != tt.expected {
                t.Errorf("Add(%d, %d) = %d, want %d", tt.a, tt.b, result, tt.expected)
            }
        })
    }
}
```

---

## Functional Options

```go
type Server struct {
    addr    string
    timeout time.Duration
    logger  *slog.Logger
}

type Option func(*Server)

func WithAddr(addr string) Option {
    return func(s *Server) { s.addr = addr }
}

func WithTimeout(d time.Duration) Option {
    return func(s *Server) { s.timeout = d }
}

func WithLogger(l *slog.Logger) Option {
    return func(s *Server) { s.logger = l }
}

func NewServer(opts ...Option) *Server {
    s := &Server{
        addr:    ":8080",           // sensible default
        timeout: 30 * time.Second,  // sensible default
        logger:  slog.Default(),
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Usage
srv := NewServer(
    WithAddr(":9090"),
    WithTimeout(60 * time.Second),
)
```

---

## Custom Error Types

```go
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %s: %s", e.Field, e.Message)
}

type NotFoundError struct {
    Resource string
    ID       string
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s %s not found", e.Resource, e.ID)
}

// Usage with errors.As
func handleErr(err error) {
    var validErr *ValidationError
    if errors.As(err, &validErr) {
        log.Printf("bad input: field=%s msg=%s", validErr.Field, validErr.Message)
        return
    }
    var notFound *NotFoundError
    if errors.As(err, &notFound) {
        log.Printf("missing: %s/%s", notFound.Resource, notFound.ID)
        return
    }
    log.Printf("unexpected: %v", err)
}
```

---

## Middleware Pattern

```go
type Middleware func(http.Handler) http.Handler

func Logging(logger *slog.Logger) Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            start := time.Now()
            next.ServeHTTP(w, r)
            logger.Info("request",
                "method", r.Method,
                "path", r.URL.Path,
                "duration", time.Since(start),
            )
        })
    }
}

func Recovery() Middleware {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            defer func() {
                if err := recover(); err != nil {
                    w.WriteHeader(http.StatusInternalServerError)
                    slog.Error("panic recovered", "error", err)
                }
            }()
            next.ServeHTTP(w, r)
        })
    }
}

// Chain composes middleware in order
func Chain(handler http.Handler, middlewares ...Middleware) http.Handler {
    for i := len(middlewares) - 1; i >= 0; i-- {
        handler = middlewares[i](handler)
    }
    return handler
}

// Usage
mux := http.NewServeMux()
mux.HandleFunc("/api/users", handleUsers)
handler := Chain(mux, Recovery(), Logging(logger))
```

---

## Graceful Shutdown

```go
func main() {
    srv := &http.Server{Addr: ":8080", Handler: mux}

    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            slog.Error("server error", "error", err)
        }
    }()

    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    if err := srv.Shutdown(ctx); err != nil {
        slog.Error("shutdown error", "error", err)
    }
    slog.Info("server stopped")
}
```

---

## Constructor Pattern

```go
// Validate at construction - enforce invariants
func NewUser(name, email string) (*User, error) {
    if name == "" {
        return nil, &ValidationError{Field: "name", Message: "required"}
    }
    if !strings.Contains(email, "@") {
        return nil, &ValidationError{Field: "email", Message: "invalid format"}
    }
    return &User{
        ID:        uuid.New().String(),
        Name:      name,
        Email:     email,
        CreatedAt: time.Now(),
    }, nil
}
```

---

## Structured Logging with slog

```go
func ProcessOrder(ctx context.Context, orderID string) error {
    logger := slog.With("order_id", orderID, "trace_id", traceID(ctx))

    logger.Info("processing order")

    items, err := fetchItems(ctx, orderID)
    if err != nil {
        logger.Error("failed to fetch items", "error", err)
        return fmt.Errorf("fetching items for order %s: %w", orderID, err)
    }

    logger.Info("items fetched", "count", len(items))
    return nil
}
```
