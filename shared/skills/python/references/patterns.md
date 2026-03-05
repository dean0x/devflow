# Python Correct Patterns

Extended correct patterns for Python development. Reference from main SKILL.md.

## Dependency Injection

### Constructor Injection

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

# Easy to test — inject fakes
service = UserService(repo=FakeUserRepo(), emailer=FakeEmailSender())
```

### Factory Functions

```python
def create_app(config: AppConfig) -> Flask:
    app = Flask(__name__)
    db = Database(config.database_url)
    cache = RedisCache(config.redis_url)
    user_service = UserService(repo=SqlUserRepo(db), emailer=SmtpSender(config.smtp))
    register_routes(app, user_service)
    return app
```

## Decorator Patterns

### Retry Decorator

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

### Validation Decorator

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

## Context Manager Patterns

### Database Transaction

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

### Temporary Directory

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

## Pytest Fixture Patterns

### Service Fixtures with DI

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

### Parametrized Tests

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

## Structured Logging

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

## Enum Patterns

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
