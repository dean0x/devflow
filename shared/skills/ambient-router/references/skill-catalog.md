# Ambient Router — Skill Catalog

Full mapping of DevFlow skills to ambient intents and file-type triggers. The ambient-router SKILL.md references this for detailed selection logic.

## Skills Available for Ambient Loading

These skills may be loaded during GUIDED and ORCHESTRATED-depth ambient routing.

### IMPLEMENT Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| implementation-orchestration | ORCHESTRATED only | ORCHESTRATED | Any — orchestrates agent pipeline |
| implementation-patterns | Always for IMPLEMENT | GUIDED + ORCHESTRATED | Any code file |
| search-first | Always for IMPLEMENT | GUIDED + ORCHESTRATED | Any — enforces research before building |
| typescript | TypeScript files in scope | GUIDED + ORCHESTRATED | `*.ts`, `*.tsx` |
| react | React components in scope | GUIDED + ORCHESTRATED | `*.tsx`, `*.jsx` |
| frontend-design | UI/styling work | GUIDED + ORCHESTRATED | `*.css`, `*.scss`, `*.tsx` with styling keywords |
| input-validation | Forms, APIs, user input | GUIDED + ORCHESTRATED | Files with form/input/validation keywords |
| go | Go files in scope | GUIDED + ORCHESTRATED | `*.go` |
| java | Java files in scope | GUIDED + ORCHESTRATED | `*.java` |
| python | Python files in scope | GUIDED + ORCHESTRATED | `*.py` |
| rust | Rust files in scope | GUIDED + ORCHESTRATED | `*.rs` |
| security-patterns | Auth, crypto, secrets | GUIDED + ORCHESTRATED | Files with auth/token/crypto/password keywords |

### DEBUG Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| debug-orchestration | ORCHESTRATED only | ORCHESTRATED | Any — orchestrates investigation pipeline |
| core-patterns | Always for DEBUG | GUIDED + ORCHESTRATED | Any code file |
| test-patterns | Always for DEBUG (GUIDED) | GUIDED | Any code file |
| git-safety | Git operations involved | GUIDED + ORCHESTRATED | User mentions git, rebase, merge, etc. |

### REVIEW Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| self-review | Always for REVIEW | GUIDED | Any code file |
| core-patterns | Always for REVIEW | GUIDED | Any code file |
| test-patterns | Test files in scope | GUIDED | `*.test.*`, `*.spec.*` |

### PLAN Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| plan-orchestration | ORCHESTRATED only | ORCHESTRATED | Any — orchestrates design pipeline |
| implementation-patterns | Always for PLAN | GUIDED + ORCHESTRATED | Any planning context |
| core-patterns | Always for PLAN | GUIDED + ORCHESTRATED | System design discussions |

## Skills Excluded from Ambient

These skills are loaded only by explicit DevFlow commands (primarily `/code-review`):

- review-methodology — Full review process (6-step, 3-category classification)
- complexity-patterns — Cyclomatic complexity, deep nesting analysis
- consistency-patterns — Naming convention, pattern deviation detection
- database-patterns — Index analysis, query optimization, migration safety
- dependencies-patterns — CVE detection, license audit, outdated packages
- documentation-patterns — Doc drift, stale comments, missing API docs
- regression-patterns — Lost functionality, broken exports, behavioral changes
- architecture-patterns — SOLID analysis, coupling detection, layering issues
- accessibility — WCAG compliance, ARIA roles, keyboard navigation
- performance-patterns — N+1 queries, memory leaks, caching opportunities

## Selection Limits

- **Maximum 3 knowledge skills** per ambient response (primary + up to 2 secondary)
- **Orchestration skills** (implementation-orchestration, debug-orchestration, plan-orchestration) are loaded only at ORCHESTRATED depth — they don't count toward the knowledge skill limit
- **Primary skills** are always loaded for the classified intent at both GUIDED and ORCHESTRATED depth
- **Secondary skills** are loaded only when file patterns match conversation context
- **GUIDED depth** loads knowledge skills only (no orchestration skills) — main session works directly
- **ORCHESTRATED depth** loads orchestration skill + knowledge skills — agents execute the pipeline
