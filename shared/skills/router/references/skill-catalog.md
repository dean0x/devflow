# Skill Catalog

Reference for companion skills loaded by each guided skill. The router dispatches by intent and depth to either a `:guided` or `:orch` skill. In ORCHESTRATED mode, agents load their own skills — the router only loads the orch skill.

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
