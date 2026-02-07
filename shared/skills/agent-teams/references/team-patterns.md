# Team Patterns by Workflow

## Task-Based Coordination

All team workflows should use the shared task list for structured progress tracking:

```
1. Lead creates team
2. Lead creates tasks (TaskCreate) for each teammate's work unit
3. Lead spawns teammates, assigning tasks via TaskUpdate(owner)
4. Teammates work, mark tasks completed via TaskUpdate(status: completed)
5. Lead checks TaskList before proceeding to next phase
6. Lead shuts down teammates, calls TeamDelete
```

**Example task creation for a review team:**

```
TaskCreate: "Security review of auth module" → assigned to Security Reviewer
TaskCreate: "Architecture review of auth module" → assigned to Architecture Reviewer
TaskCreate: "Performance review of auth module" → assigned to Performance Reviewer
```

---

## Review Team

### Standard Review (4 perspectives)

```
Lead spawns:
├── Security reviewer    → vulnerabilities, injection, auth, crypto
├── Architecture reviewer → SOLID, coupling, layering, modularity
├── Performance reviewer  → queries, algorithms, caching, I/O
└── Quality reviewer      → complexity, tests, consistency, naming
```

### Extended Review (add conditionally)

```
Additional teammates based on changed files:
├── TypeScript reviewer  → type safety, generics (if .ts/.tsx changed)
├── React reviewer       → hooks, state, rendering (if .tsx/.jsx changed)
├── Database reviewer    → schema, queries, migrations (if DB files changed)
└── Dependencies reviewer → CVEs, versions, licenses (if package files changed)
```

### Review Debate Flow

```
1. Each reviewer analyzes independently
2. Lead broadcasts: "Share top 3 findings and challenge others"
3. Security challenges architecture: "This coupling creates attack surface"
4. Architecture challenges performance: "Your caching suggestion breaks separation"
5. Quality validates: "Tests don't cover the security concern raised"
6. Lead collects consensus after max 2 exchange rounds
```

---

## Implementation Team

### Exploration Team (4 perspectives)

```
Lead spawns:
├── Architecture explorer  → existing patterns, module structure
├── Integration explorer   → entry points, services, config
├── Reusable code explorer → utilities, helpers, shared logic
└── Edge case explorer     → error conditions, boundaries, race conditions
```

### Planning Team (3 perspectives)

```
Lead spawns:
├── Implementation planner → step-by-step coding approach
├── Testing planner        → test strategy and coverage plan
└── Risk planner           → potential issues, rollback strategy
```

### Implementation Debate

```
1. Explorers share findings
2. Architecture challenges edge cases: "This boundary isn't handled"
3. Integration challenges reusable code: "That helper doesn't cover our case"
4. Lead synthesizes consensus exploration

5. Planners propose approaches
6. Testing challenges implementation: "This approach is untestable"
7. Risk challenges both: "Rollback is impossible with this migration"
8. Lead synthesizes consensus plan
```

---

## Specification Team

### Requirements Exploration Team (4 perspectives)

```
Lead spawns:
├── User Perspective Explorer  → target users, goals, pain points, user journeys
├── Similar Features Explorer  → comparable features, scope patterns, precedents
├── Constraints Explorer       → dependencies, business rules, security, performance
└── Failure Mode Explorer      → error states, edge cases, validation needs
```

### Requirements Debate Flow

```
1. Each explorer shares findings from their perspective
2. Constraints challenges user perspective: "This requirement conflicts with X constraint"
3. Failure modes challenges similar features: "That pattern failed in Y scenario"
4. Similar features validates user perspective: "This UX pattern works well in Z"
5. Lead collects consensus after max 2 exchange rounds
```

### Scope Planning Team (3 perspectives)

```
Lead spawns:
├── User Stories Planner       → actors, actions, outcomes ("As X, I want Y, so that Z")
├── Scope Boundaries Planner   → v1 MVP, v2 deferred, out of scope, dependencies
└── Acceptance Criteria Planner → success/failure/edge case criteria (testable)
```

### Scope Debate Flow

```
1. Each planner presents their analysis
2. Scope challenges user stories: "This story is too broad for v1"
3. Acceptance challenges scope: "These boundaries leave this edge case uncovered"
4. User stories challenges acceptance: "This criterion is untestable"
5. Lead collects consensus after max 2 exchange rounds
```

**Note**: Specification teams complement (not replace) the 3 mandatory clarification gates. User still drives all decisions via Gate 0, Gate 1, and Gate 2.

---

## Resolution Team

### Cross-Validation Resolution Team

```
Lead spawns resolvers based on batches:
├── Resolver A → Batch 1 issues (file-a cluster)
├── Resolver B → Batch 2 issues (file-b cluster)
└── Resolver C → Batch 3 issues (file-c cluster)
```

### Resolution Debate Flow

```
1. Each resolver independently validates + fixes their batch
2. Lead broadcasts: "Review each other's fixes for cross-batch conflicts"
3. Resolver A: "My fix in file-a.ts changes the interface that Resolver B depends on"
4. Resolver B: "Confirmed — my fix in file-b.ts imports from that interface"
5. Resolvers coordinate the fix or escalate conflict to lead
6. Lead collects consensus after max 2 exchange rounds
```

### When Cross-Validation Adds Value

- Fixes touch shared interfaces or types
- Resolvers modify files that import from each other
- Batch fixes could introduce conflicting patterns
- Large resolution sets (>5 issues across multiple files)

### When to Skip Cross-Validation

- All fixes are in completely independent files
- Only 1-2 batches with no shared dependencies
- Fixes are trivial (typos, formatting, naming)

---

## Debug Team

### Hypothesis Investigation (3-5 hypotheses)

```
Lead spawns (one per hypothesis):
├── Hypothesis A investigator → state management / race condition
├── Hypothesis B investigator → configuration / environment
├── Hypothesis C investigator → edge case / input validation
└── Hypothesis D investigator → dependency / version issue
```

### Debug Debate Flow

```
1. Each investigator gathers evidence for their hypothesis
2. Lead broadcasts: "Present evidence. Disprove each other."
3. Investigator A: "Found race condition at file:line"
4. Investigator B: "My config theory is disproved by A's evidence"
5. Investigator C: "A's race condition doesn't explain the timing"
6. Converge on surviving hypothesis with strongest evidence
```

---

## Team Size Guidelines

| Scenario | Min | Max | Rationale |
|----------|-----|-----|-----------|
| Quick review | 2 | 3 | Focused, low cost |
| Full review | 4 | 5 | Core perspectives |
| Exploration | 3 | 4 | Diminishing returns beyond 4 |
| Planning | 2 | 3 | Too many cooks |
| Specification (explore) | 3 | 4 | Requirements need diverse perspectives |
| Specification (scope) | 2 | 3 | Scope planning benefits from focus |
| Resolution | 2 | 4 | One per independent batch |
| Debugging | 3 | 5 | One per viable hypothesis |
| Parallel coding | 2 | 3 | Merge complexity grows fast |
