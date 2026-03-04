# Go Violation Examples

Extended violation patterns for Go reviews. Reference from main SKILL.md.

## Error Handling Violations

### Ignored Errors

```go
// VIOLATION: Silently discarding error
data, _ := json.Marshal(user)
w.Write(data)

// VIOLATION: Error ignored in deferred call
defer file.Close() // Close() returns error

// VIOLATION: Swallowing error with log
if err != nil {
    log.Println("something failed") // Error details lost
    return nil
}
```

### Unwrapped Errors

```go
// VIOLATION: No context on error
func LoadConfig(path string) (*Config, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err // Caller has no idea what failed
    }
    var cfg Config
    if err := json.Unmarshal(data, &cfg); err != nil {
        return nil, err // Which unmarshal? What file?
    }
    return &cfg, nil
}
```

---

## Goroutine Leak Violations

### Fire-and-Forget Goroutine

```go
// VIOLATION: No way to stop or wait for this goroutine
func StartPoller() {
    go func() {
        for {
            poll()
            time.Sleep(10 * time.Second)
        }
    }()
}

// VIOLATION: Goroutine blocks forever on channel nobody reads
func process(items []Item) {
    ch := make(chan Result)
    for _, item := range items {
        go func(i Item) {
            ch <- compute(i) // Blocks if nobody reads
        }(item)
    }
    // Only reads first result - rest leak
    result := <-ch
    _ = result
}
```

### Missing Context Cancellation

```go
// VIOLATION: Goroutine ignores context
func Fetch(ctx context.Context, url string) ([]byte, error) {
    ch := make(chan []byte, 1)
    go func() {
        resp, _ := http.Get(url) // Ignores ctx cancellation
        body, _ := io.ReadAll(resp.Body)
        ch <- body
    }()
    return <-ch, nil
}
```

---

## Interface Pollution Violations

### Premature Interface Definition

```go
// VIOLATION: Interface defined at producer, not consumer
package user

type UserStore interface { // Only one implementation exists
    Get(id string) (*User, error)
    Save(u *User) error
    Delete(id string) error
    List() ([]*User, error)
    Count() (int, error)
}

type PostgresStore struct{ db *sql.DB }

func (s *PostgresStore) Get(id string) (*User, error) { ... }
// ... implements all 5 methods
```

### God Interface

```go
// VIOLATION: Interface too large - impossible to mock cleanly
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
```

---

## Naked Return Violations

```go
// VIOLATION: Naked returns obscure what's being returned
func divide(a, b float64) (result float64, err error) {
    if b == 0 {
        err = errors.New("division by zero")
        return // What is result here? Zero - but not obvious
    }
    result = a / b
    return // Have to trace back to find return values
}
```

---

## init() Abuse Violations

```go
// VIOLATION: Side effects in init - runs on import
func init() {
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        log.Fatal(err) // Crashes on import
    }
    globalDB = db
}

// VIOLATION: Registration magic in init
func init() {
    http.HandleFunc("/health", healthCheck) // Hidden route registration
    prometheus.MustRegister(requestCounter) // Panics if called twice
}
```

---

## Mutex Violations

```go
// VIOLATION: Copying mutex (passes by value)
type Cache struct {
    mu   sync.Mutex
    data map[string]string
}

func process(c Cache) { // c is a COPY - mutex is copied too
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data["key"] = "val"
}

// VIOLATION: Forgetting to unlock
func (c *Cache) Get(key string) string {
    c.mu.Lock()
    if val, ok := c.data[key]; ok {
        return val // Mutex never unlocked!
    }
    c.mu.Unlock()
    return ""
}
```

---

## Slice and Map Violations

```go
// VIOLATION: Nil map write (runtime panic)
var m map[string]int
m["key"] = 1 // panic: assignment to entry in nil map

// VIOLATION: Sharing slice backing array
func getFirstThree(s []int) []int {
    return s[:3] // Shares backing array - mutations leak
}
```
