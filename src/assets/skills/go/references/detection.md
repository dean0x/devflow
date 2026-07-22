# Go Issue Detection

Grep and regex patterns for finding common Go issues. Reference from main SKILL.md.

## Error Handling Detection

### Unchecked Errors

```bash
# Find ignored error returns (blank identifier)
grep -rn ', _ := ' --include='*.go' .
grep -rn ', _ = ' --include='*.go' .

# Find bare error returns without wrapping
grep -rn 'return.*err$' --include='*.go' . | grep -v 'fmt.Errorf' | grep -v ':= err'

# Find deferred calls that return errors (Close, Flush, Sync)
grep -rn 'defer.*\.Close()' --include='*.go' .
grep -rn 'defer.*\.Flush()' --include='*.go' .
```

### Missing Error Context

```bash
# Find raw error returns (no wrapping)
grep -rn 'return nil, err$' --include='*.go' .
grep -rn 'return err$' --include='*.go' .
```

---

## Concurrency Detection

### Goroutine Without Context

```bash
# Find goroutines that don't reference ctx
grep -rn 'go func()' --include='*.go' .

# Find goroutines without done/cancel/ctx
grep -B5 -A10 'go func' --include='*.go' . | grep -L 'ctx\|done\|cancel\|errgroup'
```

### Potential Goroutine Leaks

```bash
# Find unbuffered channel creation followed by goroutine
grep -rn 'make(chan ' --include='*.go' . | grep -v ', [0-9]'

# Find goroutines with infinite loops
grep -A5 'go func' --include='*.go' . | grep 'for {'
```

---

## Interface Detection

### Empty Interface Usage

```bash
# Find empty interface (pre-1.18 style)
grep -rn 'interface{}' --include='*.go' .

# Find any type (1.18+ style) - may be intentional, review context
grep -rn '\bany\b' --include='*.go' . | grep -v '_test.go' | grep -v 'vendor/'
```

### Large Interfaces

```bash
# Find interface declarations and count methods (interfaces > 5 methods)
grep -B1 -A20 'type.*interface {' --include='*.go' .
```

---

## Panic Detection

### Panic in Library Code

```bash
# Find panic calls outside main/test
grep -rn 'panic(' --include='*.go' . | grep -v '_test.go' | grep -v 'main.go'

# Find log.Fatal (calls os.Exit) in library code
grep -rn 'log.Fatal' --include='*.go' . | grep -v 'main.go' | grep -v '_test.go'

# Find os.Exit in library code
grep -rn 'os.Exit' --include='*.go' . | grep -v 'main.go' | grep -v '_test.go'
```

---

## init() Detection

```bash
# Find all init functions
grep -rn '^func init()' --include='*.go' .

# Find init functions with side effects (network, file, global state)
grep -A10 '^func init()' --include='*.go' . | grep -E 'http\.|sql\.|os\.|Open|Dial|Connect'
```

---

## Mutex and Race Detection

```bash
# Find mutex passed by value (function params with Mutex, not pointer)
grep -rn 'func.*sync\.Mutex[^*]' --include='*.go' .

# Find Lock without corresponding Unlock
grep -rn '\.Lock()' --include='*.go' . | grep -v 'defer.*Unlock'

# Find RLock without RUnlock
grep -rn '\.RLock()' --include='*.go' . | grep -v 'defer.*RUnlock'
```

---

## Map and Slice Safety

```bash
# Find uninitialized map declarations (potential nil map panic)
grep -rn 'var.*map\[' --include='*.go' . | grep -v 'make\|:='

# Find slice append without pre-allocation hint
grep -rn 'append(' --include='*.go' . | head -20
```
