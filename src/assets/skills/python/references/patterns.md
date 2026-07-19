# Python Correct Patterns

Extended correct patterns for Python development. Reference from main SKILL.md.
All citations reference `sources.md`.

## Dependency Injection [9][1]

### Constructor Injection

Cosmic Python's repository pattern uses constructor injection for all service
dependencies [9]. Ramalho notes that Protocol-typed parameters decouple interface
from implementation [1].

```python
from typing import Protocol

class EmailSender(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...

class UserService:
    def __init__(self, repo: UserRepository, emailer: EmailSender) -> None:
        self._repo = repo
        self._emailer = emailer

    def create_user(self, request: CreateUserRequest) -> User:
        user = User(name=request.name, email=request.email)
        saved = self._repo.save(user)
        self._emailer.send(user.email, "Welcome", f"Hello {user.name}")
        return saved

# Easy to test — inject fakes [13]
service = UserService(repo=FakeUserRepo(), emailer=FakeEmailSender())
```

### Factory Functions [9]

Cosmic Python recommends a top-level factory (bootstrap module) that wires all
real dependencies at startup [9]:

```python
def create_app(config: AppConfig) -> Flask:
    app = Flask(__name__)
    db = Database(config.database_url)
    cache = RedisCache(config.redis_url)
    user_service = UserService(repo=SqlUserRepo(db), emailer=SmtpSender(config.smtp))
    register_routes(app, user_service)
    return app
```

## Decorator Patterns [10][1]

### Retry Decorator

Beazley & Jones Cookbook recipe for retry with exponential backoff [10].
Uses `ParamSpec` (PEP 612) for preserving callable signatures [1]:

```python
import functools
import time
from typing import TypeVar, Callable, ParamSpec

P = ParamSpec("P")
R = TypeVar("R")

def retry(
    max_attempts: int = 3,
    delay: float = 1.0,
    exceptions: tuple[type[Exception], ...] = (Exception,),
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            last_error: Exception | None = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_error = e
                    if attempt < max_attempts - 1:
                        time.sleep(delay * (2 ** attempt))
            raise last_error  # type: ignore[misc]
        return wrapper
    return decorator

@retry(max_attempts=3, delay=0.5, exceptions=(ConnectionError, TimeoutError))
def fetch_data(url: str) -> dict[str, Any]:
    ...
```

### Validation Decorator [12]

```python
def validate_input(schema: type[BaseModel]):
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            # Validate first positional arg after self/cls
            data = args[1] if len(args) > 1 else args[0]
            schema.model_validate(data)
            return func(*args, **kwargs)
        return wrapper
    return decorator
```

## Context Manager Patterns [10][9]

### Database Transaction

Unit-of-work pattern from Cosmic Python; transaction wraps the session lifecycle [9].
Beazley & Jones provide the `@contextmanager` recipe [10]:

```python
from contextlib import contextmanager
from typing import Generator

@contextmanager
def transaction(session: Session) -> Generator[Session, None, None]:
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

# Usage
with transaction(db.session()) as session:
    session.add(user)
    session.add(audit_log)
```

### Temporary Directory [10]

```python
from contextlib import contextmanager
from pathlib import Path
import tempfile
import shutil

@contextmanager
def temp_workspace() -> Generator[Path, None, None]:
    path = Path(tempfile.mkdtemp())
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
```

## Pytest Fixture Patterns [13][9]

### Service Fixtures with DI

pytest fixtures compose naturally with the DI pattern from Cosmic Python [9][13]:

```python
import pytest

@pytest.fixture
def fake_repo() -> FakeUserRepo:
    return FakeUserRepo()

@pytest.fixture
def fake_emailer() -> FakeEmailSender:
    return FakeEmailSender()

@pytest.fixture
def user_service(fake_repo: FakeUserRepo, fake_emailer: FakeEmailSender) -> UserService:
    return UserService(repo=fake_repo, emailer=fake_emailer)

def test_create_user_sends_welcome_email(
    user_service: UserService,
    fake_emailer: FakeEmailSender,
) -> None:
    user_service.create_user(CreateUserRequest(name="Alice", email="a@b.com"))
    assert fake_emailer.sent_count == 1
    assert fake_emailer.last_to == "a@b.com"
```

### Parametrized Tests [13]

Slatkin's "Effective Python" recommends parametrize for exhaustive edge coverage [2][13]:

```python
@pytest.mark.parametrize(
    "input_age, expected_valid",
    [
        (25, True),
        (0, True),
        (150, True),
        (-1, False),
        (151, False),
        (None, False),
    ],
)
def test_age_validation(input_age: int | None, expected_valid: bool) -> None:
    result = validate_age(input_age)
    assert result.is_valid == expected_valid
```

## Structured Logging [20]

structlog binds context to a logger instance, producing machine-readable JSON [20]:

```python
import structlog

logger = structlog.get_logger()

def process_order(order: Order) -> OrderResult:
    log = logger.bind(order_id=order.id, user_id=order.user_id)
    log.info("processing_order", item_count=len(order.items))

    try:
        result = fulfill(order)
        log.info("order_fulfilled", total=result.total)
        return result
    except InsufficientStockError as e:
        log.warning("order_failed_stock", item_id=e.item_id)
        raise
```

## Enum Patterns [2][24]

PEP 634 structural pattern matching works cleanly with Enum [24].
Slatkin recommends enum state machines with explicit transition tables [2]:

```python
from enum import Enum, auto

class OrderStatus(Enum):
    PENDING = auto()
    PROCESSING = auto()
    SHIPPED = auto()
    DELIVERED = auto()
    CANCELLED = auto()

    @property
    def is_terminal(self) -> bool:
        return self in (OrderStatus.DELIVERED, OrderStatus.CANCELLED)

    def can_transition_to(self, target: "OrderStatus") -> bool:
        valid = {
            OrderStatus.PENDING: {OrderStatus.PROCESSING, OrderStatus.CANCELLED},
            OrderStatus.PROCESSING: {OrderStatus.SHIPPED, OrderStatus.CANCELLED},
            OrderStatus.SHIPPED: {OrderStatus.DELIVERED},
        }
        return target in valid.get(self, set())
```

## Generic Types [7][4]

PEP 695 (Python 3.12) introduces clean generic syntax [7]:

```python
# Before PEP 695
from typing import TypeVar, Generic
T = TypeVar("T")

class Stack(Generic[T]):
    def push(self, item: T) -> None: ...
    def pop(self) -> T: ...

# After PEP 695 (Python 3.12+)
class Stack[T]:
    def push(self, item: T) -> None: ...
    def pop(self) -> T: ...
```

## Protocol vs ABC Decision [5][1][14]

Use **Protocol** (structural) when:
- The implementing class should not be forced to import the interface [5]
- Third-party classes already satisfy the interface [1]
- You want duck-typing behavior with static verification [5]

Use **ABC** (nominal) when:
- You need shared implementation via `@abstractmethod` + mixin [1]
- You need `isinstance()` checks at runtime [14]
- The interface is coupled to the hierarchy (e.g., plugin system) [9]
