---
name: research
description: Automatically conduct comprehensive research before implementing unfamiliar features or when multiple implementation approaches exist. Use when user requests new functionality, mentions technologies you're unfamiliar with, or when architectural decisions are needed.
allowed-tools: Bash, Read, Grep, Glob, WebFetch, TodoWrite
---

# Research Skill

## Purpose

Conduct thorough pre-implementation research to ensure informed decisions:
1. **Analyze approaches** - Evaluate multiple solutions and trade-offs
2. **Study documentation** - Find official patterns and best practices
3. **Review codebase** - Understand existing architecture and conventions
4. **Design integration** - Plan how new code fits existing patterns
5. **Create plan** - Produce actionable implementation roadmap

## When This Skill Activates

Automatically triggers when:
- User requests implementing unfamiliar technology or pattern
- Multiple implementation approaches are possible
- Architectural decisions need to be made
- Integration with existing code requires planning
- Best practices or official patterns need investigation

## Research Process

### Phase 1: Understand the Request

Analyze what's being asked:
- What problem are we solving?
- What technologies/patterns are involved?
- What constraints exist (time, compatibility, architecture)?
- What success criteria define "done"?

### Phase 2: Explore Implementation Approaches

Research multiple solutions:

```bash
# Search for existing implementations in codebase
rg -i "similar_feature|related_pattern" --type ts --type js

# Find existing architectural patterns
find . -name "*.ts" -type f | head -20 | xargs grep -l "class.*Service\|interface.*Repository"

# Check package.json for relevant dependencies
cat package.json | grep -A 50 "dependencies"
```

**Questions to answer:**
- What approaches have been used successfully in this codebase?
- What libraries or frameworks are already available?
- What patterns would be consistent with existing code?
- What are the trade-offs between approaches?

### Phase 3: Study Official Documentation

For external libraries or patterns:

```markdown
## Documentation Research

Use WebFetch to gather:
- Official quick-start guides
- Best practices documentation
- Common patterns and examples
- Integration guides
- Known limitations or gotchas

Focus on:
- How it's meant to be used (official patterns)
- What our specific use case needs
- How to integrate with existing stack
- Security or performance considerations
```

### Phase 4: Analyze Codebase Patterns

Understand existing architecture:

```bash
# Find similar functionality
rg -i "keyword_related_to_feature" --files-with-matches

# Understand file organization
tree -L 3 src/

# Check existing conventions
grep -r "export class.*Service" src/ | head -10
grep -r "export interface.*Repository" src/ | head -10

# Review recent changes in related areas
git log --oneline --since="1 month ago" -- src/relevant/area/ | head -20
```

**Questions to answer:**
- How is similar functionality currently organized?
- What naming conventions are used?
- What design patterns are prevalent?
- What dependencies are typically injected?
- How is error handling done?

### Phase 5: Design Integration Strategy

Plan how new code fits:

```markdown
## Integration Analysis

**File Structure**:
- Where should new files be created?
- What directory structure matches conventions?
- What test files are needed?

**Dependencies**:
- What existing services can be reused?
- What new dependencies need injection?
- How does this fit the dependency graph?

**Error Handling**:
- Does codebase use Result types?
- Are exceptions used at boundaries?
- What error types already exist?

**Testing Strategy**:
- What test patterns are used?
- How are dependencies mocked/injected?
- What test coverage is expected?

**Architecture Alignment**:
- Does this follow existing patterns?
- Are there architectural principles to follow?
- Any documented design decisions to respect?
```

### Phase 6: Produce Implementation Plan

Create actionable roadmap:

```markdown
## Implementation Plan

### Step 1: Setup/Infrastructure
- [ ] Create directory: `src/services/new-feature/`
- [ ] Add types: `src/types/new-feature.ts`
- [ ] Install dependencies: `npm install library-name`

### Step 2: Core Implementation
- [ ] Implement pure business logic: `src/services/new-feature/logic.ts`
- [ ] Create service wrapper: `src/services/new-feature/service.ts`
- [ ] Add error types: `src/types/errors.ts`

### Step 3: Integration
- [ ] Inject into: `src/main.ts:45`
- [ ] Update configuration: `src/config/services.ts`
- [ ] Add to dependency graph

### Step 4: Testing
- [ ] Unit tests: `src/services/new-feature/logic.test.ts`
- [ ] Integration tests: `src/services/new-feature/service.test.ts`
- [ ] Update test fixtures if needed

### Step 5: Documentation
- [ ] Add JSDoc comments
- [ ] Update README if public API
- [ ] Document any architectural decisions

**Estimated Time**: 4-6 hours
**Key Files to Modify**: [list]
**Dependencies**: [list]
**Risks**: [list potential issues]
```

## Research Output Format

Present findings concisely:

```markdown
🔬 RESEARCH COMPLETE: {Feature/Topic}

## 📊 RECOMMENDED APPROACH

**Solution**: {Chosen approach}

**Rationale**:
- Fits existing architecture (example: matches Service pattern in `src/services/`)
- Uses available dependencies (example: leverages existing `database-client`)
- Follows project conventions (example: Result types, dependency injection)

**Trade-offs**:
- ✅ Advantage 1 (example: minimal new dependencies)
- ✅ Advantage 2 (example: testable without mocks)
- ⚠️  Consideration 1 (example: requires small refactor of X)

## 🏗️ INTEGRATION STRATEGY

**File Structure**:
```
src/
├── services/new-feature/
│   ├── logic.ts          (pure functions)
│   ├── service.ts        (dependency wrapper)
│   └── types.ts          (domain types)
└── services/new-feature/__tests__/
    ├── logic.test.ts
    └── service.test.ts
```

**Dependencies to Inject**:
- `Database` (existing: `src/database/client.ts`)
- `Logger` (existing: `src/utils/logger.ts`)
- `Config` (existing: `src/config/index.ts`)

**Integration Points**:
- Wire in `src/main.ts:67` (following UserService pattern)
- Export from `src/services/index.ts`
- Add to DI container

## 📝 IMPLEMENTATION PLAN

### Phase 1: Foundation (1 hour)
- [ ] Create directory structure
- [ ] Define types and interfaces
- [ ] Add to TypeScript paths

### Phase 2: Core Logic (2 hours)
- [ ] Implement pure business functions
- [ ] Add comprehensive JSDoc
- [ ] Write unit tests (should be simple)

### Phase 3: Service Wrapper (1 hour)
- [ ] Create service class with DI
- [ ] Add Result type error handling
- [ ] Wire up to existing services

### Phase 4: Integration Testing (1 hour)
- [ ] Integration tests
- [ ] Verify DI works correctly
- [ ] Test error scenarios

### Phase 5: Finalization (30 min)
- [ ] Documentation review
- [ ] Run full test suite
- [ ] Architecture alignment check

**Total Estimate**: 5.5 hours

## ⚠️ CONSIDERATIONS

**Risks**:
- {Risk 1}: {mitigation strategy}
- {Risk 2}: {mitigation strategy}

**Dependencies**:
- Requires library X version Y (compatible with current stack)
- No breaking changes to existing code

**Performance**:
- Expected impact: {minimal/moderate/significant}
- Optimization opportunities: {list if any}

**Security**:
- Input validation at: {boundary points}
- Authentication/authorization: {how handled}
- Data exposure risks: {none/mitigated/needs review}

## 🔗 KEY REFERENCES

**Documentation**:
- Official guide: {URL}
- API reference: {URL}
- Examples: {URL}

**Existing Code**:
- Similar pattern: `src/services/existing-service/` (see `logic.ts:45-67`)
- Error handling: `src/types/errors.ts` (Result type pattern)
- Testing approach: `src/services/user/__tests__/` (DI example)

**External Resources**:
- Best practices: {URL}
- Security considerations: {URL}

---

Ready to proceed with implementation? This approach:
✅ Aligns with project architecture
✅ Reuses existing patterns
✅ Minimizes new dependencies
✅ Maintains testability
✅ Follows security practices
```

## Integration with Workflow

Research skill coordinates with other skills:

**Before implementation:**
```
User: "Add JWT authentication"
→ research skill activates
→ Studies official JWT libraries
→ Analyzes existing auth patterns
→ Proposes integration strategy
→ Creates implementation plan
→ Waits for approval
```

**Hands off to:**
- **pattern-check**: Ensures implementation follows patterns
- **test-design**: Verifies tests are simple
- **code-smell**: Catches fake solutions
- **input-validation**: Ensures security boundaries

## Research Quality Criteria

Research is complete when:
- ✅ Multiple approaches evaluated with trade-offs
- ✅ Official documentation reviewed
- ✅ Existing codebase patterns understood
- ✅ Integration strategy defined
- ✅ Step-by-step plan created
- ✅ Risks and considerations documented
- ✅ Time estimate provided
- ✅ Key reference files identified

## Example Scenarios

### Scenario 1: Unfamiliar Library
```
User: "Add Redis caching to the API"
→ Research activates
→ Searches codebase for existing caching
→ Finds in-memory cache pattern
→ Researches Redis best practices
→ Plans migration strategy
→ Proposes approach maintaining existing API
```

### Scenario 2: Multiple Approaches
```
User: "Implement real-time notifications"
→ Research activates
→ Evaluates: WebSockets vs SSE vs Polling
→ Analyzes: Current HTTP server setup
→ Considers: Scale requirements, complexity
→ Recommends: SSE (simpler, fits existing stack)
→ Plans: Integration with current services
```

### Scenario 3: Architectural Decision
```
User: "Refactor authentication system"
→ Research activates
→ Reviews: Current auth implementation
→ Identifies: Security issues, tight coupling
→ Studies: Modern auth patterns
→ Proposes: JWT with refresh tokens
→ Plans: Gradual migration path
```

## Success Metrics

Research was valuable if:
- Implementation follows the plan
- No major surprises during implementation
- Existing patterns were reused correctly
- Integration was smooth
- Tests were simple (good design validated)
- No need for major refactoring afterward

## Philosophy Alignment

This skill enforces:
- **Evidence-driven**: Research before implementation
- **No fake solutions**: Understand properly before coding
- **Fix root causes**: Identify architectural issues early
- **Document decisions**: Create record of why approach was chosen

Research prevents rushing into implementation with incomplete understanding.
