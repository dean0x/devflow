# Townhall Project - Engineering Instructions

## CRITICAL: READ THIS FIRST

This codebase uses **Hexagonal Architecture with CQRS**. Every line of code you write MUST follow these rules or it will be rejected.

## Architecture Enforcement Rules

### Layer Dependencies (NEVER VIOLATE)

```
Interfaces → Application → Core → Nothing
    ↓           ↓
Infrastructure ←┘
```

- **Core** depends on NOTHING (pure business logic)
- **Application** depends ONLY on Core
- **Infrastructure** implements Core/Application interfaces
- **Interfaces** orchestrate Application commands/queries

**VIOLATIONS THAT WILL BE REJECTED:**
```typescript
// ❌ WRONG: Core importing infrastructure
import { FileStorage } from '../../infrastructure/storage'

// ❌ WRONG: Core knowing about CLI
class Argument {
  toCliOutput(): string { } // Core should never know about CLI
}

// ❌ WRONG: Application doing I/O directly
class CreateArgumentHandler {
  fs.writeFileSync(...) // Handlers MUST use repositories
}
```

## Code Structure Rules

### 1. Result Types EVERYWHERE

**NEVER throw exceptions in business logic:**

```typescript
// ❌ WRONG
async save(arg: Argument): Promise<ArgumentId> {
  if (!arg.isValid()) {
    throw new Error("Invalid argument") // NEVER throw
  }
}

// ✅ CORRECT
async save(arg: Argument): Promise<Result<ArgumentId, ValidationError>> {
  if (!arg.isValid()) {
    return err(new ValidationError("Invalid argument"))
  }
  return ok(arg.id)
}
```

### 2. Dependency Injection ALWAYS

**NEVER create dependencies inside classes:**

```typescript
// ❌ WRONG
class ArgumentService {
  private storage = new FileStorage() // NEVER instantiate directly
}

// ✅ CORRECT
class ArgumentService {
  constructor(
    @inject('ArgumentRepository') private storage: IArgumentRepository
  ) {}
}
```

### 3. Commands/Queries for ALL Operations

**NEVER add business methods to interfaces:**

```typescript
// ❌ WRONG: Business logic in CLI
class ArgumentCommand {
  validatePremises(premises: string[]) { } // NO business logic here
}

// ✅ CORRECT: Use command + handler
const command = new CreateArgumentCommand(...)
const result = await commandBus.execute(command)
```

### 4. Pure Domain Entities

**Domain entities MUST be immutable and framework-agnostic:**

```typescript
// ✅ CORRECT Domain Entity
export class Argument {
  private constructor(
    public readonly id: ArgumentId,
    public readonly content: string
  ) {}

  // Factory method, not constructor
  static create(params: CreateParams): Argument { }

  // Return new instance, never mutate
  withCitation(citation: Citation): Argument {
    return new Argument(this.id, this.content, [...this.citations, citation])
  }
}
```

**NEVER add these to domain entities:**
- Database decorators (`@Entity`, `@Column`)
- Serialization methods (`toJSON`, `toDTO`)
- Framework-specific code (`express.Request`)
- I/O operations (file/network access)

### 5. Repository Interfaces in Core

**Define interfaces in Core, implement in Infrastructure:**

```typescript
// src/core/repositories/IArgumentRepository.ts
export interface IArgumentRepository {
  save(arg: Argument): Promise<Result<ArgumentId, StorageError>>
  findById(id: ArgumentId): Promise<Result<Argument, NotFoundError>>
}

// src/infrastructure/storage/FileArgumentRepository.ts
@injectable()
export class FileArgumentRepository implements IArgumentRepository {
  // Implementation details here
}
```

## File Organization Rules

### STRICT Directory Structure

```
src/
├── core/                 # Business logic ONLY
│   ├── entities/        # Domain entities (Argument, Agent, etc.)
│   ├── value-objects/   # Immutable values (ArgumentId, Timestamp)
│   ├── repositories/    # Interface definitions ONLY
│   └── services/        # Domain services (pure logic)
│
├── application/         # Use case orchestration
│   ├── commands/       # Command definitions
│   ├── queries/        # Query definitions
│   ├── handlers/       # Command/Query handlers
│   ├── events/         # Domain events
│   └── ports/          # Application-level interfaces
│
├── infrastructure/      # External world
│   ├── storage/        # Repository implementations
│   ├── events/         # Event bus implementation
│   └── logging/        # Logger implementation
│
├── interfaces/          # User-facing adapters
│   ├── cli/           # CLI commands
│   ├── api/           # REST routes
│   ├── mcp/           # MCP tools
│   └── sdk/           # Public SDK
│
└── shared/             # Cross-cutting (Result, types)
```

**NEVER put files in wrong directories:**
- No storage code outside `infrastructure/`
- No business logic outside `core/`
- No HTTP/CLI code outside `interfaces/`

## Implementation Checklist

### For EVERY New Feature

1. **Start with Core Domain**
   - [ ] Define domain entity/value object
   - [ ] Define repository interface
   - [ ] Write domain service if needed
   - [ ] NO dependencies, NO I/O, NO frameworks

2. **Create Application Layer**
   - [ ] Define Command/Query class
   - [ ] Create Handler class
   - [ ] Inject repository interfaces
   - [ ] Return Result types
   - [ ] Emit domain events

3. **Implement Infrastructure**
   - [ ] Implement repository interface
   - [ ] Handle actual I/O here
   - [ ] Adapt domain objects to storage format

4. **Add Interface Layer**
   - [ ] Translate user input to Command/Query
   - [ ] Execute via CommandBus/QueryBus
   - [ ] Translate Result to user output
   - [ ] NO business logic

### Before EVERY Commit

- [ ] No imports from infrastructure in core?
- [ ] All methods return Result types?
- [ ] All dependencies injected?
- [ ] Domain entities immutable?
- [ ] Business logic in core only?
- [ ] Tests for business logic?

## Common Violations and Fixes

### Violation 1: Business Logic in Wrong Layer

```typescript
// ❌ WRONG: Validation in CLI
if (content.length < 10) {
  console.error("Argument too short")
}

// ✅ FIX: Move to domain
class ArgumentValidator {
  validate(content: string): Result<void, ValidationError> {
    if (content.length < 10) {
      return err(new ValidationError("Argument too short"))
    }
    return ok(undefined)
  }
}
```

### Violation 2: Direct Infrastructure Access

```typescript
// ❌ WRONG: Handler using filesystem
class CreateArgumentHandler {
  execute(cmd: Command) {
    fs.writeFileSync('.townhall/...', data) // NO!
  }
}

// ✅ FIX: Use repository interface
class CreateArgumentHandler {
  constructor(private repo: IArgumentRepository) {}

  execute(cmd: Command) {
    return this.repo.save(argument)
  }
}
```

### Violation 3: Throwing Exceptions

```typescript
// ❌ WRONG: Throwing in business logic
findById(id: string): Argument {
  const arg = this.storage.get(id)
  if (!arg) throw new Error("Not found") // NO!
  return arg
}

// ✅ FIX: Return Result
findById(id: string): Result<Argument, NotFoundError> {
  const arg = this.storage.get(id)
  if (!arg) return err(new NotFoundError(id))
  return ok(arg)
}
```

## Testing Requirements

### Test Pyramid

1. **Unit Tests (70%)**
   - Test pure domain logic
   - No mocking required if architecture is correct
   - Fast, deterministic

2. **Integration Tests (20%)**
   - Test repository implementations
   - Test command/query handlers
   - Mock external services only

3. **E2E Tests (10%)**
   - Test full user workflows
   - Use real implementations

### Test Location Rules

```
tests/
├── unit/
│   ├── core/           # Domain logic tests
│   └── application/    # Handler tests with mocked repos
├── integration/
│   └── infrastructure/ # Repository tests with real I/O
└── e2e/
    └── interfaces/     # Full flow tests
```

## Git Commit Standards

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code change that neither fixes nor adds
- `test`: Adding tests
- `docs`: Documentation only
- `style`: Formatting (NOT CSS)
- `perf`: Performance improvement
- `chore`: Maintenance

Scopes:
- `core`: Domain logic
- `app`: Application layer
- `infra`: Infrastructure
- `cli`: CLI interface
- `api`: API interface
- `mcp`: MCP interface

### Examples

```
feat(core): add Rebuttal entity with validation

- Rebuttal extends Argument with additional constraints
- Must reference existing argument
- Validates logical consistency

refactor(app): extract common command validation

- Move shared validation to BaseCommandHandler
- Reduce duplication across handlers
- All handlers now extend base class

fix(infra): handle concurrent file writes

- Add file locking mechanism
- Prevent corruption during parallel operations
- Fixes #123
```

## Architecture Decision Records (ADRs)

For ANY architectural change:

1. Create ADR file: `.docs/adr/YYYY-MM-DD-title.md`
2. Include:
   - Context: Why considering change
   - Decision: What we're doing
   - Consequences: Trade-offs
   - Alternatives: What we considered

## Performance Guidelines

### Optimization Rules

1. **Measure First**: Profile before optimizing
2. **Cache Strategically**: Only after measuring
3. **Batch Operations**: Reduce I/O calls
4. **Lazy Loading**: Load on demand
5. **Connection Pooling**: Reuse connections

### Performance Anti-Patterns

```typescript
// ❌ WRONG: N+1 queries
for (const id of argumentIds) {
  const arg = await repo.findById(id) // N database calls
}

// ✅ CORRECT: Batch fetch
const args = await repo.findByIds(argumentIds) // 1 call
```

## Security Requirements

### NEVER Commit These

- API keys, tokens, passwords
- `.env` files with secrets
- Private keys or certificates
- Database connection strings
- User data or PII

### Input Validation

```typescript
// ALWAYS validate at boundaries
class CreateArgumentCommand {
  constructor(params: unknown) {
    const validated = ArgumentSchema.parse(params) // Zod validation
    Object.assign(this, validated)
  }
}
```

## Monitoring and Logging

### Structured Logging

```typescript
// ✅ CORRECT: Structured, contextual
logger.info('Argument created', {
  argumentId: arg.id.value,
  agentId: arg.agentId.value,
  simulationId: context.simulationId,
  duration: performance.now() - startTime
})

// ❌ WRONG: Unstructured strings
console.log(`Created argument ${id} for agent ${agentId}`)
```

## Code Review Checklist

Before requesting review:

- [ ] Follows hexagonal architecture
- [ ] Uses Result types (no throws)
- [ ] Dependencies injected
- [ ] Domain logic in core only
- [ ] Interfaces are thin translators
- [ ] Tests cover business logic
- [ ] No security vulnerabilities
- [ ] Performance considered
- [ ] Documentation updated

## Questions?

If architectural decision unclear:
1. Check `.docs/townhall-product/architecture-decision-multi-interface.md`
2. Check existing code patterns
3. Ask before implementing if still unclear

**Remember: Bad architecture is technical debt. Get it right the first time.**