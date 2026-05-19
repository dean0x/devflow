# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Engineering Principles

**IMPORTANT**: Follow these principles strictly when implementing features:

1. **Always use Result types** - Never throw errors in business logic
2. **Inject dependencies** - Makes testing trivial
3. **Compose with pipes** - Readable, maintainable chains
4. **Immutable by default** - No mutations, return new objects
5. **Type everything** - No any types, explicit returns
6. **Test behaviors, not implementation** - Focus on integration tests
7. **Resource cleanup** - Always use try/finally or "using" pattern
8. **Structured logging** - JSON logs with context
9. **Validate at boundaries** - Parse, don't validate (Zod schemas)
10. **Performance matters** - Measure, benchmark, optimize

### Code Example (Good)
```typescript
// Result type instead of throwing
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// Dependency injection
class FooManager {
  constructor(
    private readonly process: Process,
    private readonly resource: Resource,
    private readonly logger: Logger
  ) {}
}

// Composable functions with pipes
const processFoo = pipe(
  validateInput,
  checkResources,
  spawnFoo,
  captureOutput,
  handleResult
);

// Immutable updates
const updateBar = (bar: Bar, update: Partial<Bar>): Bar => ({
  ...bar,
  ...update,
  updatedAt: Date.now()
});
```

## Important Guidelines

When working on this codebase:

1. **NO FAKE SOLUTIONS** - Never hardcode responses or data to simulate working
functionality
2. **BE TRANSPARENT** - Always explain when something is a workaround, mock, or temporary
fix
3. **FAIL HONESTLY** - If something can't work, say so clearly instead of hiding it
4. **LABEL EVERYTHING** - Use clear comments: HACK:, MOCK:, TEMPORARY:, NOT-PRODUCTION:
5. **PRODUCTION ONLY** - Unless specifically asked for mocks/demos, only implement real
solutions

When encountering limitations:
- State the blocker clearly
- Provide real alternatives
- Don't paper over problems with fake data

Preferred response format:
- "❌ This won't work because [reason]"
- "⚠️ I could work around it by [approach], but this isn't production-ready"
- "✅ Here's a real solution: [approach]"

## Code Quality Enforcement

**CRITICAL**: Never fix tests by working around bad architecture. Always fix root causes.

### Before Making Any Changes

1. **Identify the root architectural issue** - Don't fix symptoms
2. **Propose the correct design pattern** - Show what good architecture looks like  
3. **Explain why current approach is wrong** - Be specific about the problems
4. **Get explicit approval** for architectural changes before implementing
5. **NEVER implement "quick fixes"** when fundamental design is flawed

### API Consistency Rules

ENFORCE these strictly:
- If one method returns Result<T,E>, ALL related methods must
- If dependency injection is used, apply it consistently throughout
- Stick to ONE async pattern (don't mix promises/async/fire-and-forget)
- NO global state unless explicitly justified

### Test Quality Standards

Tests must validate BEHAVIOR, not work around BAD DESIGN:
- If tests need complex setup, the design is probably wrong
- If tests have repetitive boilerplate, the API is probably wrong
- If mocking is difficult, dependencies are probably wrong
- Tests should be SIMPLE when design is correct

### Change Process for Failing Tests

1. **STOP** - Don't fix tests immediately
2. **ANALYZE** - What is the root architectural issue?
3. **PROPOSE** - What would correct design look like?
4. **COMMUNICATE** - Always say: "I found test failure. Root cause is [X]. To fix properly, I need to [design change]. Should I proceed with proper fix?"
5. **IMPLEMENT** - Design changes first, then update tests

### Red Flags - Stop Immediately If:

- Adding try/catch blocks around test expectations
- Writing "if (!result.ok) return;" boilerplate everywhere
- Using environment variables to work around test conflicts
- Mocking things that should be easily testable
- Adding timeouts to tests to avoid race conditions

### Quality Gates

Before declaring work complete:
- Can you explain the design to junior developer in 2 minutes?
- Are there any "magic" behaviors or implicit dependencies?
- Would this design survive production environment?
- Are tests simple and focused on behavior?
- Is error handling consistent throughout?

