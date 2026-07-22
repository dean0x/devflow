# Reliability — Correct Patterns

## 1. Bounded Iteration Patterns [1]

### Bounded pagination
```typescript
const MAX_PAGES = 100;
async function fetchAllPages(url: string) {
  const results = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await fetch(`${url}?page=${page}`);
    results.push(...data.items);
    if (!data.nextPage) break;
  }
  return results;
}
```

### Bounded event consumer with context cancellation [2]
```go
func consume(ctx context.Context, ch <-chan Event) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case event, ok := <-ch:
            if !ok { return nil }
            process(event)
        }
    }
}
```

### Retry with exponential backoff and cap [6]
```python
MAX_RETRIES = 5

def fetch_with_retry(url: str) -> Response:
    for attempt in range(MAX_RETRIES):
        try:
            return requests.get(url, timeout=10)
        except ConnectionError:
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(min(2 ** attempt, 30))
```

## 2. Assertion Density Patterns [1]

### Defensive validation with assertions
```typescript
function validateConfig(config: Config): Config {
  assert(config != null, 'Config must not be null');
  assert(config.timeout == null || config.timeout > 0, 'Timeout must be positive');
  assert(config.retries == null || config.retries >= 0, 'Retries must be non-negative');
  const timeout = config.timeout ?? 5000;
  const retries = config.retries ?? 3;
  return { ...config, timeout, retries };
}
```

### Post-condition assertions [1]
```go
func (q *Queue) Dequeue() (Item, error) {
    if len(q.items) == 0 {
        return Item{}, errors.New("dequeue from empty queue")
    }
    item := q.items[0]
    q.items = q.items[1:]
    assert(q.size > 0, "size invariant violated")
    q.size--
    return item, nil
}
```

## 3. Allocation Discipline Patterns [1]

### Pooled resources [6]
```java
private static final ObjectPool<JsonParser> PARSER_POOL =
    ObjectPool.create(JsonParser::new, 16);

public void handleRequest(Request req) {
    JsonParser parser = PARSER_POOL.borrow();
    try {
        var result = parser.parse(req.body());
        respond(result);
    } finally {
        PARSER_POOL.release(parser);
    }
}
```

### Pre-sized collections
```python
def build_report(items: list[Item]) -> str:
    parts = [f"{item.name}: {item.value}" for item in items]
    return "\n".join(parts)  # single allocation for join
```

## 4. Indirection Limit Patterns [1]

### Flat data structures
```go
func update(node *Node) {
    node.Value = 42  // single dereference
}
```

### Direct ownership in Rust
```rust
struct Tree {
    children: Vec<Tree>,  // direct ownership, no double-boxing
}
```

### Flat data access
```typescript
interface Report {
  metrics: Record<string, number>;  // single level of indirection
}
```

## 5. Metaprogramming Restraint Patterns [1]

### Interface-based dispatch instead of reflection
```java
public interface Handler {
    Object handle(Object... args);
}

private final Map<String, Handler> handlers = Map.of(
    "create", this::handleCreate,
    "delete", this::handleDelete
);

public Object invoke(String action, Object... args) {
    Handler h = handlers.get(action);
    if (h == null) throw new IllegalArgumentException("Unknown: " + action);
    return h.handle(args);
}
```

### Simple derive macros instead of nested macros
```rust
#[derive(Debug, Clone)]
struct Handler {
    name: String,
    endpoint: String,
}
```
