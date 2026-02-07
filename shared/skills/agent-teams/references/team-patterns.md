# Team Patterns by Workflow

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
| Debugging | 3 | 5 | One per viable hypothesis |
| Parallel coding | 2 | 3 | Merge complexity grows fast |
