# Skill Catalog

Reference for companion skills loaded by commands. Commands load always-on companion skills before their first phase.

## Command Companion Skills

| Intent | Command | Companions |
|--------|---------|------------|
| IMPLEMENT | /implement | `devflow:test-driven-development`, `devflow:patterns`, `devflow:dependency-research` |
| DEBUG | /debug | `devflow:test-driven-development`, `devflow:software-design`, `devflow:testing` |
| PLAN | /plan | `devflow:test-driven-development`, `devflow:patterns`, `devflow:software-design`, `devflow:security`, `devflow:design-review` |
| REVIEW | /code-review | `devflow:quality-gates`, `devflow:software-design` |
| RELEASE | /release | `devflow:git` |
| EXPLORE | /explore | (none) |
| RESEARCH | /research | (none — agents load type-specific skills internally) |
| RESOLVE | /resolve | (none) |

## File-Type Conditional Skills

Commands and Coder agents load language/framework skills based on files touched:

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

## Agent-Internal Skills

These skills are always installed (universal skill installation) but loaded by agents internally at runtime:

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
- devflow:compliance — Regulatory code-level controls: GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX; used by Reviewer (compliance focus), Designer (gap-analysis compliance focus), and Coder (when COMPLIANCE: enabled and regulated surface detected); gated on devflow-compliance plugin installed
