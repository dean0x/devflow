# Navigation Patterns Reference

Extended pattern discovery workflows and detection tables.

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

## Anti-Patterns to Avoid

### Reading Everything
Don't read every file. Focus on:
1. Entry points
2. Similar implementations
3. Type definitions
4. The specific area you're changing

### Ignoring Tests
Tests are documentation. They show:
- How to use the code
- Expected behavior
- Edge cases
- Setup patterns

### Skipping Types
Type definitions reveal:
- Data structures
- API contracts
- Domain concepts
- Relationships

### Not Following Imports
Imports show the dependency graph. Follow them to understand:
- What a module depends on
- How modules connect
- Shared utilities

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
