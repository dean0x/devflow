# Ambient Router — Skill Catalog

Full mapping of DevFlow skills to ambient intents and file-type triggers. The ambient-router SKILL.md references this for detailed selection logic.

## Skills Available for Ambient Loading

These skills may be loaded during STANDARD-depth ambient routing.

### BUILD Intent

| Skill | When to Load | File Patterns |
|-------|-------------|---------------|
| test-driven-development | Always for BUILD | `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.py` |
| implementation-patterns | Always for BUILD | Any code file |
| typescript | TypeScript files in scope | `*.ts`, `*.tsx` |
| react | React components in scope | `*.tsx`, `*.jsx` |
| frontend-design | UI/styling work | `*.css`, `*.scss`, `*.tsx` with styling keywords |
| input-validation | Forms, APIs, user input | Files with form/input/validation keywords |
| security-patterns | Auth, crypto, secrets | Files with auth/token/crypto/password keywords |

### DEBUG Intent

| Skill | When to Load | File Patterns |
|-------|-------------|---------------|
| test-patterns | Always for DEBUG | Any test-related context |
| core-patterns | Always for DEBUG | Any code file |
| git-safety | Git operations involved | User mentions git, rebase, merge, etc. |

### REVIEW Intent

| Skill | When to Load | File Patterns |
|-------|-------------|---------------|
| self-review | Always for REVIEW | Any code file |
| core-patterns | Always for REVIEW | Any code file |
| test-patterns | Test files in scope | `*.test.*`, `*.spec.*` |

### PLAN Intent

| Skill | When to Load | File Patterns |
|-------|-------------|---------------|
| implementation-patterns | Always for PLAN | Any planning context |
| core-patterns | Architectural planning | System design discussions |

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

- **Maximum 3 skills** per ambient response (primary + up to 2 secondary)
- **Primary skills** are always loaded for the classified intent
- **Secondary skills** are loaded only when file patterns match conversation context
- If more than 3 skills seem relevant, this is an ESCALATE signal
