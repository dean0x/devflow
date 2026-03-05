# Python Violation Examples

Extended violation patterns for Python reviews. Reference from main SKILL.md.

## Type Safety Violations

### Missing Type Hints

```python
# VIOLATION: No type annotations
def process(data, config):
    result = transform(data)
    return result

# VIOLATION: Partial annotations (inconsistent)
def save(user: User, db):  # db missing type
    return db.insert(user)

# VIOLATION: Missing return type
def calculate_total(items: list[Item]):
    return sum(item.price for item in items)
```

### Bare Except Clauses

```python
# VIOLATION: Catches everything including SystemExit and KeyboardInterrupt
try:
    process_data()
except:
    pass

# VIOLATION: Catches too broadly and silences
try:
    user = fetch_user(user_id)
except Exception:
    user = None  # Hides real errors (network, auth, parsing)

# VIOLATION: Bare except with logging but no re-raise
try:
    critical_operation()
except:
    logger.error("Something failed")
    # Swallows the error — caller never knows
```

## Data Modeling Violations

### Raw Dicts Instead of Dataclasses

```python
# VIOLATION: Untyped dict — no IDE support, no validation
user = {
    "name": "Alice",
    "email": "alice@example.com",
    "age": 30,
}

# VIOLATION: Accessing dict keys without safety
def get_display_name(user: dict) -> str:
    return f"{user['first_name']} {user['last_name']}"  # KeyError risk

# VIOLATION: Nested untyped dicts
config = {
    "database": {
        "host": "localhost",
        "port": 5432,
    },
    "cache": {
        "ttl": 300,
    },
}
```

### Mutable Default Arguments

```python
# VIOLATION: Mutable default shared across calls
def add_item(item: str, items: list[str] = []) -> list[str]:
    items.append(item)
    return items

# VIOLATION: Dict default mutated in place
def register(name: str, registry: dict[str, bool] = {}) -> None:
    registry[name] = True

# VIOLATION: Set default
def collect(value: int, seen: set[int] = set()) -> set[int]:
    seen.add(value)
    return seen
```

## String Formatting Violations

### Percent Formatting

```python
# VIOLATION: Old-style % formatting
message = "Hello %s, you have %d messages" % (name, count)

# VIOLATION: % formatting with dict — hard to read, error-prone
log = "%(timestamp)s - %(level)s - %(message)s" % log_data
```

### String Concatenation in Loops

```python
# VIOLATION: O(n^2) string building
result = ""
for line in lines:
    result += line + "\n"

# CORRECT: Use join
result = "\n".join(lines)
```

## Global State Violations

### Module-Level Mutable State

```python
# VIOLATION: Global mutable state
_cache = {}
_connections = []

def get_cached(key: str) -> Any:
    return _cache.get(key)

def add_connection(conn: Connection) -> None:
    _connections.append(conn)

# VIOLATION: Global variable modified by functions
current_user = None

def login(username: str) -> None:
    global current_user
    current_user = authenticate(username)
```

### Singleton via Module Import

```python
# VIOLATION: Hard-to-test singleton
# db.py
connection = create_connection(os.environ["DATABASE_URL"])

# service.py
from db import connection  # Cannot mock or swap for tests
```

## Import Violations

### Wildcard Imports

```python
# VIOLATION: Pollutes namespace, hides dependencies
from os.path import *
from utils import *

# VIOLATION: Star import in __init__.py
# mypackage/__init__.py
from .models import *
from .services import *
```

### Circular Imports

```python
# VIOLATION: Circular dependency
# models.py
from services import UserService  # services imports models too

# services.py
from models import User  # Circular!
```

## Testing Violations

### Assert in Production Code

```python
# VIOLATION: assert is stripped with -O flag
def withdraw(account: Account, amount: float) -> None:
    assert amount > 0, "Amount must be positive"  # Disabled in production!
    assert account.balance >= amount, "Insufficient funds"
    account.balance -= amount
```

### No pytest Fixtures

```python
# VIOLATION: Repeated setup in every test
def test_create_user():
    db = Database(":memory:")
    db.create_tables()
    service = UserService(db)
    # ... test logic

def test_update_user():
    db = Database(":memory:")  # Duplicated setup
    db.create_tables()
    service = UserService(db)
    # ... test logic
```
