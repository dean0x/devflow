# Documentation Framework Patterns

Correct patterns for DevFlow documentation artifacts:

## Patterns

### Directory Structure

```
.docs/
├── reviews/{branch-slug}/          # Code review reports
├── design/                         # Implementation plans
├── status/                         # Development logs
│   ├── compact/                    # Compact versions
│   └── INDEX.md                    # Status index
└── CATCH_UP.md                     # Latest summary
```

### Naming Conventions

```bash
# Timestamps: YYYY-MM-DD_HHMM
TIMESTAMP=$(date +%Y-%m-%d_%H%M)  # 2025-01-14_2030

# Branch slugs: Replace / with -
BRANCH_SLUG=$(git branch --show-current | sed 's/\//-/g')

# Topic slugs: Lowercase, dashes, alphanumeric
TOPIC_SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
```

## Quick Reference

See [templates.md](templates.md) for full templates and [examples.md](examples.md) for more examples.
