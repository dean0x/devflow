# Navigation Patterns Reference

Extended pattern discovery workflows, detection tables, and command reference.

---

## Architecture Detection

### Project Architecture Patterns

| Pattern | Indicates |
|---------|-----------|
| `src/routes/` + `src/controllers/` | MVC pattern |
| `src/modules/` with subdirs | Module-based architecture |
| `src/domain/` + `src/application/` | Clean/Hexagonal architecture |
| `src/features/` | Feature-based organization |
| `src/api/` + `src/services/` | Layered architecture |

### Framework Detection

| Files/Patterns | Framework |
|----------------|-----------|
| `next.config.js`, `pages/` or `app/` | Next.js |
| `angular.json` | Angular |
| `nuxt.config.ts` | Nuxt |
| `vite.config.ts` + React | Vite + React |
| `nest-cli.json`, `@Module` decorators | NestJS |
| `express()`, `app.use()` | Express |
| `Hono`, `c.json()` | Hono |

### Database/ORM Detection

| Pattern | Database/ORM |
|---------|--------------|
| `prisma/schema.prisma` | Prisma |
| `drizzle.config.ts` | Drizzle |
| `typeorm` in package.json | TypeORM |
| `sequelize` in package.json | Sequelize |
| `mongoose` in package.json | MongoDB/Mongoose |
| `knex` in package.json | Knex |

---

## Directory Structure Patterns

Common directory patterns to look for:

| Directory | Purpose |
|-----------|---------|
| `src/` | Source code |
| `lib/` | Library code |
| `tests/` | Test files |
| `config/` | Configuration |
| `scripts/` | Build/utility scripts |
| `types/` | Type definitions |
| `utils/` | Utility functions |
| `models/` | Data models |
| `services/` | Business logic |
| `controllers/` | Request handlers |
| `middleware/` | Request middleware |
| `routes/` | API routes |

---

## Navigation Commands

### Language/Framework Detection

```bash
# Check for project markers
ls -la | head -20

# Detect language/framework
[ -f "package.json" ] && echo "Node.js" && cat package.json | grep -E '"(name|scripts|dependencies)"' | head -10
[ -f "Cargo.toml" ] && echo "Rust" && head -20 Cargo.toml
[ -f "go.mod" ] && echo "Go" && cat go.mod
[ -f "pyproject.toml" ] && echo "Python" && head -20 pyproject.toml
[ -f "requirements.txt" ] && echo "Python" && head -10 requirements.txt
```

### Entry Point Detection

```bash
# Node.js entry points
grep -l "main\|start\|server" package.json
cat package.json | grep -A5 '"scripts"'
ls src/index.* src/main.* src/app.* 2>/dev/null

# API projects
ls -la src/routes/ src/api/ src/endpoints/ src/handlers/ 2>/dev/null
grep -r "app\.\(get\|post\|put\|delete\)" --include="*.ts" -l | head -5

# CLI projects
ls src/cli.* src/bin/* bin/* 2>/dev/null
grep -r "commander\|yargs\|argparse" --include="*.ts" -l | head -3
```

### Directory Structure Discovery

```bash
# Get tree structure (depth 3)
find . -type d -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -30
```

---

## Code Search Commands

### Find Files by Pattern

```bash
# Find files by name pattern
find . -name "*user*" -type f -not -path "*/node_modules/*" | head -10
find . -name "*auth*" -type f -not -path "*/node_modules/*" | head -10

# Find by content pattern
grep -r "class.*Service" --include="*.ts" -l | head -5
grep -r "interface.*Repository" --include="*.ts" -l | head -5
grep -r "export.*function" --include="*.ts" -l | head -10
```

### Pattern Discovery

```bash
# How are services structured?
grep -r "class.*Service" --include="*.ts" -A 10 | head -50

# How are API endpoints defined?
grep -r "@Get\|@Post\|app\.get\|app\.post" --include="*.ts" -B 2 -A 5 | head -50

# How are database queries done?
grep -r "prisma\.\|db\.\|repository\." --include="*.ts" | head -20

# How is error handling done?
grep -r "Result\|Either\|throw new\|catch" --include="*.ts" | head -20
```

### Test Discovery

```bash
# Find test files
find . -name "*.test.ts" -o -name "*.spec.ts" | head -10

# Find tests for similar features
grep -r "describe.*[Uu]ser\|it.*should.*user" --include="*.test.ts" -l | head -5

# See test structure
head -50 $(find . -name "*.test.ts" | head -1)
```

---

## Data Flow Tracing

### Input Detection

```bash
# Find where data enters (API endpoints, CLI args, events)
grep -r "req\.body\|req\.params\|req\.query" --include="*.ts" | head -10
grep -r "event\.\|message\.\|payload\." --include="*.ts" | head -10
```

### Processing Detection

```bash
# Find where data is processed (services, handlers)
grep -r "async.*handle\|async.*process\|async.*execute" --include="*.ts" | head -10
```

### Output Detection

```bash
# Find where data exits (responses, database, events)
grep -r "res\.json\|res\.send\|return.*Ok\|emit\(" --include="*.ts" | head -10
```

### Follow Request Path

```bash
# Example: Trace "createUser" flow
# 1. Find the route/endpoint
grep -r "createUser\|create.*user\|POST.*user" --include="*.ts" -l

# 2. Find the handler/controller
grep -r "createUser" --include="*.ts" -B 5 -A 20 | head -50

# 3. Find the service method
grep -r "userService\|UserService" --include="*.ts" | head -10

# 4. Find the repository/database call
grep -r "userRepository\|users\.create\|INSERT.*users" --include="*.ts" | head -10
```

### Dependency Analysis

```bash
# Find imports for a specific file
head -30 src/services/user-service.ts | grep "import"

# Find what imports a specific module
grep -r "from.*user-service\|require.*user-service" --include="*.ts" | head -10

# Find all dependencies of a module
grep -r "import.*from" src/services/user-service.ts
```

---

## Configuration Discovery

### Config File Discovery

```bash
# Read main config files
cat tsconfig.json 2>/dev/null | head -30
cat .env.example 2>/dev/null
cat config/default.* 2>/dev/null | head -30
```

### Type Definition Discovery

```bash
# Find core type definitions
find . -name "*.d.ts" -o -name "types.ts" -o -name "interfaces.ts" | head -10
grep -r "^export.*interface\|^export.*type" --include="*.ts" -l | head -10

# Read main types
cat src/types/*.ts 2>/dev/null | head -100
```

### Utility Discovery

```bash
# Find utility functions
ls src/utils/* src/lib/* src/shared/* 2>/dev/null | head -10
grep -r "export.*function" src/utils/ --include="*.ts" | head -20
```

---

## Quick Reference Commands

```bash
# Find where something is defined
grep -r "export.*MyThing\|class MyThing\|function myThing" --include="*.ts" -l

# Find where something is used
grep -r "MyThing\|myThing" --include="*.ts" | grep -v "export\|import" | head -20

# Find all files in a feature area
find . -name "*user*" -type f | grep -v node_modules | head -20

# Get structure of a directory
ls -la src/services/

# Preview a file
head -50 src/services/user-service.ts

# Find tests for a file
ls tests/**/*user* test/**/*user* 2>/dev/null
```

---

## Navigation Checklist

### Orientation Phase
- [ ] Identified project type and framework
- [ ] Found entry points (main, routes, handlers)
- [ ] Understood directory structure

### Pattern Discovery Phase
- [ ] Found similar existing implementations
- [ ] Identified coding patterns used
- [ ] Located test examples to follow

### Data Flow Phase
- [ ] Traced input to processing to output
- [ ] Understood the dependency chain
- [ ] Found shared utilities to reuse

### Key Files Phase
- [ ] Read relevant type definitions
- [ ] Checked configuration options
- [ ] Found validation patterns

---

## Output Template

After navigation, document findings:

```markdown
## Exploration Results

### Project Overview
- **Type**: Node.js / Express API
- **Language**: TypeScript
- **Database**: PostgreSQL via Prisma
- **Testing**: Vitest

### Relevant Patterns Found
- Services use Result types for error handling
- Repositories abstract database access
- Validation uses Zod schemas at API boundary
- Tests use factory functions for test data

### Files to Reference
- `src/services/order-service.ts` - Similar service pattern
- `src/routes/orders.ts` - Similar route pattern
- `tests/services/order-service.test.ts` - Test pattern

### Where to Implement
- New service: `src/services/`
- New route: `src/routes/`
- New types: `src/types/`
- New tests: `tests/services/`

### Dependencies to Use
- `src/lib/result.ts` - Result type utilities
- `src/utils/validation.ts` - Validation helpers
- `src/repositories/` - Data access layer
```
