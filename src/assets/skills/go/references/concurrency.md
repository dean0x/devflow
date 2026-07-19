# Go Concurrency Patterns

Advanced concurrency patterns for Go. Reference from main SKILL.md.
Sources in `sources.md`.

Go's concurrency model derives from Hoare's Communicating Sequential Processes (CSP) [9].
Goroutines are independently-executing functions; channels are typed conduits for communication.
The guiding principle: "Do not communicate by sharing memory; share memory by communicating." [10]

---

## errgroup for Structured Concurrency [22][13]

`errgroup` (golang.org/x/sync) provides structured concurrency: a group of goroutines
where the first error cancels the group. [22]

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

### errgroup with Concurrency Limit [22][13]

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

## Worker Pool [13][10]

Channel-based worker pool following the CSP communication model [9][10].
Channels pass ownership of data; `context.Done()` cancels work cooperatively. [16]

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

go func() {
    defer close(jobs)
    for _, j := range allJobs {
        jobs <- j
    }
}()

for r := range results {
    fmt.Println(r)
}
```

---

## Fan-Out / Fan-In [13][9]

Pipeline pattern from CSP theory [9]: fan-out distributes one input stream across
multiple workers; fan-in merges multiple streams back into one. [13]

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

## Select with Timeout [16][13]

`select` implements the alternation operator from CSP [9]: choose the first
ready channel. `context.WithTimeout` integrates deadline propagation. [16]

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

### Select for Multiple Sources [8][9]

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

## Mutex vs Channels [8][10]

Go proverb: "channels orchestrate; mutexes serialize." [7] The Go Memory Model
defines the happens-before rules for both synchronization primitives. [8]

### Use Mutex When [8]

```go
// Protecting shared state with simple read/write [8]
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

### Use Channels When [10][9]

```go
// Communicating between goroutines / coordinating work [10]
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

### Decision Guide [8][10][13]

| Scenario | Use | Source |
|----------|-----|--------|
| Guarding shared state | `sync.Mutex` or `sync.RWMutex` | [8] |
| Passing ownership of data | Channels | [10][9] |
| Coordinating goroutine lifecycle | `context.Context` + channels | [16] |
| Waiting for N goroutines | `sync.WaitGroup` or `errgroup` | [22] |
| One-time initialization | `sync.Once` | [8] |
| Concurrent map access | `sync.Map` (high read, low write) | [8] |

---

## sync.Once for Initialization [8][12]

`sync.Once` guarantees a function runs exactly once, regardless of concurrent callers.
The Go Memory Model guarantees visibility of the function's effects to all goroutines. [8]

```go
type Client struct {
    once sync.Once
    conn *grpc.ClientConn
    err  error
}

func (c *Client) connection() (*grpc.ClientConn, error) {
    c.once.Do(func() {
        c.conn, c.err = grpc.Dial("localhost:50051",
            grpc.WithTransportCredentials(insecure.NewCredentials()))
    })
    return c.conn, c.err
}
```

---

## Rate Limiting [13]

```go
// golang.org/x/time/rate implements the token bucket algorithm [13]
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
