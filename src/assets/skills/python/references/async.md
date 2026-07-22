# Async Python Patterns

Deep-dive on async Python programming. Reference from main SKILL.md.
All citations reference `sources.md`.

## Core asyncio Patterns [16][1]

asyncio implements the Reactor pattern — a single-threaded event loop dispatches
callbacks when I/O completes [16]. Ramalho's Part V of Fluent Python covers the
design in depth [1].

### Basic Async Function [16]

```python
import asyncio
from typing import Any

async def fetch_user(user_id: str) -> User:
    async with aiohttp.ClientSession() as session:
        async with session.get(f"/api/users/{user_id}") as response:
            data = await response.json()
            return User.model_validate(data)
```

### Concurrent Execution with gather [16][1]

`asyncio.gather` runs independent coroutines concurrently — Ramalho's "spinner"
example demonstrates that gather returns when ALL tasks complete [1]:

```python
async def load_dashboard(user_id: str) -> Dashboard:
    # Independent fetches run concurrently
    user, orders, preferences = await asyncio.gather(
        fetch_user(user_id),
        fetch_orders(user_id),
        fetch_preferences(user_id),
    )
    return Dashboard(user=user, orders=orders, preferences=preferences)
```

## Structured Concurrency with TaskGroup [16]

### TaskGroup for Safe Concurrency (Python 3.11+) [16]

`asyncio.TaskGroup` is the structured concurrency primitive introduced in
Python 3.11. It cancels all sibling tasks when one raises, preventing leaked
coroutines [16]:

```python
async def process_batch(items: list[Item]) -> list[Result]:
    results: list[Result] = []

    async with asyncio.TaskGroup() as tg:
        for item in items:
            tg.create_task(process_and_collect(item, results))

    return results

async def process_and_collect(item: Item, results: list[Result]) -> None:
    result = await process_item(item)
    results.append(result)
```

### Error Handling with TaskGroup [16]

TaskGroup cancels all tasks if one raises — wrap individual tasks for per-item
error collection [16]:

```python
async def resilient_batch(items: list[Item]) -> tuple[list[Result], list[Error]]:
    results: list[Result] = []
    errors: list[Error] = []

    # TaskGroup cancels all tasks if one raises — wrap individual tasks
    async def safe_process(item: Item) -> None:
        try:
            result = await process_item(item)
            results.append(result)
        except ProcessingError as e:
            errors.append(Error(item_id=item.id, message=str(e)))

    async with asyncio.TaskGroup() as tg:
        for item in items:
            tg.create_task(safe_process(item))

    return results, errors
```

## Async Generators [1][16]

Ramalho covers async generators in depth — they enable streaming without loading
all results into memory [1]:

### Streaming Results

```python
from typing import AsyncGenerator

async def stream_results(query: str, params: tuple = ()) -> AsyncGenerator[Record, None]:
    async with get_connection() as conn:
        cursor = await conn.execute(query, params)
        async for row in cursor:
            yield Record.from_row(row)

# Usage
async for record in stream_results("SELECT * FROM events WHERE type = ?", ("click",)):
    await process(record)
```

### Async Generator with Cleanup [1]

```python
async def paginated_fetch(url: str, page_size: int = 100) -> AsyncGenerator[Item, None]:
    page = 0
    while True:
        response = await fetch_page(url, page=page, size=page_size)
        if not response.items:
            break
        for item in response.items:
            yield item
        page += 1
```

## Semaphore for Rate Limiting [16][10]

asyncio Semaphore provides bounded concurrency — Beazley & Jones Cookbook
shows this pattern for controlling outbound request volume [10][16]:

### Bounded Concurrency

```python
async def fetch_all(urls: list[str], max_concurrent: int = 10) -> list[Response]:
    semaphore = asyncio.Semaphore(max_concurrent)

    async def bounded_fetch(url: str) -> Response:
        async with semaphore:
            return await fetch(url)

    return await asyncio.gather(*[bounded_fetch(url) for url in urls])
```

## aiohttp Patterns [16]

### Client Session Management

Session reuse amortizes connection overhead across many requests [16]:

```python
from contextlib import asynccontextmanager
from typing import AsyncGenerator

@asynccontextmanager
async def api_client(base_url: str) -> AsyncGenerator[aiohttp.ClientSession, None]:
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(base_url, timeout=timeout) as session:
        yield session

# Usage — session reused for multiple requests
async def sync_users(user_ids: list[str]) -> list[User]:
    async with api_client("https://api.example.com") as client:
        tasks = [fetch_user_with_session(client, uid) for uid in user_ids]
        return await asyncio.gather(*tasks)

async def fetch_user_with_session(
    client: aiohttp.ClientSession, user_id: str
) -> User:
    async with client.get(f"/users/{user_id}") as response:
        response.raise_for_status()
        data = await response.json()
        return User.model_validate(data)
```

## Timeout Patterns [16]

`asyncio.timeout` (Python 3.11+) replaces the `wait_for` pattern for per-operation
timeouts [16]:

### Per-Operation Timeout

```python
async def fetch_with_timeout(url: str, timeout_seconds: float = 5.0) -> dict[str, Any]:
    try:
        async with asyncio.timeout(timeout_seconds):
            return await fetch(url)
    except TimeoutError:
        raise OperationTimeout(f"Request to {url} timed out after {timeout_seconds}s")
```

## Anti-Patterns

### Blocking Calls in Async Code [16][2]

Slatkin's Item 62 and asyncio docs both flag synchronous I/O inside async functions
as blocking the event loop for all other coroutines [2][16]:

```python
# VIOLATION: Blocks the event loop [16]
async def bad_fetch(url: str) -> str:
    import requests
    return requests.get(url).text  # Blocks entire event loop!

# CORRECT: Use async library or run in executor [16]
async def good_fetch(url: str) -> str:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.text()

# CORRECT: Offload blocking call to thread pool [16]
async def run_blocking(func: Callable[..., R], *args: Any) -> R:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, func, *args)
```

### Fire-and-Forget Without Error Handling [16][1]

Ramalho and asyncio docs both warn that `create_task` without a done callback
silently discards exceptions [1][16]:

```python
# VIOLATION: Exception silently lost [16]
async def bad_handler(event: Event) -> None:
    asyncio.create_task(send_notification(event))  # Error vanishes

# CORRECT: Track the task and handle errors [16]
async def good_handler(event: Event) -> None:
    task = asyncio.create_task(send_notification(event))
    task.add_done_callback(handle_task_exception)

def handle_task_exception(task: asyncio.Task[Any]) -> None:
    if not task.cancelled() and task.exception() is not None:
        logger.error("Background task failed", exc_info=task.exception())
```

### Sequential When Parallel Is Safe [16][1]

Ramalho's dashboard example (Fluent Python Ch. 21) benchmarks sequential vs
concurrent fetching — 3 sequential awaits take 3x longer than gather [1]:

```python
# VIOLATION: Unnecessarily sequential — 3x slower [1]
async def slow_load(user_id: str) -> Dashboard:
    user = await fetch_user(user_id)
    orders = await fetch_orders(user_id)
    prefs = await fetch_preferences(user_id)
    return Dashboard(user=user, orders=orders, preferences=prefs)

# CORRECT: Concurrent — ~1x latency [1][16]
async def fast_load(user_id: str) -> Dashboard:
    user, orders, prefs = await asyncio.gather(
        fetch_user(user_id),
        fetch_orders(user_id),
        fetch_preferences(user_id),
    )
    return Dashboard(user=user, orders=orders, preferences=prefs)
```
