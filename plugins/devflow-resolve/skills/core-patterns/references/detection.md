# Detection Patterns

Grep patterns and code analysis techniques for detecting pattern violations.

---

## Result Type Violations

### Detecting Throws in Business Logic

```bash
# Find throw statements (potential violations)
grep -rn "throw new\|throw Error\|throw \w" --include="*.ts" src/services/ src/domain/

# Find try/catch blocks (review for appropriateness)
grep -rn "try {" --include="*.ts" -A 5 src/services/ src/domain/

# Find functions that don't return Result but could fail
grep -rn "async function\|function" --include="*.ts" src/services/ | grep -v "Result<"
```

### Detecting Silent Failures

```bash
# Empty catch blocks
grep -rn "catch.*{" --include="*.ts" -A 1 | grep -E "catch.*\{\s*\}"

# Catch blocks that return null/undefined
grep -rn "catch" --include="*.ts" -A 3 | grep -E "return (null|undefined|void 0);"

# Catch blocks with only console.log
grep -rn "catch" --include="*.ts" -A 3 | grep -E "^\s*console\.(log|error)"
```

---

## Dependency Injection Violations

### Detecting Internal Instantiation

```bash
# Find 'new' keyword in class bodies (potential DI violation)
grep -rn "private.*= new\|this\.\w* = new" --include="*.ts" src/

# Find imported singletons
grep -rn "import.*from.*\./.*instance\|import.*from.*\./.*singleton" --include="*.ts"

# Find static method calls on external classes
grep -rn "\w+Service\.\w+(\|Calculator\.\w+(" --include="*.ts" src/services/
```

### Detecting Global State Access

```bash
# Find process.env access outside config
grep -rn "process\.env\." --include="*.ts" src/ | grep -v "config\|Config"

# Find global variable access
grep -rn "globalThis\.\|window\.\|global\." --include="*.ts" src/

# Find module-level let/var (mutable global state)
grep -rn "^let \|^var " --include="*.ts" src/
```

---

## Immutability Violations

### Detecting Array Mutations

```bash
# Array mutating methods
grep -rn "\.push(\|\.pop(\|\.shift(\|\.unshift(\|\.splice(\|\.reverse(\|\.sort(\|\.fill(" --include="*.ts" src/

# Assignment to array elements
grep -rn "\[\d+\]\s*=" --include="*.ts" src/

# forEach with mutations
grep -rn "\.forEach.*=>" --include="*.ts" -A 2 | grep -E "\.\w+\s*="
```

### Detecting Object Mutations

```bash
# Direct property assignment on parameters
grep -rn "function.*(\w+:" --include="*.ts" -A 10 | grep -E "^\s+\w+\.\w+\s*="

# delete operator
grep -rn "delete \w+\." --include="*.ts" src/

# Object.assign mutating first argument
grep -rn "Object\.assign(\w+," --include="*.ts" src/
```

---

## Pure Function Violations

### Detecting Side Effects

```bash
# Console/logging in business logic
grep -rn "console\.\|logger\.\|log(" --include="*.ts" src/domain/ src/services/

# Date/time access (non-deterministic)
grep -rn "new Date(\|Date\.now(\|performance\.now(" --include="*.ts" src/domain/

# Random number generation
grep -rn "Math\.random(\|crypto\.random" --include="*.ts" src/domain/

# File system access
grep -rn "fs\.\|readFile\|writeFile" --include="*.ts" src/domain/
```

### Detecting External Dependencies

```bash
# Network calls
grep -rn "fetch(\|axios\.\|http\.\|https\." --include="*.ts" src/domain/

# Database calls
grep -rn "db\.\|prisma\.\|mongoose\.\|sequelize\." --include="*.ts" src/domain/

# Environment access
grep -rn "process\.env\|import\.meta\.env" --include="*.ts" src/domain/
```

---

## Type Safety Violations

### Detecting Any Types

```bash
# Explicit any
grep -rn ": any\|<any>\|as any" --include="*.ts" src/

# Implicit any (missing return types)
grep -rn "function \w+(" --include="*.ts" src/ | grep -v "): \w"

# Type assertions without guards
grep -rn "as \w+\[" --include="*.ts" src/ | grep -v "if.*typeof\|if.*instanceof"
```

### Detecting Non-Exhaustive Patterns

```bash
# Switch without default that might need exhaustive check
grep -rn "switch.*{" --include="*.ts" -A 20 | grep -v "default:"

# If chains without else
grep -rn "if.*===.*'\\|if.*===.*\"" --include="*.ts" -A 5 | grep -v "else"
```

---

## Resource Cleanup Violations

### Detecting Missing Cleanup

```bash
# File opens without close
grep -rn "fs\.open\|createReadStream\|createWriteStream" --include="*.ts" -A 10 | grep -v "close\|finally"

# Connection acquires without release
grep -rn "\.connect(\|getConnection(\|acquire(" --include="*.ts" -A 10 | grep -v "release\|close\|finally"

# Event listeners without removal
grep -rn "\.on(\|addEventListener(" --include="*.ts" | grep -v "removeEventListener\|off("
```

### Detecting Timer Leaks

```bash
# setInterval without clearInterval
grep -rn "setInterval(" --include="*.ts" -B 5 -A 5 | grep -v "clearInterval"

# setTimeout in loops without clear
grep -rn "setTimeout(" --include="*.ts" | grep -v "clearTimeout"
```

---

## API Consistency Violations

### Detecting Mixed Patterns

```bash
# Functions returning different error patterns in same file
grep -rn "return null\|throw new\|return Err\|return { ok:" --include="*.ts" src/services/

# Mixed async patterns
grep -rn "callback\|\.then(\|async " --include="*.ts" src/services/
```

### Detecting Missing Awaits

```bash
# Async calls without await (potential fire-and-forget)
grep -rn "async function" --include="*.ts" -A 20 | grep -E "^\s+\w+\.\w+\(" | grep -v "await\|return"
```

---

## Architecture Violations

### Detecting Layer Boundary Violations

```bash
# Domain importing from infrastructure
grep -rn "from.*\/infrastructure\|from.*\/adapters\|from.*\/repositories" --include="*.ts" src/domain/

# Controllers containing business logic (too many lines)
wc -l src/controllers/*.ts | sort -n | tail -10

# Services importing from controllers
grep -rn "from.*\/controllers\|from.*\/routes\|from.*\/handlers" --include="*.ts" src/services/
```

### Detecting Missing Documentation

```bash
# Public functions without JSDoc
grep -rn "^export function\|^export async function" --include="*.ts" -B 1 | grep -v "/\*\*\|//\|@"

# Classes without documentation
grep -rn "^export class" --include="*.ts" -B 1 | grep -v "/\*\*\|//"
```

---

## Automated Detection Script

```bash
#!/bin/bash
# pattern-check.sh - Detect common pattern violations

echo "=== Pattern Violation Detection ==="
echo ""

echo "1. Checking for throws in business logic..."
THROWS=$(grep -rn "throw new\|throw Error" --include="*.ts" src/services/ src/domain/ 2>/dev/null | wc -l)
echo "   Found: $THROWS potential violations"

echo ""
echo "2. Checking for any types..."
ANYS=$(grep -rn ": any\|<any>\|as any" --include="*.ts" src/ 2>/dev/null | wc -l)
echo "   Found: $ANYS uses of 'any'"

echo ""
echo "3. Checking for array mutations..."
MUTATIONS=$(grep -rn "\.push(\|\.pop(\|\.splice(\|\.sort(" --include="*.ts" src/ 2>/dev/null | wc -l)
echo "   Found: $MUTATIONS potential array mutations"

echo ""
echo "4. Checking for internal instantiation..."
INTERNAL=$(grep -rn "private.*= new\|this\.\w* = new" --include="*.ts" src/ 2>/dev/null | wc -l)
echo "   Found: $INTERNAL internal instantiations (DI violations)"

echo ""
echo "5. Checking for console.log in business logic..."
CONSOLE=$(grep -rn "console\." --include="*.ts" src/services/ src/domain/ 2>/dev/null | wc -l)
echo "   Found: $CONSOLE console statements"

echo ""
echo "=== Summary ==="
TOTAL=$((THROWS + ANYS + MUTATIONS + INTERNAL + CONSOLE))
echo "Total potential violations: $TOTAL"
```

---

## IDE/Editor Integration

### ESLint Rules

```json
{
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-throw-literal": "error",
    "no-console": ["error", { "allow": ["warn", "error"] }],
    "no-param-reassign": "error"
  }
}
```

### TypeScript Compiler Options

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true
  }
}
```
