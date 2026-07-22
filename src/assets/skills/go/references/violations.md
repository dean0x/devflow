# Go Violation Examples

Extended violation patterns for Go reviews. Reference from main SKILL.md.
Sources in `sources.md`.

## Error Handling Violations

### Ignored Errors [5][2]

Rob Pike's core principle: errors are values and must be handled. [5]

```go
// VIOLATION: Silently discarding error [5]
data, _ := json.Marshal(user)
w.Write(data)

// VIOLATION: Error ignored in deferred call [2]
defer file.Close() // Close() returns error — should use named return or log

// VIOLATION: Swallowing error with log [6]
if err != nil {
    log.Println("something failed") // Error details lost — wrap and return instead
    return nil
}
```

### Unwrapped Errors [6][20]

Cheney's rule: always add context so callers can understand the failure chain. [6]

```go
// VIOLATION: No context on error [6]
func LoadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err // Caller has no idea what failed or which file
    }
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, err // Which unmarshal? What file?
    }
    return &cfg, nil
}

// CORRECT:
//   return nil, fmt.Errorf("loading config %s: %w", path, err)
```

---

## Goroutine Leak Violations [13][8]

### Fire-and-Forget Goroutine [13][10]

Without a lifecycle mechanism, goroutines leak — they consume memory and CPU
indefinitely. [13]

```go
// VIOLATION: No way to stop or wait for this goroutine [13]
func StartPoller() {
    go func() {
        for {
            poll()
            time.Sleep(10 * time.Second)
        }
    }()
}

// VIOLATION: Goroutine blocks forever on channel nobody reads [8]
func process(items []Item) {
    ch := make(chan Result)
    for _, item := range items {
        go func(i Item) {
            ch <- compute(i) // Blocks if nobody reads
        }(item)
    }
    result := <-ch // Only reads first result — rest leak
    _ = result
}
```

### Missing Context Cancellation [16][13]

Context is the canonical Go cancellation mechanism. Goroutines that ignore context
cannot be cancelled. [16]

```go
// VIOLATION: Goroutine ignores ctx — cannot be cancelled [16]
func Fetch(ctx context.Context, url string) ([]byte, error) {
    ch := make(chan []byte, 1)
    go func() {
        resp, _ := http.Get(url) // Ignores ctx cancellation entirely
        body, _ := io.ReadAll(resp.Body)
        ch <- body
    }()
    return <-ch, nil
}

// CORRECT: use http.NewRequestWithContext(ctx, "GET", url, nil)
```

---

## Interface Pollution Violations [7][14]

### Premature Interface Definition [14][7]

"The bigger the interface, the weaker the abstraction." — Rob Pike [7]
Interfaces should be defined at the consumer site, not the producer site. [14]

```go
// VIOLATION: Interface defined at producer — only one implementation exists [14]
package user

type UserStore interface { // Defined where the implementation lives
    Get(id string) (*User, error)
    Save(u *User) error
    Delete(id string) error
    List() ([]*User, error)
    Count() (int, error)
}

type PostgresStore struct{ db *sql.DB }
// ... implements all 5 methods
```

### God Interface [7][12]

```go
// VIOLATION: Interface too large — impossible to mock cleanly [7][12]
type Service interface {
    CreateUser(ctx context.Context, u *User) error
    GetUser(ctx context.Context, id string) (*User, error)
    UpdateUser(ctx context.Context, u *User) error
    DeleteUser(ctx context.Context, id string) error
    ListUsers(ctx context.Context) ([]*User, error)
    SendEmail(ctx context.Context, to string, body string) error
    GenerateReport(ctx context.Context) ([]byte, error)
    ProcessPayment(ctx context.Context, amt int) error
}
// CORRECT: Split by behavior — one small interface per concern
```

---

## Naked Return Violations [2][4]

```go
// VIOLATION: Naked returns obscure what's being returned [2]
func divide(a, b float64) (result float64, err error) {
    if b == 0 {
        err = errors.New("division by zero")
        return // What is result here? Zero — but not obvious
    }
    result = a / b
    return // Must trace back to find return values
}

// CORRECT: return result, err — explicit, readable
```

---

## init() Abuse Violations [1][12]

Side effects in `init()` run automatically on import, making code impossible to
test in isolation and violating explicit initialization. [1]

```go
// VIOLATION: Side effects in init — runs on import, crashes on error [1]
func init() {
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        log.Fatal(err) // Crashes on import
    }
    globalDB = db
}

// VIOLATION: Registration magic in init [12]
func init() {
    http.HandleFunc("/health", healthCheck) // Hidden route registration
    prometheus.MustRegister(requestCounter) // Panics if called twice
}

// CORRECT: Call explicit New*() / Initialize() from main()
```

---

## Panic in Library Code Violations [1][4]

`panic` and `log.Fatal` bypass Go's error return convention and deprive callers of
the ability to handle failures gracefully. [1]

```go
// VIOLATION: panic in library code — crashes callers unconditionally [4]
func ParseConfig(data []byte) *Config {
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        panic(err) // Caller has no recovery option
    }
    return &cfg
}

// CORRECT:
func ParseConfig(data []byte) (*Config, error) {
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, fmt.Errorf("parsing config: %w", err)
    }
    return &cfg, nil
}
```

---

## Mutex Violations [8][12]

```go
// VIOLATION: Copying mutex — passes by value [8][12]
type Cache struct {
    mu   sync.Mutex
    data map[string]string
}

func process(c Cache) { // c is a COPY — mutex copied too, breaks exclusion
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data["key"] = "val"
}

// VIOLATION: Forgetting to unlock [12]
func (c *Cache) Get(key string) string {
    c.mu.Lock()
    if val, ok := c.data[key]; ok {
        return val // Mutex never unlocked!
    }
    c.mu.Unlock()
    return ""
}

// CORRECT: defer c.mu.Unlock() immediately after c.mu.Lock()
```

---

## Slice and Map Violations [1][12]

```go
// VIOLATION: Nil map write — runtime panic [1]
var m map[string]int
m["key"] = 1 // panic: assignment to entry in nil map

// CORRECT: m := make(map[string]int)

// VIOLATION: Sharing slice backing array — mutations leak [12]
func getFirstThree(s []int) []int {
    return s[:3] // Shares backing array with s — mutations affect caller
}

// CORRECT: return append([]int(nil), s[:3]...)
```
