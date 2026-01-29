---
name: devflow-codebase-navigation
description: Automatically activate when exploring unfamiliar codebases, searching for entry points, tracing data flow, or discovering existing patterns. Triggers when asked to understand, explore, or find code in a codebase before implementation.
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash
---

# Codebase Navigation

Systematic approach to exploring and understanding unfamiliar codebases efficiently.

## Iron Law

> **FIND PATTERNS BEFORE IMPLEMENTING**
>
> Understand existing code before writing new code. Spend 5-10 minutes finding similar
> implementations. The codebase has conventions - discover them, don't invent new ones.
> Inconsistent code is harder to maintain than imperfect-but-consistent code.

## When This Skill Activates

- Starting work on unfamiliar codebase
- Finding where to implement a new feature
- Understanding existing patterns to follow
- Tracing data flow through the system
- Finding test examples to copy

---

## Navigation Workflow

### Phase 1: Orientation (2 min)

**Identify project type and entry points.**

```bash
# Detect language/framework
ls -la | head -20
[ -f "package.json" ] && cat package.json | grep -A5 '"scripts"'

# Find entry points
ls src/index.* src/main.* src/app.* 2>/dev/null
ls -la src/routes/ src/api/ 2>/dev/null
```

### Phase 2: Find Similar Code (3 min)

**Search for existing implementations to follow.**

```bash
# Find files by name
find . -name "*user*" -type f -not -path "*/node_modules/*" | head -10

# Find by content pattern
grep -r "class.*Service" --include="*.ts" -l | head -5

# Find test examples
find . -name "*.test.ts" -o -name "*.spec.ts" | head -10
```

### Phase 3: Trace Data Flow (2 min)

**Follow input -> processing -> output.**

```bash
# Input (API, CLI, events)
grep -r "req\.body\|req\.params" --include="*.ts" | head -10

# Processing (services, handlers)
grep -r "async.*handle\|async.*process" --include="*.ts" | head -10

# Output (responses, database)
grep -r "res\.json\|return.*Ok" --include="*.ts" | head -10
```

### Phase 4: Key Files (2 min)

**Read types, config, and utilities.**

```bash
# Type definitions
find . -name "types.ts" -o -name "interfaces.ts" | head -5

# Configuration
cat tsconfig.json 2>/dev/null | head -30

# Utilities
ls src/utils/* src/lib/* 2>/dev/null | head -10
```

---

## Quick Detection Tables

### Project Type

| Marker | Type |
|--------|------|
| `package.json` | Node.js |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `pyproject.toml` | Python |

### Architecture

| Pattern | Style |
|---------|-------|
| `routes/` + `controllers/` | MVC |
| `domain/` + `application/` | Clean/Hexagonal |
| `features/` | Feature-based |
| `modules/` | Module-based |

### Database

| File | ORM |
|------|-----|
| `prisma/schema.prisma` | Prisma |
| `drizzle.config.ts` | Drizzle |
| `typeorm` in deps | TypeORM |

---

## Core Principles

1. **Focus, don't read everything** - Entry points, similar code, types, your target area
2. **Tests are documentation** - They show usage, behavior, edge cases
3. **Follow imports** - Reveals dependency graph and shared utilities
4. **Match existing patterns** - Consistency over personal preference

---

## Checklist

- [ ] Identified project type and framework
- [ ] Found entry points (main, routes, handlers)
- [ ] Found similar existing implementations
- [ ] Located test examples to follow
- [ ] Read relevant type definitions
- [ ] Identified shared utilities to reuse

---

## Extended References

For extended commands and patterns, see:
- `references/commands.md` - Full bash/grep command reference
- `references/patterns.md` - Detection tables, anti-patterns, output template
