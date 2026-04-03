# Ambient Router — Skill Catalog

Full mapping of DevFlow skills to ambient intents and file-type triggers. The ambient-router SKILL.md references this for detailed selection logic.

## Skills Available for Ambient Loading

These skills may be loaded during GUIDED and ORCHESTRATED-depth ambient routing.

### IMPLEMENT Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| devflow:implementation-orchestration | ORCHESTRATED only | ORCHESTRATED | Any — orchestrates agent pipeline |
| devflow:test-driven-development | Always for IMPLEMENT | GUIDED + ORCHESTRATED | Any code file — enforces RED-GREEN-REFACTOR |
| devflow:implementation-patterns | Always for IMPLEMENT | GUIDED + ORCHESTRATED | Any code file |
| devflow:search-first | Always for IMPLEMENT | GUIDED + ORCHESTRATED | Any — enforces research before building |
| devflow:typescript | TypeScript files in scope | GUIDED + ORCHESTRATED | `*.ts`, `*.tsx` |
| devflow:react | React components in scope | GUIDED + ORCHESTRATED | `*.tsx`, `*.jsx` |
| devflow:ui-design | UI/styling work | GUIDED + ORCHESTRATED | `*.css`, `*.scss`, `*.tsx` with styling keywords |
| devflow:boundary-validation | Forms, APIs, user input | GUIDED + ORCHESTRATED | Files with form/input/validation keywords |
| devflow:go | Go files in scope | GUIDED + ORCHESTRATED | `*.go` |
| devflow:java | Java files in scope | GUIDED + ORCHESTRATED | `*.java` |
| devflow:python | Python files in scope | GUIDED + ORCHESTRATED | `*.py` |
| devflow:rust | Rust files in scope | GUIDED + ORCHESTRATED | `*.rs` |
| devflow:security | Auth, crypto, secrets | GUIDED + ORCHESTRATED | Files with auth/token/crypto/password keywords |

### DEBUG Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| devflow:debug-orchestration | ORCHESTRATED only | ORCHESTRATED | Any — orchestrates investigation pipeline |
| devflow:software-design | Always for DEBUG | GUIDED + ORCHESTRATED | Any code file |
| devflow:testing | Always for DEBUG (GUIDED) | GUIDED | Any code file |
| devflow:git | Git operations involved | GUIDED + ORCHESTRATED | User mentions git, rebase, merge, etc. |

### REVIEW Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| devflow:self-review | Always for REVIEW | GUIDED | Any code file |
| devflow:software-design | Always for REVIEW | GUIDED | Any code file |
| devflow:testing | Test files in scope | GUIDED | `*.test.*`, `*.spec.*` |
| devflow:review-orchestration | ORCHESTRATED only | ORCHESTRATED | Any — orchestrates multi-agent review pipeline |

**REVIEW depth is continuation-aware**: If the prior classification in the same conversation was IMPLEMENT/GUIDED → REVIEW stays GUIDED. If prior was IMPLEMENT/ORCHESTRATED → REVIEW becomes ORCHESTRATED. Standalone REVIEW uses signal words: "full review"/"branch review"/"PR review" → ORCHESTRATED, "check this"/"review this file" → GUIDED. Ambiguous → GUIDED.

### RESOLVE Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| devflow:resolve-orchestration | Always for RESOLVE | ORCHESTRATED | Any — orchestrates issue resolution pipeline |
| devflow:software-design | Always for RESOLVE | ORCHESTRATED | Any code file |

RESOLVE is always ORCHESTRATED — it requires multi-agent resolution with Resolver agents and Simplifier.

### PIPELINE Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| devflow:pipeline-orchestration | Always for PIPELINE | ORCHESTRATED | Any — meta-orchestrator for implement → review → resolve |
| devflow:implementation-patterns | Always for PIPELINE | ORCHESTRATED | Any code file |

PIPELINE is always ORCHESTRATED — it chains multiple orchestration stages with user gates.

### PLAN Intent

| Skill | When to Load | Depth | File Patterns |
|-------|-------------|-------|---------------|
| devflow:plan-orchestration | ORCHESTRATED only | ORCHESTRATED | Any — orchestrates design pipeline |
| devflow:implementation-patterns | Always for PLAN | GUIDED + ORCHESTRATED | Any planning context |
| devflow:software-design | Always for PLAN | GUIDED + ORCHESTRATED | System design discussions |

## Skills Excluded from Ambient Router Loading

These skills are always installed (universal skill installation) but loaded by agents internally at runtime, not by the ambient router. Reviewer agents load their pattern skill based on their focus area:

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

## Multi-Worktree Detection

When the user's prompt contains multi-worktree signals ("all worktrees", "all branches", "each worktree", "review everything", "resolve all"), classify as MULTI_WORKTREE intent combined with REVIEW or RESOLVE. This always routes to ORCHESTRATED depth.

| Signal | Combined Intent | Action |
|--------|----------------|--------|
| "review all worktrees/branches" | MULTI_WORKTREE + REVIEW | Follow `devflow:code-review` command flow (auto-discovers worktrees) |
| "resolve all worktrees/branches" | MULTI_WORKTREE + RESOLVE | Follow `devflow:resolve` command flow (auto-discovers worktrees) |
| "review everything that needs review" | MULTI_WORKTREE + REVIEW | Follow `devflow:code-review` command flow |
| "run code review on each branch" | MULTI_WORKTREE + REVIEW | Follow `devflow:code-review` command flow |

No additional skills needed — the code-review and resolve commands handle all orchestration internally, including worktree discovery, incremental detection, and parallel agent spawning.

## Selection Limits

- **Maximum 3 knowledge skills** per ambient response (primary + up to 2 secondary)
- **Orchestration skills** (devflow:implementation-orchestration, devflow:debug-orchestration, devflow:plan-orchestration, devflow:review-orchestration, devflow:resolve-orchestration, devflow:pipeline-orchestration) are loaded only at ORCHESTRATED depth — they don't count toward the knowledge skill limit
- **Primary skills** are always loaded for the classified intent at both GUIDED and ORCHESTRATED depth
- **Secondary skills** are loaded only when file patterns match conversation context
- **GUIDED depth** loads knowledge skills only (no orchestration skills) — main session works directly
- **ORCHESTRATED depth** loads orchestration skill + knowledge skills — agents execute the pipeline
