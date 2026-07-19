# Python Issue Detection

Grep patterns for finding common Python issues. Reference from main SKILL.md.

## Type Safety Detection

### Missing Type Hints

```bash
# Functions without return type annotation
grep -rn "def .*):$" --include="*.py" | grep -v "->.*:"

# Functions without any annotations
grep -rn "def .*([a-z_][a-z_0-9]*\s*," --include="*.py" | grep -v ":"
```

### Bare Except Clauses

```bash
# Bare except (catches everything)
grep -rn "except:" --include="*.py"

# Overly broad except Exception
grep -rn "except Exception:" --include="*.py" | grep -v "# noqa"
```

## Data Modeling Detection

### Mutable Default Arguments

```bash
# List defaults
grep -rn "def .*=\s*\[\]" --include="*.py"

# Dict defaults
grep -rn "def .*=\s*{}" --include="*.py"

# Set defaults
grep -rn "def .*=\s*set()" --include="*.py"
```

### Raw Dict Usage Instead of Dataclasses

```bash
# Dict literals assigned to typed variables
grep -rn ': dict\[' --include="*.py" | grep "= {"

# Nested dict access patterns (fragile)
grep -rn '\["[a-z].*\]\["' --include="*.py"
```

## Anti-Pattern Detection

### Assert in Production Code

```bash
# Assert statements outside test files
grep -rn "^    assert " --include="*.py" | grep -v "test_\|_test\.py\|tests/"
```

### Global Mutable State

```bash
# Global variable assignment
grep -rn "^[a-z_].*= \[\]\|^[a-z_].*= {}\|^[a-z_].*= set()" --include="*.py"

# Global keyword usage
grep -rn "global " --include="*.py"
```

### Old-Style String Formatting

```bash
# Percent formatting
grep -rn '"%.*" %' --include="*.py"
grep -rn "'%.*' %" --include="*.py"

# .format() where f-strings would be cleaner
grep -rn '\.format(' --include="*.py"
```

### Wildcard Imports

```bash
# Star imports
grep -rn "from .* import \*" --include="*.py"
```

## Async Detection

### Missing Await

```bash
# Coroutine called without await (common mistake)
grep -rn "async def" --include="*.py" -l | xargs grep -n "[^await ]fetch\|[^await ]save\|[^await ]send"
```

### Blocking Calls in Async Code

```bash
# time.sleep in async context
grep -rn "time\.sleep" --include="*.py"

# requests library in async files (should use aiohttp/httpx)
grep -rn "import requests\|from requests" --include="*.py"
```

## Security Detection

### Unsafe Deserialization

```bash
# pickle usage (arbitrary code execution risk)
grep -rn "pickle\.loads\|pickle\.load(" --include="*.py"

# yaml.load without SafeLoader
grep -rn "yaml\.load(" --include="*.py" | grep -v "SafeLoader\|safe_load"
```

### Shell Injection

```bash
# subprocess with shell=True
grep -rn "shell=True" --include="*.py"

# os.system calls
grep -rn "os\.system(" --include="*.py"
```
