# Go Concurrency Patterns

Advanced concurrency patterns for Go. Reference from main SKILL.md.

## errgroup for Structured Concurrency

```go
import "golang.org/x/sync/errgroup"

func FetchAll(ctx context.Context, urls []string) ([]Response, error) {
    g, ctx := errgroup.WithContext(ctx)
    responses := make([]Response, len(urls))

    for i, url := range urls {
        g.Go(func() error {
            resp, err := fetch(ctx, url)
            if err != nil {
                return fmt.Errorf("fetching %s: %w", url, err)
            }
            responses[i] = resp // Safe: each goroutine writes to unique index
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return responses, nil
}
```

### errgroup with Concurrency Limit

```go
func ProcessItems(ctx context.Context, items []Item) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(10) // Maximum 10 concurrent goroutines

    for _, item := range items {
        g.Go(func() error {
            return processItem(ctx, item)
        })
    }

    return g.Wait()
}
```

---

## Worker Pool

```go
func WorkerPool(ctx context.Context, jobs <-chan Job, workers int) <-chan Result {
    results := make(chan Result, workers)

    var wg sync.WaitGroup
    for range workers {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case job, ok := <-jobs:
                    if !ok {
                        return
                    }
                    results <- process(ctx, job)
                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    go func() {
        wg.Wait()
        close(results)
    }()

    return results
}

// Usage
jobs := make(chan Job, 100)
results := WorkerPool(ctx, jobs, 5)

// Send jobs
go func() {
    defer close(jobs)
    for _, j := range allJobs {
        jobs <- j
    }
}()

// Collect results
for r := range results {
    fmt.Println(r)
}
```

---

## Fan-Out / Fan-In

```go
// Fan-out: one source, multiple workers
func fanOut(ctx context.Context, input <-chan int, workers int) []<-chan int {
    channels := make([]<-chan int, workers)
    for i := range workers {
        channels[i] = worker(ctx, input)
    }
    return channels
}

func worker(ctx context.Context, input <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range input {
            select {
            case out <- n * n:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// Fan-in: multiple sources, one destination
func fanIn(ctx context.Context, channels ...<-chan int) <-chan int {
    merged := make(chan int)
    var wg sync.WaitGroup

    for _, ch := range channels {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for val := range ch {
                select {
                case merged <- val:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    go func() {
        wg.Wait()
        close(merged)
    }()

    return merged
}
```

---

## Select with Timeout

```go
func fetchWithTimeout(ctx context.Context, url string) ([]byte, error) {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()

    ch := make(chan result, 1)
    go func() {
        data, err := doFetch(ctx, url)
        ch <- result{data, err}
    }()

    select {
    case r := <-ch:
        return r.data, r.err
    case <-ctx.Done():
        return nil, fmt.Errorf("fetch %s: %w", url, ctx.Err())
    }
}

type result struct {
    data []byte
    err  error
}
```

### Select for Multiple Sources

```go
func merge(ctx context.Context, primary, fallback <-chan Event) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        for {
            select {
            case e, ok := <-primary:
                if !ok {
                    return
                }
                out <- e
            case e, ok := <-fallback:
                if !ok {
                    return
                }
                out <- e
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

---

## Mutex vs Channels

### Use Mutex When

```go
// Protecting shared state with simple read/write
type SafeCounter struct {
    mu sync.RWMutex
    v  map[string]int
}

func (c *SafeCounter) Inc(key string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.v[key]++
}

func (c *SafeCounter) Get(key string) int {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.v[key]
}
```

### Use Channels When

```go
// Communicating between goroutines / coordinating work
func pipeline(ctx context.Context, input []int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range input {
            select {
            case out <- transform(n):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

### Decision Guide

| Scenario | Use |
|----------|-----|
| Guarding shared state | `sync.Mutex` or `sync.RWMutex` |
| Passing ownership of data | Channels |
| Coordinating goroutine lifecycle | `context.Context` + channels |
| Waiting for N goroutines | `sync.WaitGroup` or `errgroup` |
| One-time initialization | `sync.Once` |
| Concurrent map access | `sync.Map` (high read, low write) |

---

## sync.Once for Initialization

```go
type Client struct {
    once sync.Once
    conn *grpc.ClientConn
    err  error
}

func (c *Client) connection() (*grpc.ClientConn, error) {
    c.once.Do(func() {
        // requires: "google.golang.org/grpc/credentials/insecure"
        c.conn, c.err = grpc.Dial("localhost:50051",
            grpc.WithTransportCredentials(insecure.NewCredentials()))
    })
    return c.conn, c.err
}
```

---

## Rate Limiting

```go
func rateLimited(ctx context.Context, items []Item, rps int) error {
    limiter := rate.NewLimiter(rate.Limit(rps), 1)

    for _, item := range items {
        if err := limiter.Wait(ctx); err != nil {
            return fmt.Errorf("rate limiter: %w", err)
        }
        if err := process(ctx, item); err != nil {
            return fmt.Errorf("processing item %s: %w", item.ID, err)
        }
    }
    return nil
}
```
