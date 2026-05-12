# Reliability — Violation Examples

## 1. Bounded Iteration Violations [1]

### Unbounded pagination
```typescript
async function fetchAllPages(url: string) {
  let page = 1;
  const results = [];
  while (true) {                    // no upper bound
    const data = await fetch(`${url}?page=${page++}`);
    results.push(...data.items);
    if (!data.nextPage) break;      // trusts external signal
  }
  return results;
}
```

### Infinite event loop
```go
func consume(ch <-chan Event) {
    for {                           // no termination condition
        event := <-ch
        process(event)
    }
}
```

### Unbounded recursive retry
```python
def fetch_with_retry(url: str) -> Response:
    try:
        return requests.get(url)
    except ConnectionError:
        time.sleep(1)
        return fetch_with_retry(url)  # unbounded recursion
```

## 2. Assertion Density Violations [1]

### Zero-assertion validation function
```typescript
function validateConfig(config: Config): Config {
  // 30 lines of transformation with no precondition checks
  const timeout = config.timeout ?? 5000;
  const retries = config.retries ?? 3;
  return { ...config, timeout, retries };
}
```

### Missing invariant check after mutation
```go
func (q *Queue) Dequeue() Item {
    item := q.items[0]
    q.items = q.items[1:]
    // no assertion that len(q.items) >= 0 or q.size is consistent
    return item
}
```

## 3. Allocation Discipline Violations [1]

### Allocation per request in hot path
```java
public void handleRequest(Request req) {
    byte[] buffer = new byte[1024 * 1024]; // 1MB per request
    var parser = new JsonParser();          // stateless, could be reused
    var result = parser.parse(req.body(), buffer);
    respond(result);
}
```

### String concatenation in loop
```python
def build_report(items: list[Item]) -> str:
    result = ""
    for item in items:
        result += f"{item.name}: {item.value}\n"  # O(n^2) allocation
    return result
```

## 4. Indirection Limit Violations [1]

### Pointer-to-pointer in Go
```go
func update(ptr **Node) {
    (*ptr).Value = 42    // double dereference
}
```

### Nested Box in Rust
```rust
struct Tree {
    children: Box<Vec<Box<Tree>>>,  // unnecessary double boxing
}
```

### Triple-nested references
```typescript
function process(data: Map<string, Map<string, Map<string, number>>>) {
  // three levels of indirection to reach a value
}
```

## 5. Metaprogramming Restraint Violations [1]

### Reflection-heavy dispatch
```java
public Object invoke(String methodName, Object... args) throws Exception {
    Method m = this.getClass().getMethod(methodName,
        Arrays.stream(args).map(Object::getClass).toArray(Class[]::new));
    return m.invoke(this, args);  // reflection instead of interface
}
```

### Multi-level macro expansion
```rust
macro_rules! define_handler {
    ($name:ident, $($field:ident),*) => {
        macro_rules! $name {                    // macro defining macro
            () => { struct Handler { $($field: String),* } }
        }
    }
}
```
