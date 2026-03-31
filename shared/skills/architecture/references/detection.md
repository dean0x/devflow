# Detection Patterns

Bash commands and grep patterns for detecting architecture violations. Reference from main SKILL.md.

## SOLID Violations

### Single Responsibility Violations

```bash
# Find god classes (large files)
find . -name "*.ts" -not -path "*/node_modules/*" -exec wc -l {} \; | \
  sort -rn | head -20

# Find classes with too many methods
grep -rn "class.*{" --include="*.ts" -A 100 | \
  grep -E "^\s+(async\s+)?\w+\(" | \
  awk -F: '{print $1}' | sort | uniq -c | sort -rn | head -20

# Find services with too many dependencies (constructor injection)
grep -rn "constructor(" --include="*service*.ts" -A 10 | \
  grep -E "private|readonly" | \
  awk -F: '{print $1}' | sort | uniq -c | sort -rn | head -20

# More than 5 injected dependencies = potential SRP violation
```

### Open/Closed Violations

```bash
# Find switch statements on type fields (often OCP violation)
grep -rn "switch.*type\|switch.*kind\|switch.*status" --include="*.ts"

# Find if-else chains on types
grep -rn "if.*type\s*===\|if.*type\s*==" --include="*.ts" -A 5 | \
  grep -E "else if.*type"

# Find instanceof checks (often indicates missing polymorphism)
grep -rn "instanceof" --include="*.ts"
```

### Liskov Substitution Violations

```bash
# Find methods that throw "not supported" or "not implemented"
grep -rn "throw.*not supported\|throw.*not implemented\|throw.*cannot" --include="*.ts"

# Find overridden methods with different behavior
grep -rn "override\|@Override" --include="*.ts" -A 10 | \
  grep -E "throw|return null|return undefined"
```

### Interface Segregation Violations

```bash
# Find large interfaces (too many methods)
grep -rn "interface.*{" --include="*.ts" -A 50 | \
  grep -E "^\s+\w+\(" | \
  awk -F: '{gsub(/-.*/,"",$1); print $1}' | sort | uniq -c | sort -rn | head -20

# Find implementations that throw on interface methods
grep -rn "implements" --include="*.ts" -A 100 | \
  grep -B 5 "throw.*not\|throw.*Error\|not implemented"
```

### Dependency Inversion Violations

```bash
# Find direct instantiation in services (new keyword)
grep -rn "new [A-Z].*Service\|new [A-Z].*Repository\|new [A-Z].*Client" \
  --include="*.ts" | grep -v "\.test\.\|\.spec\."

# Find concrete class imports in services
grep -rn "import.*Client\|import.*Repository\|import.*Service" \
  --include="*service*.ts" | grep -v "interface\|type\|from.*interface"

# Find services without constructor injection
grep -rn "class.*Service" --include="*.ts" -A 20 | \
  grep -v "constructor" | head -50
```

---

## Coupling Issues

### Circular Dependencies

```bash
# Find potential circular imports between services
for file in $(find . -name "*service*.ts" -not -path "*/node_modules/*"); do
  imports=$(grep "import.*from.*service" "$file" | sed 's/.*from.*\/\([^'"'"'\"]*\).*/\1/')
  for import in $imports; do
    if grep -q "$(basename "$file" .ts)" "$(dirname "$file")/$import.ts" 2>/dev/null; then
      echo "CIRCULAR: $file <-> $import"
    fi
  done
done

# Use madge for accurate circular dependency detection
npx madge --circular src/

# Generate dependency graph
npx madge --image deps.svg src/
```

### Feature Envy

```bash
# Find methods with many dot-chains (accessing other objects' internals)
grep -rn "\.\w\+\.\w\+\.\w\+\.\w\+" --include="*.ts" | \
  grep -v "node_modules\|\.test\.\|\.spec\."

# Find repeated access to same object prefix
grep -rn "this\.\w\+\.\|order\.\|user\.\|customer\." --include="*.ts" | \
  awk -F: '{print $1}' | sort | uniq -c | sort -rn | head -20
```

### Tight Coupling

```bash
# Find direct instantiation (new keyword outside factories/tests)
grep -rn "= new [A-Z]" --include="*.ts" | \
  grep -v "\.test\.\|\.spec\.\|factory\|Factory\|mock\|Mock"

# Find static method calls (often indicates coupling)
grep -rn "[A-Z][a-zA-Z]*\.[a-z][a-zA-Z]*(" --include="*.ts" | \
  grep -v "import\|Math\.\|Date\.\|JSON\.\|Object\.\|Array\.\|console\."

# Find hardcoded configuration
grep -rn "localhost\|127\.0\.0\.1\|:3000\|:5432\|:6379" --include="*.ts" | \
  grep -v "\.test\.\|\.spec\.\|config"
```

---

## Layering Violations

### Skipping Layers

```bash
# Find direct database access in controllers
grep -rn "db\.\|prisma\.\|mongoose\.\|sequelize\." \
  --include="*controller*.ts" --include="*handler*.ts"

# Find direct SQL in non-repository files
grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" --include="*.ts" | \
  grep -v "repository\|Repository\|\.test\.\|\.spec\."

# Find HTTP calls in domain/service layers
grep -rn "fetch(\|axios\.\|http\." --include="*service*.ts" --include="*/domain/*.ts"
```

### Leaky Abstractions

```bash
# Find ORM decorators in domain models
grep -rn "@Entity\|@Column\|@PrimaryKey\|@ManyToOne" --include="*/domain/*.ts"

# Find database-specific types in domain
grep -rn "ObjectId\|QueryResult\|RowDataPacket\|PrismaClient" --include="*/domain/*.ts"

# Find infrastructure imports in domain
grep -rn "import.*from.*infrastructure\|import.*from.*db\|import.*from.*redis" \
  --include="*/domain/*.ts"
```

### Wrong Direction Dependencies

```bash
# Find domain importing from infrastructure
grep -rn "import.*from.*infrastructure\|import.*from.*adapters" \
  --include="*/domain/*.ts"

# Find domain importing from application
grep -rn "import.*from.*application\|import.*from.*services" \
  --include="*/domain/*.ts"

# Check import directions with dependency-cruiser
npx depcruise --validate .dependency-cruiser.js src/
```

---

## Modularity Issues

### God Classes

```bash
# Find files over 500 lines
find . -name "*.ts" -not -path "*/node_modules/*" -exec wc -l {} \; | \
  awk '$1 > 500 {print}' | sort -rn

# Find classes with many public methods
grep -rn "class.*{" --include="*.ts" -A 200 | \
  grep -E "^\s+public\s+\w+\(" | \
  awk -F: '{gsub(/-.*/,"",$1); print $1}' | sort | uniq -c | \
  awk '$1 > 10 {print}' | sort -rn

# Find files with many exports
grep -rn "^export " --include="*.ts" | \
  awk -F: '{print $1}' | sort | uniq -c | \
  awk '$1 > 20 {print}' | sort -rn
```

### Inappropriate Intimacy

```bash
# Find private member access (using type assertions)
grep -rn "as any)\.\|as unknown)\." --include="*.ts"

# Find access to private fields with underscore prefix
grep -rn "\._[a-zA-Z]" --include="*.ts" | grep -v "this\._"

# Find deep object access
grep -rn "\w\+\.\w\+\.\w\+\.\w\+\.\w\+" --include="*.ts"
```

---

## Quick Architecture Audit

Run this script for a quick architecture health check:

```bash
#!/bin/bash

echo "=== Architecture Audit ==="
echo ""

echo "1. God Classes (files > 500 lines):"
find . -name "*.ts" -not -path "*/node_modules/*" -exec wc -l {} \; | \
  awk '$1 > 500 {print "   " $1 " " $2}' | sort -rn | head -10

echo ""
echo "2. Direct DB Access in Controllers:"
grep -rn "db\.\|prisma\.\|mongoose\." --include="*controller*.ts" -l 2>/dev/null | \
  sed 's/^/   /'

echo ""
echo "3. Concrete Instantiation in Services:"
grep -rn "= new [A-Z]" --include="*service*.ts" 2>/dev/null | \
  grep -v "\.test\.\|\.spec\." | head -10 | sed 's/^/   /'

echo ""
echo "4. Domain Importing Infrastructure:"
grep -rn "import.*postgres\|import.*mongo\|import.*redis" \
  --include="*/domain/*.ts" 2>/dev/null | sed 's/^/   /'

echo ""
echo "5. Missing Dependency Injection:"
for f in $(find . -name "*service*.ts" -not -path "*/node_modules/*" 2>/dev/null); do
  if ! grep -q "constructor" "$f"; then
    echo "   $f (no constructor)"
  fi
done | head -10

echo ""
echo "6. Potential Circular Dependencies:"
npx madge --circular src/ 2>/dev/null || echo "   Install madge: npm i -g madge"

echo ""
echo "=== End Audit ==="
```

---

## IDE/Editor Integration

### VS Code Settings

```json
// .vscode/settings.json
{
  "editor.codeActionsOnSave": {
    "source.organizeImports": true
  },
  "typescript.preferences.importModuleSpecifier": "relative",
  "eslint.rules.customizations": [
    { "rule": "no-restricted-imports", "severity": "error" }
  ]
}
```

### ESLint Rules for Architecture

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        // Prevent domain from importing infrastructure
        {
          group: ['**/infrastructure/**'],
          message: 'Domain cannot import from infrastructure'
        },
        // Prevent direct database imports in services
        {
          group: ['pg', 'mysql', 'mongodb', '@prisma/client'],
          message: 'Use repository pattern instead of direct DB access'
        }
      ]
    }],
    // Flag large files
    'max-lines': ['warn', { max: 500 }],
    // Flag too many parameters (potential SRP violation)
    'max-params': ['warn', { max: 5 }]
  }
};
```

### Dependency Cruiser Config

```javascript
// .dependency-cruiser.js
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'domain-cannot-depend-on-infrastructure',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: '^src/infrastructure' }
    },
    {
      name: 'domain-cannot-depend-on-application',
      severity: 'error',
      from: { path: '^src/domain' },
      to: { path: '^src/application' }
    }
  ]
};
```
