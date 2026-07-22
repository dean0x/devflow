# Python Violation Examples

Extended violation patterns for Python reviews. Reference from main SKILL.md.
All citations reference `sources.md`.

## Type Safety Violations

### Missing Type Hints [4][17][18]

PEP 484 made type hints standard in 2014; unannotated public APIs are a code smell [4].
Dropbox's 4-million-line migration showed that annotations catch bugs before runtime [18]:

```python
# VIOLATION: No type annotations [4]
def process(data, config):
    result = transform(data)
    return result

# VIOLATION: Partial annotations (inconsistent) [4]
def save(user: User, db):  # db missing type
    return db.insert(user)

# VIOLATION: Missing return type [17]
def calculate_total(items: list[Item]):
    return sum(item.price for item in items)
```

### Bare Except Clauses [2][8]

Google Style Guide prohibits bare `except:` — it catches `SystemExit` and
`KeyboardInterrupt`, preventing clean shutdown [8]. Slatkin's Item 87 recommends
specific exception types [2]:

```python
# VIOLATION: Catches everything including SystemExit and KeyboardInterrupt [8]
try:
    process_data()
except:
    pass

# VIOLATION: Catches too broadly and silences [2]
try:
    user = fetch_user(user_id)
except Exception:
    user = None  # Hides real errors (network, auth, parsing)

# VIOLATION: Bare except with logging but no re-raise [8]
try:
    critical_operation()
except:
    logger.error("Something failed")
    # Swallows the error — caller never knows
```

## Data Modeling Violations

### Raw Dicts Instead of Dataclasses [6][14][19]

PEP 557 dataclasses add typed fields and IDE support at zero runtime cost [6].
Viafore argues raw dicts make wrong code look right — type system cannot catch
misspelled keys or incorrect value types [14]. Spolsky's principle: make wrong code
look wrong [19]:

```python
# VIOLATION: Untyped dict — no IDE support, no validation [14][19]
user = {
    "name": "Alice",
    "email": "alice@example.com",
    "age": 30,
}

# VIOLATION: Accessing dict keys without safety [19]
def get_display_name(user: dict) -> str:
    return f"{user['first_name']} {user['last_name']}"  # KeyError risk

# VIOLATION: Nested untyped dicts [14]
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

### Mutable Default Arguments [2][3]

Slatkin's Item 24: never use mutable values as default arguments [2].
PEP 20's "Explicit is better than implicit" applies — the shared-state behavior is
invisible to callers [3]:

```python
# VIOLATION: Mutable default shared across calls [2]
def add_item(item: str, items: list[str] = []) -> list[str]:
    items.append(item)
    return items

# VIOLATION: Dict default mutated in place [2]
def register(name: str, registry: dict[str, bool] = {}) -> None:
    registry[name] = True

# VIOLATION: Set default [2]
def collect(value: int, seen: set[int] = set()) -> set[int]:
    seen.add(value)
    return seen
```

## String Formatting Violations

### Percent Formatting [8][2]

Google Style Guide and Slatkin both require f-strings (Python 3.6+) over
`%` or `.format()` [8][2]:

```python
# VIOLATION: Old-style % formatting [8]
message = "Hello %s, you have %d messages" % (name, count)

# VIOLATION: % formatting with dict — hard to read, error-prone [8]
log = "%(timestamp)s - %(level)s - %(message)s" % log_data
```

### String Concatenation in Loops [2][10]

Slatkin Item 11 and Beazley & Jones both flag O(n²) string concatenation [2][10]:

```python
# VIOLATION: O(n^2) string building [2]
result = ""
for line in lines:
    result += line + "\n"

# CORRECT: Use join [2]
result = "\n".join(lines)
```

## Global State Violations

### Module-Level Mutable State [9][3]

Cosmic Python's service layer design eliminates global mutable state — side effects
are in explicit service functions, not module-level variables [9]. PEP 20: "Explicit
is better than implicit" [3]:

```python
# VIOLATION: Global mutable state [9]
_cache = {}
_connections = []

def get_cached(key: str) -> Any:
    return _cache.get(key)

def add_connection(conn: Connection) -> None:
    _connections.append(conn)

# VIOLATION: Global variable modified by functions [9]
current_user = None

def login(username: str) -> None:
    global current_user
    current_user = authenticate(username)
```

### Singleton via Module Import [9][13]

Cosmic Python shows this pattern makes testing impossible — the module-level object
cannot be swapped for a test double [9][13]:

```python
# VIOLATION: Hard-to-test singleton [9]
# db.py
connection = create_connection(os.environ["DATABASE_URL"])

# service.py
from db import connection  # Cannot mock or swap for tests [13]
```

## Import Violations

### Wildcard Imports [8][3]

Google Style Guide prohibits `import *` — it pollutes the namespace and hides
dependencies [8]. PEP 20: "Explicit is better than implicit" [3]:

```python
# VIOLATION: Pollutes namespace, hides dependencies [8]
from os.path import *
from utils import *

# VIOLATION: Star import in __init__.py [8]
# mypackage/__init__.py
from .models import *
from .services import *
```

### Circular Imports [9][8]

Cosmic Python's layered architecture (domain → adapters → service layer) prevents
circular imports by enforcing one-way dependency flow [9]:

```python
# VIOLATION: Circular dependency [9]
# models.py
from services import UserService  # services imports models too

# services.py
from models import User  # Circular!
```

## Testing Violations

### Assert in Production Code [2][13]

Slatkin Item 88: `assert` is disabled with Python `-O` flag — use explicit checks
with proper exceptions instead [2]:

```python
# VIOLATION: assert is stripped with -O flag [2]
def withdraw(account: Account, amount: float) -> None:
    assert amount > 0, "Amount must be positive"  # Disabled in production!
    assert account.balance >= amount, "Insufficient funds"
    account.balance -= amount
```

### No pytest Fixtures [13][9]

pytest fixture composition avoids repeated setup — Cosmic Python's test patterns
show service fixtures built from smaller, reusable parts [13][9]:

```python
# VIOLATION: Repeated setup in every test [13]
def test_create_user():
    db = Database(":memory:")
    db.create_tables()
    service = UserService(db)
    # ... test logic

def test_update_user():
    db = Database(":memory:")  # Duplicated setup [13]
    db.create_tables()
    service = UserService(db)
    # ... test logic
```

## Protocol Violations

### ABC Where Protocol Suffices [5][1][14]

PEP 544 Protocols provide structural subtyping without coupling the implementor
to the interface module [5]. Ramalho calls ABC-based designs "nominal typing" that
creates unnecessary coupling [1]:

```python
# VIOLATION: Forces third-party class to inherit from your ABC [1]
from abc import ABC, abstractmethod

class Serializable(ABC):
    @abstractmethod
    def to_dict(self) -> dict: ...

# Pydantic models can't be passed without subclassing — breaks duck typing

# CORRECT: Protocol — any class with to_dict() works [5]
from typing import Protocol

class Serializable(Protocol):
    def to_dict(self) -> dict: ...

# Pydantic models, dataclasses, any class with to_dict() works automatically
```
