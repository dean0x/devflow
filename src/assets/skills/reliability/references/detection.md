# Reliability — Detection Patterns

Grep commands for automated detection of reliability violations.

## Unbounded Loops

```bash
# while(true) / for(;;) patterns
grep -rn 'while\s*(true)\|while\s*(1)\|for\s*(;;)' --include="*.ts" --include="*.tsx" --include="*.js"
grep -rn 'while True' --include="*.py"
grep -rn 'for\s*{' --include="*.go" | grep -v 'range\|select\|ctx'
grep -rn 'while\s*(true)\|for\s*(;;)' --include="*.java"
grep -rn 'loop\s*{' --include="*.rs"
```

## Missing Retry Bounds

```bash
# Retry/attempt keywords without max/limit/bound nearby
grep -rn 'retry\|retries\|attempt' --include="*.ts" --include="*.tsx" | grep -v 'max\|limit\|bound\|MAX\|LIMIT'
grep -rn 'retry\|retries\|attempt' --include="*.py" | grep -v 'max\|limit\|bound'
grep -rn 'retry\|retries\|Retry' --include="*.go" | grep -v 'Max\|max\|Limit\|limit'
grep -rn 'retry\|retries\|attempt' --include="*.java" | grep -v 'max\|limit\|MAX'
```

## Excessive Indirection

```bash
# Pointer-to-pointer (Go)
grep -rn '\*\*[A-Z]' --include="*.go"
# Double-boxed types (Rust)
grep -rn 'Box<Box\|Rc<Rc\|Arc<Arc\|&&mut\|&mut &mut' --include="*.rs"
# Triple-nested Map/Record (TypeScript)
grep -rn 'Map<.*Map<.*Map<\|Record<.*Record<.*Record<' --include="*.ts" --include="*.tsx"
```

## Missing Assertions

```bash
# Functions with zero assert/invariant checks (heuristic: find functions > 10 lines)
grep -rn 'function\|fn\s\|def\s\|public\s.*(' --include="*.ts" --include="*.go" --include="*.py" --include="*.java" --include="*.rs" | head -50
# Compare against assertion density
grep -rn 'assert\|invariant\|precondition\|require(' --include="*.ts" --include="*.go" --include="*.py" --include="*.java" --include="*.rs" | wc -l
```

## Allocation in Hot Paths

```bash
# new/make inside for loops (Go)
grep -rn 'make(\|new(' --include="*.go" | grep -B5 'for\s\|range'
# new allocation in loops (Java)
grep -rn 'new\s' --include="*.java" | grep -B5 'for\s*(\|while\s*('
# String concatenation in loops (Python)
grep -rn '+=' --include="*.py" | grep -B3 'for\s\|while\s'
```

## Reflection and Dynamic Dispatch

```bash
# Java reflection
grep -rn 'getClass()\|getMethod\|getDeclaredField\|Class.forName\|\.invoke(' --include="*.java"
# Python dynamic attribute access
grep -rn 'getattr\|setattr\|__getattr__\|eval(\|exec(' --include="*.py"
# TypeScript runtime type checking (often unnecessary)
grep -rn 'eval(\|Function(' --include="*.ts" --include="*.tsx"
```
