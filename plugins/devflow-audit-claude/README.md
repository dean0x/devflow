# devflow-audit-claude

Audit CLAUDE.md files against Anthropic's best practices for size, structure, and content quality.

## Command

### `/audit-claude`

Analyzes CLAUDE.md files and reports issues with severity levels and fix suggestions.

```bash
/audit-claude              # Audit all CLAUDE.md files in project + global
/audit-claude ./CLAUDE.md  # Audit a specific file
```

## What It Checks

| Category | What It Finds |
|----------|--------------|
| **SIZE** | Files exceeding line/token limits |
| **MISSING** | Required sections (tech stack, structure, commands) |
| **ANTI-PATTERN** | Content that belongs elsewhere (runbooks, catalogs, style rules) |
| **STRUCTURE** | Deep heading nesting, non-scannable layout |
| **CONTENT** | Generic advice, removable lines, vague instructions |
| **HIERARCHY** | Duplicated content across root/subdir/global |
| **INTEGRATION** | Content that should be skills, hooks, or linter config |
| **CLAUDE-SPECIFIC** | Re-documented skills, agent internals, build details |

## Severity Levels

- **Critical**: File exceeds size limits, missing essential sections
- **High**: Anti-pattern content (runbooks, catalogs), skill re-documentation
- **Medium**: Section bloat, generic advice, integration opportunities
- **Low**: Style issues, minor nesting problems

## Guidelines

Based on Anthropic's official CLAUDE.md guidance:
- Target < 300 lines for root CLAUDE.md
- "For each line, ask whether removing it would cause Claude to make mistakes; if not, cut it"
- Use progressive disclosure: brief summary with pointers to detailed docs
- CLAUDE.md loads every session — only include universally-applicable guidance

## Agent

- `claude-md-auditor` — Plugin-specific agent that runs the 8-category audit rubric
