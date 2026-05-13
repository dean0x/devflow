# Skill Catalog

Reference for companion skills loaded at both GUIDED and ORCHESTRATED depth. The router dispatches by intent and depth to either a `:guided` or `:orch` skill. Both depths load always-on companion skills; GUIDED additionally loads file-type conditionals.

## Companion Skills by Workflow

### IMPLEMENT (implement:guided)

Always loaded: `devflow:test-driven-development`, `devflow:patterns`, `devflow:dependency-research`

| Pattern | Skill |
|---------|-------|
| .ts, .tsx | devflow:typescript |
| .tsx, .jsx | devflow:react |
| .go | devflow:go |
| .java | devflow:java |
| .py | devflow:python |
| .rs | devflow:rust |
| CSS/UI/styling | devflow:ui-design |
| Forms/API/input | devflow:boundary-validation |
| Auth/crypto/secrets | devflow:security |

### DEBUG (debug:guided)

Always loaded: `devflow:test-driven-development`, `devflow:software-design`, `devflow:testing`

Same file-type table as IMPLEMENT.

### PLAN (plan:guided)

Always loaded: `devflow:test-driven-development`, `devflow:patterns`, `devflow:software-design`, `devflow:security`, `devflow:design-review`

### REVIEW (review:guided)

Always loaded: `devflow:quality-gates`, `devflow:software-design`

### EXPLORE (explore:guided)

No companion skills — self-sufficient (Skimmer + code reading + feature knowledge).

### RESEARCH (research:guided)

Loads per-type research skills dynamically (e.g., `devflow:research-codebase`). See research:guided for the type→skill table.

### RELEASE (release:guided)

Loads `devflow:git`. See release:guided.

## ORCHESTRATED Companion Skills

At ORCHESTRATED depth, orch skills and commands load always-on companion skills before their first phase. No file-type conditionals — the orchestrator doesn't know which files will be touched, and agents load their own language/framework skills.

| Intent | Orch Skill / Command | Companions |
|--------|---------------------|------------|
| IMPLEMENT | implement:orch, /implement | `devflow:test-driven-development`, `devflow:patterns`, `devflow:dependency-research` |
| DEBUG | debug:orch, /debug | `devflow:test-driven-development`, `devflow:software-design`, `devflow:testing` |
| PLAN | plan:orch, /plan | `devflow:test-driven-development`, `devflow:patterns`, `devflow:software-design`, `devflow:security`, `devflow:design-review` |
| REVIEW | review:orch, /code-review | `devflow:quality-gates`, `devflow:software-design` |
| RELEASE | release:orch, /release | `devflow:git` |
| EXPLORE | explore:orch, /explore | (none) |
| RESEARCH | research:orch, /research | (none — agents load type-specific skills internally) |
| RESOLVE | resolve:orch, /resolve | (none) |
| PIPELINE | pipeline:orch | (none — delegates to sub-orchestrators) |

## Agent-Internal Skills (Not Router-Loaded)

These skills are always installed (universal skill installation) but loaded by agents internally at runtime, not by the router or guided skills:

- devflow:review-methodology — Full review process (6-step, 3-category classification)
- devflow:complexity — Cyclomatic complexity, deep nesting analysis
- devflow:consistency — Naming convention, pattern deviation detection
- devflow:database — Index analysis, query optimization, migration safety
- devflow:dependencies — CVE detection, license audit, outdated packages
- devflow:documentation — Doc drift, stale comments, missing API docs
- devflow:regression — Lost functionality, broken exports, behavioral changes
- devflow:architecture — SOLID analysis, coupling detection, layering issues
- devflow:accessibility — WCAG compliance, ARIA roles, keyboard navigation
- devflow:performance — N+1 queries, memory leaks, caching opportunities
- devflow:qa — Scenario-based acceptance testing, evidence collection
