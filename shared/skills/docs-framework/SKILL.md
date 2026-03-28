---
name: docs-framework
description: This skill should be used when the user asks to "create a review report", "write a status log", "add documentation", "name this artifact", or creates files in the .docs/ directory. Provides naming conventions, templates, and directory structure for reviews, debug sessions, design docs, and all persistent DevFlow documentation artifacts.
user-invocable: false
allowed-tools: Read, Bash, Glob
---

# Documentation Framework

The canonical source for documentation conventions in DevFlow. All agents that persist artifacts must follow these standards.

## Iron Law

> **ALL ARTIFACTS FOLLOW NAMING CONVENTIONS**
>
> Timestamps are `YYYY-MM-DD_HHMM`. Branch slugs replace `/` with `-`. Topic slugs are
> lowercase alphanumeric with dashes. No exceptions. Inconsistent naming breaks tooling,
> searching, and automation. Follow the pattern or fix the pattern for everyone.

---

## Directory Structure

All generated documentation lives under `.docs/` in the project root:

```
.docs/
├── reviews/{branch-slug}/              # Code review reports per branch
│   ├── .last-review-head              # HEAD SHA of last completed review (for incremental)
│   ├── {timestamp}/                   # Timestamped review directory (YYYY-MM-DD_HHMM)
│   │   ├── {focus}.md                 # Reviewer report (e.g., security.md, architecture.md)
│   │   ├── review-summary.md          # Synthesizer output
│   │   └── resolution-summary.md      # Written by /resolve (if run)
│   └── {timestamp}/                   # Second review (incremental)
│       ├── {focus}.md
│       └── review-summary.md
├── status/                             # Development logs
│   ├── {timestamp}.md
│   ├── compact/{timestamp}.md
│   └── INDEX.md
└── swarm/                              # Swarm operation state
    ├── state.json
    └── plans/

.memory/
├── WORKING-MEMORY.md                   # Auto-maintained by Stop hook (overwritten)
├── backup.json                         # Pre-compact git state snapshot
└── knowledge/
    ├── decisions.md                    # Architectural decisions (ADR-NNN format)
    └── pitfalls.md                     # Known pitfalls (PF-NNN format)
```

---

## Naming Conventions

### Timestamps
Format: `YYYY-MM-DD_HHMM` (sortable, readable)
```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)  # Example: 2025-12-26_1430
```

### Branch Slugs
Replace `/` with `-`, sanitize special characters:
```bash
BRANCH_SLUG=$(git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone")
```

### Topic Slugs
Lowercase, dashes, alphanumeric only, max 50 chars:
```bash
TOPIC_SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50)
```

### File Naming Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Special indexes | `UPPERCASE.md` | `WORKING-MEMORY.md`, `INDEX.md` |
| Review reports | `{focus}.md` in timestamped dir | `2025-12-26_1430/security.md` |
| Review summary | `review-summary.md` in timestamped dir | `2025-12-26_1430/review-summary.md` |
| Resolution summary | `resolution-summary.md` in timestamped dir | `2025-12-26_1430/resolution-summary.md` |
| Review head marker | `.last-review-head` | Plain text file with SHA |
| Status logs | `{timestamp}.md` | `2025-12-26_1430.md` |

---

## Helper Functions

Source helpers for consistent naming:

```bash
source .devflow/scripts/docs-helpers.sh 2>/dev/null || {
    get_timestamp() { date +%Y-%m-%d_%H%M; }
    get_branch_slug() { git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone"; }
    get_topic_slug() { echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50; }
    ensure_docs_dir() { mkdir -p ".docs/$1"; }
}
```

---

## Agent Persistence Rules

### Agents That Persist Artifacts

| Agent | Output Location | Behavior |
|-------|-----------------|----------|
| Reviewer | `.docs/reviews/{branch-slug}/{timestamp}/{focus}.md` | Creates new in timestamped dir |
| Synthesizer (review) | `.docs/reviews/{branch-slug}/{timestamp}/review-summary.md` | Creates new in timestamped dir |
| Resolver | `.docs/reviews/{branch-slug}/{timestamp}/resolution-summary.md` | Creates new in timestamped dir |
| Code-review cmd | `.docs/reviews/{branch-slug}/.last-review-head` | Overwrites with HEAD SHA |
| Working Memory | `.memory/WORKING-MEMORY.md` | Overwrites (auto-maintained by Stop hook) |
| Knowledge (decisions) | `.memory/knowledge/decisions.md` | Append-only (ADR-NNN sequential IDs) |
| Knowledge (pitfalls) | `.memory/knowledge/pitfalls.md` | Append-only (PF-NNN sequential IDs) |

### Agents That Don't Persist

- Git (fetch-issue: read-only, comment-pr: PR comments only)
- Coder (commits to git, no .docs/ output)

---

## Implementation Checklist

When creating or modifying persisting agents:

- [ ] Use standard timestamp format (`YYYY-MM-DD_HHMM`)
- [ ] Sanitize branch names (replace `/` with `-`)
- [ ] Sanitize topic names (lowercase, dashes, alphanumeric)
- [ ] Create directory with `mkdir -p .docs/{subdir}`
- [ ] Document output location in agent's final message
- [ ] Follow special file naming (UPPERCASE for indexes)
- [ ] Use helper functions when possible
- [ ] Update relevant index files

---

## Integration

This framework is used by:
- **Review agents**: Creates review reports
- **Working Memory hooks**: Auto-maintains `.memory/WORKING-MEMORY.md`
- **Command flows**: `/implement` appends ADRs to `decisions.md`; `/code-review`, `/debug`, `/resolve` append PFs to `pitfalls.md`

All persisting agents should load this skill to ensure consistent documentation.

---

## Extended References

For detailed patterns and violation examples:

- **[patterns.md](./references/patterns.md)** - Full templates, helper functions, naming examples, edge cases
- **[violations.md](./references/violations.md)** - Common violations with detection patterns and fixes
