# Async Python Patterns

Deep-dive on async Python programming. Reference from main SKILL.md.

## Core asyncio Patterns

### Basic Async Function

```python
import asyncio
from typing import Any

async def fetch_user(user_id: str) -> User:
    async with aiohttp.ClientSession() as session:
        async with session.get(f"/api/users/{user_id}") as response:
            data = await response.json()
            return User.model_validate(data)
```

### Concurrent Execution with gather

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

## Structured Concurrency with TaskGroup

### TaskGroup for Safe Concurrency (Python 3.11+)

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

### Error Handling with TaskGroup

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

## Async Generators

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

### Async Generator with Cleanup

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

## Semaphore for Rate Limiting

### Bounded Concurrency

```python
async def fetch_all(urls: list[str], max_concurrent: int = 10) -> list[Response]:
    semaphore = asyncio.Semaphore(max_concurrent)

    async def bounded_fetch(url: str) -> Response:
        async with semaphore:
            return await fetch(url)

    return await asyncio.gather(*[bounded_fetch(url) for url in urls])
```

## aiohttp Patterns

### Client Session Management

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

## Timeout Patterns

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

### Blocking Calls in Async Code

```python
# VIOLATION: Blocks the event loop
async def bad_fetch(url: str) -> str:
    import requests
    return requests.get(url).text  # Blocks entire event loop!

# CORRECT: Use async library or run in executor
async def good_fetch(url: str) -> str:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.text()

# CORRECT: Offload blocking call to thread pool
async def run_blocking(func: Callable[..., R], *args: Any) -> R:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, func, *args)
```

### Fire-and-Forget Without Error Handling

```python
# VIOLATION: Exception silently lost
async def bad_handler(event: Event) -> None:
    asyncio.create_task(send_notification(event))  # Error vanishes

# CORRECT: Track the task and handle errors
async def good_handler(event: Event) -> None:
    task = asyncio.create_task(send_notification(event))
    task.add_done_callback(handle_task_exception)

def handle_task_exception(task: asyncio.Task[Any]) -> None:
    if not task.cancelled() and task.exception() is not None:
        logger.error("Background task failed", exc_info=task.exception())
```

### Sequential When Parallel Is Safe

```python
# VIOLATION: Unnecessarily sequential — 3x slower
async def slow_load(user_id: str) -> Dashboard:
    user = await fetch_user(user_id)
    orders = await fetch_orders(user_id)
    prefs = await fetch_preferences(user_id)
    return Dashboard(user=user, orders=orders, preferences=prefs)

# CORRECT: Concurrent — ~1x latency
async def fast_load(user_id: str) -> Dashboard:
    user, orders, prefs = await asyncio.gather(
        fetch_user(user_id),
        fetch_orders(user_id),
        fetch_preferences(user_id),
    )
    return Dashboard(user=user, orders=orders, preferences=prefs)
```
